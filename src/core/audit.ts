import { change } from "./analysis";
import { goalGain, type Goal } from "./goals";
import { drawbacks } from "./passives";
import type { Stats } from "./stats";

// Build audit (design doc §3.12 items 13, 15, 18, 20): what the config assumes
// and whether the build makes it true against a boss, what each flask is for
// and what to put in the slot it can spare, and where PoB's numbers aren't the
// whole story. The engine's `audit` calculates; this file judges.

export interface AuditTry {
  /** The value tried, as PoB shows it ("true", "Blood Stance"). */
  value: string;
  stats: Stats;
}

export interface AuditOption {
  var: string;
  label: string;
  kind: "check" | "list";
  /** The value set now, as PoB shows it. */
  current: string;
  tries: AuditTry[];
}

export interface AuditFlask {
  slot: string;
  name: string;
  base: string;
  /** PoB's flask kind: "Life", "Mana", "Hybrid", "Utility". */
  kind: string;
  active: boolean;
  raw: string;
  /** The build with this flask off (missing when it isn't in use). */
  without?: Stats;
  /** Plain 20% quality utility flasks tried in this slot. */
  alternatives: { base: string; stats: Stats }[];
}

/** What the engine's `audit` returns. */
export interface AuditResult {
  before: Stats;
  skill: { name?: string; part?: string };
  options: AuditOption[];
  flasks: AuditFlask[];
  /** Path of Building's own warnings ("Poison DPS exceeds in game limit"). */
  warnings: { stat: string; text: string }[];
  dotCap: number;
  text: { items: { slot: string; name: string; raw: string }[]; nodes: string[]; gems: string[] };
}

const effect = (goal: Goal, before: Stats, after: Stats, noDamage: boolean) => {
  const dps = change(before.CombinedDPS ?? 0, after.CombinedDPS ?? 0);
  const ehp = change(before.TotalEHP ?? 0, after.TotalEHP ?? 0);
  return { dps, ehp, gain: noDamage ? ehp : goalGain(goal, dps, ehp) };
};

// --- Charges and conditions --------------------------------------------------

/**
 * What gives each charge or buff: lines that grant it (not ones that only
 * use it, "while you have…", "per Frenzy Charge") and gems that do.
 */
const SOURCES: Record<string, { words: string; gems: string[] }> = {
  usePowerCharges: { words: "Power Charges?", gems: ["Power Charge On Critical", "Assassin's Mark"] },
  useFrenzyCharges: { words: "Frenzy Charges?", gems: ["Blood Rage", "Frenzy", "Poacher's Mark"] },
  useEnduranceCharges: { words: "Endurance Charges?", gems: ["Enduring Cry", "Warlord's Mark", "Endurance Charge on Melee Stun"] },
  buffOnslaught: { words: "Onslaught", gems: ["Berserk"] },
  buffArcaneSurge: { words: "Arcane Surge", gems: ["Arcane Surge"] },
  buffUnholyMight: { words: "Unholy Might", gems: [] },
  buffFortification: { words: "Fortif(?:y|ication)", gems: ["Fortify", "Fortification"] },
  buffTailwind: { words: "Tailwind", gems: [] },
  buffElusive: { words: "Elusive", gems: ["Withering Step"] },
};

/** Gems and lines that only work when something dies, so not against a lone boss. */
const ON_KILL = /\bon kill\b|when you kill|killed recently|on killing/i;
const ON_KILL_GEMS = new Set(["Blood Rage"]);

/** Base types that grant a buff while their effect lasts. */
const FLASK_SOURCES: Record<string, string> = { buffOnslaught: "Silver Flask" };

export interface Source {
  /** The item, "Passive tree" or "Gem". */
  from: string;
  line: string;
  onKill: boolean;
}

