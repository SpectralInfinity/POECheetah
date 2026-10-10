import { invoke } from "@tauri-apps/api/core";
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
      ColdResist: 75,
      LightningResist: 75,
      ChaosResist: 40,
      PhysicalMaximumHitTaken: 31_591,
    },
  };
}
