import { change } from "./analysis";
import { avoidsDrawbacks, goalGain, goalLabel, type Goal } from "./goals";
import { drawbacks } from "./passives";
import type { Stats } from "./stats";

/** The top of PoE item text, as copied with Ctrl+C in game or from the trade site (design doc §3.3). */
export interface ItemHeader {
  /** "Rings", "Body Armours"…; missing in text copied before the game added it. */
  itemClass: string | null;
  /** "Normal", "Magic", "Rare", "Unique", "Currency", "Gem"… */
  rarity: string;
  /** The item's name: a unique's or rare's own name, else the full magic or normal name. */
  name: string;
  /** The base type for rares and uniques ("Gold Ring"); null otherwise. */
  base: string | null;
}

const SEPARATOR = /^-{8,}$/;

/** Reads the header of PoE item text; null when the text isn't a copied item. */
export function readItemHeader(text: string): ItemHeader | null {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim());
  while (lines.length > 0 && lines[0] === "") lines.shift();
  if (!lines.some((l) => SEPARATOR.test(l))) return null;
  let i = 0;
  let itemClass: string | null = null;
  const cls = lines[i]?.match(/^Item Class:\s*(.+)$/);
  if (cls) {
    itemClass = cls[1];
    i++;
  }
  const rarity = lines[i]?.match(/^Rarity:\s*(.+)$/)?.[1];
  if (!rarity) return null;
  i++;
  const names: string[] = [];
  while (i < lines.length && !SEPARATOR.test(lines[i]) && names.length < 3) names.push(lines[i++]);
  if (names.length === 0 || names.length > 2) return null;
  return { itemClass, rarity, name: names[0], base: names[1] ?? null };
}

const EQUIPMENT_RARITIES = new Set(["Normal", "Magic", "Rare", "Unique"]);

/** Item classes with an equipment rarity that never go in a build's slots. */
const NOT_WORN =
  /^(Maps|Map Fragments|Misc Map Items|Stackable Currency|Divination Cards|Contracts|Blueprints|Heist .+|Trinkets|Expedition Logbooks|Incubators|Relics|Sanctum .+|Memories|Quest Items|Pieces|Atlas Upgrade Items)$/i;

/** Whether copied item text is something a build might wear (so the clipboard watch checks it). */
export function isEquipment(h: ItemHeader): boolean {
  return EQUIPMENT_RARITIES.has(h.rarity) && !(h.itemClass && NOT_WORN.test(h.itemClass));
}

/** What the engine's `tryItem` returns. */
export interface ItemTrial {
  item: string;
  /** The character level the item needs, as PoB read it. */
  requiredLevel?: number | null;
  before: Stats;
  slots: { slot: string; replaces: string | null; stats: Stats }[];
}

export interface SlotCheck {
  slot: string;
  replaces: string | null;
  stats: Stats;
  /** Relative DPS and effective HP change (0.1 = +10%). */
  dps: number;
  ehp: number;
  /** The goal's gain. */
  gain: number;
  drawbacks: string[];
}

export type Verdict =
  /** Gains for the goal; for Damage and Defence possibly with drawbacks (listed). */
  | "upgrade"
  /** Gains, but every gaining slot has a drawback, which Balanced and Bossing don't accept. */
  | "drawback"
  /** Within ±1% for the goal. */
  | "same"
  | "worse"
  /** Fits none of the build's active slots. */
  | "no-slot";

export interface ItemCheck {
  item: string;
  goal: Goal;
  /** The main skill deals no damage in PoB, so the check ranks by effective HP (as the advisors do). */
  noDamage: boolean;
  verdict: Verdict;
  /** The slot the verdict is about (the best one); null when the item fits nowhere. */
  best: SlotCheck | null;
  /** Every slot it fits, best first. */
  slots: SlotCheck[];
  /** The item needs a higher level than the character has. */
  tooHigh: { needs: number; level: number } | null;
}

/** Below this gain (either way) an item is about the same as what's worn; as the upgrade advisor's minimum. */
const MIN_GAIN = 0.01;

/** Upgrade or not, for the build and goal: PoB's trial of the item in each slot it fits. */
export function checkItem(trial: ItemTrial, goal: Goal, level: number): ItemCheck {
  const noDamage = !((trial.before.CombinedDPS ?? 0) > 0);
  const slots: SlotCheck[] = trial.slots
    .map((s) => {
      const dps = change(trial.before.CombinedDPS ?? 0, s.stats.CombinedDPS ?? 0);
      const ehp = change(trial.before.TotalEHP ?? 0, s.stats.TotalEHP ?? 0);
      const gain = noDamage ? ehp : goalGain(goal, dps, ehp);
      return { ...s, dps, ehp, gain, drawbacks: drawbacks(trial.before, s.stats) };
    })
    .sort((a, b) => b.gain - a.gain || a.drawbacks.length - b.drawbacks.length);

  let best = slots[0] ?? null;
  let verdict: Verdict = "no-slot";
  if (best) {
    if (best.gain >= MIN_GAIN) {
      const clean = slots.find((s) => s.gain >= MIN_GAIN && s.drawbacks.length === 0);
      if (!avoidsDrawbacks(goal)) verdict = "upgrade";
      else if (clean) {
        best = clean;
        verdict = "upgrade";
      } else verdict = "drawback";
    } else verdict = best.gain > -MIN_GAIN ? "same" : "worse";
  }
  const needs = trial.requiredLevel ?? 0;
  return {
    item: trial.item,
    goal,
    noDamage,
    verdict,
    best,
    slots,
    tooHigh: needs > level ? { needs, level } : null,
  };
}

const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 100))}%`;

/** "+14% DPS, −3% effective HP"; changes under 1% left out. */
export function changeText(s: { dps: number; ehp: number }, noDamage = false): string {
  const parts: string[] = [];
  if (!noDamage && Math.abs(s.dps) >= 0.005) parts.push(`${pct(s.dps)} DPS`);
  if (Math.abs(s.ehp) >= 0.005) parts.push(`${pct(s.ehp)} effective HP`);
  return parts.join(", ") || "no change to DPS or effective HP";
}

/** The one-line answer: "Upgrade for Balanced: +14% DPS, +2% effective HP in Ring 2". */
export function verdictText(c: ItemCheck): string {
  const goal = goalLabel(c.goal);
  const b = c.best;
  if (!b) return "Doesn't fit any of this build's slots";
  const where = ` in ${b.slot}`;
  switch (c.verdict) {
    case "upgrade":
      return `Upgrade for ${goal}: ${changeText(b, c.noDamage)}${where}`;
    case "drawback":
      return `Not for ${goal}: ${b.drawbacks.join(", ")}`;
    case "same":
      return `About the same for ${goal}${where}`;
    default:
      return `Not an upgrade for ${goal}: ${changeText(b, c.noDamage)}${where}`;
  }
}
