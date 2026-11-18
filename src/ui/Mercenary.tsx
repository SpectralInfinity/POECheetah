import { useState } from "react";
import { MERCENARY_RULES_330, hasMercenary, linksOnMercenary, linksOnMercenary329, uncounted, type MercenaryResult } from "../core/mercenary";
import { message } from "./format";
import { mercenary } from "./pob";

/** 3.30 mercenaries (design doc §3.13): what your Link skills give your mercenary, and the league's rules for it. */
export function MercenaryPanel(props: { disabled: boolean; xml: () => Promise<string> }) {
  const [result, setResult] = useState<MercenaryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    try {
      setResult(await mercenary(await props.xml()));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const links = result ? linksOnMercenary(result) : [];
  const before = result ? linksOnMercenary329(result) : [];
  const notCounted = result ? uncounted(result) : [];

  return (
    <section className="panel">
      <h3>Mercenary</h3>
      <p className="muted small">
        Path of Building has no mercenary to calculate. From what it does know (your Link skills' buffs, your life and
        light radius) this works out what your mercenary gets, with 3.30's rules.
      </p>
      <div className="actions">
        <button type="button" className={result ? "secondary" : ""} onClick={run} disabled={props.disabled || busy}>
          {busy ? "Reading…" : result ? "Check again" : "Check my mercenary"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {result && !hasMercenary(result) && <p className="muted small">Nothing on this build for a mercenary: no Link skill and no mercenary passive or item.</p>}
      {result && hasMercenary(result) && (
        <>
          {links.length > 0 && (
            <>
              <h4>What your Link skills give it</h4>
              <ul className="findings">
                {links.map((l, i) => (
                  <li key={l.name} className="info">
                    <strong>
                      {l.name}
                      {l.level ? ` (level ${l.level})` : ""}
                    </strong>{" "}
                    <span className="small">{l.lines.join("; ") || "No values Path of Building can read."}</span>
                    <div className="muted small">Buff effect on your mercenary: {l.effectText}.</div>
                    {before[i] && before[i].lines.join() !== l.lines.join() && (
                      <div className="muted small">With 3.29's rules (Golden Glory at 100%, Flame Link 5% of life): about {before[i].lines.map((x) => x.replace(/^Adds /, "")).join("; ")}.</div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {notCounted.length > 0 && (
            <>
              <h4>Not counted by Path of Building</h4>
              <ul className="small">
                {notCounted.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </>
          )}
          <h4>3.30 rules for your mercenary</h4>
          <ul className="small">
            {MERCENARY_RULES_330.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
