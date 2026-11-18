// Mercenaries (3.30, design doc §3.13 / §3.6). Path of Building has no
// mercenary to calculate, but it builds each Link skill's buff and knows the
// player's life and light radius. What the mercenary gets follows from GGG's
// stated rules: Golden Glory adds light radius to link buff effect on the
// mercenary at 50% of its value (3.30, was 100%); Flame Link adds fire damage
// plus a share of the player's life. The 3.30 penalties come from the
// 3.30.0 patch notes.

export interface LinkMod {
  name: string;
  type: string;
  value: number;
  /** The player stat `value` is a percentage of (Flame Link: Life). */
  percentOf?: string;
}

export interface LinkSkill {
  name: string;
  level?: number;
  quality?: number;
  /** Increased buff effect of the skill (link skill and buff effect bonuses), in %. */
  inc: number;
  more: number;
  mods: LinkMod[];
}

export interface MercenaryResult {
  life: number;
  lightRadiusInc: number;
  links: LinkSkill[];
  nodes: { line: string; parsed: boolean }[];
  items: { slot: string; line: string; parsed: boolean }[];
}

export interface LinkOnMercenary {
  name: string;
  level?: number;
  /** Buff effect multiplier on the mercenary (2.4 = 240% of the base buff). */
  effect: number;
  /** How the multiplier is made up, for the panel. */
  effectText: string;
  lines: string[];
}

/** Golden Glory's share of light radius that applies to link buffs on the mercenary (0.5 in 3.30), from the tree text; 0 without it. */
export function goldenGlory(r: MercenaryResult): number {
  for (const n of r.nodes) {
    const m = n.line.match(/Link Skill Buffs on your Mercenary at (\d+)% of their value/i);
    if (m) return Number(m[1]) / 100;
  }
  return r.nodes.some((n) => /Light Radius also apply to the Effect of your Link Skill Buffs on your Mercenary/i.test(n.line)) ? 1 : 0;
}

const STAT_NAMES: Record<string, string> = {
  Fire: "fire damage",
  Cold: "cold damage",
  Lightning: "lightning damage",
  Physical: "physical damage",
  Chaos: "chaos damage",
};

const round = (x: number) => Math.round(x).toLocaleString("en-US");

/** What each Link skill gives the mercenary: its buff's values (life-based parts with the player's life) times the buff effect on the mercenary. */
export function linksOnMercenary(r: MercenaryResult, rules: { share?: number; flameLinkLifePercent?: number } = {}): LinkOnMercenary[] {
  const share = rules.share ?? goldenGlory(r);
  return r.links.map((l) => {
    const fromLight = share * r.lightRadiusInc;
    const effect = (1 + (l.inc + fromLight) / 100) * l.more;
    const effectText =
      `+${round(l.inc)}% buff effect` +
      (share > 0 ? ` and +${round(fromLight)}% from Golden Glory (${round(r.lightRadiusInc)}% light radius at ${Math.round(share * 100)}%)` : "") +
      ` = ${Math.round(effect * 100)}% of the base buff`;
    // Sum each stat's flat and life-based parts.
    const sums = new Map<string, number>();
    for (const m of l.mods) {
      const pct = m.percentOf === "Life" && l.name === "Flame Link" && rules.flameLinkLifePercent !== undefined ? rules.flameLinkLifePercent : m.value;
      const value = m.percentOf === "Life" ? (pct / 100) * r.life : m.percentOf ? NaN : m.value;
      sums.set(m.name, (sums.get(m.name) ?? 0) + value);
    }
    const lines: string[] = [];
    const done = new Set<string>();
    for (const [name, value] of sums) {
      const range = name.match(/^(\w+)Min$/);
      if (range) {
        const max = sums.get(`${range[1]}Max`);
        const what = STAT_NAMES[range[1]] ?? range[1];
        lines.push(max !== undefined ? `Adds ${round(value * effect)} to ${round(max * effect)} ${what} to its hits` : `${name}: ${round(value * effect)}`);
        done.add(`${range[1]}Max`);
      } else if (!done.has(name) && !/Max$/.test(name)) {
        lines.push(Number.isNaN(value) ? `${name} (based on a stat the app can't read)` : `${name}: ${Math.round(value * effect * 100) / 100}`);
      }
    }
    return { name: l.name, level: l.level, effect, effectText, lines };
  });
}

/**
 * The same with 3.29's rules, for comparison: Golden Glory at 100% of light
 * radius and Flame Link's 5% of life. Flame Link's flat damage was lower in
 * 3.29 too (169–254 at level 20, now 219–329); that part is left as 3.30's.
 */
export const linksOnMercenary329 = (r: MercenaryResult) =>
  linksOnMercenary(r, { share: goldenGlory(r) > 0 ? 1 : 0, flameLinkLifePercent: 5 });

/** Lines on the build about the mercenary that Path of Building doesn't count (it has no mercenary). */
export function uncounted(r: MercenaryResult): string[] {
  return [...r.nodes.filter((n) => !n.parsed).map((n) => n.line), ...r.items.filter((i) => !i.parsed).map((i) => `${i.slot}: ${i.line}`)]
    .filter((l) => /mercenar/i.test(l))
    .filter((l, i, all) => all.indexOf(l) === i);
}

/** True when the build has anything for a mercenary: a Link skill or a line that mentions one. */
export const hasMercenary = (r: MercenaryResult) => r.links.length > 0 || r.nodes.some((n) => /mercenar/i.test(n.line)) || r.items.some((i) => /mercenar/i.test(i.line));

/** 3.30's rules for hired mercenaries (patch notes 3.30.0), for the checklist. */
export const MERCENARY_RULES_330 = [
  "Resistances: −30% to all resistances in level 46–67 areas, −60% in level 68+ areas and hideouts. To reach 75% in maps the mercenary needs +135% from its gear and auras (an aura such as Purity of Elements helps with fire, cold and lightning); chaos resistance has to come from gear.",
  "Attack damage: up to 20% less at level 83.",
  "More base life and increased maximum life as it levels; less damage reduction scaling.",
  "Greater Brutality and Greater Trap and Mine Damage give 25% (not 30%) on mercenaries.",
  "Luminary's Golden Glory: light radius applies to link buffs on the mercenary at 50% of its value (was 100%). Flame Link adds 3% of your maximum life as fire damage (was 5%).",
];
