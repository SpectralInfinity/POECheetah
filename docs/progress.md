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
- [x] 3. Honest DPS and boss check; support gem and pantheon ranking.
      (Built 2026-10-10 as v0.4.0; flask ranking moved to session 5 with
      item upgrades. Tick once the analysis on your build makes sense.)
- [x] 4. Passive advisor.
      (Built 2026-10-10 as v0.5.0; tick once the top 10 on your build are
      passives you'd take.)
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
- **Reference build for sessions 1–2** (the user's character; its code is
  now in `docs/test-builds/reliquarian-poison-95.txt`): level 95 Scion / Reliquarian, PoB tree 3_29,
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

- **3:** Engine `analyse` (Lua, `engine.lua`): changes config inputs or the
  weakest support gem, recalculates (`configTab:BuildModList`, `buildFlag`,
  `OnFrame`), restores the build exactly. "Conservative" clears the options
  in PoB's "When In Combat" and "For Effective DPS" sections that the player
  changed (not list modes, not PoB's own defaults); boss = `enemyIsBoss`
  "Uber" (PoB's default is Pinnacle); pantheon ranked by effective HP;
  supports: each current one's worth, then every compatible support
  replacing the least valuable (level 20, quality 0). ~30 s on the reference
  build. Reference results: 5.36M → 2.82M without assumptions (−47%), 1.63M
  vs uber; Awakened Deadly Ailments for GMP +5.9%; Lunaris already best.
  Also v0.3.1: app renamed "POE Cheetah" (IDs unchanged); a capped-resist
  weakest damage type is a note, uncapped or negative stays a warning.

- **4:** Engine `passives` (Lua): every unallocated node next to the tree,
  notables/keystones up to 4 points away (path included, PoB's `node.path`),
  each free effect of reachable masteries, ascendancy notables within the free
  ascendancy points, and other effects for allocated masteries (free swaps).
  Calculated with PoB's misc calculator (`addNodes`/`removeNodes`), the build
  untouched. Ranking in `src/core/passives.ts` (goal switch, drawbacks,
  one entry per mastery). Points available assume every quest done
  (level − 1 + 23 + PoB's extra points). Test fixture
  `elementalist-tree.xml` is made up (116 points around the Witch start).
  ~2 s on both test builds (`docs/test-builds/`, added this session):
  Reliquarian 220 candidates + 43 mastery swaps; the Luminary's main skill
  (Flame Link) deals no damage, so the app ranks by defence and says why.
  Identical choices (same stats elsewhere, same swap on two masteries)
  show once with a count. To check on the Reliquarian: "+12% DoT multi for
  poison on Bleeding Enemies" (+6.4%) counts though the config doesn't set
  the enemy as bleeding.
  Dev tool: `cargo run --release --example stats -- build.xml --passives`.
  Not done: minion DPS (Combined DPS only, like session 3), the small tree
  view with the path drawn, cluster jewel notables not yet socketed.

## Usage log (claude.ai → Settings → Usage)

| Date | Session | Window before → after | Weekly before → after | Notes |
|---|---|---|---|---|
| 2026-10-10 | 0. Planning + foundations | ? → 31% | ~0% → 5% | Started in a Dancing Cabbage session; repo attached mid-session |
| 2026-10-10 | 1–2. PoB engine + saved builds; health check + try an item | 31% → 89% | 5% → 14% | Same conversation as session 0, so not separable; another session ran at the same time, so these overstate the cost |
| 2026-10-10 | 3. Honest DPS, boss check, gem + pantheon ranking (+ v0.3.1 rename) | 3% → 9% | 17% → 18% | New 5-hour window, still the same long conversation |
| 2026-10-10 | 4. Passive advisor | ? → ? | ? → ? | New conversation |
