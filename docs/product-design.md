# POECheetah — Product Design

Status: draft · Owner: SpectralInfinity · Last updated: 2026-10-10

## 0. Decisions (2026-10-10)

| Question | Decision | Consequence |
|---|---|---|
| Platform | **Windows desktop app** | Tauri 2 (same stack as Dancing Cabbage). Needed anyway: reading the game log, the clipboard and running Path of Building locally all require a local app |
| Game | **Path of Exile 1 first**, PoE2 later | PoB Community (PoE1) is the calculation engine; the PoE2 fork is added later (§7) |
| Calculation | **Use Path of Building, don't rewrite it** | PoB runs headless inside the app; league patches arrive as PoB updates, not app releases |
| Input | PoB codes and build links first (several builds saved, §3.0), GGG account login later | Works with no login and no GGG approval |
| Plain price checking | **Not built** | Awakened PoE Trade / Exiled Exchange 2 already do it well (§4) |
| Budget | Claude **Pro** plan | Small sessions, one row of §7 each; same rules as Dancing Cabbage §15 |

## 1. Problem

Players often don't know what to do next to improve a character: which
passives to take, which items to buy, what content to farm, how to make
currency, and how to use league mechanics (e.g. 3.29 mercenaries for
Luminary). Guides are generic; PoB shows numbers but only answers "what if"
for changes you think of yourself.

**Audience:** the owner and friends; players who use PoB but don't
min-max by hand.

## 2. Core idea: rank next steps by return per cost

Every question above is "of the things I could do next, which gives the most
for the least?". The app answers it by computation:

1. **Import** the build (PoB code).
2. **Simulate** each candidate change in headless PoB and record the change in
   the goal metric: damage (PoB "Full DPS"), defence (effective HP, resists,
   life/ES) or balanced.
3. **Price** the change: passive points, or chaos from market data.
4. **Rank** by gain per cost and explain it in plain words.

The numbers always come from PoB and market data. Claude (later, optional)
only explains them; it never invents them.

## 3. Features

### 3.0 Build library and inputs (added 2026-10-10)

- **Several builds saved**, each with a name (e.g. "Main – Reliquarian",
  "League starter"), shown in a list; one is active. Re-pasting a newer code
  for the same build updates it and keeps the old version, so you can see what
  changed since last time.
- **Accepted inputs:** a PoB code; a link that holds one (pobb.in, pastebin,
  poe.ninja character pages): the app fetches the code from the link; later,
  characters from your GGG account (§4).
- **Compare to a target build** (e.g. a guide or a top poe.ninja character
  with the same skill): the app lists the differences (passives, items, gems,
  ascendancy) and orders them by gain per cost, so the answer is "do these
  three things first" rather than "copy everything". Uses the same engine as
  §3.1 and §3.2.
- **Build guides:** paste the guide's PoB link (guides publish one, often per
  stage: league start, mid, end game). The app picks the stage closest to your
  character, then (1) orders the gap as above, and (2) runs the advisors on the
  guide build itself to find cheaper or stronger choices than the guide's,
  which matters most after a patch the guide hasn't caught up with. The app
  only reads PoB codes the user pastes; it doesn't scrape or copy guide sites.
- **poe.ninja builds:** what top characters with the same skill use (share of
  players per item, keystone, ascendancy), as extra candidates for §3.1–§3.2.

### 3.1 Passive advisor (first feature)

- Candidates: every unallocated node adjacent to the tree (1 point), plus
  notables and keystones within 2–4 points (path cost = points on the path).
  Masteries: try each mastery effect. Ascendancy points when available.
- Score = metric gain ÷ points. Show the top 10, with the path drawn on a
  small tree view later.
- Goal switch: Damage / Defence / Balanced. Balanced must never recommend
  something that drops resists below cap or life sharply.

### 3.2 Item upgrade advisor

