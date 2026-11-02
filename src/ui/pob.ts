import { invoke } from "@tauri-apps/api/core";
import type { Analysis } from "../core/analysis";
import type { AuditResult } from "../core/audit";
import type { Calculated, CompareResult } from "../core/compare";
import type { Mode } from "../core/goals";
import type { ItemTrial } from "../core/itemCheck";
import type { PassiveCandidate, PassiveResult } from "../core/passives";
import type { UniqueTrial, UpgradeResult } from "../core/upgrades";
import type { Stats } from "../core/stats";
import { isTauri } from "../data/db";

export interface PobResult {
  stats: Stats;
  mainSkill: string | null;
  messages: string[];
}

/** Calculates build XML with the Path of Building engine in the Rust shell. */
export async function calculate(xml: string): Promise<PobResult> {
  if (!isTauri()) return previewResult(xml);
  return invoke<PobResult>("pob_calculate", { xml });
}

/** Calculates the build with an item (copied item text) in each slot it fits, in `mode`. */
export async function tryItem(xml: string, item: string, mode: Mode): Promise<ItemTrial> {
  if (!isTauri()) return previewTrial(xml, item);
  return invoke<ItemTrial>("pob_try_item", { xml, item, mode });
}

/** Honest DPS, boss check, pantheon and support gem ranking in `mode` (about 30 s on a big build). */
export async function analyse(xml: string, mode: Mode): Promise<Analysis> {
  if (!isTauri()) return previewAnalysis(xml);
  return invoke<Analysis>("pob_analyse", { xml, mode });
}

/** Every passive worth taking next, each calculated with its path, in `mode` (seconds to a minute). */
export async function passives(xml: string, mode: Mode): Promise<PassiveResult> {
  if (!isTauri()) return previewPassives(xml, mode);
  return invoke<PassiveResult>("pob_passives", { xml, mode });
}

/** Each named unique tried in every slot it fits, and flask mods, in `mode` (up to a minute). */
export async function upgrades(xml: string, mode: Mode, uniques: string[]): Promise<UpgradeResult> {
  if (!isTauri()) return previewUpgrades(xml, mode, uniques);
  return invoke<UpgradeResult>("pob_upgrades", { xml, mode, uniques });
}

/** PoB's weighted trade search for a rare in one slot (a few seconds); the trade query as JSON. */
export async function rareSearch(
  xml: string,
  mode: Mode,
  slot: string,
  weights: { stat: string; weightMult: number }[],
): Promise<{ slot: string; query: string }> {
  if (!isTauri()) {
    const query = { query: { status: { option: "available" }, stats: [{ type: "weight", filters: [], value: { min: 1 } }] } };
    return { slot, query: JSON.stringify(query) };
  }
  return invoke<{ slot: string; query: string }>("pob_rare_search", { xml, mode, slot, weights });
}

/** A build's numbers in `mode`, its main skill in part `skillPart` (PoB's 1-based number) if given. */
export async function calculateIn(xml: string, mode: Mode, skillPart?: number): Promise<Calculated> {
  if (!isTauri()) return previewCalculated(xml, mode);
  return invoke<Calculated>("pob_calculate_mode", { xml, mode, skillPart: skillPart ?? null });
}

/** My build against a target build, each gear slot swapped both ways (10–30 s). */
export async function compareBuilds(xml: string, target: string, mode: Mode, targetSkillPart?: number): Promise<CompareResult> {
  if (!isTauri()) return previewCompare(xml, target, mode);
  return invoke<CompareResult>("pob_compare", { xml, target, mode, targetSkillPart: targetSkillPart ?? null });
}

/** The build audit with the config as set: charges, conditions, stance, flasks, PoB's warnings (seconds). */
export async function audit(xml: string): Promise<AuditResult> {
  if (!isTauri()) return previewAudit(xml);
  return invoke<AuditResult>("pob_audit", { xml });
}

