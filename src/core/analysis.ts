import type { Stats } from "./stats";

/** What the engine's `analyse` returns (design doc §3.9). */
export interface PantheonOption {
  value: string;
  label: string;
  stats: Stats;
}

export interface Analysis {
  configured: Stats;
  conservative: Stats;
  /** Situational config options that were set and got cleared for `conservative`. */
  cleared: string[];
  /** The build's "Is the enemy a Boss?" setting, as PoB labels it. */
  enemyIsBoss: string;
  uber: Stats;
  pantheonMajor: { current: string; options: PantheonOption[] };
  pantheonMinor: { current: string; options: PantheonOption[] };
  supports: {
    baseDps: number;
    current: { name: string; dpsWithout: number }[];
    replacing: string;
    candidates: { name: string; stats: Stats }[];
  } | null;
}

/** Relative change from `before` to `after` (0.1 = +10%). */
export const change = (before: number, after: number) => (before === 0 ? 0 : (after - before) / Math.abs(before));

export interface PantheonAdvice {
  current: string;
  best: PantheonOption | null;
  /** Relative EHP gain of `best` over the current choice; 0 when the current one is best or nothing differs. */
  gain: number;
  /** True when no option changes effective HP or max hits. */
  noDifference: boolean;
}

/** The pantheon option with the highest effective HP, compared to the current one. */
export function pantheonAdvice(group: Analysis["pantheonMajor"], currentEhp: number): PantheonAdvice {
  const ehp = (o: PantheonOption) => o.stats.TotalEHP ?? 0;
  const best = group.options.reduce<PantheonOption | null>((a, o) => (!a || ehp(o) > ehp(a) ? o : a), null);
  const noDifference = group.options.every((o) => Math.abs(ehp(o) - currentEhp) < 1);
  const gain = best && best.value !== group.current ? change(currentEhp, ehp(best)) : 0;
  return { current: group.current, best, gain: Math.max(0, gain), noDifference };
}

export interface SupportAdvice {
  /** Each current support and the share of DPS lost without it, most valuable first. */
  worth: { name: string; loss: number }[];
  replacing: string;
  /** Replacements that beat the current links, best first. */
  better: { name: string; gain: number }[];
}

export function supportAdvice(s: NonNullable<Analysis["supports"]>, limit = 5): SupportAdvice {
  return {
    worth: s.current
      .map((c) => ({ name: c.name, loss: (s.baseDps - c.dpsWithout) / s.baseDps }))
      .sort((a, b) => b.loss - a.loss),
    replacing: s.replacing,
    better: s.candidates
      .map((c) => ({ name: c.name, gain: change(s.baseDps, c.stats.CombinedDPS ?? 0) }))
      .filter((c) => c.gain > 0.005)
      .slice(0, limit),
  };
}
