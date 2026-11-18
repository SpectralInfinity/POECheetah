import { useState } from "react";
import { FATES, GRIM_FATES, fateTrials, judgeFates, type Danger, type Fate, type FateVerdict } from "../core/fates";
import type { Mode } from "../core/goals";
import { message } from "./format";
import { trials } from "./pob";

const LABEL: Record<Danger, string> = {
  danger: "Avoid",
  watch: "Careful",
  unknown: "Can't calculate",
  safe: "Fine",
  immune: "Immune",
};

const CLASS: Record<Danger, string> = { danger: "critical", watch: "warning", unknown: "info", safe: "fixed", immune: "fixed" };

async function judge(xml: string, mode: Mode, fates: Fate[], boss: "Boss" | "Pinnacle"): Promise<FateVerdict[]> {
  const t = fateTrials(fates);
  const r = await trials(xml, mode, { ...t.shared, enemyIsBoss: boss }, t.trials.map(({ label: _label, ...trial }) => trial));
  return judgeFates(
    fates,
    r.before,
    t.trials.map((trial, i) => ({ label: trial.label, stats: r.results[i]?.stats ?? {}, unparsed: r.results[i]?.unparsed ?? [] })),
  );
}

/** 3.30 Fates (design doc §3.13): which Fate cards your build handles, to pick 1 of 4 at a Rite and 3 for the boss. */
export function FatesPanel(props: { mode: Mode; disabled: boolean; xml: () => Promise<string> }) {
  const [fates, setFates] = useState<FateVerdict[] | null>(null);
  const [grim, setGrim] = useState<FateVerdict[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    try {
      const xml = await props.xml();
      setFates(await judge(xml, props.mode, FATES, "Boss"));
      setGrim(await judge(xml, props.mode, GRIM_FATES, "Pinnacle"));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h3>Fates</h3>
      <p className="muted small">
        Path of Exile 3.30: each Fate card makes a boss harder for its reward. Choose by reward, but skip the ones your
        build handles badly. Path of Building calculates what it can (the boss's resistance, curses and ailments on you,
        less life); the rest is described with your build's numbers for its damage type.
      </p>
      <div className="actions">
        <button type="button" className={fates ? "secondary" : ""} onClick={run} disabled={props.disabled || busy}>
          {busy ? "Trying each Fate…" : fates ? "Check again" : "Check every Fate on my build"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {fates && <VerdictList title="Map boss Fates" verdicts={fates} />}
      {grim && <VerdictList title="Grim Fates (pinnacle bosses)" verdicts={grim} />}
      {fates && (
        <p className="muted small">
          Two copies of one Fate triple the first one's rewards; matching reward icons across 3 Fates unlock combo
          rewards. Numbers can change with patches.
        </p>
      )}
    </section>
  );
}

function VerdictList(props: { title: string; verdicts: FateVerdict[] }) {
  return (
    <>
      <h4>{props.title}</h4>
      <ul className="findings">
        {props.verdicts.map((v) => (
          <li key={v.fate.name} className={CLASS[v.danger]}>
            <strong>
              {v.fate.name}
              {v.fate.boss ? ` (${v.fate.boss})` : ""}: {LABEL[v.danger]}
            </strong>{" "}
            <span className="small">{v.text}</span>
            <div className="muted small">{v.fate.does}</div>
            {v.unparsed.length > 0 && (
              <div className="muted small">Path of Building doesn't understand yet: {v.unparsed.join("; ")}</div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