/** Browser preview (`npm run dev`) has no engine: sample numbers that change with level. */
function previewResult(xml: string): PobResult {
  const level = Number(xml.match(/<Build\b[^>]*\slevel="(\d+)"/)?.[1] ?? 90);
  return {
    mainSkill: "Preview skill",
    messages: ["Browser preview: sample numbers, not Path of Building"],
    stats: {
      CombinedDPS: level * 52_000,
      TotalEHP: level * 600,
      Life: level * 31,
      EnergyShield: 69,
      Mana: 792,
      Armour: 2685,
      Evasion: 1453,
      EffectiveBlockChance: 47,
      EffectiveSpellSuppressionChance: 100,
      FireResist: 90,
      FireResistOverCap: 27,
      ColdResist: -50,
      LightningResist: 75,
      ChaosResist: 40,
      PhysicalMaximumHitTaken: 31_591,
      FireMaximumHitTaken: 47_845,
      ColdMaximumHitTaken: 47_845,
      LightningMaximumHitTaken: 45_998,
      ChaosMaximumHitTaken: 22_947,
      HitChance: 88,
      Int: 91,
      ReqInt: 98,
      ManaCost: 25,
      ManaUnreserved: 130,
      ManaPerSecondCost: 61.8,
      ManaRegenRecovery: 17.2,
      ManaLeechGainRate: 349.8,
    },
  };
}

function previewTrial(xml: string, item: string): ItemTrial {
  const before = previewResult(xml).stats;
  if (!/Rarity:/i.test(item)) throw new Error("Path of Building couldn't read that item. Copy it with Ctrl+C in game or from the trade site.");
  const name = item.split(/\r?\n/).filter((l) => l.trim() && !/^(Item Class|Rarity):/i.test(l))[0] ?? "Item";
  // Sample numbers: rings gain, body armours trade the physical max hit for effective HP (as Kintsugi does).
  const body = /Body Armour|Leather|Plate|Robe|Vest|Coat/i.test(item);
  const after = body
    ? { ...before, TotalEHP: before.TotalEHP * 1.32, PhysicalMaximumHitTaken: before.PhysicalMaximumHitTaken * 0.73 }
    : { ...before, Life: before.Life + 88, Int: before.Int + 20, CombinedDPS: before.CombinedDPS * 1.06 };
  const slots = body ? ["Body Armour"] : ["Ring 1", "Ring 2"];
  return {
    item: name,
    requiredLevel: Number(item.match(/^Level:\s*(\d+)/m)?.[1] ?? 1),
    before,
    slots: slots.map((slot) => ({ slot, replaces: body ? "Cloak of Flame, Scholar's Robe" : "Betrayal's Sting, Steel Ring", stats: after })),
  };
}

function previewAnalysis(xml: string): Analysis {
  const configured = previewResult(xml).stats;
  const scaled = (k: number) => ({ ...configured, CombinedDPS: configured.CombinedDPS * k, TotalEHP: configured.TotalEHP * (0.5 + k / 2) });
  const god = (value: string, ehp: number) => ({ value, label: `Soul of ${value}`, stats: { TotalEHP: ehp } });
  return {
    configured,
    conservative: scaled(0.53),
    cleared: ["Is the enemy Ignited?", "Is the enemy Chilled?", "# of Withered Stacks: 15"],
    enemyIsBoss: "Guardian/Pinnacle Boss",
    uber: scaled(0.3),
    pantheonMajor: {
      current: "Lunaris",
      options: [god("Lunaris", configured.TotalEHP), god("Solaris", configured.TotalEHP * 0.91)],
    },
    pantheonMinor: { current: "Ryslatha", options: [god("Gruthkul", configured.TotalEHP), god("Yugul", configured.TotalEHP)] },
    supports: {
      baseDps: configured.CombinedDPS,
      current: [
        { name: "Greater Multiple Projectiles", dpsWithout: configured.CombinedDPS * 0.74 },
        { name: "Unbound Ailments", dpsWithout: configured.CombinedDPS * 0.64 },
      ],
      replacing: "Greater Multiple Projectiles",
      candidates: [
        { name: "Awakened Greater Multiple Projectiles", level: 5, stats: { CombinedDPS: configured.CombinedDPS * 1.08 } },
        { name: "Awakened Deadly Ailments", level: 5, stats: { CombinedDPS: configured.CombinedDPS * 1.059 } },
      ],
    },
  };
}

