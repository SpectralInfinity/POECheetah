import { change } from "./analysis";
import { avoidsDrawbacks, goalGain, type Goal, type Mode } from "./goals";
import { drawbacks } from "./passives";
import type { Stats } from "./stats";

// Compare my build to a target build: a guide, a ladder character (design doc
// §3.0, §3.12 items 10–12, 14, 16). The engine does the calculations; this
// file picks the guide's stage, builds the mixed builds ("mine with their
// tree") as PoB XML, and turns the numbers into an ordered list.

/** The main skill PoB calculated, the part of it ("No Flask", "Life"…) and that part's number. */
export interface SkillInfo {
  name?: string;
  part?: string;
  partIndex?: number;
}

/** One build's numbers (the engine's `calculate`). */
export interface Calculated {
  stats: Stats;
  skill: SkillInfo;
}

export interface HeldItem {
  name: string;
  rarity: string;
  /** PoB's item text. */
  raw: string;
}

export interface CompareSlot {
  slot: string;
  mine?: HeldItem;
  target?: HeldItem;
  /** My build with the target's item in this slot. */
  intoMine?: Stats;
  /** The target with my item in this slot. */
  intoTarget?: Stats;
}

export interface ConfigDiff {
  var: string;
  label: string;
  /** The value as PoB shows it; missing when not set. */
  mine?: string;
  target?: string;
}

/** What the engine's `compare` returns. */
export interface CompareResult {
  mode: Mode;
  mine: Calculated;
  target: Calculated;
  slots: CompareSlot[];
  config: ConfigDiff[];
}

// --- PoB XML: sections and attributes -------------------------------------

interface Span {
  start: number;
  end: number;
  text: string;
}

/** Every `<tag …>…</tag>` (or `<tag …/>`) in `xml`, outermost only. */
function spans(xml: string, tag: string): Span[] {
  const out: Span[] = [];
  const open = new RegExp(`<${tag}\\b[^>]*?(/?)>`, "g");
  let m: RegExpExecArray | null;
  while ((m = open.exec(xml))) {
    const start = m.index;
    let end: number;
    if (m[1] === "/") end = open.lastIndex;
    else {
      const close = xml.indexOf(`</${tag}>`, open.lastIndex);
      if (close < 0) break;
      end = close + tag.length + 3;
    }
    out.push({ start, end, text: xml.slice(start, end) });
    open.lastIndex = end;
  }
  return out;
}

const first = (xml: string, tag: string) => spans(xml, tag)[0] ?? null;

const splice = (xml: string, s: Span, text: string) => xml.slice(0, s.start) + text + xml.slice(s.end);

/** An attribute of the first tag in `text`. */
function attr(text: string, name: string): string | null {
  const head = text.match(/^<[^>]*>/)?.[0] ?? "";
  return head.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;
}

/** Sets an attribute on the first tag in `text`. */
function setAttr(text: string, name: string, value: string): string {
  const head = text.match(/^<[^>]*>/)?.[0] ?? "";
  const re = new RegExp(`(\\s${name}=")[^"]*(")`);
  const next = re.test(head) ? head.replace(re, `$1${value}$2`) : head.replace(/^<(\w+)/, `<$1 ${name}="${value}"`);
  return next + text.slice(head.length);
}

function setSectionAttr(xml: string, tag: string, name: string, value: string): string {
  const s = first(xml, tag);
  return s ? splice(xml, s, setAttr(s.text, name, value)) : xml;
}

// --- Guide stages ----------------------------------------------------------

export interface Stage {
  id: number;
  title: string;
}

export interface Stages {
  /** Trees by position (PoB's `activeSpec` counts from 1), with their allocated node count. */
  specs: (Stage & { nodes: number })[];
  activeSpec: number;
  itemSets: Stage[];
  activeItemSet: number;
  skillSets: Stage[];
  activeSkillSet: number;
}

const nodeIds = (spec: string) => (attr(spec, "nodes") ?? "").split(",").filter((n) => n.trim() !== "");

