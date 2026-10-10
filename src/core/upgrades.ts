import { change } from "./analysis";
import { avoidsDrawbacks, goalGain, type Goal, type Mode } from "./goals";
import type { Price } from "./market";
import { drawbacks } from "./passives";
import type { Stats } from "./stats";

/** A unique the engine tried in one slot (design doc §3.2). */
export interface UniqueTrial {
  name: string;
  base: string;
  /** PoB's slot label ("Ring 1", "Socket #3") and name ("Jewel 18436"). */
  slot: string;
  slotName: string;
  replaces: string | null;
  /** Level requirement. */
  level: number;
  stats: Stats;
}

export interface FlaskMod {
  modId: string;
  lines: string[];
  stats: Stats;
}

/** A non-unique flask: the build with the same base and no mods, and with each mod alone. */
export interface FlaskTrial {
  slot: string;
  slotName: string;
  flask: string;
  active: boolean;
  plain: Stats;
  prefixes: FlaskMod[];
  suffixes: FlaskMod[];
}

export interface SlotInfo {
  slot: string;
  slotName: string;
  item?: string | null;
  rarity?: string | null;
  links: number;
}

/** What the engine's `upgrades` returns. */
export interface UpgradeResult {
  mode: Mode;
  level: number;
  before: Stats;
  slots: SlotInfo[];
  uniques: UniqueTrial[];
  /** Names poe.ninja lists that PoB doesn't know (e.g. added since the bundled PoB). */
  missing: string[];
  flasks: FlaskTrial[];
}

export interface UpgradeAdvice extends UniqueTrial {
  dps: number;
  ehp: number;
  /** The goal's gain (0.1 = +10%). */
  gain: number;
  price: Price;
  /** Gain per chaos, the ranking. */
  perChaos: number;
  drawbacks: string[];
  /** The slot holds 5+ linked sockets that this item's price doesn't include. */
  needsLinks: number;
}

/** Below this gain an item isn't worth buying. */
const MIN_GAIN = 0.01;
/** Prices under 1c count as 1c, so near-free items don't swamp the ranking. */
const MIN_PRICE = 1;
/** Losing more than this share of DPS or effective HP isn't an upgrade for any goal. */
const MAX_LOSS = 0.3;
/** Best buys per kind of slot (flasks, rings, jewels…), so one kind doesn't fill the list. */
const PER_KIND = 2;

/** "Flask 3" → "Flask", "Ring 2" → "Ring", "Socket #4" → "Socket". */
const slotKind = (slot: string) => slot.replace(/\s*#?\d+$/, "");

export interface UpgradePlan {
  /** The main skill deals no damage in PoB, so only defence can rank (as in the passive advisor). */
  noDamage: boolean;
  /** Best gain per chaos first, one entry per item (its best slot), at most two per kind of slot. */
  best: UpgradeAdvice[];
  /** Per slot, its best upgrades by gain. */
  bySlot: { slot: string; slotName: string; current: string | null; upgrades: UpgradeAdvice[] }[];
  /** Tried items without a price (shouldn't happen: the engine only tries priced ones). */
  unpriced: number;
}

export function planUpgrades(
  r: UpgradeResult,
  goal: Goal,
  priceOf: (name: string, base: string) => Price | null,
  opts: { budget?: number; limit?: number; perSlot?: number } = {},
): UpgradePlan {
  const { budget, limit = 15, perSlot = 3 } = opts;
  const links = new Map(r.slots.map((s) => [s.slotName, s.links]));
  const advice: UpgradeAdvice[] = [];
  let unpriced = 0;
  for (const t of r.uniques) {
    if (t.level > r.level) continue;
    const price = priceOf(t.name, t.base);
    if (!price) {
      unpriced++;
      continue;
    }
    if (budget !== undefined && price.chaos > budget) continue;
    const dps = change(r.before.CombinedDPS ?? 0, t.stats.CombinedDPS ?? 0);
    const ehp = change(r.before.TotalEHP ?? 0, t.stats.TotalEHP ?? 0);
    const gain = goalGain(goal, dps, ehp);
    if (gain < MIN_GAIN || dps < -MAX_LOSS || ehp < -MAX_LOSS) continue;
    const costs = drawbacks(r.before, t.stats);
    if (avoidsDrawbacks(goal) && costs.length > 0) continue;
    const slotLinks = links.get(t.slotName) ?? 0;
    advice.push({
      ...t,
      dps,
      ehp,
      gain,
      price,
      perChaos: gain / Math.max(MIN_PRICE, price.chaos),
      drawbacks: costs,
      needsLinks: slotLinks >= 5 ? slotLinks : 0,
    });
  }

  const bestPerItem = new Map<string, UpgradeAdvice>();
  for (const a of advice) {
    const key = `${a.name}|${a.base}`;
    const seen = bestPerItem.get(key);
    if (!seen || a.gain > seen.gain) bestPerItem.set(key, a);
  }
  const perKind = new Map<string, number>();
  const best = [...bestPerItem.values()]
    .sort((a, b) => b.perChaos - a.perChaos || b.gain - a.gain)
    .filter((a) => {
      const kind = slotKind(a.slot);
      const n = perKind.get(kind) ?? 0;
      perKind.set(kind, n + 1);
      return n < PER_KIND;
    })
    .slice(0, limit);

  const bySlot = r.slots
    .map((s) => ({
      slot: s.slot,
      slotName: s.slotName,
      current: s.item ?? null,
      upgrades: advice
        .filter((a) => a.slotName === s.slotName)
        .sort((a, b) => b.gain - a.gain)
        .slice(0, perSlot),
    }))
    .filter((s) => s.upgrades.length > 0);
  return { noDamage: !((r.before.CombinedDPS ?? 0) > 0), best, bySlot, unpriced };
}

export interface FlaskAdvice {
  slot: string;
  flask: string;
  active: boolean;
  /** The current flask's gain over the same base without mods. */
  current: number;
  prefix: { lines: string[]; gain: number } | null;
  suffix: { lines: string[]; gain: number } | null;
  /** Roughly what the best two mods add over the current flask (each mod measured alone). */
  improvement: number;
}

/** The best prefix and suffix for each magic flask, by the goal's gain over the same flask without mods. */
export function flaskAdvice(r: UpgradeResult, goal: Goal): FlaskAdvice[] {
  const gainOver = (base: Stats, s: Stats) =>
    goalGain(goal, change(base.CombinedDPS ?? 0, s.CombinedDPS ?? 0), change(base.TotalEHP ?? 0, s.TotalEHP ?? 0));
  const top = (f: FlaskTrial, mods: FlaskMod[]) => {
    const best = mods
      .map((m) => ({ lines: m.lines, gain: gainOver(f.plain, m.stats) }))
      .reduce<{ lines: string[]; gain: number } | null>((a, m) => (!a || m.gain > a.gain ? m : a), null);
    return best && best.gain > 0.001 ? best : null;
  };
  return r.flasks.map((f) => {
    const prefix = top(f, f.prefixes);
    const suffix = top(f, f.suffixes);
    const current = gainOver(f.plain, r.before);
    return {
      slot: f.slot,
      flask: f.flask,
      active: f.active,
      current,
      prefix,
      suffix,
      improvement: (prefix?.gain ?? 0) + (suffix?.gain ?? 0) - current,
    };
  });
}
