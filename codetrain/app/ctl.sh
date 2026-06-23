#!/usr/bin/env bash
# CodeTrain control script.
#
# A single, stable entry point for the tutor's lifecycle commands, so they can be
# allow-listed once in settings.json (no per-turn permission prompts). It avoids
# inline `ENV=… python3 …` prefixes, which break Bash permission prefix-matching.
#
#   ctl.sh serve <workspace>           # start the UI server (run in background)
#   ctl.sh watch <workspace> [iters]   # arm the event watcher (run in background)
#   ctl.sh stop  <workspace>           # stop the server for this workspace
#   ctl.sh patch <workspace>           # merge a JSON delta (on stdin) into session.json
#   ctl.sh run   <workspace>           # run the active step's tests.cmd / submitted file
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cmd="${1:-}"; ws="${2:-}"

case "$cmd" in
  serve)
    [ -n "$ws" ] || { echo "usage: ctl.sh serve <workspace>" >&2; exit 2; }
    TUTOR_SESSION="$ws/.tutor/session.json" TUTOR_WORKSPACE="$ws" exec python3 "$HERE/server.py" ;;
  watch)
    [ -n "$ws" ] || { echo "usage: ctl.sh watch <workspace> [iters]" >&2; exit 2; }
    exec bash "$HERE/watch.sh" "$ws/.tutor/session.json" "${3:-900}" ;;
  stop)
    pid="$(cat "$ws/.tutor/server.pid" 2>/dev/null || true)"
    [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null && echo "stopped $pid" || echo "no server running"
    ;;
  patch)
    [ -n "$ws" ] || { echo "usage: ctl.sh patch <workspace>  (JSON delta on stdin)" >&2; exit 2; }
    exec python3 "$HERE/patch.py" "$ws/.tutor/session.json" ;;
  run)
    # Run the active step's declared tests.cmd, else `sh <submitted file>`, in the
    # workspace. Only runs the lesson's own command / the user's own file — never
    # arbitrary input — so it's safe to allow-list for prompt-free tutor reviews.
    [ -n "$ws" ] || { echo "usage: ctl.sh run <workspace>" >&2; exit 2; }
    S="$ws/.tutor/session.json"
    line="$(python3 - "$S" <<'PY'
import json, sys
try: s=json.load(open(sys.argv[1]))
except Exception: print("\t"); raise SystemExit
steps=s.get("steps")
st=steps[((s.get("progress") or {}).get("step",1) or 1)-1] if isinstance(steps,list) and steps else (s.get("step") or {})
t=(st.get("tests") or s.get("tests") or {})
print((t.get("cmd") or "")+"\t"+(st.get("file") or ""))
PY
)"
    cmd_str="${line%%$'\t'*}"; file_str="${line#*$'\t'}"
    cd "$ws" || exit 1
    if [ -n "$cmd_str" ]; then
      eval "$cmd_str"
    elif [ -n "$file_str" ] && [ -f "$file_str" ]; then
      sh "$file_str"
    else
      echo "(nothing to run for this step)"
    fi
    ;;
  *) echo "usage: ctl.sh {serve|watch|stop|patch|run} <workspace>" >&2; exit 2 ;;
esac
