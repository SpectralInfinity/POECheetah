import { change } from "./analysis";
import type { Stats } from "./stats";

// 3.30 Fates (design doc §3.13): Fate cards empower an area's boss, up to 3
// per boss, each with a hazard (a new skill) and a modifier, for its reward.
// When choosing 1 of 4 cards at a Rite and 3 at the boss, the player wants
// the ones whose empowerment their build handles. Path of Building can put
// some modifiers in numbers (an enemy resistance, a curse or ailment on the
// player, less life); the rest are described with the build's own numbers
// for the damage type involved. Texts from Maxroll's Covens of Umbra farming
// guide (read 2026-11-18); exact values may change with patches.

export type Element = "Physical" | "Fire" | "Cold" | "Lightning" | "Chaos";

/** What the engine changes to calculate a modifier (see `api.trials`). */
export interface Trial {
  config?: Record<string, string | number | boolean>;
  lines?: string[];
  enemyResist?: Partial<Record<"Fire" | "Cold" | "Lightning" | "Chaos", number>>;
}

export interface Fate {
  name: string;
  /** For a Grim Fate: the pinnacle boss it empowers. */
  boss?: string;
  /** The hazard (new boss skill) and the modifier, as the guide words them. */
  does: string;
  /** Damage type of its hits and hazards, when known. */
  element?: Element;
  /** What Path of Building calculates for the modifier, and how it's described. */
  trial?: Trial;
  trialText?: string;
  /** Output stat at 100 means the player is immune to its ailment or curse. */
  avoid?: { key: string; what: string };
  /** The boss deals this much more damage (0.3 = 30% increased). */
  moreDamage?: number;
  /** What the app can't calculate, said plainly. */
  note?: string;
}

const MAP_CURSE = 15;

