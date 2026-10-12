import type { Finding } from "../core/health";
import { formatStat, type StatChange } from "../core/stats";

export function FindingItem({ finding }: { finding: Finding }) {
  return (
    <li className={finding.severity}>
      <strong>{finding.title}</strong>
      <span className="muted small"> {finding.detail}</span>
    </li>
  );
}

/** Headline stat changes, "Life: 2,959 → 3,047 (+3%)", green up and red down. */
export function StatChangeList({ changes }: { changes: StatChange[] }) {
  return (
    <ul className="changes">
      {changes.map(({ def, before: a, after: b }) => (
        <li key={def.key} className={b > a ? "up" : "down"}>
          {def.label}: {formatStat(def.kind, a)} → {formatStat(def.kind, b)}
          {def.kind === "number" && a !== 0 && ` (${b > a ? "+" : ""}${Math.round(((b - a) / Math.abs(a)) * 100)}%)`}
        </li>
      ))}
    </ul>
  );
}
