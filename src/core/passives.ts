import { change } from "./analysis";
import type { Stats } from "./stats";

/** One passive the engine calculated (design doc §3.1). */
export interface PassiveCandidate {
  /** PoB node id; a mastery appears once per effect it can take. */
  id: number;
  kind: "small" | "notable" | "keystone" | "mastery" | "ascendancy" | "swap";
  name: string;
  /** The node's (or mastery effect's) stat lines. */
  lines: string[];
  /** Passive points (ascendancy points for `ascendancy`, 0 for a mastery swap), the path included. */
  points: number;
  /** Unallocated nodes on the way, nearest to the node last. */
  via: string[];
  /** For a mastery swap: the effect it replaces. */
  replaces?: string[];
  /** The build's stats with the node and its path allocated. */
  stats: Stats;
}

/** What the engine's `passives` returns. */
export interface PassiveResult {
  before: Stats;
  level: number;
  pointsUsed: number;
  /** Points from outside levels and quests that PoB counts (e.g. from items). */
  extraPoints: number;
  ascendancyUsed: number;
  candidates: PassiveCandidate[];
  masterySwaps: PassiveCandidate[];
}

export type Goal = "damage" | "defence" | "balanced";

export const GOALS: { id: Goal; label: string }[] = [
  { id: "damage", label: "Damage" },
  { id: "defence", label: "Defence" },
  { id: "balanced", label: "Balanced" },
];

/** Passive points from quests (all acts done); PoB's maximum is 99 levels + these. */
export const QUEST_POINTS = 23;
export const ASCENDANCY_POINTS = 8;

/** Below this relative gain a passive isn't worth listing. */
const MIN_GAIN = 0.001;
/** Losing more than this share of life, effective HP or DPS counts as a drawback. */
const SHARP_DROP = 0.05;

const RESISTS = [
  { key: "FireResist", label: "Fire res" },
  { key: "ColdResist", label: "Cold res" },
  { key: "LightningResist", label: "Lightning res" },
  { key: "ChaosResist", label: "Chaos res" },
];

const pct = (x: number) => `${x > 0 ? "+" : "−"}${Math.abs(Math.round(x * 100))}%`;

/**
 * What a change costs the build: a resist going down (PoB's resist is already
 * capped, so any drop is below cap or further below it), or a sharp loss of
 * life, effective HP or DPS.
 */
export function drawbacks(before: Stats, after: Stats): string[] {
  const out: string[] = [];
  for (const { key, label } of RESISTS) {
    const a = before[key];
    const b = after[key];
    if (a !== undefined && b !== undefined && b <= a - 1) out.push(`${label} ${Math.round(a)}% → ${Math.round(b)}%`);
  }
  for (const [key, label] of [
    ["Life", "Life"],
    ["TotalEHP", "Effective HP"],
    ["CombinedDPS", "DPS"],
  ]) {
    const c = change(before[key] ?? 0, after[key] ?? 0);
    if (c < -SHARP_DROP) out.push(`${label} ${pct(c)}`);
  }
  return out;
}

export interface PassiveAdvice extends PassiveCandidate {
  /** Relative DPS and effective HP change (0.1 = +10%). */
  dps: number;
  ehp: number;
  /** The goal's gain: per point for passives, total for a mastery swap. */
  score: number;
  drawbacks: string[];
  /** How many reachable nodes give exactly this (e.g. two identical small nodes). */
  count: number;
}

function goalGain(goal: Goal, dps: number, ehp: number): number {
  if (goal === "damage") return dps;
  if (goal === "defence") return ehp;
  return (dps + ehp) / 2;
}

function advise(before: Stats, c: PassiveCandidate, goal: Goal): PassiveAdvice {
  const dps = change(before.CombinedDPS ?? 0, c.stats.CombinedDPS ?? 0);
  const ehp = change(before.TotalEHP ?? 0, c.stats.TotalEHP ?? 0);
  const gain = goalGain(goal, dps, ehp);
  return { ...c, dps, ehp, score: gain / Math.max(1, c.points), drawbacks: drawbacks(before, c.stats), count: 1 };
}

/**
 * Best first, only real gains; Balanced drops anything with a drawback. One
 * entry per node (a mastery keeps its best effect), and one per identical
 * choice: the same stats for the same points elsewhere on the tree, or the
 * same effect swapped onto either of two masteries of a kind (the best kept).
 */
function rank(before: Stats, list: PassiveCandidate[], goal: Goal, limit: number): PassiveAdvice[] {
  const best = new Map<number, PassiveAdvice>();
  for (const c of list) {
    const a = advise(before, c, goal);
    if (a.score * Math.max(1, a.points) < MIN_GAIN) continue;
    if (goal === "balanced" && a.drawbacks.length > 0) continue;
    const seen = best.get(a.id);
    if (!seen || a.score > seen.score) best.set(a.id, a);
  }
  const alike = new Map<string, PassiveAdvice>();
  for (const a of best.values()) {
    const key = JSON.stringify([a.kind, a.name, a.lines, a.points]);
    const seen = alike.get(key);
    if (!seen) alike.set(key, a);
    else {
      const keep = a.score > seen.score ? a : seen;
      alike.set(key, { ...keep, count: seen.count + 1 });
    }
  }
  return [...alike.values()].sort((a, b) => b.score - a.score || a.points - b.points).slice(0, limit);
}

export interface PassivePlan {
  /** The main skill deals no damage in PoB (e.g. a link or aura skill), so damage can't be ranked. */
  noDamage: boolean;
  /** Passive points spent, and available at this level with every quest done. */
  used: number;
  available: number;
  ascendancyUsed: number;
  /** Next passives by gain per point. */
  passives: PassiveAdvice[];
  /** Ascendancy notables within the free ascendancy points. */
  ascendancy: PassiveAdvice[];
  /** Other effects for allocated masteries (no points, only a respec). */
  swaps: PassiveAdvice[];
}

export function planPassives(r: PassiveResult, goal: Goal, limit = 10): PassivePlan {
  const main = r.candidates.filter((c) => c.kind !== "ascendancy");
  const asc = r.candidates.filter((c) => c.kind === "ascendancy");
  return {
    noDamage: !((r.before.CombinedDPS ?? 0) > 0),
    used: r.pointsUsed,
    available: Math.max(0, Math.min(r.level, 100) - 1) + QUEST_POINTS + r.extraPoints,
    ascendancyUsed: r.ascendancyUsed,
    passives: rank(r.before, main, goal, limit),
    ascendancy: rank(r.before, asc, goal, 3),
    swaps: rank(r.before, r.masterySwaps, goal, 3),
  };
}