export const FATES: Fate[] = [
  { name: "Crowkeeper", does: "Releases crow projectiles that detonate after a delay on whoever they hit; the boss deals extra damage to enemies on low life.", element: "Physical", note: "Hurts most when you sit at low life (Righteous Fire, low-life builds)." },
  { name: "Torchbearer", does: "Bonfires from corpses spew fiery projectiles; the boss gains a share of its physical damage as extra fire damage.", element: "Fire" },
  { name: "Tempest", does: "Lightning orbs that shoot projectiles and explode; the boss curses you with Conductivity on hit.", element: "Lightning", trial: { config: { playerCursedWithConductivity: MAP_CURSE } }, trialText: `Conductivity on you (level ${MAP_CURSE} assumed)`, avoid: { key: "CurseAvoidChance", what: "curses" } },
  { name: "Stormcaller", does: "Leylines that call down lightning bolts; the boss shocks on hit.", element: "Lightning", trial: { config: { conditionShocked: true } }, trialText: "Shocked", avoid: { key: "ShockAvoidChance", what: "shock" } },
  { name: "Houndmaster", does: "Spectral wolves leap at you, howl to make you Brittle and explode for cold damage.", element: "Cold", trial: { config: { conditionBrittle: true } }, trialText: "Brittle (crits against you)", avoid: { key: "BrittleAvoidChance", what: "Brittle" } },
  { name: "Bloodthirsty", does: "Volleys of bone projectiles; the boss impales on hit.", element: "Physical", avoid: { key: "ImpaleAvoidChance", what: "impale" }, note: "Impale stacks extra physical damage on later hits." },
  { name: "Sanguine", does: "A ring of blood dealing heavy physical damage over time; the boss regenerates life.", element: "Physical", note: "Regeneration makes the fight longer: low damage builds feel it most." },
  { name: "Deathbringer", does: "Gory beams from the sky at your location, heavy damage; the boss has more maximum life.", note: "More boss life: a longer fight." },
  { name: "Wildfire", does: "Walls of blackfire dealing fire damage over time; the boss curses you with Flammability on hit.", element: "Fire", trial: { config: { playerCursedWithFlammability: MAP_CURSE } }, trialText: `Flammability on you (level ${MAP_CURSE} assumed)`, avoid: { key: "CurseAvoidChance", what: "curses" } },
  { name: "Conjurer", does: "Two portals with a beam of energy between them; the boss can inflict Withered on hit.", element: "Chaos", trial: { lines: ["90% increased Chaos Damage taken"] }, trialText: "Withered at 15 stacks (90% increased chaos damage taken)" },
  { name: "Dryad", does: "Vengeful vines slam at your location; the boss leeches life from its damage.", note: "Leech keeps the boss alive longer against low damage." },
  { name: "Doomsayer", does: "A huge blackfire blast (its centre is safe); the boss gains 75% fire resistance and penetrates 8% fire resistance.", element: "Fire", trial: { enemyResist: { Fire: 75 }, config: { enemyFirePen: 8 } }, trialText: "the boss's +75% fire resistance and 8% fire penetration" },
  { name: "Incandescent", does: "Blackfire detonations track you; the boss Hinders and Unnerves on hit.", element: "Fire", note: "Hinder slows you; Unnerve makes you take more spell damage." },
  { name: "Alchemist", does: "Boiling cauldrons of blood dealing physical damage over time; the boss poisons on hit.", element: "Chaos", avoid: { key: "PoisonAvoidChance", what: "poison" } },
  { name: "Butcher", does: "Piercing projectiles that return, opening sores that deal repeated physical damage; the boss deals 30% increased damage.", element: "Physical", moreDamage: 0.3 },
  { name: "Gravewalker", does: "Fissures sprout bloated corpses that explode for fire damage and lower your life and energy shield by 10% per stack, up to 50%.", element: "Fire", trial: { lines: ["50% less maximum Life", "50% less maximum Energy Shield"] }, trialText: "5 stacks (half your life and energy shield)" },
  { name: "Rotted", does: "Lines of poisoning Plaguebursts; the boss gains a share of its physical damage as extra chaos damage.", element: "Chaos", avoid: { key: "PoisonAvoidChance", what: "poison" } },
  { name: "Murderous", does: "Malignant crows explode for physical damage when you come close; the boss blinds on hit.", element: "Physical", trial: { config: { conditionBlinded: true } }, trialText: "Blinded", avoid: { key: "BlindAvoidChance", what: "blind" } },
  { name: "Black Frost", does: "Ice chunks then a cascade of ice spikes where they landed; the boss gains a share of its physical damage as extra cold damage.", element: "Cold" },
  { name: "Golemancer", does: "Fleshy blood simulacra slam your location and make you bleed; the boss has 50% increased area of effect.", element: "Physical", avoid: { key: "BleedAvoidChance", what: "bleeding" } },
  { name: "Avalanche", does: "Icy darts; the boss has 30% increased attack, cast and movement speed.", element: "Cold", note: "Faster boss: more hits a second, less time to dodge." },
  { name: "Blood Moon", does: "Orbs of blood slam into pools of physical damage over time; the boss's attacks make you bleed.", element: "Physical", avoid: { key: "BleedAvoidChance", what: "bleeding" } },
  { name: "Savage", does: "A second boss joins, drawn from campaign bosses, empowered by your other Fates too.", note: "Two bosses at once; the others' Fates apply to both." },
  { name: "Pestilent", does: "A second boss joins, drawn from campaign bosses, empowered by your other Fates too.", note: "Two bosses at once; the others' Fates apply to both." },
  { name: "Sadist", does: "A second boss joins, drawn from campaign bosses, empowered by your other Fates too.", note: "Two bosses at once; the others' Fates apply to both." },
];

