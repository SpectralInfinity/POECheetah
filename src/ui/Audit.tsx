import { useState } from "react";
import { adviseOptions, adviseStance, planFlasks, pobLimits, type AuditResult, type OptionVerdict } from "../core/audit";
import { goalLabel, type Goal } from "../core/goals";
import { message, signed } from "./format";

const MARK: Record<OptionVerdict, string> = {
  "turn-on": "warning",
  assumed: "warning",
  "on-kill": "warning",
  ok: "fixed",
  off: "info",
};

/** Build audit (design doc §3.12 items 13, 15, 18, 20): what the config assumes, the flask set, PoB's blind spots. */
export function BuildAudit(props: { goal: Goal; disabled: boolean; onRun: () => Promise<AuditResult> }) {
  const { goal } = props;
  const [result, setResult] = useState<AuditResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    try {
      setResult(await props.onRun());
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const options = result ? adviseOptions(result, goal) : [];
  const shown = options.filter((o) => o.verdict !== "off" || o.gain > 0.01);
  const stance = result ? adviseStance(result, goal) : null;
  const flasks = result ? planFlasks(result, goal) : null;
  const limits = result ? pobLimits(result) : [];

  return (
    <section className="panel">
      <h3>Build audit · {goalLabel(goal)}</h3>
      {!result && (
        <p className="muted small">
          Checks the charges and buffs your Path of Building config assumes (and whether your build makes them true
          against a boss), your stance, what each flask is for and what to put in the slot you can spare, and where
          Path of Building's numbers aren't the whole story. Takes a few seconds.
        </p>
      )}
      <div className="actions">
        <button type="button" className={result ? "secondary" : ""} onClick={run} disabled={props.disabled || busy}>
          {busy ? "Checking…" : result ? "Check again" : "Audit my build"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {result && (
        <div className="compare">
          <h4>Charges and buffs</h4>
          {shown.length === 0 ? (
            <p className="muted small">Nothing assumed that your build doesn't give, and nothing to turn on.</p>
          ) : (
            <ul className="findings">
              {shown.map((o) => (
                <li key={o.var} className={MARK[o.verdict]}>
                  <strong>{o.label.replace(/\?$/, "")}</strong> <span className="small">{o.text}</span>
                </li>
              ))}
            </ul>
          )}

          {stance && (
            <>
              <h4>Stance: {stance.current}</h4>
              <ul className="small">
                {stance.others.map((s) => (
                  <li key={s.value}>
                    {s.value} instead: {s.text}
                  </li>
                ))}
              </ul>
              {stance.bloodOnDot && (
                <p className="small drawback">
                  Blood Stance only adds physical damage taken from hits, and most of your damage is over time: Sand
                  Stance's defence is likely worth more.
                </p>
              )}
              {stance.fleshAndStone && (
                <p className="muted small">Flesh and Stone sets the stance by itself: Blood and Sand isn't needed.</p>
              )}
            </>
          )}

          {flasks && flasks.flasks.length > 0 && (
            <>
              <h4>Flasks</h4>
              <ul className="passives">
                {flasks.flasks.map((f) => (
                  <li key={f.slot} className="passive">
                    <strong>{f.slot}</strong>: {f.name} <span className="muted small">{f.role}</span>
                    {f.protects.length > 0 && <div className="small">Protects: {f.protects.join("; ")}</div>}
                  </li>
                ))}
              </ul>
              {flasks.free && (
                <p className="small">
                  The slot you can spare: <strong>{flasks.free.slot}</strong> ({flasks.free.name}
                  {flasks.free.protects.length > 0 && `; keep its ${flasks.free.protects.join(", ")} elsewhere`}).
                  {flasks.lifeIsSustain && " Life flasks stay: the skill uses their charges."}
                </p>
              )}
              {flasks.options.length > 0 && (
                <ul className="small">
                  {flasks.options.map((o) => (
                    <li key={o.base}>
                      {o.base}: <span className="gain">{signed(o.gain)}</span> for{" "}
                      {goalLabel(goal)}
                      {o.note && <span className="muted"> · {o.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="muted small">
                Plain bases at 20% quality, each in that slot; mods and enchantments come on top. Per-content sets
                (maps vs bosses) aren't planned yet.
              </p>
            </>
          )}

          {limits.length > 0 && (
            <>
              <h4>Where Path of Building isn't the whole story</h4>
              <ul className="findings">
                {limits.map((l) => (
                  <li key={l.id} className="info">
                    <span className="small">{l.text}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
