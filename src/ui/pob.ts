import { invoke } from "@tauri-apps/api/core";
import type { Analysis } from "../core/analysis";
import type { Mode } from "../core/goals";
import type { PassiveCandidate, PassiveResult } from "../core/passives";
import type { UniqueTrial, UpgradeResult } from "../core/upgrades";
import type { Stats } from "../core/stats";
import { isTauri } from "../data/db";

export interface PobResult {
  stats: Stats;
  mainSkill: string | null;
  messages: string[];
}

export interface SlotTrial {
  slot: string;
  replaces: string | null;
  stats: Stats;
}

export interface ItemTrial {
  item: string;
  before: Stats;
  slots: SlotTrial[];
}

/** Calculates build XML with the Path of Building engine in the Rust shell. */
export async function calculate(xml: string): Promise<PobResult> {
  if (!isTauri()) return previewResult(xml);
  return invoke<PobResult>("pob_calculate", { xml });
}

/** Calculates the build with an item (copied item text) in each slot it fits. */
export async function tryItem(xml: string, item: string): Promise<ItemTrial> {
  if (!isTauri()) return previewTrial(xml, item);
  return invoke<ItemTrial>("pob_try_item", { xml, item });
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
  const after = { ...before, Life: before.Life + 88, Int: before.Int + 20, CombinedDPS: before.CombinedDPS * 0.75 };
  return {
    item: name,
    before,
    slots: ["Ring 1", "Ring 2"].map((slot) => ({ slot, replaces: "Betrayal's Sting, Steel Ring", stats: after })),
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
