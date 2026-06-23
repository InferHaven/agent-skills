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
         "$DEST/app/patch.py" "$DEST/app/checkpoint-hook.sh" \
         "$DEST/app/install-permissions.py" 2>/dev/null || true

echo "Installed CodeTrain → $DEST"
echo "Restart Claude Code, then say: \"teach me this code\" / \"walk me through this\" / \"give me a practice exercise\"."
echo
echo "Optional: make live tutoring sessions prompt-free with a small, scoped"
echo "allow-list (additive; shown in full before anything is written)."
if [ -t 0 ] && [ -t 1 ]; then
  python3 "$DEST/app/install-permissions.py" --skill-dir "$DEST" || true
else
  echo "  Run when ready:  python3 \"$DEST/app/install-permissions.py\" --skill-dir \"$DEST\""
fi
