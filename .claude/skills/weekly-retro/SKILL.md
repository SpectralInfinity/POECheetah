---
name: weekly-retro
description: Weekly retro across the owner's products (PoolParty, Dear Clutter, POE Cheetah). Use only when the owner asks for a weekly retro or review of the week. Looks at what shipped, what non-build work is going stale, and picks the next actions.
---

# Weekly retro

Goal: keep building from crowding out launching, adoption and money. A product's job is
roughly a third launch, a third adoption, a third monetization; the progress logs are
mostly build steps, so this retro looks for the rest. Keep it under 15 minutes of the
owner's time and under 25 lines of output.

1. **Gather (read-only).** For each product repo checked out in this session (this one,
   plus `../dear-clutter`, `../poecheetah`, `../poolparty` or `/home/user/<name>` if
   present; do not clone anything, just note which were missing):
   - `git log --since="8 days ago" --oneline` on the default branch, and open PRs if
     the GitHub tools are available.
   - The next unchecked row and the open owner to-dos (PoolParty and POE Cheetah:
     `docs/progress.md`; Dear Clutter: "Current status" in `CLAUDE.md` and the open
     questions at the end of `docs/product.md`).
   - The last entry in `docs/retros.md` of each repo, if any.
2. **Sort last week's work** into build vs launch/adoption/monetization (store listing,
   real users, pilot hosts, pricing, marketing, payments set-up).
3. **Flag stale items:** owner to-dos and non-build items that were already open in
   the previous retro and are still open. Name them plainly, without guilt.
4. **Ask the owner three short questions**, in one message: How did the week feel?
   Did any real user or tester say anything? Any numbers (pilot bookings, installs,
   users)?
5. **Decide together:** for each product, one non-build action for the coming week and
   the next build row. Suggest; the owner chooses.
6. **Record** a dated entry at the top of `docs/retros.md` in this repo (create it if
   needed): shipped, stale, answers, the chosen actions. Docs-only, so it does not run
   CI; commit it on a `docs/retro-YYYY-MM-DD` branch and open a pull request.
