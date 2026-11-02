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
- [x] 5. Item upgrade advisor; Bossing goal; priced support gems; flasks.
      (Built 2026-10-10 as v0.6.0; tick once the top buys on your build
      make sense and the poe.ninja prices load in the installed app.)
- [x] 6. Item check from the game clipboard; max-hit drawback check.
      (Built 2026-10-12 as v0.7.0; tick once copying an item in game shows
      the verdict in the pop-out and the max-hit flags make sense.)
- [x] 7a. Compare to a target build / guide (incl. guide stages); build links;
      the gap explained piece by piece.
      (Built 2026-11-02 as v0.8.0; tick once comparing to a guide or a
      ladder character gives a list you'd follow.)
- [ ] 7c. Build audit: charges, conditions, stances; flask set planner; PoB
      limits flagged. (Split from 7 on 2026-11-02: too big for one session.)
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
  poison on Bleeding Enemies" (+6.4%) counts because the build's own PoB
  config ticks "Is the enemy Bleeding?" (the owner says it shouldn't). The
  passive advisor and gem ranking use the config as set; a switch to drop
  situational assumptions there (session 3's code) is a candidate v0.5.1.
  Support ranking suggested Awakened gems that no longer drop: see §3.2.
  Dev tool: `cargo run --release --example stats -- build.xml --passives`.
  Not done: minion DPS (Combined DPS only, like session 3), the small tree
  view with the path drawn, cluster jewel notables not yet socketed.

- **5:** Calculation modes in the engine (`inMode` in `engine.lua`):
  `configured`, `conservative` (session 3's assumption clearing) and `boss`
  (cleared + `enemyIsBoss = "Uber"`); passives, support ranking and item
  upgrades take one. Goals now Damage / Defence / Balanced / Bossing
  (`src/core/goals.ts`); Bossing = boss mode, DPS and EHP averaged, no
  drawbacks. "Count my situational assumptions" is off by default, so the
  Reliquarian's "+12% DoT multi for poison on Bleeding Enemies" no longer
  ranks (it did at +6.4%). Item upgrades: engine `upgrades` tries each named
  unique (PoB's unique DB by title) in every active slot; ~36 s on the
  Reliquarian (2,484 trials, every unique PoB knows), ~48 s on the Luminary.
  Flask mods: each prefix/suffix alone on the same base, against the base
  without mods. Rares: engine `rareSearch` runs PoB's `TradeQueryGenerator`
  (~3 s per slot) and the app opens the trade site with the weighted query.
  Market data: Rust `market_get` (allowlist: poe.ninja API, trade site's
  `api/trade/data/`), cached 30 min; league from the trade site's league
  list. Gem prices: uncorrupted at the calculated level, else level 1 ("level
  it"); no listing → left out as not sold (catches Awakened GMP). PoB gem
  names lack " Support"; prices and trade links add it.
  Checked against live poe.ninja (Allflame, once the environment allowed
  it): its API moved to `https://poe.ninja/poe1/api/` (old `/api/data/`
  answers "not found"); fields as expected. Leagues now come from poe.ninja's
  `data/index-state`: the trade site's league list answers 403 without a
  login. Foulborn uniques (556 listings) aren't in PoB's list and are skipped.
  Only Awakened Empower/Enhance/Enlighten are listed, so the rule catches the
  rest (Reliquarian: Awakened Deadly Ailments, GMP, Vicious Projectiles left
  out; Cruelty +3% for ~37c suggested). Best buys keep two per kind of slot
  and drop anything losing > 30% DPS or EHP (any main-hand weapon kills
  Poisonous Concoction: DPS −100%).
  On the Reliquarian (bossing) only flask uniques pass without drawbacks
  (most items lower max fire res or EHP > 5%); Damage shows Qotra's
  Regulator +27% DPS, The Covenant +33% (−66% EHP). Path of Building values
  life flasks' mods at nothing and counts flasks as always up; the UI says so.
  Not done: sampling rare prices from the trade API; a combined best
  prefix + suffix calculation (summed from each alone).

- **6:** Max-hit drawback: `drawbacks()` (`src/core/passives.ts`) adds any
  of the five max hits falling by more than 5% ("Physical max hit 32k →
  23k"), so passives, item upgrades and the item check leave them out for
  Balanced/Bossing and flag them for Damage/Defence. Item check:
  `src/core/itemCheck.ts` (item text header, what counts as equipment,
  verdict per goal) and `src/ui/ItemCheck.tsx` (panel, clipboard watch,
  pop-out window `item-check`, `index.html#item-check`). Engine `tryItem`
  takes a mode and returns PoB's level requirement (PoB trusts the copied
  "Level:" only for items without sockets; else the base's). Clipboard via
  `tauri-plugin-clipboard-manager`, read only (`clipboard-manager:allow-read-text`).
  Goal and the assumptions switch are now saved, so the pop-out uses them.
  PoB reads the game's advanced copy (Ctrl+Alt+C, `{ Prefix Modifier … }`
  lines) too. Checked on the Reliquarian with made-up copies of real
  uniques: Kintsugi (config as set) DPS −15%, EHP −29%, physical max hit
  32k → 11k (the prediction test's roll gave +32% EHP; same conversion
  loss); bossing: EHP +11% but physical max hit 25k → 16k → "Not for
  Bossing". Replica Mistwall: EHP −19%, cold/lightning max hit 48k → 21k.
  A rare ring (advanced copy) +125 life but DPS −24% (loses Betrayal's
  Sting): upgrade only for Defence, with the cost shown. Luminary: judged by
  effective HP (no damage), the same ring −8%. Not checked here: the
  Windows clipboard and the pop-out window itself (no Windows in this
  environment; the shell compiles on Linux).
  Dev tool: `cargo run --release --example stats -- build.xml --item item.txt --mode boss [--json out.json]`.

- **7a:** Engine `compare` (my build and a target, each gear slot's item
  swapped both ways, config diff; ~10 s on two real Reliquarians) and
  `calculate` (one build in a mode, optionally another skill part); TS in
  `src/core/compare.ts` (stages, mixed builds, plan, damage factors, fight
  verdict) and `src/core/buildLink.ts`; UI `src/ui/Compare.tsx`. Rust:
  `pob_compare`, `pob_calculate_mode`, `build_link_get` (pobb.in and
  pastebin raw pages only; poe.ninja via `market_get`). Fixed on the way: a
  missing skill part reached Lua as JSON null (a truthy light userdata),
  which crashed PoB's skill part code or left a stale result. Mixed builds
  drop granted skill groups (`source="Tree:…"`/items), else PoB's main
  group index shifts (their tree made "Summon Spectral Tiger" the main skill).
  Checked against live poe.ninja: the ladder search takes
  `&skills=Poisonous+Concoction+of+Bouncing` (20 PCOC Reliquarians of
  2,890). The owner's Reliquarian against the 4th (4.82M configured,
  poe.ninja's number): without assumptions theirs is 2.49M vs 2.82M, +25%
  effective HP; uber boss 746k vs 856k DPS, weakest max hit 25k vs 23k chaos
  ("yours kills faster, theirs survives 11% bigger hits"). Their Cloak of
  Flame is −15% in the owner's build (the owner's in theirs +19%); their
  gems −40%, all their gear −46%; Asenath's Gentle Touch +3% DPS but every
  max hit down (Damage only); for Balanced only Phoenix Goad (+7% EHP), with
  "yours gives: Aspect of Arakaali" shown (PoB values it at 0%). Factors:
  curse limit ×2, damage per poison ×0.61, speed ×1.3. Not checked here:
  pobb.in and pastebin (not reachable from this environment) and the panel
  in the installed app. Dev tool: `stats -- mine.xml --compare target.xml
  --mode conservative --json out.json` and `--calc --mode boss`.

- **Research 2026-10-12 (not a session):** "a Luminary that clears The
  Feared for 70 div". Read poe.ninja's ladder (design doc §3.11 has the
  endpoints; decoders in `scripts/research/poe_ninja_builds.py`): 29,537
  Allflame Luminaries; mercenary Kineticist 32%, Manyshot 30%, Combatant 13%;
  Flame Link support with Animate Guardian is the norm. Four characters below
  level 96 through the engine (configured → uber DPS, EHP, lowest max hit):
  Lightning Tendrils of Eccentricity 265M → 80M, 73k, 8k phys;
  Facebreaker Doryani's Touch 36M → 11M, 175k, 7k phys; Eccentricity 44M →
  13M, 27k, 10k phys; Kineticist aurabot 0 (merc not in PoB), 4.7M, 67k phys.
  Reliquarian for comparison: 5.4M → 1.6M, 57k, 23k chaos. Ideas: §3.12.

## Usage log (claude.ai → Settings → Usage)

| Date | Session | Window before → after | Weekly before → after | Notes |
|---|---|---|---|---|
| 2026-10-10 | 0. Planning + foundations | ? → 31% | ~0% → 5% | Started in a Dancing Cabbage session; repo attached mid-session |
| 2026-10-10 | 1–2. PoB engine + saved builds; health check + try an item | 31% → 89% | 5% → 14% | Same conversation as session 0, so not separable; another session ran at the same time, so these overstate the cost |
| 2026-10-10 | 3. Honest DPS, boss check, gem + pantheon ranking (+ v0.3.1 rename) | 3% → 9% | 17% → 18% | New 5-hour window, still the same long conversation |
| 2026-10-10 | 4. Passive advisor | ? → 32% | 18% → 21% | New conversation; includes checking the two test builds |
| 2026-10-10 | 5. Item upgrade advisor, Bossing goal, gem prices, flasks | ? → 74% | 21% → 27% | New conversation; includes checking against live poe.ninja once the environment allowed it |
| 2026-10-12 | 6. Item check from the clipboard, max-hit drawback | ? → 40% | ? → 21% | Read 2026-11-02 after the follow-ups (CI artifact cleanup and re-run, roadmap question), weeks later, so it doesn't isolate session 6; also the "before" of session 7a |
| 2026-11-02 | 7a. Compare to a build or guide, build links | 40% → 84% | 21% → 27% | Same conversation as session 6's follow-ups; includes the roadmap split and checking against live poe.ninja ladder characters |
