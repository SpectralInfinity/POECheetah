import { change } from "./analysis";
import { avoidsDrawbacks, goalGain, type Goal } from "./goals";
import { drawbacks } from "./passives";
import type { Stats } from "./stats";

// 3.30's Wickerman (design doc §3.13): four slots for body parts (head,
// torso, arm, leg) dropped by bosses, each a permanent effect while
// attached. Body parts are items; their lines are calculated with PoB as
// custom modifiers (engine `modSets`) before PoB knows the Wickerman.

export const BODY_SLOTS = ["Head", "Torso", "Arm", "Leg"] as const;
export type BodySlot = (typeof BODY_SLOTS)[number];

export interface BodyPart {
  name: string;
  slot: BodySlot;
  /** Lesser (campaign), normal, Greater (endgame), from the name. */
  tier: "Lesser" | "Normal" | "Greater";
  /** Its modifier lines. */
  lines: string[];
}

const SEPARATOR = /^-{8,}$/;

/**
 * Reads a body part copied in game (Ctrl+C). The layout is assumed from
 * the keynote's tooltip (name, slot, modifiers, "Take this to the
 * Wickerman…"): checked on a real copy at launch. Null when the text isn't one.
 */
export function readBodyPart(text: string): BodyPart | null {
  if (!/wickerman/i.test(text)) return null;
  const sections: string[][] = [[]];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (SEPARATOR.test(line)) sections.push([]);
    else if (line) sections[sections.length - 1].push(line);
  }
  const head = sections[0].filter((l) => !/^(Item Class|Rarity):/i.test(l));
  const name = head[0];
  if (!name) return null;
  let slot: BodySlot | null = null;
  let slotSection = -1;
  sections.forEach((sec, i) => {
    for (const l of sec) {
      const m = BODY_SLOTS.find((s) => s.toLowerCase() === l.toLowerCase());
      if (m && slot === null) {
        slot = m;
        slotSection = i;
      }
    }
  });
  if (!slot) return null;
  const isMeta = (l: string) =>
    /wickerman/i.test(l) || /^(Item Level|Requires|Requirements|Level):?/i.test(l) || l === name || l === slot || /^Corrupted$/i.test(l);
  // The modifiers: the slot's own section after the slot line, else the next section.
  const own = sections[slotSection].slice(sections[slotSection].indexOf(slot) + 1).filter((l) => !isMeta(l));
  const next = (sections[slotSection + 1] ?? []).filter((l) => !isMeta(l));
  const lines = own.length ? own : next;
  const tier = /^Lesser /.test(name) ? "Lesser" : /^Greater /.test(name) ? "Greater" : "Normal";
  return { name, slot, tier, lines };
}

/** The parts attached to the Wickerman now, by slot. */
export type Wickerman = Partial<Record<BodySlot, BodyPart>>;

/** Every attached part's lines, with `slot` left empty or holding `replace` instead. */
export function wickermanLines(w: Wickerman, slot?: BodySlot, replace?: BodyPart | null): string[] {
  return BODY_SLOTS.flatMap((s) => {
    const part = s === slot ? replace : w[s];
    return part ? part.lines : [];
  });
}

/** One modifier set for the engine and what it stands for. */
export interface PartSet {
  id: string;
  lines: string[];
}

/**
 * The sets to calculate: all attached parts; all but each attached one
 * (to say what each is worth); and, for a candidate, the attached ones with
 * it in its slot.
 */
export function partSets(w: Wickerman, candidate?: BodyPart | null): PartSet[] {
  const sets: PartSet[] = [{ id: "all", lines: wickermanLines(w) }];
  for (const s of BODY_SLOTS) if (w[s]) sets.push({ id: `without:${s}`, lines: wickermanLines(w, s, null) });
  if (candidate) sets.push({ id: "candidate", lines: wickermanLines(w, candidate.slot, candidate) });
  return sets;
}