/** Grim Fates: dropped by Fate-empowered bosses of high tier maps, used on pinnacle bosses (the way to the Coven Queen). */
export const GRIM_FATES: Fate[] = [
  { name: "The Collector", boss: "The Maven", does: "Chance to gain a power, frenzy or endurance charge on hit; brain-phase monsters get a random Fate; Cascade of Pain fires crows; Circle Slam triggers a blood beam.", note: "Charges make her hit harder and faster as the fight goes on." },
  { name: "The Awakened", boss: "Sirus", does: "A random Conqueror power; Deatomisation storms become crowstorms; Meteor Maze gets an extra wall; the multi-beam's last burst is empowered.", note: "The Conqueror power is random: be ready for any." },
  { name: "The Emissary", boss: "The Eater of Worlds", does: "Gains 30% of its maximum life as extra energy shield; Drowning Orbs carry a random curse aura; Dash Slam is empowered.", note: "About 30% more to chew through: a longer fight." },
  { name: "The Iridescent", boss: "The Searing Exarch", does: "Always scorches on hit; runes and meteors replaced by Umbral ones; flame walls empowered.", element: "Fire", trial: { config: { conditionScorched: true } }, trialText: "Scorched (lower elemental resistances)" },
  { name: "The Arkhon", boss: "The Shaper", does: "Gains 80% of physical damage as extra damage of a random element; an illusory clone when he fires his beam; anomalies release delayed blasts.", note: "The extra element is random: your weakest elemental max hit is what counts." },
  { name: "The Malignance", boss: "The Elder", does: "Empowered by the Rot Fate (extra chaos damage); portals release lightning blasts during tentacle slams.", element: "Chaos" },
  { name: "The Unraveller", boss: "The Elder and The Shaper", does: "Shaper 20% faster cooldowns, Elder 20% faster projectiles; Elder's arena blast deals heavy fire damage and ignites; bone harpoons inflict Corpserot.", element: "Fire" },
  { name: "The Templar", boss: "Venarius", does: "Unique synthesised monsters get a random Fate; Venarius conjures malignant crows and blood orbs.", note: "Random Fates on the adds." },
  { name: "The Fearsome", boss: "The Incarnation of Fear", does: "Regenerates 2% of life per second; Umbral Orbs; fissures and burning ground make exploding corpses.", note: "2% a second regeneration: low damage builds may not out-damage it." },
  { name: "The Neglectful", boss: "The Incarnation of Neglect", does: "100% increased duration of the ailments it inflicts; returning projectiles; howling wolves; statues summon crowstorms.", note: "Ailments last twice as long: ailment immunity matters more." },
  { name: "The Dreadful", boss: "The Incarnation of Dread", does: "500% increased critical strike chance and +30% critical strike multiplier; more Umbral Roses; empowered orbs and nova.", element: "Physical", note: "It crits far more often: crit protection and max hit matter." },
];

/** The engine call for a list of Fates: the enemy is a map boss; one trial per Fate that has one. */
export function fateTrials(fates: Fate[]): { shared: Record<string, string>; trials: (Trial & { label: string })[] } {
  return { shared: { enemyIsBoss: "Boss" }, trials: fates.filter((f) => f.trial).map((f) => ({ label: f.name, ...f.trial! })) };
}

export type Danger = "immune" | "safe" | "watch" | "danger" | "unknown";

export interface FateVerdict {
  fate: Fate;
  danger: Danger;
  /** Changes the app could calculate (0.1 = +10%). */
  dps?: number;
  ehp?: number;
  maxHit?: number;
  /** Net life per second with Righteous Fire, after the change, if the build burns itself. */
  burnNet?: number;
  text: string;
  unparsed: string[];
}

