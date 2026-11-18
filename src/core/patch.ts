import { diffStats, type StatChange, type Stats } from "./stats";

// Patch impact (design doc §3.10): when the bundled Path of Building is
// updated for a patch, saved builds are recalculated and what changed is
// shown per build. The app keeps the stats from before the recalculation
// (`previous` in the build store) with the release that calculated them.

export interface PatchImpact {
  from: string;
  to: string;
  changes: StatChange[];
  /** The main skill PoB calculated changed (e.g. a skill granted by an item moved the main group). */
  skillChange: { before: string | null; after: string | null } | null;
  text: string;
}

const pct = (before: number, after: number) => (before === 0 ? 0 : (after - before) / Math.abs(before));
const signed = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 100))}%`;

/** What a Path of Building update changed for one build; null when nothing headline changed. */
export function patchImpact(
  previous: { stats: Stats; mainSkill: string | null; pobVersion: string | null },
  current: { stats: Stats; mainSkill: string | null; pobVersion: string | null },
): PatchImpact | null {
  const changes = diffStats(previous.stats, current.stats);
  const skillChange = previous.mainSkill !== current.mainSkill ? { before: previous.mainSkill, after: current.mainSkill } : null;
  if (changes.length === 0 && !skillChange) return null;
  const from = previous.pobVersion ?? "an earlier version";
  const to = current.pobVersion ?? "the bundled version";
  const dps = changes.find((c) => c.def.key === "CombinedDPS");
  const ehp = changes.find((c) => c.def.key === "TotalEHP");
  const headline = [
    dps ? `DPS ${signed(pct(dps.before, dps.after))}` : "",
    ehp ? `effective HP ${signed(pct(ehp.before, ehp.after))}` : "",
  ].filter(Boolean);
  const text = headline.length
    ? `With Path of Building ${to} (was ${from}): ${headline.join(", ")}.`
    : `Path of Building ${to} (was ${from}) changed some numbers.`;
  return { from, to, changes, skillChange, text };
}

/** Saved builds whose latest numbers came from another Path of Building than the bundled one. */
export function outdated<T extends { latest: { stats: Stats | null; pobVersion: string | null } }>(builds: T[], bundled: string | null): T[] {
  if (!bundled) return [];
  return builds.filter((b) => b.latest.stats !== null && b.latest.pobVersion !== bundled);
}