export interface PartWorth {
  slot: BodySlot;
  part: BodyPart;
  /** What the part adds to the build (0.1 = +10%). */
  dps: number;
  ehp: number;
  gain: number;
  /** Life regenerated per second, added. */
  regen: number;
  /** Lines Path of Building doesn't understand yet (counted as nothing). */
  unparsed: string[];
}

export interface CandidateVerdict {
  part: BodyPart;
  /** The part it would replace. */
  replaces: BodyPart | null;
  dps: number;
  ehp: number;
  gain: number;
  regen: number;
  drawbacks: string[];
  unparsed: string[];
  attach: boolean;
  text: string;
}

const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 1000) / 10)}%`;

function describe(e: { dps: number; ehp: number; regen: number }, noDamage: boolean): string {
  const parts: string[] = [];
  if (!noDamage && Math.abs(e.dps) >= 0.0005) parts.push(`${pct(e.dps)} DPS`);
  if (Math.abs(e.ehp) >= 0.0005) parts.push(`${pct(e.ehp)} effective HP`);
  if (Math.abs(e.regen) >= 0.5) parts.push(`${e.regen > 0 ? "+" : "−"}${Math.abs(Math.round(e.regen))} life/s`);
  return parts.join(", ") || "nothing Path of Building can measure";
}

/** Below this gain (either way) a swap is about the same. */
const MIN_GAIN = 0.005;

/**
 * Each attached part's worth, and the candidate's verdict, from the
 * engine's results for `partSets` (same order). Unknown lines count as
 * nothing and are listed, so a "0%" isn't read as "useless".
 */
export function judgeParts(
  w: Wickerman,
  sets: PartSet[],
  results: { stats: Stats; unparsed: string[] }[],
  goal: Goal,
  candidate?: BodyPart | null,
): { attached: PartWorth[]; candidate: CandidateVerdict | null; noDamage: boolean } {
  const by = new Map(sets.map((s, i) => [s.id, results[i]]));
  const all = by.get("all")!.stats;
  const noDamage = !((all.CombinedDPS ?? 0) > 0);
  const effect = (from: Stats, to: Stats) => {
    const dps = change(from.CombinedDPS ?? 0, to.CombinedDPS ?? 0);
    const ehp = change(from.TotalEHP ?? 0, to.TotalEHP ?? 0);
    return { dps, ehp, gain: noDamage ? ehp : goalGain(goal, dps, ehp), regen: (to.LifeRegenRecovery ?? 0) - (from.LifeRegenRecovery ?? 0) };
  };
  const unparsedOf = (part: BodyPart) => (by.get("all")?.unparsed ?? []).filter((l) => part.lines.includes(l));
  const attached: PartWorth[] = [];
  for (const slot of BODY_SLOTS) {
    const part = w[slot];
    const without = by.get(`without:${slot}`);
    if (!part || !without) continue;
    attached.push({ slot, part, ...effect(without.stats, all), unparsed: unparsedOf(part) });
  }
  let verdict: CandidateVerdict | null = null;
  const cand = by.get("candidate");
  if (candidate && cand) {
    const e = effect(all, cand.stats);
    const costs = drawbacks(all, cand.stats);
    const unparsed = cand.unparsed.filter((l) => candidate.lines.includes(l));
    const replaces = w[candidate.slot] ?? null;
    const attach = (e.gain >= MIN_GAIN || (!replaces && e.gain >= 0)) && !(avoidsDrawbacks(goal) && costs.length > 0);
    const over = replaces ? ` over ${replaces.name}` : "";
    const text = attach
      ? `Attach it${replaces ? ` in place of ${replaces.name}` : ""}: ${describe(e, noDamage)}.`
      : e.gain > -MIN_GAIN
        ? `About the same${over}: ${describe(e, noDamage)}.`
        : `Keep ${replaces?.name ?? "the slot empty"}: ${describe(e, noDamage)}.`;
    verdict = { part: candidate, replaces, ...e, drawbacks: costs, unparsed, attach, text };
  }
  return { attached, candidate: verdict, noDamage };
}
