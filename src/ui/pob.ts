import { invoke } from "@tauri-apps/api/core";
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
