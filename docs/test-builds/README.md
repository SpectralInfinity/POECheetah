# Test builds

The owner's real characters (PoB codes), for checking each session's feature
by hand on real builds. Not used by automated tests: those use made-up
fixtures (`src/core/__fixtures__/`, `src-tauri/pob-engine/tests/fixtures/`).

| File | Character | Main skill | Good for |
|---|---|---|---|
| `reliquarian-poison-95.txt` | Level 95 Scion / Reliquarian | Poisonous Concoction of Bouncing | Damage and defence advice; the reference numbers in `docs/progress.md` (session 0) |
| `reliquarian-poison-95-update.txt` | The same Reliquarian, updated (2026-11-02): Immortal Call, stance left at Blood Stance, Progenesis | The build audit (§3.12 items 15, 18): stance, flasks, charges |
| `luminary-support-97.txt` | Level 97 Scion / Luminary | Flame Link (no damage of its own; party support with minions) | Builds whose main skill deals no damage; league mechanics (§3.6, Luminary mercenaries) |

## Other builds

Public builds the owner chose as test builds (not their characters).

| File | Build | Main skill | Good for |
|---|---|---|---|
| `goratha-fireball-radiation-rf.txt` | Goratha's 3.30 league start (shared publicly with his videos, code as of 2026-11-15): Scion / Reliquarian, life stacking | Fireball of Radiation (PoB 2.67.2 doesn't know it yet: plain Fireball or Fire Trap stands in, labelled "THIS IS FIREBALL"); Righteous Fire and Fire Trap with it | Build tiers (§3.14): five trees, skill sets and item sets with matching titles (Leveling 1-28, 28-60, 68+, Red Maps, Chase Setup; Chase Setup unfinished); an auto-cast main skill (Fireball on Spellslinger); Full DPS (Red Maps ticks Fire Trap and Righteous Fire) |

Notes on that build from his league start update (2026-11-15), for checking
the app's advice against what he plays:

- Fireball of Radiation doesn't hit: it pierces, scales very well with gem
  levels, likes Lesser/Greater Multiple Projectiles or volley supports. The
  final build is "mainly Fireball": self-cast in a juiced helmet ("arch demon" in the video),
  with Righteous Fire and Fire Trap linked in a six-link body armour.
- Reliquarian's Shade of Solaris (200% increased spell damage if you crit
  recently) needs a crit from another skill: Storm Brand with Increased
  Critical Strikes, Combustion and Fire Exposure in the gloves. It doesn't
  stack with itself.
- Leveling: hit-based plain Fireball (fire mastery: more damage against
  ignited enemies; flat fire damage), with Fire Trap, until about level 50,
  then Fireball of Radiation once the fire damage-over-time nodes and gem
  levels are in. Armageddon Brand with Firestorm also works. Scion gets
  neither Combustion nor Holy Flame Totem early. Spellslinger from about
  30-40 needs mana cost efficiency (Honourhome, tree) and a mana flask;
  later Lifetap on almost everything, then self-cast.
- Righteous Fire early: Brass Dome (Scion ascendancy, +5% maximum
  resistances), the fire masteries for regeneration per overcapped fire
  resistance, Hardy and the life regeneration mastery; Purity of Fire early,
  Skitterbots from Uber Lab.
- An endurance charge source (Aggressive Bastion on the tree or anointed,
  or a cluster jewel) for mapping. Endgame: life stacking with Rathpith
  Globe and the Shadowstitch notable.

To try one with the engine (after `scripts/fetch-pob.sh`):

```sh
python3 -c "import zlib,base64,sys; c=open(sys.argv[1]).read().strip(); print(zlib.decompress(base64.urlsafe_b64decode(c+'='*(-len(c)%4))).decode())" \
  docs/test-builds/reliquarian-poison-95.txt > /tmp/build.xml
cd src-tauri/pob-engine && cargo run --release --example stats -- /tmp/build.xml --passives
```

In the app, paste the file's contents into "Add a build". When the owner
sends a newer code for a character, replace its file.
