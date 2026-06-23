#!/usr/bin/env bash
# OPTIONAL — CodeTrain "learning checkpoint" nudge. OFF by default.
#
# Enable proactivity (pick ONE):
#
#  A) Stop hook — add to ~/.claude/settings.json:
#       "hooks": { "Stop": [ { "hooks": [ { "type": "command",
#         "command": "bash <SKILL_DIR>/app/checkpoint-hook.sh" } ] } ] }
#
#  B) Simpler & reliable — add one line to your ~/.claude/CLAUDE.md:
#       "After finishing a milestone of coding work, consider offering ONE opt-in
#        CodeTrain learning checkpoint (per the skill's Checkpoints rules)."
#
# This script just emits a short reminder so Claude *considers* a checkpoint — the
# actual decision + throttling live in the skill. Self-throttled to at most once
# per 20 minutes per directory, so it stays quiet and cheap.
set -u
key="$(printf '%s' "${PWD:-x}" | cksum | cut -d' ' -f1)"
stamp="${TMPDIR:-/tmp}/.codetrain-checkpoint-$key"
now="$(date +%s)"
last="$(cat "$stamp" 2>/dev/null || echo 0)"
[ $(( now - last )) -lt 1200 ] && exit 0
printf '%s' "$now" > "$stamp"
echo "CodeTrain: if a milestone with genuine learning value was just completed, you MAY offer ONE short opt-in learning checkpoint (see the skill's Checkpoints rules). Otherwise ignore this."
exit 0
