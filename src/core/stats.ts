/** Path of Building output: its stat keys (e.g. `CombinedDPS`) to numbers. */
export type Stats = Record<string, number>;

export interface StatDef {
  key: string;
  label: string;
  kind: "number" | "percent";
}

/** The stats the app shows and stores per build version, in display order. */
export const HEADLINE_STATS: StatDef[] = [
  { key: "CombinedDPS", label: "Combined DPS", kind: "number" },
  { key: "TotalEHP", label: "Effective HP", kind: "number" },
  { key: "Life", label: "Life", kind: "number" },
  { key: "EnergyShield", label: "Energy shield", kind: "number" },
  { key: "Mana", label: "Mana", kind: "number" },
  { key: "Armour", label: "Armour", kind: "number" },
  { key: "Evasion", label: "Evasion", kind: "number" },
  { key: "EffectiveBlockChance", label: "Block", kind: "percent" },
  { key: "EffectiveSpellBlockChance", label: "Spell block", kind: "percent" },
  { key: "EffectiveSpellSuppressionChance", label: "Spell suppression", kind: "percent" },
  { key: "FireResist", label: "Fire res", kind: "percent" },
  { key: "ColdResist", label: "Cold res", kind: "percent" },
  { key: "LightningResist", label: "Lightning res", kind: "percent" },
  { key: "ChaosResist", label: "Chaos res", kind: "percent" },
  { key: "PhysicalMaximumHitTaken", label: "Max physical hit", kind: "number" },
  { key: "FireMaximumHitTaken", label: "Max fire hit", kind: "number" },
  { key: "ColdMaximumHitTaken", label: "Max cold hit", kind: "number" },
  { key: "LightningMaximumHitTaken", label: "Max lightning hit", kind: "number" },
  { key: "ChaosMaximumHitTaken", label: "Max chaos hit", kind: "number" },
];

/** Keeps only the headline stats PoB reported. */
export function pickHeadline(all: Stats): Stats {
  const out: Stats = {};
  for (const { key } of HEADLINE_STATS) {
    if (typeof all[key] === "number" && Number.isFinite(all[key])) out[key] = all[key];
  }
  return out;
}

/** 5358662 → "5.36M", 56897 → "56.9k", 2959 → "2,959", 75 (percent) → "75%". */
export function formatStat(kind: StatDef["kind"], value: number): string {
  if (kind === "percent") return `${Math.round(value * 10) / 10}%`;
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `${(value / 1e3).toFixed(1)}k`;
  return Math.round(value).toLocaleString("en-US");
}

export interface StatChange {
  def: StatDef;
  before: number;
  after: number;
}

/** Headline stats that changed between two versions (ignoring rounding noise). */
export function diffStats(before: Stats, after: Stats): StatChange[] {
  const changes: StatChange[] = [];
  for (const def of HEADLINE_STATS) {
    const a = before[def.key];
    const b = after[def.key];
    if (a === undefined || b === undefined) continue;
    if (Math.abs(b - a) < 0.005 * Math.max(1, Math.abs(a))) continue;
    changes.push({ def, before: a, after: b });
  }
  return changes;
}
