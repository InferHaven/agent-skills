#!/usr/bin/env python3
"""
CodeTrain — local presentation server.

A presentation layer. It serves a responsive tutoring UI and a tiny JSON state
API. It executes user code ONLY inside an optional, sandboxed throwaway container
(bash "Run"); never otherwise.

Contract:
  - Claude (the tutor) writes session.json each turn: the current step, hints,
    feedback, tests, and the running "learned" list.
  - The browser polls GET /api/state ~every 1.2s and renders it.
  - User actions in the browser (submitting code, asking for a hint, choosing a
    level/goal) POST to /api/event. The server appends them to session.json's
    `inbox` queue and, for submissions, writes the code to the workspace file.
  - Claude drains `inbox` on its next turn, reviews, runs tests with its OWN
    tools, and updates session.json again.

Config via environment (or flags):
  TUTOR_SESSION    path to session.json             (required)
  TUTOR_WORKSPACE  root dir for writing code files   (required)
  TUTOR_STATIC     static asset dir (default: ./static next to this file)
  TUTOR_HOST       bind host (default 127.0.0.1 — loopback only)
  TUTOR_PORT       preferred port (default 7341; falls forward if busy)

On start it writes `url.txt` and `server.pid` next to session.json so the tutor
can discover/reuse a running instance and clean it up later.
"""
import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
LOCK = threading.Lock()

_DONE_GRACE = 90          # seconds to keep serving `done` (recap + confetti), then self-exit
_done_timer = None


def _arm_done_shutdown():
    """Once the browser has seen phase:done, keep serving briefly so the recap +
    confetti render, then exit so the detached server doesn't linger. Idempotent.
    (Stopping the server the instant `done` is patched races this poll and freezes
    the page on "reviewing" — let the server retire itself instead.)"""
    global _done_timer
    if _done_timer is None:
        _done_timer = threading.Timer(_DONE_GRACE, lambda: os._exit(0))
        _done_timer.daemon = True
        _done_timer.start()

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".woff2": "font/woff2",
    ".svg": "image/svg+xml",
}


