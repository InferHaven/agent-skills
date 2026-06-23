#!/usr/bin/env bash
# CodeTrain — event watcher.
#
# Blocks (≈0 Claude tokens — just a sleeping shell) until a NEW actionable event
# lands: intake / submit / question / end / resume. Then it prints a compact
# payload and exits, which wakes the tutor for ONE turn. Hints never wake the tutor.
#
# The payload carries everything needed to act WITHOUT re-reading session.json:
# the event type, plus code / client-test summary / question text as relevant.
#
# Usage:  watch.sh <path/to/session.json> [timeout_iterations]
# Default timeout: 900 iterations * 2s ≈ 30 minutes.

set -u
S="${1:?usage: watch.sh <session.json> [iterations]}"
TIMEOUT="${2:-900}"

trig() {
  python3 -c "import json
try: s=json.load(open('$S'))
except Exception: print(0); raise SystemExit
t=float(s.get('submission',{}).get('ts',0) or 0)
for e in s.get('inbox',[]):
    if e.get('type') in ('intake','submit','question','end','resume'):
        t=max(t, float(e.get('ts',0) or 0))
print(t)" 2>/dev/null
}

base="$(trig)"
i=0
while [ "$i" -lt "$TIMEOUT" ]; do
  cur="$(trig)"
  if [ "$cur" != "$base" ]; then
    python3 -c "import json
s=json.load(open('$S'))
sub=s.get('submission',{})
ev={}
for e in reversed(s.get('inbox',[])):
    if e.get('type') in ('intake','submit','question','end','resume'): ev=e; break
t=ev.get('type','submit')
print('NEW_EVENT:'+t.upper())
if t=='end':
    print('--- end ---')
    print('User clicked END SESSION. Write the congratulatory done screen + summary, save history + update the profile, then stop the server.')
elif t=='intake':
    print('--- intake ---'); print('level=%r goal=%r' % (s.get('level'), s.get('goal')))
    print('Author the lesson now (full steps[] plan), set phase=learning + step 1, then re-arm.')
elif t=='resume':
    print('--- resume ---'); print('User resumed. Set tutor_status=listening, welcome them back briefly, re-arm.')
elif t=='question':
    print('--- question ---'); print(ev.get('text','') or '(none)')
    print('--- their current code ---'); print(ev.get('code','') or '(none)')
else:
    print('--- note ---'); print(sub.get('note','') or '(none)')
    print('--- review_request ---'); print('YES — give the full walkthrough even if failing' if ev.get('review_request') else 'no')
    print('--- client_tests ---'); ct=ev.get('client_tests'); print(json.dumps(ct) if ct else '(none — run them yourself or trust the code)')
    print('--- code ---'); print(sub.get('code',''))" 2>/dev/null
    exit 0
  fi
  sleep 2
  i=$((i + 1))
done
echo "TIMEOUT"
exit 0
