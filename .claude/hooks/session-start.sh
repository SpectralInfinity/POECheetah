#!/bin/sh
# Session start: show the next session row and what earlier sessions learned, so every
# session starts from the same place. Read-only and fast; it never fails the session
# (CLAUDE.md is the guidance, this is the reminder).
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

echo "## Session start"
if [ -f docs/progress.md ]; then
  echo "Next session row (docs/progress.md):"
  # First unchecked item (with its indented continuation lines) under "## Sessions".
  awk '
    index($0, "## Sessions") == 1 { s = 1; next }
    s && /^## / { exit }
    s && /^- \[ \]/ { p = 1; print; next }
    p && /^  / { print; next }
    p { exit }
  ' docs/progress.md
fi
if [ -f docs/learnings.md ]; then
  echo
  echo "Learnings from earlier sessions (docs/learnings.md):"
  sed -n '/^## /,$p' docs/learnings.md | head -80
fi
echo
echo "End the session with /wrap-session. Once a week, the owner may ask for /weekly-retro."
exit 0