- Per slot, candidates from: popular uniques for the build's skill, and
  weighted rare searches. PoB already contains a trade-query generator with
  per-stat weights (its "Trader" in the Items tab); reuse that logic instead
  of inventing weights.
- Prices from poe.ninja (uniques, currency) and the official trade site
  (rares, sampled sparingly within its rate limits).
- Output: "Ring: +25% DPS for ~40c" ranked by gain per chaos, with a link
  that opens the matching trade search.

### 3.3 Item check: "is this an upgrade for my build?"

- In game, Ctrl+C on a hovered item copies its full text to the clipboard
  (a game feature; Ctrl+Alt+C gives the advanced text). The app notices PoE
  item text on the clipboard and runs it through PoB against the current build.
- Result in a small always-on-top window: "+14% DPS, −3% life, worth ~30c".
- The player presses the keys; the app only reads the clipboard (§4).
- First version: paste the item text into the app by hand.

### 3.4 Run tracker (game log)

- Reads `logs/Client.txt` in the game folder (standalone and Steam installs
  differ; the user picks the folder once). Tails the file; never loads it all
  (it grows to hundreds of MB).
- Lines used: area generation (area name and level), "You have entered …",
  level-ups, deaths, trade whispers.
- Gives: maps per hour, time per map, deaths per map type, leveling speed.
- The log has **no** loot, damage or gear information; earnings come from §3.5.

### 3.5 Earnings and farming advisor

- Snapshots of stash value through GGG's official API (needs login, §4),
  priced with poe.ninja, taken between runs.
- Joined with §3.4: **currency per hour per strategy, measured on your own
  play**.
- Advice combines that with the build's numbers (clear speed vs single-target,
  map mods it can't run) and market prices for strategy inputs and outputs
  (scarabs, fragments, etc.).

### 3.6 League mechanics (e.g. 3.29 Luminary mercenaries)

- Researched when the session starts, not from memory: mechanics change
  every league. Simulated in PoB if PoB models them; otherwise a short
  curated guide that ranks options for the build's needs.

## 4. Data sources and game rules

GGG's rule of thumb for third-party tools:

- **Allowed:** reading `Client.txt`, reading item text the player copied,
  GGG's official APIs, public sites like poe.ninja.
- **Banned:** reading game memory, sending input to the game (macros,
  automation).
- **Avoided:** reading the screen with OCR.

| Source | Used for | Notes |
|---|---|---|
| PoB code / XML | The build | No login. Code = zlib-compressed XML in URL-safe base64 (`src/core/buildCode.ts`) |
| Path of Building Community | All calculations | Open source; check its licence allows bundling (session 1) |
| poe.ninja | Prices (currency, uniques, fragments), popular builds | No official API: cache (≥ 15 min), low request rate, identify the app in User-Agent |
| Official trade site API | Rare item prices | Respect the rate-limit headers it returns; send a User-Agent with contact info; check whether searches need a login |
| GGG OAuth API | Characters, stash (§3.5) | **Requires registering the app with GGG, reviewed by hand. Apply well before session 6.** Desktop apps use the public-client flow with PKCE |
| `Client.txt` | Runs (§3.4) | Local file, read only |

**No passwords, no session cookies (decided 2026-10-10).** The app never asks
for the GGG password or the `POESESSID` cookie: logging in on the user's behalf
breaks GGG's terms and risks the account, and the cookie gives full account
access. What works without them:

- Trade search and prices: the trade site's search works logged out.
- Characters: PoB-style import by account name when the profile's Characters
  tab is public.
- Stash value (§3.5) is the only part that needs the official OAuth login.
  If GGG doesn't approve the app, §3.5 falls back to the run tracker plus
  manual price checks, and the rest of the app is unaffected.

Never commit account tokens, session IDs or a real `Client.txt`. Test
fixtures are made-up builds and synthetic log lines.

## 5. Stack and architecture

- Tauri 2, React + TypeScript + Vite, npm; SQLite later (run history,
  price cache) via the Tauri SQL plugin; tokens in Windows Credential Manager.