/** The trees, item sets and skill sets a PoB code holds (guides often have one per stage). */
export function readStages(xml: string): Stages {
  const tree = first(xml, "Tree");
  const specs = spans(tree?.text ?? "", "Spec").map((s, i) => ({
    id: i + 1,
    title: attr(s.text, "title") || `Tree ${i + 1}`,
    nodes: nodeIds(s.text).length,
  }));
  const sets = (section: string, tag: string, word: string) =>
    spans(first(xml, section)?.text ?? "", tag).map((s, i) => {
      const id = Number(attr(s.text, "id") ?? i + 1);
      return { id, title: attr(s.text, "title") || `${word} ${id}` };
    });
  const active = (section: string, name: string) => Number(attr(first(xml, section)?.text ?? "", name) ?? 1) || 1;
  return {
    specs,
    activeSpec: active("Tree", "activeSpec"),
    itemSets: sets("Items", "ItemSet", "Item set"),
    activeItemSet: active("Items", "activeItemSet"),
    skillSets: sets("Skills", "SkillSet", "Skill set"),
    activeSkillSet: active("Skills", "activeSkillSet"),
  };
}

export interface StageChoice {
  spec: number;
  itemSet: number;
  skillSet: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The stage closest to my character: the tree whose allocated node count is
 * nearest mine, and the item and skill sets named like it (else at the same
 * position, else the guide's active ones).
 */
export function closestStage(st: Stages, myNodes: number): StageChoice {
  const spec = st.specs.reduce<(typeof st.specs)[number] | null>(
    (best, s) => (!best || Math.abs(s.nodes - myNodes) < Math.abs(best.nodes - myNodes) ? s : best),
    null,
  );
  if (!spec) return { spec: st.activeSpec, itemSet: st.activeItemSet, skillSet: st.activeSkillSet };
  const position = st.specs.indexOf(spec);
  const match = (sets: Stage[], active: number) =>
    sets.find((x) => norm(x.title) === norm(spec.title) && norm(x.title) !== "")?.id ??
    (sets.length === st.specs.length ? sets[position]?.id : undefined) ??
    active;
  return {
    spec: spec.id,
    itemSet: match(st.itemSets, st.activeItemSet),
    skillSet: match(st.skillSets, st.activeSkillSet),
  };
}

/** The PoB code's XML with another tree, item set and skill set active. */
export function withStage(xml: string, c: StageChoice): string {
  let out = setSectionAttr(xml, "Tree", "activeSpec", String(c.spec));
  out = setSectionAttr(out, "Items", "activeItemSet", String(c.itemSet));
  return setSectionAttr(out, "Skills", "activeSkillSet", String(c.skillSet));
}

function activeSpec(xml: string): Span | null {
  const tree = first(xml, "Tree");
  if (!tree) return null;
  const list = spans(tree.text, "Spec");
  const s = list[(Number(attr(tree.text, "activeSpec")) || 1) - 1] ?? list[0];
  return s ? { start: tree.start + s.start, end: tree.start + s.end, text: s.text } : null;
}

/** Passive nodes allocated in the active tree (ascendancy and masteries included). */
export const allocatedNodes = (xml: string) => nodeIds(activeSpec(xml)?.text ?? "").length;

// --- Mixed builds ------------------------------------------------------------

/** A part of the target swapped into my build as a whole. */
export type Piece = "config" | "skills" | "tree" | "gear";

export const PIECES: { piece: Piece; label: string }[] = [
  { piece: "tree", label: "Their passive tree" },
  { piece: "skills", label: "Their gems" },
  { piece: "gear", label: "All their gear" },
  { piece: "config", label: "Their config (assumptions)" },
];

/** The active tree's jewel sockets block (`<Sockets>…</Sockets>`), or "" when none. */
const socketsOf = (xml: string) => first(activeSpec(xml)?.text ?? "", "Sockets")?.text ?? "";

/** Replaces the jewel sockets of the active tree in `xml`. */
function setSockets(xml: string, sockets: string): string {
  const spec = activeSpec(xml);
  if (!spec) return xml;
  const own = first(spec.text, "Sockets");
  const text = own
    ? splice(spec.text, own, sockets)
    : spec.text.replace(/<\/Spec>$/, `${sockets}</Spec>`);
  return splice(xml, spec, text);
}

/**
 * My build (PoB XML) with one piece of the target's as a whole. Jewels sit in
 * the tree but are items: "tree" keeps my jewels (in the sockets both trees
 * have), "gear" brings the target's.
 */
export function hybrid(mine: string, target: string, piece: Piece): string {
  const swap = (xml: string, tag: string) => {
    const a = first(xml, tag);
    const b = first(target, tag);
    return a && b ? splice(xml, a, b.text) : xml;
  };
  if (piece === "config") return swap(mine, "Config");
  if (piece === "skills") {
    const out = swap(mine, "Skills");
    const main = attr(first(target, "Build")?.text ?? "", "mainSocketGroup");
    return main ? setSectionAttr(out, "Build", "mainSocketGroup", main) : out;
  }
  if (piece === "tree") return setSockets(swap(mine, "Tree"), socketsOf(mine));
  return setSockets(swap(mine, "Items"), socketsOf(target));
}

/** Passive nodes to allocate and to refund to turn my active tree into the target's. */
export function treeChange(mine: string, target: string): { add: number; remove: number } {
  const a = new Set(nodeIds(activeSpec(mine)?.text ?? ""));
  const b = new Set(nodeIds(activeSpec(target)?.text ?? ""));
  return { add: [...b].filter((n) => !a.has(n)).length, remove: [...a].filter((n) => !b.has(n)).length };
}

/** Enabled gems of the active skill set: name → highest level. */
function gems(xml: string): Map<string, number> {
  const skills = first(xml, "Skills");
  const id = attr(skills?.text ?? "", "activeSkillSet");
  const sets = spans(skills?.text ?? "", "SkillSet");
  const set = sets.find((s) => attr(s.text, "id") === id) ?? sets[0];
  const out = new Map<string, number>();
  for (const skill of spans(set?.text ?? skills?.text ?? "", "Skill")) {
    if (attr(skill.text, "enabled") === "false") continue;
    for (const g of spans(skill.text, "Gem")) {
      const name = attr(g.text, "nameSpec");
      if (!name || attr(g.text, "enabled") === "false") continue;
      const level = Number(attr(g.text, "level") ?? 1);
      out.set(name, Math.max(out.get(name) ?? 0, level));
    }
  }
  return out;
}

export interface GemChange {
  name: string;
  level: number;
  /** My level of it; missing when I don't have it. */
  mine?: number;
}

/** Gems the target uses that I don't, or at a higher level. */
export function gemChanges(mine: string, target: string): GemChange[] {
  const have = gems(mine);
  const out: GemChange[] = [];
  for (const [name, level] of gems(target)) {
    const own = have.get(name);
    if (own === undefined) out.push({ name, level });
    else if (level > own) out.push({ name, level, mine: own });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// --- What an item carries ----------------------------------------------------

const CARRIES = [
  /Socketed .*Gems?\b/i,
  /^Curse Enemies with /i,
  /^Grants Level \d+ /i,
  /^Trigger Level \d+ /i,
  /^Grants .*Skill\b/i,
  /additional Curse/i,
  /^Hits? .*inflict .* Curse/i,
];

/**
 * Lines of an item (PoB's item text) that give the build something a plain
 * stat swap hides: curses, granted or triggered skills, socketed gem levels.
 */
export function carries(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^(\{[^}]*\})+/, "").trim())
    .filter((l) => CARRIES.some((re) => re.test(l)));
}

// --- The plan ---------------------------------------------------------------

export interface Change {
  /** "slot" for one item, otherwise the piece swapped as a whole. */
  kind: "slot" | Piece;
  label: string;
  /** For a slot: the target's item, and what it replaces. */
  item?: string;
  rarity?: string;
  replaces?: string;
  /** Relative DPS and effective HP change to my build (0.1 = +10%). */
  dps: number;
  ehp: number;
  gain: number;
  drawbacks: string[];
  /** What the item I'd take out gives (curses, gem levels…), and what theirs gives. */
  losing: string[];
  gaining: string[];
}

export interface Factor {
  key: string;
  label: string;
  mine: number;
  target: number;
  /** target / mine. */
  ratio: number;
}

/** PoB's damage factors worth naming side by side (design doc §3.12 item 11). */
export const FACTORS: { key: string; label: string }[] = [
  { key: "AverageHit", label: "Average hit" },
  { key: "Speed", label: "Attacks/casts per second" },
  { key: "HitChance", label: "Hit chance" },
  { key: "CritChance", label: "Crit chance" },
  { key: "CritMultiplier", label: "Crit multiplier" },
  { key: "TotalDPS", label: "Hit DPS" },
  { key: "PoisonDamage", label: "Damage per poison" },
  { key: "PoisonStacks", label: "Poison stacks" },
  { key: "PoisonDuration", label: "Poison duration" },
  { key: "PoisonEffMult", label: "Enemy poison damage taken" },
  { key: "IgniteDPS", label: "Ignite DPS" },
  { key: "BleedDPS", label: "Bleed DPS" },
  { key: "TotalDotDPS", label: "Damage over time DPS" },
  { key: "ImpaleDPS", label: "Impale DPS" },
  { key: "CullMultiplier", label: "Culling" },
  { key: "EnemyCurseLimit", label: "Curse limit" },
];

/** Factors that differ by more than this (5%) are listed. */
const FACTOR_DIFF = 0.05;

export function damageFactors(mine: Stats, target: Stats): Factor[] {
  const out: Factor[] = [];
  for (const { key, label } of FACTORS) {
    const a = mine[key];
    const b = target[key];
    if (!(a > 0) || !(b > 0)) continue;
    const ratio = b / a;
    if (Math.abs(ratio - 1) > FACTOR_DIFF) out.push({ key, label, mine: a, target: b, ratio });
  }
  return out.sort((x, y) => Math.abs(Math.log(y.ratio)) - Math.abs(Math.log(x.ratio)));
}

const MAX_HITS = [
  { key: "PhysicalMaximumHitTaken", label: "physical" },
  { key: "FireMaximumHitTaken", label: "fire" },
  { key: "ColdMaximumHitTaken", label: "cold" },
  { key: "LightningMaximumHitTaken", label: "lightning" },
  { key: "ChaosMaximumHitTaken", label: "chaos" },
];

function weakest(s: Stats): { label: string; value: number } | null {
  let out: { label: string; value: number } | null = null;
  for (const { key, label } of MAX_HITS) {
    const v = s[key];
    if (v !== undefined && (!out || v < out.value)) out = { label, value: v };
  }
  return out;
}

export interface FightVerdict {
  /** The target's DPS and weakest max hit relative to mine, against the boss. */
  dps: number;
  hit: number;
  mineWeakest: { label: string; value: number } | null;
  targetWeakest: { label: string; value: number } | null;
  better: "mine" | "target" | "tradeoff" | "same";
  text: string;
}

/** Within this (5%) two numbers count as the same in the fight verdict. */
const SAME = 0.05;

const pct = (x: number) => `${Math.abs(Math.round(x * 100))}%`;
const k = (v: number) => (v >= 9950 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);

/**
 * Which build for a fight (design doc §3.12 item 14): both in boss mode, by DPS
 * and by the weakest max hit (the hit type that kills first).
 */
export function fightVerdict(mine: Stats, target: Stats, fight = "an uber pinnacle boss"): FightVerdict {
  const dps = change(mine.CombinedDPS ?? 0, target.CombinedDPS ?? 0);
  const mw = weakest(mine);
  const tw = weakest(target);
  const hit = mw && tw ? change(mw.value, tw.value) : 0;
  const hits = mw && tw ? ` (weakest max hit ${k(tw.value)} ${tw.label} vs your ${k(mw.value)} ${mw.label})` : "";
  let better: FightVerdict["better"];
  let text: string;
  const dpsSame = Math.abs(dps) <= SAME;
  const hitSame = Math.abs(hit) <= SAME;
  if (dpsSame && hitSame) {
    better = "same";
    text = `Against ${fight} the builds are about even.`;
  } else if (dps >= -SAME && hit >= -SAME) {
    better = "target";
    text = `Against ${fight} the target is better: ${dpsSame ? "about the same DPS" : `${pct(dps)} more DPS`} and ${hitSame ? "about the same max hits" : `${pct(hit)} bigger hits survived`}${hits}.`;
  } else if (dps <= SAME && hit <= SAME) {
    better = "mine";
    text = `Against ${fight} yours is better: ${dpsSame ? "about the same DPS" : `${pct(dps)} less DPS for the target`} and ${hitSame ? "about the same max hits" : `${pct(hit)} smaller hits kill the target`}${hits}.`;
  } else if (dps > 0) {
    better = "tradeoff";
    text = `Against ${fight} the target kills faster (${pct(dps)} more DPS) but dies to ${pct(hit)} smaller hits${hits}.`;
  } else {
    better = "tradeoff";
    text = `Against ${fight} yours kills faster (the target has ${pct(dps)} less DPS) but the target survives ${pct(hit)} bigger hits${hits}.`;
  }
  return { dps, hit, mineWeakest: mw, targetWeakest: tw, better, text };
}

export interface ComparePlan {
  /** The target relative to me: DPS and effective HP (0.5 = +50%). */
  gap: { dps: number; ehp: number };
  /** Changes worth making, best gain for the goal first. */
  first: Change[];
  /** Everything tried, best first (including what doesn't help). */
  all: Change[];
  /** The target's config in my build: how much of the gap is assumptions, not gear. */
  config: Change | null;
  factors: Factor[];
  /** The two builds' main skills differ, so their DPS isn't like for like. */
  otherSkill: boolean;
  noDamage: boolean;
}

/** Below this gain a change isn't worth listing first. */
const MIN_GAIN = 0.01;

/** Turns the engine's comparison and the mixed builds' numbers into "do these first". */
export function planCompare(r: CompareResult, wholes: Partial<Record<Piece, Stats>>, goal: Goal): ComparePlan {
  const base = r.mine.stats;
  const noDamage = !((base.CombinedDPS ?? 0) > 0);
  const make = (c: Omit<Change, "dps" | "ehp" | "gain" | "drawbacks">, stats: Stats): Change => {
    const dps = change(base.CombinedDPS ?? 0, stats.CombinedDPS ?? 0);
    const ehp = change(base.TotalEHP ?? 0, stats.TotalEHP ?? 0);
    return { ...c, dps, ehp, gain: noDamage ? ehp : goalGain(goal, dps, ehp), drawbacks: drawbacks(base, stats) };
  };
  const all: Change[] = [];
  let config: Change | null = null;
  for (const { piece, label } of PIECES) {
    const stats = wholes[piece];
    if (!stats) continue;
    const c = make({ kind: piece, label, losing: [], gaining: [] }, stats);
    if (piece === "config") config = c;
    else all.push(c);
  }
  for (const s of r.slots) {
    if (!s.target || !s.intoMine || s.mine?.raw === s.target.raw) continue;
    all.push(
      make(
        {
          kind: "slot",
          label: s.slot,
          item: s.target.name,
          rarity: s.target.rarity,
          replaces: s.mine?.name,
          losing: carries(s.mine?.raw),
          gaining: carries(s.target.raw),
        },
        s.intoMine,
      ),
    );
  }
  all.sort((a, b) => b.gain - a.gain);
  const first = all.filter((c) => c.gain >= MIN_GAIN && !(avoidsDrawbacks(goal) && c.drawbacks.length > 0));
  return {
    gap: {
      dps: change(base.CombinedDPS ?? 0, r.target.stats.CombinedDPS ?? 0),
      ehp: change(base.TotalEHP ?? 0, r.target.stats.TotalEHP ?? 0),
    },
    first,
    all,
    config,
    factors: damageFactors(base, r.target.stats),
    otherSkill: !!r.mine.skill.name && !!r.target.skill.name && r.mine.skill.name !== r.target.skill.name,
    noDamage,
  };
}

/**
 * The part to calculate the target's main skill in (design doc §3.12 item 12):
 * mine, when both builds use the same skill in different parts.
 */
export function alignedPart(mine: SkillInfo, target: SkillInfo): number | undefined {
  if (!mine.name || mine.name !== target.name || mine.partIndex === undefined) return undefined;
  return mine.partIndex !== target.partIndex ? mine.partIndex : undefined;
}