function previewPassives(xml: string, mode: Mode): PassiveResult {
  const full = previewResult(xml).stats;
  const before: Stats = { ...full, CombinedDPS: full.CombinedDPS * (mode === "configured" ? 1 : mode === "conservative" ? 0.53 : 0.3) };
  let id = 0;
  const node = (
    kind: PassiveCandidate["kind"],
    name: string,
    lines: string[],
    points: number,
    dps: number,
    ehp: number,
    extra: Partial<PassiveCandidate> = {},
  ): PassiveCandidate => ({
    id: ++id,
    kind,
    name,
    lines,
    points,
    via: Array.from({ length: Math.max(0, points - 1) }, (_, i) => (i === 0 ? "Intelligence" : "Poison Damage")),
    stats: { ...before, CombinedDPS: before.CombinedDPS * (1 + dps), TotalEHP: before.TotalEHP * (1 + ehp) },
    ...extra,
  });
  return {
    before,
    level: Number(xml.match(/<Build\b[^>]*\slevel="(\d+)"/)?.[1] ?? 90),
    pointsUsed: 112,
    extraPoints: 0,
    ascendancyUsed: 8,
    candidates: [
      node("notable", "Toxic Strikes", ["20% increased Poison Duration", "Poisons you inflict deal Damage 10% faster"], 2, 0.07, 0),
      node("small", "Poison Damage", ["12% increased Damage with Poison"], 1, 0.021, 0),
      node("notable", "Fending", ["+5% Chance to Block Attack Damage", "+15% to all Elemental Resistances"], 3, 0, 0.09),
      node("mastery", "Life Mastery", ["+50 to maximum Life"], 1, 0, 0.018),
      node("keystone", "Chaos Inoculation", ["Maximum Life becomes 1, Immune to Chaos Damage"], 3, 0.02, -0.6, {
        stats: { ...before, Life: 1, TotalEHP: before.TotalEHP * 0.4, CombinedDPS: before.CombinedDPS * 1.02 },
      }),
      node("notable", "Constitution", ["+20 to Strength", "8% increased maximum Life", "+15% to Cold Resistance"], 4, 0, 0.11, {
        stats: { ...before, ColdResist: -35, TotalEHP: before.TotalEHP * 1.11 },
      }),
    ],
    masterySwaps: [
      node("swap", "Poison Mastery", ["Poisons on you expire 50% faster"], 0, 0, 0.004, {
        replaces: ["Poisons you inflict deal Damage 10% faster"],
        via: [],
      }),
      node("swap", "Poison Mastery", ["40% increased Damage with Poison"], 0, 0.028, 0, {
        replaces: ["Poisons you inflict deal Damage 10% faster"],
        via: [],
      }),
    ],
  };
}

