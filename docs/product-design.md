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
- **Built in session 7a (2026-11-02):** the "Compare to a build or guide"
  panel. Paste a code or a link (pobb.in and pastebin raw pages; poe.ninja
  character pages through its character data). Guides with several trees,
  item sets or skill sets start at the tree whose node count is nearest
  yours (sets matched by name, else position), and each can be changed.
  The engine (`compare`) swaps every gear slot's item both ways and diffs
  the config; mixed builds (your build with their tree, gems, all gear or
  config, `hybrid()` in `src/core/compare.ts`) give each whole's worth.
  Jewels move with the gear; skill groups granted by the tree or items are
  dropped from mixed builds so PoB's main group stays the same. The list
  "do these first" ranks the swaps by the goal's gain, with drawbacks (max
  hits included), poe.ninja prices for uniques, and what the replaced item
  and theirs carry (curses, granted skills, socketed gem levels). Their
  config is shown apart ("their assumptions"). Also: PoB's damage factors
  side by side, the target calculated in your skill part when the main
  skill is the same, and a verdict against an uber pinnacle boss (DPS and
  weakest max hit). Not yet: coupled slots swapped together (all gear
  covers them), gem prices, Maxroll planner links (copy the code).
- **Compare to a target build** (e.g. a guide or a top poe.ninja character
  with the same skill): the app lists the differences (passives, items, gems,
  ascendancy) and orders them by gain per cost, so the answer is "do these
  three things first" rather than "copy everything". Uses the same engine as
  §3.1 and §3.2.
- **Build guides** (including Maxroll): paste the guide's PoB code or link.
  Guide PoBs often hold several trees and item sets in one code (league
  start, mid, end game); the app lets you pick which one to compare against.
  Links to guide sites are fetched only where the site exposes the code at a
  stable address and its terms allow it; otherwise copy the code. The app picks the stage closest to your
  character, then (1) orders the gap as above, and (2) runs the advisors on the
  guide build itself to find cheaper or stronger choices than the guide's,
  which matters most after a patch the guide hasn't caught up with. The app
  only reads PoB codes the user pastes; it doesn't scrape or copy guide sites.
- **poe.ninja builds:** what top characters with the same skill use (share of
  players per item, keystone, ascendancy), as extra candidates for §3.1–§3.2.

### 3.1 Passive advisor (built in session 4)

- Candidates: every unallocated node adjacent to the tree (1 point), plus
  notables and keystones within 2–4 points (path cost = points on the path).
  Masteries: try each mastery effect. Ascendancy points when available.
- Score = metric gain ÷ points. Show the top 10, with the path drawn on a
  small tree view later.
- Goal switch: Damage / Defence / Balanced. Balanced must never recommend
  something that drops resists below cap or life sharply.
