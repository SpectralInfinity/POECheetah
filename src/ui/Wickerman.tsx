import { useCallback, useEffect, useState } from "react";
import { decodeBuildCode } from "../core/buildCode";
import { goalLabel, type Goal, type Mode } from "../core/goals";
import {
  BODY_SLOTS,
  judgeParts,
  partSets,
  readBodyPart,
  type BodyPart,
  type CandidateVerdict,
  type PartWorth,
  type Wickerman as WickermanParts,
} from "../core/wickerman";
import { message } from "./format";
import { modSets } from "./pob";

// The Wickerman's attached parts, per saved build (design doc §3.13).
const KEY = (buildId: number) => `poecheetah.wickerman.${buildId}`;

export function savedWickerman(buildId: number): WickermanParts {
  try {
    return JSON.parse(localStorage.getItem(KEY(buildId)) ?? "{}");
  } catch {
    return {};
  }
}

function saveWickerman(buildId: number, w: WickermanParts) {
  try {
    localStorage.setItem(KEY(buildId), JSON.stringify(w));
  } catch {
    // Not remembering it is fine.
  }
}

/** Calculates the Wickerman's parts (and a candidate) on the build. Shared with the item check. */
export async function judgeWickerman(code: string, mode: Mode, goal: Goal, w: WickermanParts, candidate?: BodyPart | null) {
  const sets = partSets(w, candidate);
  const r = await modSets(await decodeBuildCode(code), mode, sets.map((s) => s.lines));
  return judgeParts(w, sets, r.results, goal, candidate);
}

/** One line for a body part copied in game, as the item check shows it. */
export function CandidateView({ v }: { v: CandidateVerdict }) {
  return (
    <div className="item-check">
      <p className="muted small">
        {v.part.name} · Wickerman {v.part.slot.toLowerCase()}
      </p>
      <p className={`verdict ${v.attach ? "upgrade" : "worse"}`}>{v.text}</p>
      {v.drawbacks.length > 0 && <p className="small drawback">Costs: {v.drawbacks.join(", ")}</p>}
      {v.unparsed.length > 0 && (
        <p className="muted small">Path of Building doesn't understand yet (counted as nothing): {v.unparsed.join("; ")}</p>
      )}
    </div>
  );
}

/** The Wickerman (3.30): each attached body part's worth on the build, and whether a new one is better. */
export function WickermanPanel(props: { buildId: number; code: string; goal: Goal; mode: Mode; disabled: boolean }) {
  const { buildId, goal, mode } = props;
  const [parts, setParts] = useState<WickermanParts>(() => savedWickerman(buildId));
  const [text, setText] = useState("");
  const [worth, setWorth] = useState<PartWorth[]>([]);
  const [verdict, setVerdict] = useState<CandidateVerdict | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = useCallback(
    async (w: WickermanParts, candidate?: BodyPart | null) => {
      setBusy(true);
      setError("");
      try {
        const j = await judgeWickerman(props.code, mode, goal, w, candidate);
        setWorth(j.attached);
        setVerdict(j.candidate);
      } catch (e) {
        setError(message(e));
      } finally {
        setBusy(false);
      }
    },
    [props.code, mode, goal],
  );

  useEffect(() => {
    if (Object.keys(parts).length) void run(parts);
  }, [parts, run]);

  const update = (w: WickermanParts) => {
    setParts(w);
    saveWickerman(buildId, w);
  };

  function check() {
    const part = readBodyPart(text);
    if (!part) {
      setError("That isn't a Wickerman body part. Copy one in game with Ctrl+C (its text mentions the Wickerman).");
      return;
    }
    void run(parts, part);
  }

  return (
    <section className="panel">
      <h3>Wickerman · {goalLabel(goal)}</h3>
      <p className="muted small">
        Path of Exile 3.30: body parts attached to the Wickerman apply to your character. Copy a body part in game
        (Ctrl+C) and paste it here, or let the Item check's clipboard watch catch it. Your Path of Building code doesn't
        include them; the app adds the attached ones as custom modifiers.
      </p>
      <ul className="passives">
        {BODY_SLOTS.map((slot) => {
          const p = parts[slot];
          const w = worth.find((x) => x.slot === slot);
          return (
            <li key={slot} className="passive">
              <strong>{slot}</strong>: {p ? p.name : <span className="muted">empty</span>}
              {w && (
                <span className="gain small">
                  {" "}
                  {[
                    Math.abs(w.dps) >= 0.0005 ? `${w.dps >= 0 ? "+" : "−"}${Math.abs(Math.round(w.dps * 1000) / 10)}% DPS` : "",
                    Math.abs(w.ehp) >= 0.0005 ? `${w.ehp >= 0 ? "+" : "−"}${Math.abs(Math.round(w.ehp * 1000) / 10)}% effective HP` : "",
                    Math.abs(w.regen) >= 0.5 ? `+${Math.round(w.regen)} life/s` : "",
                  ]
                    .filter(Boolean)
                    .join(", ") || "nothing measurable"}
                </span>
              )}
              {p && (
                <>
                  {" "}
                  <button type="button" className="link" onClick={() => update({ ...parts, [slot]: undefined })}>
                    remove
                  </button>
                  <div className="muted small">{p.lines.join("; ")}</div>
                </>
              )}
              {w && w.unparsed.length > 0 && (
                <div className="muted small">Not understood by Path of Building yet: {w.unparsed.join("; ")}</div>
              )}
            </li>
          );
        })}
      </ul>
      <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Body part text" />
      <div className="actions">
        <button type="button" onClick={check} disabled={props.disabled || busy || !text.trim()}>
          {busy ? "Calculating…" : "Check this body part"}
        </button>
        {verdict && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              update({ ...parts, [verdict.part.slot]: verdict.part });
              setVerdict(null);
              setText("");
            }}
          >
            Attach it (replace {verdict.replaces?.name ?? "the empty slot"})
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {verdict && <CandidateView v={verdict} />}
    </section>
  );
}