function previewUpgrades(xml: string, mode: Mode, names: string[]): UpgradeResult {
  const full = previewResult(xml).stats;
  const before: Stats = { ...full, CombinedDPS: full.CombinedDPS * (mode === "configured" ? 1 : mode === "conservative" ? 0.53 : 0.3) };
  const level = previewResult(xml).stats.Life / 31;
  const slots = [
    { slot: "Body Armour", slotName: "Body Armour", item: "Cloak of Flame, Scholar's Robe", rarity: "UNIQUE", links: 6 },
    { slot: "Ring 1", slotName: "Ring 1", item: "Betrayal's Sting, Steel Ring", rarity: "UNIQUE", links: 0 },
    { slot: "Ring 2", slotName: "Ring 2", item: "Betrayal's Sting, Steel Ring", rarity: "UNIQUE", links: 0 },
    { slot: "Flask 2", slotName: "Flask 2", item: "Quicksilver Flask of Adrenaline", rarity: "MAGIC", links: 0 },
  ];
  const tried = (name: string, base: string, slot: string, dps: number, ehp: number, extra: Partial<UniqueTrial> = {}): UniqueTrial => ({
    name,
    base,
    slot,
    slotName: slot,
    replaces: slots.find((s) => s.slot === slot)?.item ?? null,
    level: 60,
    stats: { ...before, CombinedDPS: before.CombinedDPS * (1 + dps), TotalEHP: before.TotalEHP * (1 + ehp) },
    ...extra,
  });
  const all = [
    tried("Kaom's Heart", "Glorious Plate", "Body Armour", -0.2, 0.25, { stats: { ...before, TotalEHP: before.TotalEHP * 1.25, CombinedDPS: before.CombinedDPS * 0.8 } }),
    tried("Le Heup of All", "Iron Ring", "Ring 1", 0.04, 0.02),
    tried("Le Heup of All", "Iron Ring", "Ring 2", 0.04, 0.02),
    tried("Precursor's Emblem", "Topaz Ring", "Ring 1", 0.09, 0.03),
    tried("Dying Sun", "Ruby Flask", "Flask 2", 0.13, 0),
  ];
  const plain = { ...before, CombinedDPS: before.CombinedDPS * 0.97 };
  return {
    mode,
    level: Math.round(level),
    before,
    slots,
    uniques: all.filter((u) => names.includes(u.name)),
    missing: names.filter((n) => n === "Made Up Unique"),
    flasks: [
      {
        slot: "Flask 2",
        slotName: "Flask 2",
        flask: "Quicksilver Flask of Adrenaline",
        active: true,
        plain,
        prefixes: [{ modId: "a", lines: ["25% increased effect", "(33-25)% reduced Duration"], stats: { ...plain, CombinedDPS: plain.CombinedDPS * 1.04 } }],
        suffixes: [{ modId: "b", lines: ["(14-20)% increased Attack Speed during Effect"], stats: { ...plain, CombinedDPS: plain.CombinedDPS * 1.06 } }],
      },
    ],
  };
}

const MODE_DPS: Record<Mode, number> = { configured: 1, conservative: 0.53, boss: 0.3 };

/** Sample numbers: a target build is the preview build scaled by its level, a mixed build by its XML length. */
function previewCalculated(xml: string, mode: Mode): Calculated {
  const s = previewResult(xml).stats;
  const wobble = 0.9 + (xml.length % 23) / 100;
  return {
    stats: { ...s, CombinedDPS: s.CombinedDPS * MODE_DPS[mode] * wobble, TotalEHP: s.TotalEHP * (2 - wobble) },
    skill: { name: "Poisonous Concoction of Bouncing", part: "No Flask", partIndex: 1 },
  };
}

