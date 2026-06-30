#!/usr/bin/env bash
# CodeTrain control script.
#
# A single, stable entry point for the tutor's lifecycle commands, so they can be
# allow-listed once in settings.json (no per-turn permission prompts). It avoids
# inline `ENV=… python3 …` prefixes, which break Bash permission prefix-matching.
#
#   ctl.sh sandbox                         # make a throwaway /tmp/codetrain-* dir; prints its path
#   ctl.sh serve <session-dir> [code-root] # start the UI server, DETACHED (survives the session)
#   ctl.sh watch <session-dir> [iters]     # arm the event watcher (run in background)
#   ctl.sh stop  <session-dir>             # stop the server for this session
#   ctl.sh patch <session-dir>             # apply .tutor/patch.json (write it with the Write tool)
#   ctl.sh run   <session-dir>             # run the active step's tests.cmd / submitted file
#
# Call each command STANDALONE (never inside a pipe, `;`, `&&`, or `$( )`) so one
# `Bash(bash .../ctl.sh:*)` allow-rule covers the whole live loop prompt-free.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cmd="${1:-}"; ws="${2:-}"

case "$cmd" in
  sandbox)
    ws="$(mktemp -d /tmp/codetrain-XXXXXX)" || { echo "mktemp failed" >&2; exit 1; }
    mkdir -p "$ws/.tutor"
    printf '%s\n' "$ws" ;;
  serve)
    # <ws> = session-dir (.tutor state lives here — keep it under /tmp so it's allow-listed).
    # Optional [code-root] is where submitted code is written (local code); defaults to <ws>.
    # Detached (setsid + nohup) so the page outlives the Claude session that started it.
    [ -n "$ws" ] || { echo "usage: ctl.sh serve <session-dir> [code-root]" >&2; exit 2; }
    code="${3:-$ws}"
    mkdir -p "$ws/.tutor"
    rm -f "$ws/.tutor/url.txt"
    TUTOR_SESSION="$ws/.tutor/session.json" TUTOR_WORKSPACE="$code" \
      setsid nohup python3 "$HERE/server.py" >"$ws/.tutor/serve.log" 2>&1 </dev/null &
    for _ in $(seq 1 40); do [ -f "$ws/.tutor/url.txt" ] && break; sleep 0.1; done
    url="$(cat "$ws/.tutor/url.txt" 2>/dev/null || true)"
    [ -n "$url" ] && echo "TUTOR_URL=$url" || { echo "server failed to start; see $ws/.tutor/serve.log" >&2; exit 1; } ;;
  watch)
    [ -n "$ws" ] || { echo "usage: ctl.sh watch <workspace> [iters]" >&2; exit 2; }
    exec bash "$HERE/watch.sh" "$ws/.tutor/session.json" "${3:-900}" ;;
  stop)
    pid="$(cat "$ws/.tutor/server.pid" 2>/dev/null || true)"
    [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null && echo "stopped $pid" || echo "no server running"
    ;;
  patch)
    # Applies <ws>/.tutor/patch.json (the tutor writes it with the Write tool — robust,
    # no shell quoting, no prompt). Falls back to a delta arg / stdin for back-compat.
    [ -n "$ws" ] || { echo "usage: ctl.sh patch <session-dir>  (write .tutor/patch.json first)" >&2; exit 2; }
    exec python3 "$HERE/patch.py" "$ws/.tutor/session.json" "${3-}" ;;
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
  *) echo "usage: ctl.sh {sandbox|serve|watch|stop|patch|run} <workspace>" >&2; exit 2 ;;
esac