def load_session(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {
            "version": 1,
            "phase": "intake",
            "title": "Your tutor is setting up…",
            "tutor_status": "thinking",
            "inbox": [],
            "learned": [],
        }


def active_step(s):
    """The step the user is currently on — supports steps[] (new) or step (legacy)."""
    steps = s.get("steps")
    if isinstance(steps, list) and steps:
        idx = ((s.get("progress") or {}).get("step", 1) or 1) - 1
        if 0 <= idx < len(steps):
            return steps[idx]
    return s.get("step") or {}


def save_session(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)  # atomic: readers never see a half-written file


def read_profile():
    """Read the local learner profile + a recent-history index (read-only).

    Touches only ~/.codetrain — never executes anything. Powers the UI's Progress
    drawer; the browser fetches it on demand (no tutor turn, no tokens)."""
    home = os.path.expanduser("~")
    base = os.path.join(home, ".codetrain")
    if not os.path.isdir(base) and os.path.isdir(os.path.join(home, ".claude", "codetrain")):
        base = os.path.join(home, ".claude", "codetrain")   # legacy location (pre-relocation)
    prof = {}
    try:
        with open(os.path.join(base, "profile.json"), "r", encoding="utf-8") as f:
            prof = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        prof = {}
    hist = []
    hdir = os.path.join(base, "history")
    try:
        names = sorted((n for n in os.listdir(hdir) if n.endswith(".md")), reverse=True)
    except OSError:
        names = []
    for n in names[:12]:                       # most recent dozen — filenames sort by date
        stem = n[:-3]
        if len(stem) >= 11 and stem[4] == "-" and stem[7] == "-" and stem[10] == "-":
            date, slug = stem[:10], stem[11:]   # <YYYY-MM-DD>-<slug>
        else:
            date, slug = "", stem
        title = slug.replace("-", " ").strip() or stem
        try:
            with open(os.path.join(hdir, n), "r", encoding="utf-8") as f:
                for line in f:                  # first non-empty line = title
                    s = line.strip()
                    if s:
                        title = s.lstrip("# ").strip() or title
                        break
        except OSError:
            pass
        hist.append({"date": date, "slug": slug, "title": title})
    return {"profile": prof if isinstance(prof, dict) else {}, "history": hist}


def safe_join(root, rel):
    """Resolve rel under root, refusing path traversal."""
    root_r = os.path.realpath(root)
    target = os.path.realpath(os.path.join(root_r, rel))
    if target != root_r and not target.startswith(root_r + os.sep):
        raise ValueError("path traversal blocked: %r" % rel)
    return target


# ---- optional sandboxed bash runner -----------------------------------------
# The ONLY place the server executes user code, and only inside a throwaway,
# network-disabled, resource-limited container. If no container runtime + usable
# image are present, this stays disabled and the browser falls back to Claude-run.
RUN_TIMEOUT = 15
_IMG_PREFS = ("alpine", "busybox", "bash", "ubuntu", "debian")


def detect_runtime():
    for rt in ("podman", "docker"):
        if not shutil.which(rt):
            continue
        try:
            out = subprocess.run([rt, "images", "--format", "{{.Repository}}:{{.Tag}}"],
                                 capture_output=True, text=True, timeout=8)
        except Exception:
            continue
        imgs = [l.strip() for l in (out.stdout or "").splitlines() if l.strip() and l != "<none>:<none>"]
        for pref in _IMG_PREFS:
            for img in imgs:
                if img.split("/")[-1].split(":")[0] == pref:
                    return rt, img
    return None, None


RUNTIME, RUN_IMAGE = detect_runtime()


def run_in_container(workspace, code):
    """One-shot, sandboxed bash exec → {stdout, stderr, exit} or {error}."""
    if not RUNTIME or not RUN_IMAGE:
        return {"error": "no container runtime"}
    path = None
    try:
        fd, path = tempfile.mkstemp(prefix=".run-", suffix=".sh", dir=workspace)
        with os.fdopen(fd, "w") as f:
            f.write(code or "")
        cmd = ["timeout", str(RUN_TIMEOUT), RUNTIME, "run", "--rm", "--network=none",
               "--memory=256m", "--pids-limit=128",
               "-v", "%s:/work" % os.path.realpath(workspace), "-w", "/work",
               RUN_IMAGE, "sh", "/work/" + os.path.basename(path)]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=RUN_TIMEOUT + 5)
        return {"stdout": proc.stdout, "stderr": proc.stderr, "exit": proc.returncode}
    except subprocess.TimeoutExpired:
        return {"stdout": "", "stderr": "timed out", "exit": 124}
    except Exception as e:
        return {"error": str(e)}
    finally:
        if path:
            try:
                os.remove(path)
            except Exception:
                pass


