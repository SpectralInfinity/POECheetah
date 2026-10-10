# Progress

## Sessions (design doc §7)

- [x] 0. Planning + foundations: design doc, Tauri app, CI Windows installer,
      PoB code reader. *Done when* you install the app and it shows your
      build's class and level. (Built 2026-10-10 as v0.1.0; tick once installed
      from the CI artifact and a real PoB code reads correctly.)
- [x] 1. PoB engine (headless PoB inside the app) + saved builds.
      (Built 2026-10-10 as v0.2.0; tick once the installed app shows your
      build's stats matching PoB.)
- [x] 2. Build health check + try an item.
      (Built 2026-10-10 as v0.3.0; tick once the warnings on your build make
      sense and trying an item from the game works.)
- [ ] 3. Honest DPS and boss check; support gem / pantheon / flask ranking.
- [ ] 4. Passive advisor.
- [ ] 5. Item upgrade advisor.
- [ ] 6. Item check from the game clipboard.
- [ ] 7. Compare to a target build / guide (incl. Maxroll stages); build links.
- [ ] 7b. Meta comparison with poe.ninja.
- [ ] 8. Run tracker (game log).
- [ ] 9. Earnings and farming advisor (needs GGG OAuth approval).
- [ ] 10. League mechanics (3.29 mercenaries).

## Session notes

- **0:** Stack and CI copied from Dancing Cabbage (same versions). The
  installer is the CI run's `poecheetah-windows-<sha>` artifact (unsigned:
  SmartScreen warns). The Rust shell is only checked in CI: this Linux
  environment has no WebKitGTK. PoB codes are decoded in TypeScript
  (`src/core/buildCode.ts`, `DecompressionStream("deflate")`), so the Lua
  engine can be handed XML.
- **Reference build for sessions 1–2** (the user's character, code not
  committed; ask for it again): level 95 Scion / Reliquarian, PoB tree 3_29,
  main skill Poisonous Concoction of Bouncing (body armour group). PoB's own
  numbers to match: Combined DPS 5,358,662 (hit 345,272 + poison), Total EHP
  56,898, life 2,959, armour 2,685, evasion 1,453, block 47%, suppression 100%,
  phys max hit 31,591. Cold/lightning resist show −50% (two Betrayal's Sting).
  Damage shifted to fire (90% res): cold 50% and lightning 54% (Reliquarian
  Dawnbreaker display 25/25, Dawnbreaker shield 11/15, Watcher's Eye 14/14 with
  Purity of Fire); physical 91% (+ Cloak of Flame 40%, a jewel 6%). Yet PoB
  shows cold max hit = fire max hit (47,845) and lightning 45,998: unexplained
  by the shifts alone. Check PoB's breakdown for these once the engine runs.

- **1:** Engine = `src-tauri/pob-engine` (LuaJIT via mlua, PoB's
  HeadlessWrapper, real zlib; see design doc §5.1). Run
  `scripts/fetch-pob.sh` once before `cargo test` or `npm run tauri dev`
  (CI does it, cached). `cargo run --release --example stats -- build.xml` in
  `src-tauri/pob-engine` prints a build's stats. Matches the reference build
  exactly. Saved builds: SQLite (`src/data/builds.ts`, migration 0001), each
  pasted code is a version; the UI shows changes since the previous version.
  Browser preview uses an in-memory store and sample numbers. This Linux
  environment can compile the Tauri shell after
  `apt-get install libwebkit2gtk-4.1-dev librsvg2-dev`.
  Not done yet: why cold max hit = fire max hit on the reference build
  (inspect with the engine in session 2).

- **2:** Health check = `src/core/health.ts` (rules + `THRESHOLDS`, tested
  on numbers shaped like the reference build). Versions now store PoB's full
  numeric output (≈650 stats), not just the headline ones; builds saved by
  v0.2.0 need "Recalculate" for the health check. Try an item = engine
  `tryItem` (PoB's own item-compare calculator, `GetMiscCalculator` with
  `repSlotName`/`repItem`), every valid slot of the active weapon set, jewel
  sockets included. Limitation: timeless/cluster jewels that change the tree
  aren't re-planned (PoB's tooltip does that with private helpers). Dev tool:
  `cargo run --release --example stats -- build.xml --item item.txt`.
  On the reference build the check found: weak to chaos hits, 88% hit
  chance, intelligence 91/98, small pool; cold/lightning "covered".

## Usage log (claude.ai → Settings → Usage)

| Date | Session | Window before → after | Weekly before → after | Notes |
|---|---|---|---|---|
| 2026-10-10 | 0. Planning + foundations | ? → 31% | ~0% → 5% | Started in a Dancing Cabbage session; repo attached mid-session |
| 2026-10-10 | 1–2. PoB engine + saved builds; health check + try an item | 31% → 89% | 5% → 14% | Same conversation as session 0, so not separable; another session ran at the same time, so these overstate the cost |