function previewCompare(xml: string, target: string, mode: Mode): CompareResult {
  const mine = previewCalculated(xml, mode);
  const theirs = previewCalculated(target, mode);
  const scaled = (dps: number, extra: Stats = {}) => ({ ...mine.stats, CombinedDPS: mine.stats.CombinedDPS * dps, ...extra });
  const item = (name: string, rarity: string, raw = "") => ({ name, rarity, raw: `Rarity: ${rarity}\n${name}\n${raw}` });
  return {
    mode,
    mine,
    target: theirs,
    slots: [
      {
        slot: "Gloves",
        mine: item("Plain Gloves, Vaal Gauntlets", "RARE"),
        target: item("Asenath's Gentle Touch, Silk Gloves", "UNIQUE", "Curse Enemies with Temporal Chains on Hit"),
        intoMine: scaled(0.97),
        intoTarget: scaled(1.1),
      },
      {
        slot: "Body Armour",
        mine: item("Cloak of Flame, Scholar's Robe", "UNIQUE"),
        target: item("Cloak of Flame, Scholar's Robe", "UNIQUE", "+2 to Level of Socketed Projectile Gems"),
        intoMine: scaled(1.18),
        intoTarget: scaled(1.05),
      },
      {
        slot: "Weapon 2",
        mine: item("Dawnbreaker, Colossal Tower Shield", "UNIQUE"),
        target: item("Replica Mistwall, Lacquered Buckler", "UNIQUE"),
        intoMine: scaled(1.04, { TotalEHP: mine.stats.TotalEHP * 1.3, PhysicalMaximumHitTaken: mine.stats.PhysicalMaximumHitTaken * 0.7 }),
      },
    ],
    config: [
      { var: "conditionEnemyIgnited", label: "Is the enemy Ignited?", target: "true" },
      { var: "multiplierWitheredStackCount", label: "# of Withered Stacks", mine: "5", target: "15" },
    ],
  };
}

function previewAudit(xml: string): AuditResult {
  const before = previewResult(xml).stats;
  const scaled = (dps: number, extra: Stats = {}) => ({ ...before, CombinedDPS: before.CombinedDPS * dps, ...extra });
  const flask = (slot: string, name: string, kind: string, without: Stats, raw = "", alternatives: AuditResult["flasks"][number]["alternatives"] = []) => ({
    slot,
    name,
    base: name.replace(/^.*?(\w+ Flask).*$/, "$1"),
    kind,
    active: true,
    raw: `Rarity: MAGIC\n${name}\n${raw}`,
    without,
    alternatives,
  });
  return {
    before: { ...before, TotalDPS: before.CombinedDPS * 0.06 },
    skill: { name: "Poisonous Concoction of Bouncing", part: "No Flask" },
    options: [
      { var: "useFrenzyCharges", label: "Do you use Frenzy Charges?", kind: "check", current: "false", tries: [{ value: "true", stats: scaled(1.185) }] },
      { var: "usePowerCharges", label: "Do you use Power Charges?", kind: "check", current: "true", tries: [{ value: "false", stats: scaled(0.976) }] },
      { var: "buffTailwind", label: "Do you have Tailwind?", kind: "check", current: "false", tries: [{ value: "true", stats: scaled(1.08) }] },
      {
        var: "bloodSandStance",
        label: "Stance",
        kind: "list",
        current: "Sand Stance",
        tries: [{ value: "Blood Stance", stats: scaled(1, { TotalEHP: before.TotalEHP * 0.8, PhysicalMaximumHitTaken: 26_000 }) }],
      },
    ],
    flasks: [
      flask("Flask 1", "Saturated Divine Life Flask of Incessance", "Life", before),
      flask("Flask 2", "Saturated Divine Life Flask of Quashing", "Life", before, "Grants Immunity to Ignite for 9 seconds if used while Ignited"),
      flask("Flask 4", "Dabbler's Silver Flask of the Owl", "Utility", scaled(0.879), "61% reduced Effect of Curses on you during Effect"),
      flask("Flask 5", "Progenesis, Amethyst Flask", "Utility", before, "", [
        { base: "Sulphur Flask", stats: scaled(1.083) },
        { base: "Diamond Flask", stats: scaled(1.016) },
      ]),
    ],
    warnings: [{ stat: "ReqInt", text: "You do not meet the Intelligence requirement of Malevolence" }],
    dotCap: 35_791_394,
    text: {
      items: [
        { slot: "Boots", name: "Pain Spur, Wyrmscale Boots", raw: "Grants Level 20 Aspect of Arakaali Skill" },
        { slot: "Gloves", name: "Gloves", raw: "Gain a Power Charge on Critical Strike" },
      ],
      nodes: ["Poisons you inflict deal Damage 20% faster"],
      gems: ["Poisonous Concoction of Bouncing", "Flesh and Stone"],
    },
  };
}
