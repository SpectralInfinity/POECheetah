import type { Stats } from "./stats";

// Sustain (design doc §3.14 items 6–7): self-damage against regeneration
// (Righteous Fire and other burns PoB counts in TotalBuildDegen), and mana
// for the skills. Numbers from the engine's audit (`sustain`).

export interface SustainScenario {
  label: string;
  stats: Stats;
}

export interface SustainResult {
  base: Stats;
  scenarios: SustainScenario[];
}

export interface BurnCheck {
  regen: number;
  burn: number;
  net: number;
  /** Fire resistance at its maximum (some over the cap). */
  fireAtMax: boolean;
  fireResist: number;
  /** Life a second the skills cost while casting (Lifetap, life costs). */
  lifeCostPerSecond: number;
  scenarios: { label: string; net: number }[];
  severity: "ok" | "thin" | "negative";
  text: string;
}

export interface ManaCheck {
  free: number;
  cost: number;
  perSecond: number;
  regen: number;
  severity: "ok" | "thin" | "negative";
  text: string;
}

const round = (x: number) => Math.round(x).toLocaleString("en-US");
const net = (s: Stats) => (s.LifeRegenRecovery ?? 0) - (s.TotalBuildDegen ?? 0);

/** A thin margin: less regeneration to spare than a fifth of the burn. */
const THIN = 0.2;

/** Null when the build doesn't burn itself. */
export function burnCheck(r: SustainResult): BurnCheck | null {
  const b = r.base;
  const burn = b.TotalBuildDegen ?? 0;
  if (burn <= 0) return null;
  const regen = b.LifeRegenRecovery ?? 0;
  const n = regen - burn;
  const scenarios = r.scenarios.map((s) => ({ label: s.label, net: net(s.stats) })).sort((a, z) => a.net - z.net);
  const fireAtMax = (b.FireResistOverCap ?? 0) > 0;
  const severity = n < 0 ? "negative" : n < burn * THIN || scenarios.some((s) => s.net < 0) || !fireAtMax ? "thin" : "ok";
  const losing = scenarios.filter((s) => s.net < 0).map((s) => s.label);
  const text =
    n < 0
      ? `You burn ${round(burn)} life/s and regenerate ${round(regen)}: ${round(-n)} life/s short. You'll die standing still.`
      : `You regenerate ${round(regen)} life/s against a ${round(burn)} life/s burn: ${round(n)} to spare.` +
        (losing.length ? ` Under ${losing.join("; ")} you'd burn faster than you regenerate: skip those map mods.` : "") +
        (!fireAtMax ? ` Fire resistance is ${b.FireResist ?? 0}%, not at its maximum: each missing point adds to the burn.` : "");
  return { regen, burn, net: n, fireAtMax, fireResist: b.FireResist ?? 0, lifeCostPerSecond: b.LifePerSecondCost ?? 0, scenarios, severity, text };
}

/** Mana: what's left after reservations against what the main skill costs to cast and use continuously. */
export function manaCheck(b: Stats): ManaCheck {
  const free = b.ManaUnreserved ?? 0;
  const cost = b.ManaCost ?? 0;
  const perSecond = b.ManaPerSecondCost ?? 0;
  const regen = b.ManaRegenRecovery ?? 0;
  let severity: ManaCheck["severity"] = "ok";
  let text: string;
  if (cost > 0 && free < cost) {
    severity = "negative";
    text = `Only ${round(free)} mana is left after reservations, and the main skill costs ${round(cost)}: you can't cast it.`;
  } else if (perSecond > regen) {
    severity = "thin";
    const seconds = free / (perSecond - regen);
    text = `Casting non-stop costs ${round(perSecond)} mana/s against ${round(regen)} regenerated: the ${round(free)} free mana lasts about ${Math.max(1, Math.round(seconds))} seconds. A mana flask, mana cost efficiency or Lifetap fixes it.`;
  } else if (cost === 0 && perSecond === 0) {
    text = `The main skill costs no mana${(b.LifeCost ?? 0) > 0 ? ` (it costs ${round(b.LifeCost ?? 0)} life)` : ""}; ${round(free)} mana is free after reservations.`;
  } else {
    text = `Casting non-stop costs ${round(perSecond)} mana/s and you regenerate ${round(regen)}: it never runs out. ${round(free)} mana is free after reservations.`;
  }
  return { free, cost, perSecond, regen, severity, text };
}
