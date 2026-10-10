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

## Usage log (claude.ai → Settings → Usage)

| Date | Session | Window before → after | Weekly before → after | Notes |
|---|---|---|---|---|
| 2026-10-10 | 0. Planning + foundations | ? → ? | ? → ? | Started in a Dancing Cabbage session; repo attached mid-session |