- Built in session 4: engine `passives` uses PoB's own paths (`node.path`)
  and item-compare calculator (`addNodes`/`removeNodes`), as its tree tooltip
  does. Damage = Combined DPS, Defence = effective HP, Balanced = their average,
  minus anything that lowers a resist or costs over 5% life, EHP or DPS (shown
  as "Costs" under the other goals). Also lists free swaps for allocated
  masteries, and ascendancy notables within the free ascendancy points (ranked
  separately: they're a different kind of point).

### 3.2 Item upgrade advisor (built in session 5)

Built as: every unique poe.ninja prices in the chosen league, tried by PoB in
each slot it fits (cluster and timeless jewels skipped: they reshape the
tree), ranked by goal gain per chaos, with a trade link each; magic flask
mods ranked per flask (best tier, best roll, each mod alone); rares via PoB's
own weighted trade search (`TradeQueryGenerator`), opened on the trade site.
Rare prices aren't sampled from the trade API yet: the search link shows
them. Goal, the "count my situational assumptions" switch (off by default)
and the league are shared by the passive, item and gem advice.

- Per slot, candidates from: popular uniques for the build's skill, and
  weighted rare searches. PoB already contains a trade-query generator with
  per-stat weights (its "Trader" in the Items tab); reuse that logic instead
  of inventing weights.
- Prices from poe.ninja (uniques, currency) and the official trade site
  (rares, sampled sparingly within its rate limits).
- Output: "Ring: +25% DPS for ~40c" ranked by gain per chaos, with a link
  that opens the matching trade search.
- Also price the support gems §3.9 suggests (gain per chaos), at the level
  players actually buy. A gem with no poe.ninja listing in the current
  league is left out or marked "not obtainable": most Awakened supports no
  longer drop (owner's finding, 2026-10-10: only Awakened Empower, Enlighten
  and Enhance still do), yet PoB's data still has them all and the ranking
  suggested Awakened Greater Multiple Projectiles. Use market data, not a
  hard-coded list, so the next removals are caught too.
- **Bossing goal** (owner's request, 2026-10-10): a fourth goal next to
  Damage / Defence / Balanced. Same item comparisons, calculated with
  `enemyIsBoss = "Uber"` and situational assumptions cleared (the §3.9
  boss check's settings, `withConfig` in the engine). Add it to the passive
  advisor (§3.1) too.

### 3.3 Item check: "is this an upgrade for my build?" (built in session 6)

Built as: the "Item check" panel (paste, or "Watch the clipboard") and a small
always-on-top window ("Pop out on top of the game"; stays over the game in
windowed or windowed fullscreen, not exclusive fullscreen). Each copied piece
of equipment goes through PoB in every slot it fits (`tryItem`, now in the
goal's calculation mode); the answer is one line for the chosen goal
("Upgrade for Balanced: +14% DPS, +2% effective HP in Ring 2", "Not for
Balanced: Physical max hit 32k → 23k", "About the same", "Not an upgrade"),
the costs, the level requirement if too high, and a unique's poe.ninja price
with a trade link. Rares get no price (plain price checking stays with
Awakened PoE Trade, §0). The clipboard is read once a second while watching,
only item text is acted on, and nothing is kept or sent. The pop-out follows
the build selected and the goal chosen in the main window (both saved).

- In game, Ctrl+C on a hovered item copies its full text to the clipboard
  (a game feature; Ctrl+Alt+C gives the advanced text). The app notices PoE
  item text on the clipboard and runs it through PoB against the current build.
- Result in a small always-on-top window: "+14% DPS, −3% life, worth ~30c".
- The player presses the keys; the app only reads the clipboard (§4).
- First version: paste the item text into the app by hand.

**Max-hit drawback check (owner's request, 2026-10-12; built in session 6):** the
drawback check (`drawbacks()` in `src/core/passives.ts`, used by passives, item
upgrades and the item check) only looks at resistances, life, effective HP and
DPS. A prediction test on a PCOC Reliquarian showed it missing real costs:
Kintsugi (+32% EHP, "no drawback") cut the physical max hit 32k → 23k by
replacing Cloak of Flame's conversion; Replica Mistwall (+11% EHP) cut it to
19k. Add: any of the five max hits (physical, fire, cold, lightning, chaos)
dropping by more than 5% is a drawback ("Physical max hit 32k → 23k"), so
Balanced and Bossing leave such items out and Damage/Defence flag them.

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
- Checked 2026-10-10 (PoB v2.67.2): PoB has all 28 mercenary mod lines
  (Luminary ascendancy, uniques) but parses none of them, and has no
  mercenary actor: no mercenary stats, gear or buffs on the player. Its
  Party tab (other players' auras, curses, link buffs) might stand in for a
  mercenary's effect on the player; not checked. Session 10 starts by
  checking whether a newer PoB release models mercenaries; if not, the
  recommendation comes from researched rules, not PoB numbers. Test build:
  `docs/test-builds/luminary-support-97.txt`.

### 3.7 Build health check (added 2026-10-10, session 2)

Warnings computed from PoB's output, shown with every build and after every
"try an item". Lesson from the reference build: raw resistances mislead
(−50% cold looked bad, but damage taken as fire covers it), so checks use
PoB's **maximum hit taken per damage type**, not resist numbers alone.

- Weak spot: a damage type whose max hit is far below the build's best.
- Elemental resist below cap only when that element's max hit is also low;
  otherwise an info note ("covered by damage taken as another type").
- Negative chaos resistance.
- Mana: can't afford one use; cost per second above regen (warning) or
  covered only by leech (info).
- Hit chance below 90% for attacks.
- Attribute requirements not met (gear or gems would be disabled).
- Small life + energy shield pool for the level.
- Spell suppression partly invested but not capped.

Thresholds are named constants in `src/core/health.ts`, easy to tune from
real use.

### 3.8 Try an item (added 2026-10-10, session 2)

Paste an item's text (Ctrl+C in game, the trade site, a guide). PoB computes
the build with that item in each slot it fits (both rings, empty slots, jewel
sockets), using its own item-compare calculator. The app shows the stat
changes per slot and the health-check warnings the swap adds or removes
(e.g. "Strength requirement no longer met", "lightning resist drops below
cap"). Session 4 adds the automatic version: copy in game → result appears.

### 3.9 Honest DPS and boss check (added 2026-10-10)

PoB's DPS depends on the configuration boxes the player ticked (enemy
ignited, chilled, max stacks…). Recalculate with conservative settings and
with PoB's pinnacle-boss settings, and show both next to the configured
number. Also rank alternative support gems for the main skill, pantheon
choices and flask mods ("try every option in PoB and rank").

### 3.10 Patch impact (added 2026-10-10)

When the bundled PoB is updated for a patch, recalculate saved builds and
show what the patch changed for each.

### 3.11 Meta comparison with poe.ninja (added 2026-10-10)

- Find comparable characters on poe.ninja's build pages: same main skill and
  ascendancy (optionally a similar level).
- Aggregate what they use: share of characters per unique item, keystone,
  notable, support gem, cluster jewel, anoint, pantheon, flask.
- Diff against your build: popular choices you don't have ("78% use X").
- Rank those with PoB on **your** build (try an item §3.8, passive gains
  §3.1): popularity alone isn't advice, so each suggestion shows its real gain
  for you and is marked "popular and strong for you" or "popular, small gain
  for you".
- Top characters' PoB codes double as targets for §3.0 compare.
- Caveats shown in the UI: ladder data leans to rich, late-league
  characters; only public profiles are included.
- Data access: poe.ninja has no official API. Use the JSON its own pages
  load, cached per league for hours, low request rate, app identified in
  User-Agent; check its terms when building. If that isn't allowed or
  breaks, fall back to the user pasting poe.ninja character links/codes.

**Built in session 7b (2026-11-02)** as the "Meta comparison" panel (with
§3.12 items 1–2): poe.ninja's ladder for your main skill and ascendancy
(skill alone when no one plays that ascendancy), decoded in
`src/core/ladder.ts` (protobuf search, NDIC names); popular choices (≥ 20%)
you lack: uniques (generic "Rare Boots" entries left out), passives (poe.ninja's
"keypassives" mixes keystones, ascendancy and timeless-jewel nodes, so they're
matched against all your allocated names, from the engine's `passives`),
the skill's support gems, anoints. Uniques are tried in your slots (engine
`upgrades`), passives through the passive advisor (within 4 points, path
included): "popular and strong for you" or "popular, small gain for you";
gems and anoints by popularity only. Top characters with poe.ninja's
figures and links for the Compare panel. Not yet (items 3, 4, 17, 19):
gear cost of a build, budget finder, unique variants, other ascendancies.
Live check: the search takes `&skills=<main skill>` (2026-11-02); the
dimension `supportgems-<skill>` holds the skill's own supports.

**poe.ninja's build data (checked 2026-10-12, undocumented; may change):**
- League snapshot: `https://poe.ninja/poe1/api/data/index-state` → `snapshotVersions[]`
  (`url`, `type` = `exp`, `version`).
- Ladder aggregate: `GET /poe1/api/builds/{version}/search?overview={url}&type=exp&class=Luminary`
  (`&sort=dps` / `ehp` changes the top 100 rows). Protobuf, no published
  schema: field 1 = total characters; field 2 = dimensions (`items`,
  `guardianitems`, `mercenaryclass`, `mercenaryitems`, `allgems`,
  `keypassives`, `anointed`, …) as `{name, entries[{index, count}]}`; field 6 =
  per-dictionary hashes; field 12 = the 100 listed rows (name, account,
  level, EHP, DPS columns). A level filter wasn't found: filter rows client-side.
- Names: `GET /poe1/api/builds/dictionary/{hash}` → "NDIC" v2 binary: 36-byte
  header (count at byte 12, sparse-index size at 28), 8 bytes per index entry,
  one length byte per name, then the names. A second hash per type ("NOVL")
  isn't needed.
- One character: `GET /poe1/api/builds/{version}/character?account=&name=&overview=&type=exp`
  → JSON with `pathOfBuildingExport` (a PoB code), `items`, `jewels`,
  `flasks`, `guardianItems`, `mercenary` (`build` = class, `level`, `items`),
  `keyStones`, `skills`.
- Decoder scripts used for the research are summarised in `docs/progress.md`
  (2026-10-12); the app version belongs in session 7b.

### 3.12 Ideas from the 2026-10-12 ladder research (owner's request)

Done by hand in a chat ("what do I need for a Luminary that clears The
Feared, 70 div?"); each is a feature the app could do itself:

1. **Ladder snapshot for a class/ascendancy** (session 7b): share of players
   per item, mercenary class, mercenary item, Animate Guardian item, gem,
   keystone, anoint; level cap and sort (DPS / EHP) as filters.
2. **Pull top ladder characters and calculate them honestly**: their PoB
   codes through the engine with session 3's settings (configured,
   conservative, uber) and max hits, side by side. Showed that ladder DPS can
   be mostly assumptions (one Luminary: 265M configured, 80M against an uber).
3. **Gear cost of any build**: price every unique of a PoB code on
   poe.ninja (rares: trade search link); lower bound when a variant is
   unknown (e.g. Mageblood flask count).
4. **Budget build finder**: "class, goal, budget N div" → ladder characters
   whose priced gear fits, ranked by uber DPS and lowest max hit.
5. **Content readiness**: a checklist for a named fight (e.g. The Feared,
   uber pinnacles) from the boss-mode numbers: uber DPS, max hit per damage
   type, resists, block / suppression. Thresholds need research per fight.
6. **Compare my build to a ladder build** (session 7): what to change first,
   priced.
7. **Mercenary from the ladder** (session 10): the class and items that
   players of the same build use, since PoB can't calculate mercenaries.
8. **Foulborn uniques**: price them by mutated mod and try them with PoB's
   `foulbornMap` (skipped in v0.6.0; 556 listings in Allflame).
9. **Guides**: read a guide's PoB link (pobb.in, Maxroll planner) rather
   than its video; YouTube is only useful for the link in the description.

**Built in session 7c (2026-11-02), items 13, 15, 18, 20 as the "Build
audit" panel** (engine `audit`, `src/core/audit.ts`): the charges, buffs and
Killed Recently the config sets, each tried the other way, with what in the
build grants it (item, passive or gem text; on-kill sources and nothing at
all both read "not true against a lone boss"); the stance's alternatives with
their max hits, Blood Stance flagged on damage over time, Flesh and Stone
noted; each flask's worth (PoB's `toggleFlask`), what it protects against,
life flasks kept for skills that use their charges, uniques kept (PoB may
read them without counting them, e.g. Progenesis), the slot to spare (or "no
slot is free") and plain utility bases ranked for it (bases already worn
left out); and PoB's
blind spots: its own "exceeds in game limit" warnings, "deal damage faster",
The Writhing Jar, Aspect of Arakaali, life flask charge sustain, flask
uptime. Not yet: per-content flask sets, flask enchantments and quality,
aura suggestions with reservation, the ladder's life flask count.

Two PCOC Reliquarians compared the same day (3.7M vs 5.4M in PoB; the 5.0M
poe.ninja shows is poison alone) added these checks for session 7's build
comparison (item 6):

10. **Explain a DPS gap by swapping pieces**: put the other build's items in
    one slot at a time (and its tree, gems and config as wholes) into my
    build, and knock its pieces out of it one at a time; rank what each is
    worth. Swap coupled slots together (amulet + gloves carried the curses;
    all of the other build's gear made mine worse, −5%). Found: a level 20
    Despair gem instead of the gloves' level 1 (+21%), a body armour
    corrupted with +2 to socketed projectile gems (+18%).
11. **Name PoB's damage factors side by side**: damage per poison, stacks,
    duration, enemy damage-taken multiplier (`PoisonEffMult`), average hit,
    crit, speed, curse limit; say which one makes the gap.
12. **Compare in the skill part the build plays**: PCOC's "Life" part (life
    flask charges) roughly doubles DPS over "No Flask"; compare both builds
    in the same part.
13. **Flask checks**: PoB counts only the best life flask's recovery for
    PCOC (`LifeFlaskRecovery` is a max): a second or third life flask adds
    0% in PoB, only charge sustain it doesn't model, so say that rather
    than rank it. Try utility flasks from the other build in each flask
    slot (a Silver Flask instead of a mana flask: +12.5%) and flask quality
    (28% vs 24–26%: +1.9%).
14. **Which build for a named fight**: both builds in boss mode (uber DPS,
    effective HP, max hit per damage type) side by side, with a verdict
    (with item 5's thresholds when known). A build that kills 13% slower
    with 15–40% higher max hits wins The Feared.

Snakebite / Writhing Jar follow-up the same day (PCOC Pathfinders with
Snakebite: 19–24M uber DPS but 4–8k physical max hits; the 5 Snakebite
Reliquarians: 1.3–3.5M) added:

15. **Charge and condition audit** (session 7, or earlier as part of the
    honest DPS check): list each charge and condition the config turns on
    or off with its worth (the test build had Blood Rage but frenzy charges
    off: turning them on is +19%), and whether anything in the build makes
    it true against a single boss. On-kill sources (Blood Rage's frenzy
    charge) need something to kill: The Writhing Jar's worms (PoB can't
    model them; 7 of 20 PCOC Reliquarians run it, 0 of 515 Pathfinders).
    Say "turn this on in PoB" when the build has the source but the config
    is off, and "not true on a boss" when it hasn't.
    Stances too: Flesh and Stone switches stance itself (no Blood and Sand
    needed; 0% of PCOC builds run it). Sand Stance is defence only (test
    build: effective HP 72k → 90k, every max hit +24%); Blood Stance only
    adds physical damage taken by enemies, so flag Blood Stance on a build
    whose damage isn't physical hits (poison, DoT). When suggesting an
    aura instead (Grace, Determination), check it fits the reservation
    (both left the test build at −82 mana) and compare max hits, not
    only effective HP.
16. **What an item carries before you replace it**: curses granted (Asenath's
    Despair and Temporal Chains), socketed gem levels (+2 auras, +2
    projectile gems), granted skills; shown next to the PoB result, so a
    "−29%" for swapping gloves is explained.
17. **Variants of a unique**: try the plain roll and the notable implicit or
    corruption variants (Snakebite plain −29%, with "+1 max frenzy" and
    "Enfeeble on hit" eldritch implicits +13% boss DPS; Cloak of Flame
    corrupted with +2 projectile gems +18%), and say which variant to buy.
    Needs prices per variant (rare/corrupted: trade search link).
18. **Flask set planner**: rank the whole flask set, not one flask at a
    time, and say what each flask is for (damage, defence, an immunity,
    charge sustain) so nothing needed is swapped out:
    - **Life flask count is sustain, not damage.** PoB counts only the best
      life flask (a second adds +0.6% for PCOC), but skills that use life
      flask charges (PCOC "can consume charges from a Life flask") need
      several to keep going, and PoB doesn't model charges. Keep the
      ladder's count for the same skill and ascendancy: all 6 PCOC
      Reliquarians run 2–4 life flasks; 4 of 6 Snakebite Pathfinders run
      one (their ascendancy refills charges). Never offer to replace a
      life flask below that count.
    - **Which slot is free**: the flask the build needs least (the test
      build's mana flask), with what it gave (mana sustain, ignite
      immunity) shown as the cost.
    - **What to put there**, ranked: Silver +11.8% vs Sulphur +11.3% with
      25% increased effect (+9.4% / +9.1% plain). Near-ties are broken by
      side effects PoB doesn't count: speed flasks (Silver, Onslaught)
      make a charge-using skill throw more often and drain life flasks
      faster; flat damage (Sulphur) doesn't. Say so rather than rank by
      PoB alone.
    - **Per content**: a maps set and a boss set when they differ (Sulphur
      in maps; The Writhing Jar against a single boss when on-kill charges
      matter, item 15).
    - **Suffixes that must move along**: shock immunity when
      cold/lightning resists are negative; ignite and bleed immunity.
    - **Quality**: 28% vs 24–26% life flasks +1.9% for PCOC.
    - **Enchantments** (one per flask; PoB's list is
      `Data/EnchantmentFlask.lua`): Enkindling (stat, "Gains no Charges
      during Effect") or Instilling (automatic use). PoB counts flasks as
      always on, so it overrates Enkindling's "60–70% increased effect":
      on the test build's Sulphur Flask +17.2% in PoB vs +11.3% with any
      Instilling, but the flask can't refill while active, so it pays
      only above about two-thirds uptime (17.2% × uptime vs 11.3%). Show
      the break-even uptime next to it, and default to Instilling: "Used
      when Charges reach full", or "Reused at the end of this Flask's
      effect" when the build gains charges fast enough (e.g. flask
      charges on crit). The same hidden cost as speed flasks draining
      life flask charges: PoB's number leaves out uptime.
19. **Same skill, other ascendancies**: from the ladder (item 1), each
    ascendancy's typical gear and its honest numbers side by side (uber DPS,
    max hits, block, cost of the core uniques: Svalinn ~33 div), so "should
    I switch to Pathfinder?" has an answer with a price.
20. **PoB limits flagged next to the numbers**: the damage over time cap
    (~35.8M per type; every top Snakebite Pathfinder sits at it, so their
    real DPS is higher), and things PoB doesn't model (Writhing Worms,
    flask charge sustain, mercenaries, Aspect of Arakaali: PoB
    has no data for it, so it shows 0%), so a comparison isn't read as
    exact. Also explain PoB results that look wrong but aren't: "poisons
    deal damage X% faster" adds 0% to PoB's DPS (the same total over a
    shorter time, fewer stacks); it only makes damage arrive sooner, so
    it's the implicit to trade away first.

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
| poe.ninja | Prices (currency, uniques, gems), leagues, popular builds; API at `https://poe.ninja/poe1/api/` | No official API: cache (≥ 15 min), low request rate, identify the app in User-Agent |
| Official trade site API | Rare item prices | Reading search results needs GGG's OAuth login with the `account:trade` scope (as PoB's trader does, 2026); search links work logged out. The league list also refuses logged-out requests |
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
| 1 | PoB engine (§5.1) inside the app on Windows; saved builds (§3.0) | The app shows your build's DPS, life and EHP matching PoB |
| 2 | Build health check (§3.7) + try an item (§3.8) | Your build's warnings make sense; pasting an item shows its stat changes and new warnings |
| 3 | Honest DPS and boss check; rank support gems, pantheon, flasks (§3.9) | Configured vs conservative vs boss DPS side by side; best support swap found |
| 4 | Passive advisor (§3.1) | Top 10 next passives with gain per point; you'd take most of them |
| 5 | Item upgrade advisor (§3.2) with poe.ninja prices; Bossing goal | Per-slot buys ranked by gain per chaos, with trade links; also ranked for bossing |
| 6 | Item check from the game clipboard (§3.3); max-hit drawback check (below) | Copy an item in game → upgrade or not, for your build; an item that cuts a max hit is flagged |
| 7a | Compare to a target build / guide, incl. guide stages (§3.0) + build links; the gap explained piece by piece (§3.12 items 10–12, 14, 16) | Paste a guide's code or link → ordered list of what to change first, the DPS gap split into config, tree, gems and each gear slot, what each replaced item carries, and a verdict for an uber boss fight |
| 7c | Build audit (§3.12 items 13, 15, 18, 20): charges, conditions and stances; flask set planner; PoB limits flagged | Your build: "turn this on in PoB" / "not true on a boss" with each one's worth; a ranked flask set per content; PoB's blind spots shown next to the numbers |
| 7b | Meta comparison with poe.ninja (§3.11, §3.12 items 1–4, 17, 19) | For your build: popular items/passives you lack, ranked by real gain |
| 8 | Run tracker (§3.4) | Maps per hour and deaths from a real play session |
| 9 | Earnings and farming advisor (§3.5); needs GGG OAuth approval | Currency per hour per strategy from your own play |
| 10 | League mechanics (§3.6), e.g. 3.29 mercenaries for Luminary | Merc recommendation for your build |
| 7d | Minion builds (spectres, golems, Animate Guardian…): PoB puts their damage in the minion's output (`output.Minion`), so every advisor sees DPS 0 and ranks by effective HP only (found 2026-11-02 on a level 100 spectre Necromancer from the ladder) | A spectre build's passives, items, item check, comparison and audit are ranked by its minions' DPS |
| later | Patch impact (§3.10); content readiness and Foulborn uniques (§3.12); PoE2 via PoB's PoE2 version; Claude explanations | — |

## 8. Open questions

- Which build to use as the reference for checking numbers in sessions 1–2
  (your current character's PoB code)?
- Overlay vs normal window for the item check (overlays need the game in
  windowed fullscreen).
- When to apply for GGG OAuth (suggest: after session 2, once the app is real).
