import { invoke } from "@tauri-apps/api/core";
import type { Analysis } from "../core/analysis";
import type { PassiveCandidate, PassiveResult } from "../core/passives";
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

/** Honest DPS, boss check, pantheon and support gem ranking (about 30 s on a big build). */
export async function analyse(xml: string): Promise<Analysis> {
  if (!isTauri()) return previewAnalysis(xml);
  return invoke<Analysis>("pob_analyse", { xml });
}

/** Every passive worth taking next, each calculated with its path (seconds to a minute). */
export async function passives(xml: string): Promise<PassiveResult> {
  if (!isTauri()) return previewPassives(xml);
  return invoke<PassiveResult>("pob_passives", { xml });
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
      candidates: [{ name: "Awakened Deadly Ailments", stats: { CombinedDPS: configured.CombinedDPS * 1.059 } }],
    },
  };
}

function previewPassives(xml: string): PassiveResult {
  const before = previewResult(xml).stats;
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