class Handler(BaseHTTPRequestHandler):
    session_path = ""   # set in main()
    workspace = ""
    static_dir = ""

    def log_message(self, *args):  # keep the terminal quiet
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _serve_static(self, name):
        try:
            path = safe_join(self.static_dir, name)
        except ValueError:
            return self._send(403, "forbidden", "text/plain")
        if not os.path.isfile(path):
            return self._send(404, "not found", "text/plain")
        with open(path, "rb") as f:
            data = f.read()
        ext = os.path.splitext(path)[1]
        self._send(200, data, CONTENT_TYPES.get(ext, "application/octet-stream"))

    def do_GET(self):
        p = self.path.split("?")[0]
        if p in ("/", "/index.html"):
            return self._serve_static("index.html")
        if p == "/api/state":
            with LOCK:
                data = load_session(self.session_path)
            if data.get("phase") == "done":
                _arm_done_shutdown()
            return self._send(200, json.dumps(data))
        if p == "/api/runtime":
            return self._send(200, json.dumps({"bash": bool(RUNTIME and RUN_IMAGE), "runtime": RUNTIME}))
        if p == "/api/profile":
            return self._send(200, json.dumps(read_profile()))
        if p.startswith("/") and "/" not in p[1:]:  # flat static files only
            return self._serve_static(p[1:])
        self._send(404, "not found", "text/plain")

    def _handle_run(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self._send(400, json.dumps({"ok": False, "error": "bad json"}))
        if (body.get("lang") or "").lower() not in ("bash", "sh", "shell"):
            return self._send(200, json.dumps({"error": "unsupported lang"}))
        return self._send(200, json.dumps(run_in_container(self.workspace, body.get("code", ""))))

    def do_POST(self):
        p = self.path.split("?")[0]
        if p == "/api/run":
            return self._handle_run()
        if p != "/api/event":
            return self._send(404, "not found", "text/plain")
        length = int(self.headers.get("Content-Length", 0) or 0)
        try:
            ev = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self._send(400, json.dumps({"ok": False, "error": "bad json"}))
        ev["ts"] = time.time()
        with LOCK:
            s = load_session(self.session_path)
            s.setdefault("inbox", []).append(ev)
            t = ev.get("type")
            if t == "intake":
                s["level"] = ev.get("level")
                s["goal"] = ev.get("goal")
                s["guidance"] = ev.get("guidance") or "balanced"
                if ev.get("model"):
                    s["model"] = ev.get("model")  # per-session model (Sonnet/Haiku) for the loop
                s["tutor_status"] = "thinking"
            elif t == "submit":
                code = ev.get("code", "")
                files_map = ev.get("files") if isinstance(ev.get("files"), dict) else None
                s["submission"] = {"ts": ev["ts"], "code": code, "note": ev.get("note", ""),
                                   "files": files_map or {}}
                # Write each edited file to its sandbox path (multi-file step), else the single
                # active-step file. safe_join scopes everything to the sandbox workspace.
                writes = files_map.items() if files_map else (
                    [(active_step(s).get("file"), code)] if active_step(s).get("file") else [])
                for rel, fcode in writes:
                    if not rel:
                        continue
                    try:
                        target = safe_join(self.workspace, rel)
                        os.makedirs(os.path.dirname(target), exist_ok=True)
                        with open(target, "w", encoding="utf-8") as f:
                            f.write(fcode if isinstance(fcode, str) else "")
                    except Exception as e:
                        save_session(self.session_path, s)
                        return self._send(200, json.dumps({"ok": False, "error": str(e)}))
                s["tutor_status"] = "thinking"
            elif t in ("question", "end"):
                s["tutor_status"] = "thinking"
            save_session(self.session_path, s)
        self._send(200, json.dumps({"ok": True}))


def find_port(host, start):
    for port in range(start, start + 50):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind((host, port))
            s.close()
            return port
        except OSError:
            s.close()
            continue
    return start


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--session", default=os.environ.get("TUTOR_SESSION"))
    ap.add_argument("--workspace", default=os.environ.get("TUTOR_WORKSPACE"))
    ap.add_argument("--static", default=os.environ.get("TUTOR_STATIC", os.path.join(HERE, "static")))
    ap.add_argument("--host", default=os.environ.get("TUTOR_HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("TUTOR_PORT", "7341")))
    args = ap.parse_args()
    if not args.session or not args.workspace:
        print("ERROR: --session and --workspace are required", file=sys.stderr)
        sys.exit(2)

    tutor_dir = os.path.dirname(args.session)
    os.makedirs(tutor_dir, exist_ok=True)
    Handler.session_path = args.session
    Handler.workspace = args.workspace
    Handler.static_dir = args.static

    port = find_port(args.host, args.port)
    httpd = ThreadingHTTPServer((args.host, port), Handler)
    url = "http://%s:%d" % (args.host, port)
    # discovery + teardown breadcrumbs for the tutor
    with open(os.path.join(tutor_dir, "url.txt"), "w") as f:
        f.write(url + "\n")
    with open(os.path.join(tutor_dir, "server.pid"), "w") as f:
        f.write(str(os.getpid()) + "\n")
    print("TUTOR_URL=" + url, flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
