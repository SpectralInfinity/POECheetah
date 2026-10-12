/**
 * What the player wants more of (design doc §3.1, §3.2), and how the build's
 * PoB config is set for the calculation.
 */
export type Goal = "damage" | "defence" | "balanced" | "bossing";

export const GOALS: { id: Goal; label: string; hint: string }[] = [
  { id: "damage", label: "Damage", hint: "DPS" },
  { id: "defence", label: "Defence", hint: "effective HP" },
  { id: "balanced", label: "Balanced", hint: "DPS and effective HP averaged; nothing that lowers a resistance or a max hit, or costs much" },
  {
    id: "bossing",
    label: "Bossing",
    hint: "DPS and effective HP averaged against an uber pinnacle boss, without situational assumptions",
  },
];

/**
 * How the engine sets the build's config: as the player set it, with the
 * situational assumptions ("When In Combat", "For Effective DPS") cleared, or
 * cleared and against an uber pinnacle boss (design doc §3.9).
 */
export type Mode = "configured" | "conservative" | "boss";

/** Bossing always uses boss settings; otherwise the player's assumptions count only when they ask. */
export function modeFor(goal: Goal, countAssumptions: boolean): Mode {
  if (goal === "bossing") return "boss";
  return countAssumptions ? "configured" : "conservative";
}

/** The goal's gain from relative DPS and effective HP changes (0.1 = +10%). */
export function goalGain(goal: Goal, dps: number, ehp: number): number {
  if (goal === "damage") return dps;
  if (goal === "defence") return ehp;
  return (dps + ehp) / 2;
}

/** Goals that never suggest something with a drawback (a resist drop, a sharp loss). */
export const avoidsDrawbacks = (goal: Goal) => goal === "balanced" || goal === "bossing";

/** PoB stat weights for its weighted rare search (its trader's "stat weights"). */
export function searchWeights(goal: Goal): { stat: string; weightMult: number }[] {
  if (goal === "damage") return [{ stat: "CombinedDPS", weightMult: 1 }];
  if (goal === "defence") return [{ stat: "TotalEHP", weightMult: 1 }];
  return [
    { stat: "CombinedDPS", weightMult: 0.5 },
    { stat: "TotalEHP", weightMult: 0.5 },
  ];
}

export function goalLabel(goal: Goal): string {
  return GOALS.find((g) => g.id === goal)?.label ?? goal;
}