/** The first thing in the build that grants `var`'s charge or buff; null when nothing does. */
export function findSource(text: AuditResult["text"], v: string): Source | null {
  const s = SOURCES[v];
  if (!s) return null;
  const grant = new RegExp(
    `(gains?|grants?|generates?)\\b[^.]*\\b${s.words}|${s.words}[^.]*\\bon (hit|kill|crit|critical)|chance to gain [^.]*${s.words}|(?<!while |if |during )you have ${s.words}`,
    "i",
  );
  for (const g of text.gems) {
    if (s.gems.includes(g)) return { from: "Gem", line: g, onKill: ON_KILL_GEMS.has(g) };
  }
  for (const item of text.items) {
    if (FLASK_SOURCES[v] && item.raw.includes(FLASK_SOURCES[v])) return { from: item.name, line: FLASK_SOURCES[v], onKill: false };
    for (const raw of item.raw.split(/\r?\n/)) {
      const line = raw.replace(/^(\{[^}]*\})+/, "").trim();
      if (grant.test(line)) return { from: item.name, line, onKill: ON_KILL.test(line) };
    }
  }
  for (const line of text.nodes) {
    if (grant.test(line)) return { from: "Passive tree", line, onKill: ON_KILL.test(line) };
  }
  return null;
}

export type OptionVerdict =
  /** On, and something in the build grants it. */
  | "ok"
  /** On, but only something dying grants it: not true against a lone boss. */
  | "on-kill"
  /** On, and nothing in the build grants it: an assumption. */
  | "assumed"
  /** Off, but the build has a source: turn it on in PoB. */
  | "turn-on"
  /** Off and nothing grants it: fine as it is. */
  | "off";

export interface OptionAdvice {
  var: string;
  label: string;
  on: boolean;
  verdict: OptionVerdict;
  source: Source | null;
  /** What switching it costs or gives, for the goal (0.1 = +10%). */
  dps: number;
  ehp: number;
  gain: number;
  text: string;
}

