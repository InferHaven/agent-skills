#!/usr/bin/env python3
"""CodeTrain — apply a small JSON delta to session.json.

Lets the tutor update a session with only the CHANGED fields, instead of reading +
rewriting the whole file each turn — the main token saver.

The delta is read from (in priority order):
  1. <session-dir>/patch.json  — the tutor writes this with the Write tool, then runs
     `bash ctl.sh patch <ws>`. This is the robust path: no shell quoting (JSON with
     `(`, quotes, or newlines just works) and no permission prompt. patch.json is
     deleted after a successful apply.
  2. argv[2]                   — a delta passed as an arg (fragile with quotes; back-compat).
  3. stdin                     — a piped delta (back-compat).

Special keys (processed, then removed):
  clear_inbox    : true           -> set inbox = []
  learned_append : str | [str]    -> append to learned[]
  steps_append   : {…} | [{…}]    -> append new step(s) to steps[] (lazy authoring)
  step_patch     : {index?, ...}   -> merge into steps[index | active]; APPENDS if the
                                      index is out of range (never silently dropped)
Dotted top-level keys are expanded ("progress.step": 1 -> {"progress": {"step": 1}}),
so a model that flattens keys still patches correctly. Everything else is deep-merged
(dict -> recursive; else replace).

Usage:  patch.py <session.json> ['<delta>']
"""
import json
import os
import sys


def merge(dst, src):
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            merge(dst[k], v)
        else:
            dst[k] = v
    return dst


def expand_dotted(d):
    """{"a.b": 1, "x": 2} -> {"a": {"b": 1}, "x": 2}  (top-level dotted keys only)."""
    out = {}
    for k, v in d.items():
        if isinstance(k, str) and "." in k:
            cur = out
            parts = k.split(".")
            for p in parts[:-1]:
                nxt = cur.get(p)
                if not isinstance(nxt, dict):
                    nxt = {}
                    cur[p] = nxt
                cur = nxt
            cur[parts[-1]] = v
        else:
            out[k] = v
    return out


def main():
    if len(sys.argv) < 2:
        print("usage: patch.py <session.json> ['<delta>']", file=sys.stderr)
        sys.exit(2)
    path = sys.argv[1]
    patch_file = os.path.join(os.path.dirname(path), "patch.json")

    used_file = False
    if os.path.exists(patch_file):
        with open(patch_file, "r", encoding="utf-8") as f:
            raw = f.read()
        used_file = True
    elif len(sys.argv) > 2 and sys.argv[2].strip():
        raw = sys.argv[2]
    else:
        raw = sys.stdin.read()
    delta = json.loads(raw or "{}")

    with open(path, "r", encoding="utf-8") as f:
        s = json.load(f)

    if delta.pop("clear_inbox", False):
        s["inbox"] = []
    if "learned_append" in delta:
        add = delta.pop("learned_append")
        s.setdefault("learned", [])
        s["learned"].extend(add if isinstance(add, list) else [add])
    if "steps_append" in delta:
        add = delta.pop("steps_append")
        s.setdefault("steps", [])
        if isinstance(s["steps"], list):
            s["steps"].extend(add if isinstance(add, list) else [add])
    if "step_patch" in delta:
        sp = dict(delta.pop("step_patch"))
        idx = sp.pop("index", None)
        steps = s.get("steps")
        if isinstance(steps, list):
            if idx is None:
                idx = ((s.get("progress") or {}).get("step", 1) or 1) - 1
            if 0 <= idx < len(steps):
                merge(steps[idx], sp)
            else:                       # out of range -> append; NEVER silently drop
                steps.append(sp)
        elif isinstance(s.get("step"), dict):
            merge(s["step"], sp)
        else:
            s["steps"] = [sp]

    merge(s, expand_dotted(delta))

    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(s, f, indent=2)
    os.replace(tmp, path)
    if used_file:
        try:
            os.remove(patch_file)
        except OSError:
            pass
    print("patched (steps=%d)" % len(s.get("steps") or []))


if __name__ == "__main__":
    main()
