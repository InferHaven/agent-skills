#!/usr/bin/env bash
# Install the CodeTrain skill into your Claude Code skills directory.
#
#   ./install.sh            # install to ~/.claude/skills/codetrain
#   CLAUDE_SKILLS_DIR=/custom/path ./install.sh
#
# Re-run any time to update. Requires: bash, python3 (used at runtime by the skill).

set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
DEST="$DEST_DIR/codetrain"

command -v python3 >/dev/null 2>&1 || {
  echo "WARNING: python3 not found on PATH — the skill needs it to run the tutor server." >&2
}

mkdir -p "$DEST_DIR"

# Refuse to clobber a symlink (author's dev setup) unless asked.
if [ -L "$DEST" ]; then
  echo "note: $DEST is a symlink; leaving it as-is (you're running from the source repo)."
  exit 0
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC/SKILL.md" "$SRC/app" "$SRC/references" "$DEST/"
[ -f "$SRC/README.md" ] && cp "$SRC/README.md" "$DEST/" || true
chmod +x "$DEST/app/server.py" "$DEST/app/watch.sh" "$DEST/app/ctl.sh" \
         "$DEST/app/patch.py" "$DEST/app/checkpoint-hook.sh" 2>/dev/null || true

echo "Installed CodeTrain → $DEST"
echo "Restart Claude Code, then say: \"teach me this code\" / \"walk me through this\" / \"give me a practice exercise\"."
echo
echo "Optional — for prompt-free live sessions, add these scoped rules to"
echo "~/.claude/settings.json (or .claude/settings.local.json) under permissions.allow:"
echo "    \"Read(//tmp/codetrain-*/**)\","
echo "    \"Write(//tmp/codetrain-*/**)\","
echo "    \"Bash(bash $DEST/app/ctl.sh:*)\""