const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 100))}%`;
const num = (x: number) => Math.round(x).toLocaleString("en-US");
const maxHitKey = (e: Element) => `${e}MaximumHitTaken`;
const ELEMENTS: Element[] = ["Physical", "Fire", "Cold", "Lightning", "Chaos"];

const DANGER_ORDER: Record<Danger, number> = { danger: 0, watch: 1, unknown: 2, safe: 3, immune: 4 };

/**
 * Each Fate's verdict for the build: immune when the build avoids its ailment
 * or curse entirely; otherwise the calculated change (DPS, effective HP, the
 * max hit of its damage type, Righteous Fire's margin) or, when PoB can't
 * calculate it, the build's own numbers for its damage type.
 */
export function judgeFates(
  fates: Fate[],
  before: Stats,
  results: { label: string; stats: Stats; unparsed: string[] }[],
): FateVerdict[] {
  const byLabel = new Map(results.map((r) => [r.label, r]));
  const lowest = ELEMENTS.reduce((a, b) => ((before[maxHitKey(b)] ?? Infinity) < (before[maxHitKey(a)] ?? Infinity) ? b : a));
  const burns = (before.TotalBuildDegen ?? 0) > 0;
  const net = (s: Stats) => (s.LifeRegenRecovery ?? 0) - (s.TotalBuildDegen ?? 0);

  const verdicts = fates.map((fate): FateVerdict => {
    if (fate.avoid && (before[fate.avoid.key] ?? 0) >= 100) {
      return { fate, danger: "immune", text: `You can't be affected by its ${fate.avoid.what}.`, unparsed: [] };
    }
    const hitNow = fate.element ? before[maxHitKey(fate.element)] ?? 0 : 0;
    const weakSpot = fate.element !== undefined && fate.element === lowest;
    const elementText = fate.element
      ? `Its damage is ${fate.element.toLowerCase()}: your ${fate.element.toLowerCase()} max hit is ${num(hitNow)}${weakSpot ? ", your lowest" : ""}.`
      : "";

    if (fate.moreDamage) {
      const ehp = 1 / (1 + fate.moreDamage) - 1;
      return {
        fate,
        danger: Math.abs(ehp) >= 0.25 ? "danger" : "watch",
        ehp,
        text: `Its hits are ${pct(fate.moreDamage)} stronger: your effective HP against it ${pct(ehp)}. ${elementText}`.trim(),
        unparsed: [],
      };
    }

    const r = byLabel.get(fate.name);
    if (fate.trial && r) {
      const dps = change(before.CombinedDPS ?? 0, r.stats.CombinedDPS ?? 0);
      const ehp = change(before.TotalEHP ?? 0, r.stats.TotalEHP ?? 0);
      const maxHit = fate.element ? change(hitNow, r.stats[maxHitKey(fate.element)] ?? 0) : 0;
      const burnNet = burns ? net(r.stats) : undefined;
      const worst = Math.min(dps, ehp, maxHit);
      let danger: Danger = worst <= -0.25 || (burnNet !== undefined && burnNet < 0) ? "danger" : worst <= -0.08 ? "watch" : "safe";
      if (r.unparsed.length) danger = "unknown";
      const parts: string[] = [];
      if (Math.abs(dps) >= 0.005) parts.push(`DPS ${pct(dps)}`);
      if (Math.abs(ehp) >= 0.005) parts.push(`effective HP ${pct(ehp)}`);
      if (fate.element && Math.abs(maxHit) >= 0.005) parts.push(`${fate.element.toLowerCase()} max hit ${pct(maxHit)}`);
      if (burnNet !== undefined && burnNet < net(before)) parts.push(`Righteous Fire net ${burnNet < 0 ? "−" : "+"}${num(Math.abs(burnNet))} life/s`);
      const what = fate.trialText ?? "its modifier";
      const text = parts.length
        ? `With ${what}: ${parts.join(", ")}.${weakSpot ? ` ${elementText}` : ""}`
        : `With ${what}: no change for your build.${weakSpot ? ` ${elementText}` : ""}`;
      return { fate, danger, dps, ehp, maxHit, burnNet, text, unparsed: r.unparsed };
    }

    const text = [elementText, fate.note ?? ""].filter(Boolean).join(" ") || "Path of Building can't put this in numbers.";
    return { fate, danger: weakSpot ? "watch" : "unknown", text, unparsed: [] };
  });
  return verdicts.sort((a, b) => DANGER_ORDER[a.danger] - DANGER_ORDER[b.danger] || (a.ehp ?? 0) + (a.dps ?? 0) - ((b.ehp ?? 0) + (b.dps ?? 0)));
}
