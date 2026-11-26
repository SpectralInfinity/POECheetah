---
name: wrap-session
description: End-of-session routine for POE Cheetah. Use when the owner says the session is done, asks to wrap up or finish, or after the last milestone of a design-doc row is pushed. Updates docs/progress.md, records learnings, and proposes setup improvements.
---

# Wrap up the session

Do these in order, briefly. Ask the owner only for what you cannot know (usage
percentages, in-game results, whether a correction should become a rule).

1. **Checks.** `npm run typecheck && npm test`, plus `cargo test --workspace` in
   `src-tauri/` if Rust changed (run `scripts/fetch-pob.sh` first if PoB is missing).
   Confirm the feature was checked on the owner's builds in `docs/test-builds/`. Do not
   wrap up with failing checks; say what fails instead.
2. **Progress.** Update `docs/progress.md` as the working agreement says: tick the row
   if it is done (or say what is left, such as an in-game check for the owner), add the
   session's notes, and add the usage row. Ask the owner for the two usage percentages;
   leave `?` if they skip.
3. **Learnings.** Look back over this session for (a) every time the owner corrected
   you or redirected you, and (b) every mistake you caught yourself (wrong game-rule
   assumption, outdated league fact, broken check, rework). Add one dated line each to
   `docs/learnings.md` under "Mistakes to avoid" or "Owner preferences". Write the
   lesson, not the story: "Mercenary numbers come from PoB's calc, not our own math"
   beats "I computed Flame Link wrong". Skip it if there were none. If the file is over
   about 40 lines, merge duplicates.
4. **Setup proposals.** In the pull request description (or the final message if there
   is no PR), add a short "Setup proposals" section: up to three concrete changes to
   `CLAUDE.md`, `src/conventions.test.ts`, skills or the session hook that would have
   made this session faster or avoided a mistake. Prefer a failing test over more
   prose. Do not apply them unless the owner says so.
5. **Next.** End with one line: the next unchecked session row, and anything the owner
   has to check in game before it can be ticked.