- `src/core/` — pure TypeScript: PoB code handling, candidate generation,
  ranking, log parsing, run detection. Fully unit tested.
- `src/ui/` — React screens.
- `src-tauri/` — Rust: runs the PoB engine, file tailing, clipboard watch,
  credential store.

### 5.1 PoB engine (built in session 1)

- `src-tauri/pob-engine/`: a Rust crate that embeds LuaJIT (`mlua`, vendored)
  and runs PoB's own `HeadlessWrapper.lua` on a dedicated thread. One engine
  for the app's life (startup ~3 s, a build ~1 s); requests queue to it.
- Glue (`pob-engine/lua/engine.lua`): resolves PoB's relative file paths
  against its folder (the app's working directory is untouched), provides
  `arg`, captures PoB's console output, and keeps real zlib `Inflate`/`Deflate`
  (Rust, `flate2`) in place of the wrapper's stubs. Without them timeless
  jewel data silently fails to load and defences come out wrong.
- `lua-utf8` (MIT, vendored C) is compiled into the binary.
- PoB is MIT-licensed. `scripts/fetch-pob.sh` downloads the version pinned in
  `src-tauri/pob-version.txt` and keeps only what the engine needs (~210 MB:
  sources, data, the current tree without images). The installer bundles it
  as a resource; CI caches it.
- Checked: on the reference build the engine reproduces PoB's numbers exactly
  (DPS, EHP, life, max hits); a test checks a made-up build against PoB's
  standard headless run.
- Builds must use the current tree version (only it is bundled).
- Later: download newer PoB releases at runtime so a league patch needs no
  app release.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Headless PoB needs more native glue on Windows than expected | Session 1 is a spike with a clear done-when; fallback: point the app at the user's installed PoB folder for data and modules |
| GGG OAuth approval slow or refused | Earnings (§3.5) is late in the plan; apply early. Run tracker works without it |
| poe.ninja changes or blocks its endpoints | Cache; pricing behind one interface so a source can be swapped |
| Trade API rate limits | Sample few rares; prefer poe.ninja; cache results per league |
| Advice that is "correct" by numbers but bad in play (e.g. drops resists) | Balanced goal with hard floors (resist cap, life); user feedback after each session |
| League mechanics change every 3–4 months | Mechanics via PoB updates and per-league research, not hard-coded |

## 7. Delivery plan

One session = one row. Each ends with a pushed build you can install from CI.

| # | Session goal | Done when |
|---|---|---|
| 0 | Planning + foundations: this doc, Tauri app, CI Windows installer, PoB code reader | You install the app and it shows your build's class and level |
| 1 | PoB engine spike (§5.1): headless PoB running inside the app on Windows; saved builds (§3.0) | The app shows your build's DPS, life and EHP matching PoB within rounding |
| 2 | Passive advisor (§3.1) | Top 10 next passives with gain per point; you'd take most of them |
| 3 | Item upgrade advisor (§3.2) with poe.ninja prices | Per-slot buys ranked by gain per chaos, with trade links |
| 4 | Item check from the clipboard (§3.3) | Copy an item in game → upgrade or not, for your build |
| 4b | Compare to a target build (§3.0) + build links | Paste a guide's code → ordered list of what to change first |
| 5 | Run tracker (§3.4) | Maps per hour and deaths from a real play session |
| 6 | Earnings and farming advisor (§3.5); needs GGG OAuth approval | Currency per hour per strategy from your own play |
| 7 | League mechanics (§3.6), e.g. 3.29 mercenaries for Luminary | Merc recommendation for your build |
| later | PoE2 via PoB's PoE2 version; Claude explanations | — |

## 8. Open questions

- Which build to use as the reference for checking numbers in sessions 1–2
  (your current character's PoB code)?
- Overlay vs normal window for the item check (overlays need the game in
  windowed fullscreen).
- When to apply for GGG OAuth (suggest: after session 2, once the app is real).