const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 100))}%`;

function worth(e: { dps: number; ehp: number }, noDamage: boolean): string {
  const parts = [];
  if (!noDamage && Math.abs(e.dps) >= 0.005) parts.push(`${pct(e.dps)} DPS`);
  if (Math.abs(e.ehp) >= 0.005) parts.push(`${pct(e.ehp)} effective HP`);
  return parts.join(", ") || "no change";
}

/** Charges and buffs (design doc §3.12 item 15): is each one true, and what is it worth? */
export function adviseOptions(r: AuditResult, goal: Goal): OptionAdvice[] {
  const noDamage = !((r.before.CombinedDPS ?? 0) > 0);
  const out: OptionAdvice[] = [];
  for (const o of r.options) {
    if (o.kind !== "check" || !o.tries[0]) continue;
    const on = o.current === "true";
    const flipped = effect(goal, r.before, o.tries[0].stats, noDamage);
    // The worth of having it on: the gain of turning it on, or the loss of turning it off.
    const value = on ? { dps: -flipped.dps, ehp: -flipped.ehp, gain: -flipped.gain } : flipped;
    const source = o.var === "conditionKilledRecently" ? { from: "", line: "", onKill: true } : findSource(r.text, o.var);
    let verdict: OptionVerdict;
    if (on) verdict = !source ? "assumed" : source.onKill ? "on-kill" : "ok";
    else verdict = source && !source.onKill && value.gain > 0.001 ? "turn-on" : "off";
    const w = worth(value, noDamage);
    const from = source?.from ? `${source.from}${source.line && source.from !== source.line ? `: ${source.line}` : ""}` : "";
    const text = {
      ok: `On, from ${from} (worth ${w}).`,
      "on-kill": o.var === "conditionKilledRecently"
        ? `On (worth ${w}), but against a lone boss nothing dies unless something you summon does (The Writhing Jar's worms, which PoB doesn't model).`
        : `On (worth ${w}), but it comes from killing (${from}): not true against a lone boss.`,
      assumed: `On (worth ${w}), but nothing in your gear, tree or gems grants it: not true on a boss.`,
      "turn-on": `Off, but ${from} grants it. Turn it on in Path of Building: ${w}.`,
      off: source?.onKill
        ? `Off: only killing grants it (${from}), so off is right against a boss (on: ${w}).`
        : source
          ? `Off in the config, but ${from} gives it and Path of Building already counts that.`
        : value.gain > 0.01
          ? `Off; nothing grants it (with a source it would be worth ${w}).`
          : "Off; nothing grants it.",
    }[verdict];
    out.push({ var: o.var, label: o.label, on, verdict, source, ...value, text });
  }
  const order: OptionVerdict[] = ["turn-on", "assumed", "on-kill", "ok", "off"];
  return out.sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict) || Math.abs(b.gain) - Math.abs(a.gain));
}

export interface StanceAdvice {
  current: string;
  others: { value: string; dps: number; ehp: number; text: string }[];
  /** Blood Stance on a build whose damage is mostly over time: it only helps hits. */
  bloodOnDot: boolean;
  /** Flesh and Stone switches stance by itself. */
  fleshAndStone: boolean;
}

/** The stance (Blood and Sand / Flesh and Stone), each other one's worth. */
export function adviseStance(r: AuditResult, goal: Goal): StanceAdvice | null {
  const o = r.options.find((x) => x.var === "bloodSandStance");
  if (!o) return null;
  const noDamage = !((r.before.CombinedDPS ?? 0) > 0);
  const hitShare = (r.before.TotalDPS ?? 0) / Math.max(1, r.before.CombinedDPS ?? 0);
  return {
    current: o.current,
    others: o.tries.map((t) => {
      const e = effect(goal, r.before, t.stats, noDamage);
      const hits = drawbacks(r.before, t.stats).filter((d) => / max hit /.test(d));
      return { value: t.value, dps: e.dps, ehp: e.ehp, text: `${worth(e, noDamage)}${hits.length ? `; ${hits.join(", ")}` : ""}` };
    }),
    bloodOnDot: /Blood/.test(o.current) && !noDamage && hitShare < 0.5,
    fleshAndStone: r.text.gems.includes("Flesh and Stone"),
  };
}

// --- Flasks -----------------------------------------------------------------

/** Skills that use life flask charges: their life flasks are sustain, never a free slot. */
const USES_LIFE_FLASKS = /Concoction/;

/** Flask lines that protect: immunities and removals that must move along if the flask goes. */
const PROTECTS = /immun|removes? .*(burning|shock|freez|chill|bleed|corrupted blood|poison|curse|maim|hinder)|avoid .*(shock|freez|ignite|bleed|poison)|reduced effect of curses on you/i;

export interface FlaskAdvice {
  slot: string;
  name: string;
  kind: string;
  /** What the build loses without it (0.1 = it gives +10%). */
  dps: number;
  ehp: number;
  gain: number;
  /** What it does that PoB's DPS and effective HP don't show. */
  protects: string[];
  role: string;
  /** A unique: its effect may be one PoB reads but doesn't count in DPS or effective HP. */
  unique: boolean;
}

export interface FlaskPlan {
  flasks: FlaskAdvice[];
  /** Life flasks are charge sustain for the main skill (PCOC): never offered as the free slot. */
  lifeIsSustain: boolean;
  /** The slot the build needs least, and what moving its flask out costs. */
  free: FlaskAdvice | null;
  /** Even the least needed flask gives something measurable: no slot is really free. */
  noneFree: boolean;
  /** Utility flasks for that slot, best first (bases already worn left out: the same kind doesn't stack). */
  options: { base: string; dps: number; ehp: number; gain: number; note: string }[];
}

const SPEED = new Set(["Silver Flask", "Quicksilver Flask"]);

/** The flask set (design doc §3.12 items 13, 18): what each flask is for, and what to put in the slot to spare. */
export function planFlasks(r: AuditResult, goal: Goal): FlaskPlan {
  const noDamage = !((r.before.CombinedDPS ?? 0) > 0);
  const lifeIsSustain = USES_LIFE_FLASKS.test(r.skill.name ?? "");
  const flasks: FlaskAdvice[] = r.flasks
    .filter((f) => f.active && f.without)
    .map((f) => {
      const lost = effect(goal, r.before, f.without!, noDamage);
      const protects = f.raw
        .split(/\r?\n/)
        .map((l) => l.replace(/^(\{[^}]*\})+/, "").trim())
        .filter((l) => PROTECTS.test(l));
      const life = f.kind === "Life" || f.kind === "Hybrid";
      const unique = /^Rarity: UNIQUE/im.test(f.raw);
      const role =
        life && lifeIsSustain
          ? `Life flask charges for ${r.skill.name}: Path of Building counts only your best life flask, not the charges the skill uses.`
          : life
            ? "Life recovery (Path of Building counts only your best life flask)."
            : -lost.gain > 0.005
              ? `Gives ${worth({ dps: -lost.dps, ehp: -lost.ehp }, noDamage)}.`
              : protects.length
                ? "Protection only (its value isn't in DPS or effective HP)."
                : unique
                  ? "A unique whose effect isn't in DPS or effective HP (e.g. Progenesis spreads life loss over time): kept, as Path of Building can't weigh it."
                  : "Adds nothing Path of Building can measure.";
      return { slot: f.slot, name: f.name, kind: f.kind, dps: -lost.dps, ehp: -lost.ehp, gain: -lost.gain, protects, role, unique };
    });
  // Uniques are never offered: what they do is often outside DPS and effective HP.
  const spare = flasks.filter(
    (f) =>
      !f.unique &&
      (f.kind === "Utility" || f.kind === "Mana" || (!lifeIsSustain && f.kind === "Life" && flasks.filter((x) => x.kind === "Life").length > 1)),
  );
  const free = spare.reduce<FlaskAdvice | null>((a, f) => (!a || f.gain < a.gain ? f : a), null);
  const worn = new Set(r.flasks.map((f) => f.base));
  const slot = free && r.flasks.find((f) => f.slot === free.slot);
  const options = (slot?.alternatives ?? [])
    .filter((a) => !worn.has(a.base))
    .map((a) => {
      const e = effect(goal, r.before, a.stats, noDamage);
      const note = SPEED.has(a.base) && lifeIsSustain ? "Speed makes the skill use more life flask charges, which PoB doesn't count." : "";
      return { base: a.base, ...e, note };
    })
    .filter((a) => a.gain > 0.001)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 5);
  return { flasks, lifeIsSustain, free, noneFree: !!free && free.gain > 0.01, options };
}

// --- Path of Building's blind spots -------------------------------------------

export interface Limit {
  id: string;
  text: string;
}

/** Where PoB's numbers aren't the whole story for this build (design doc §3.12 item 20). */
export function pobLimits(r: AuditResult): Limit[] {
  const out: Limit[] = r.warnings
    .filter((w) => /exceeds in game limit/i.test(w.text))
    .map((w) => ({
      id: `cap:${w.stat}`,
      text: `${w.text}: the game caps damage over time at ${Math.round(r.dotCap / 1e5) / 10}M per type, so the DPS shown above the cap isn't dealt. Gains past the cap are worth nothing.`,
    }));
  const lines = [...r.text.items.flatMap((i) => i.raw.split(/\r?\n/).map((l) => ({ from: i.name, line: l }))), ...r.text.nodes.map((l) => ({ from: "Passive tree", line: l }))];
  const faster = lines.filter((l) => /(poisons?|ailments?|ignites?|bleeding)[^.]*deal damage \d+% faster/i.test(l.line));
  if (faster.length) {
    out.push({
      id: "faster",
      text: `"Deal damage faster" (${faster.map((f) => f.from).join(", ")}) adds nothing to Path of Building's DPS: the same damage arrives sooner, with fewer stacks up. It's the first thing to trade away for real damage.`,
    });
  }
  if (r.text.items.some((i) => i.name.startsWith("The Writhing Jar"))) {
    out.push({ id: "worms", text: "The Writhing Jar's worms aren't modelled: their on-kill effects (charges, Killed Recently) are real against a boss but not in Path of Building." });
  }
  if (lines.some((l) => /Aspect of Arakaali/.test(l.line)) || r.text.gems.includes("Aspect of Arakaali")) {
    out.push({ id: "arakaali", text: "Aspect of Arakaali: Path of Building has no data for it, so it shows 0% here." });
  }
  if (USES_LIFE_FLASKS.test(r.skill.name ?? "")) {
    out.push({ id: "charges", text: `${r.skill.name} uses life flask charges; Path of Building doesn't model charge sustain, so extra life flasks show 0%.` });
  }
  if (r.flasks.some((f) => f.active && f.kind === "Utility")) {
    out.push({ id: "flasks", text: "Path of Building counts utility flasks as always up; their real uptime is lower." });
  }
  return out;
}
