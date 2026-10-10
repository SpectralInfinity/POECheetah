# Progress

## Sessions (design doc §7)

- [x] 0. Planning + foundations: design doc, Tauri app, CI Windows installer,
      PoB code reader. *Done when* you install the app and it shows your
      build's class and level. (Built 2026-10-10 as v0.1.0; tick once installed
      from the CI artifact and a real PoB code reads correctly.)
- [ ] 1. PoB engine spike (headless PoB inside the app).
- [ ] 2. Passive advisor.
- [ ] 3. Item upgrade advisor.
- [ ] 4. Item check from the clipboard.
- [ ] 4b. Compare to a target build; build links.
- [ ] 5. Run tracker (game log).
- [ ] 6. Earnings and farming advisor (needs GGG OAuth approval).
- [ ] 7. League mechanics (3.29 mercenaries).

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
  phys max hit 31,591. Cold/lightning resist show −50% but their max hit equals
  fire's, so PoB treats them as covered; the engine must reproduce that, not
  "fix" it.

## Usage log (claude.ai → Settings → Usage)

| Date | Session | Window before → after | Weekly before → after | Notes |
|---|---|---|---|---|
| 2026-10-10 | 0. Planning + foundations | ? → 31% | ~0% → 5% | Started in a Dancing Cabbage session; repo attached mid-session |
