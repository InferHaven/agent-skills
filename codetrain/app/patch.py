#!/usr/bin/env python3
"""CodeTrain — apply a small JSON delta to session.json.

Lets the tutor update a session with only the CHANGED fields (read on stdin),
instead of reading + rewriting the whole file each turn — the main token saver.

Special keys (processed, then removed):
  clear_inbox    : true          -> set inbox = []
  learned_append : str | [str]   -> append to learned[]
  step_patch     : {index?, ...}  -> deep-merge ... into steps[index | active]
Everything else is deep-merged into the session (dict -> recursive; else replace).

Usage:  patch.py <session.json> ['<delta>']   (delta as an arg, else read on stdin)

Passing the delta as an ARG lets the tutor run `bash ctl.sh patch <ws> '<delta>'` as
one standalone command — which a single `Bash(bash .../ctl.sh:*)` allow-rule matches.
A piped `printf … | ctl.sh patch` would prompt (Claude Code checks each pipe segment).
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


def main():
    if len(sys.argv) < 2:
        print("usage: patch.py <session.json>", file=sys.stderr)
        sys.exit(2)
    path = sys.argv[1]
    raw = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2].strip() else sys.stdin.read()
    delta = json.loads(raw or "{}")
    with open(path, "r", encoding="utf-8") as f:
        s = json.load(f)

    if delta.pop("clear_inbox", False):
        s["inbox"] = []
    if "learned_append" in delta:
        add = delta.pop("learned_append")
        s.setdefault("learned", [])
        s["learned"].extend(add if isinstance(add, list) else [add])
    if "step_patch" in delta:
        sp = dict(delta.pop("step_patch"))
        idx = sp.pop("index", None)
        steps = s.get("steps")
        if isinstance(steps, list) and steps:
            if idx is None:
                idx = ((s.get("progress") or {}).get("step", 1) or 1) - 1
            if 0 <= idx < len(steps):
                merge(steps[idx], sp)
        elif isinstance(s.get("step"), dict):
            merge(s["step"], sp)

    merge(s, delta)

    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(s, f, indent=2)
    os.replace(tmp, path)
    print("patched")


if __name__ == "__main__":
    main()
