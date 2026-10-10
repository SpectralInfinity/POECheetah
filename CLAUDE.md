# POECheetah

Windows desktop app that tells Path of Exile players what to do next for their
build: passives, item upgrades, farming and currency, league mechanics.
Product spec: `docs/product-design.md`. §0 (decisions), §5 (stack) and §7
(session plan) are the source of truth for what to build now. Progress and
usage log: `docs/progress.md`.

## Stack

- Tauri 2 desktop app for Windows
- React + TypeScript + Vite for the UI; npm as package manager
- Path of Building Community, run headless, does all build calculations
  (design doc §5.1). Don't reimplement PoB's math.
- Tests: Vitest for TypeScript, `cargo test` for Rust

## Layout

- `src/core/` — pure TypeScript domain logic (PoB codes, candidate
  generation, ranking, log parsing). No Tauri or DOM imports; fully unit tested.
- `src/ui/` — React screens and components.
- `src/data/` — SQLite access and migrations (when needed).
- `src-tauri/` — Rust shell: PoB engine, file tailing, clipboard, credentials.
- `.github/workflows/` — CI: tests on Linux; Windows installer on `windows-latest`.

## Conventions

- The app version lives in `package.json`, `src-tauri/tauri.conf.json` and
  `src-tauri/Cargo.toml`; bump all three together (a test checks they match).
- Releasing: bump the version (three files), merge to main, then either push a
  `v<version>` tag or run the CI workflow by hand on `main` with "release"
  ticked (the cloud environment's git proxy refuses tags).
- Prices are in chaos orb equivalents (number); league names come from data,
  never hard-coded.
- Game rules (design doc §4): read `Client.txt`, copied item text and official
  APIs only. Never read game memory, send input to the game, or OCR the screen.
- Tests never call the network; poe.ninja / trade / PoB responses and log
  lines come from made-up fixtures in `src/core/__fixtures__/`.
- Never commit account tokens, POESESSID, OAuth secrets, or a real `Client.txt`.
- Don't trust memory for league mechanics: research the current league when a
  session needs it.

## Working agreement

- One session = one row of design doc §7. Commit and push at each milestone.
- The user is on the Claude Pro plan. Keep sessions focused: read only the
  needed design-doc section; don't run Windows builds locally (this Linux
  environment can't), let GitHub Actions do it.
- At the end of a session, update `docs/progress.md` (checklist + usage row;
  the user supplies the usage percentages).
