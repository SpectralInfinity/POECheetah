import { useState } from "react";
import { decodeBuildCode } from "../core/buildCode";
import { goalLabel, type Goal, type Mode } from "../core/goals";
import { changeText } from "../core/itemCheck";
import { characterPageUrl, choicesInXml, metaGaps, rankGaps, STRONG, type MetaGap } from "../core/ladder";
import type { PassiveResult } from "../core/passives";
import type { UpgradeResult } from "../core/upgrades";
import { MODE_TEXT, message } from "./format";
import { loadLadder, openLink, type Ladder } from "./market";
import { passives, upgrades } from "./pob";

interface Run {
  mode: Mode;
  ladder: Ladder;
  gaps: MetaGap[];
  uniques: UpgradeResult | null;
  passives: PassiveResult;
}

const KIND: Record<MetaGap["kind"], string> = { unique: "Unique", keystone: "Passive", gem: "Gem", anoint: "Anoint" };
const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Meta comparison (design doc §3.11, §3.12 items 1–2): what poe.ninja's ladder
 * characters with the same skill and ascendancy use that this build doesn't,
 * each tried on this build with Path of Building.
 */
export function MetaComparison(props: {
  code: string;
  skill: string | null;
  ascendancy: string;
  goal: Goal;
  mode: Mode;
  league: string;
  disabled: boolean;
}) {
  const { goal, mode } = props;
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function go() {
    setError("");
    try {
      if (!props.league) throw new Error("Choose a league first.");
      if (!props.skill) throw new Error("Path of Building found no main skill in this build.");
      setBusy(`Reading poe.ninja's ${props.league} ladder…`);
      const ladder = await loadLadder(props.league, props.ascendancy, props.skill);
      if (ladder.search.total === 0) throw new Error(`No character on poe.ninja's ${props.league} ladder uses ${props.skill}.`);
      const xml = await decodeBuildCode(props.code);
      setBusy("Your passives with Path of Building…");
      const tree = await passives(xml, mode);
      const gaps = metaGaps(ladder.search, ladder.names, choicesInXml(xml, tree.allocated ?? []), props.skill);
      const names = gaps.filter((g) => g.kind === "unique").map((g) => g.name);
      setBusy("Their uniques in your slots…");
      const uniques = names.length ? await upgrades(xml, mode, names) : null;
      setRun({ mode, ladder, gaps, uniques, passives: tree });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }

  const ranked = run ? rankGaps(run.gaps, goal, run.uniques, run.passives) : [];
  const noDamage = run ? !((run.passives.before.CombinedDPS ?? 0) > 0) : false;
  const filter = run?.ladder.filter;

  return (
    <section className="panel">
      <h3>Meta comparison · {goalLabel(goal)}</h3>
      {!run && (
        <p className="muted small">
          What characters on poe.ninja's ladder with your skill ({props.skill ?? "none found"}) and ascendancy (
          {props.ascendancy || "none"}) use that you don't, each tried on your build with Path of Building, so
          popularity isn't taken as advice. Takes about ten seconds.
        </p>
      )}
      <div className="actions">
        <button type="button" className={run ? "secondary" : ""} onClick={go} disabled={props.disabled || busy !== ""}>
          {busy ? "Working…" : run ? "Check again" : "Compare with the ladder"}
        </button>
      </div>
      {busy && <p className="muted small">{busy}</p>}
      {error && <p className="error">{error}</p>}
      {run && filter && (
        <div className="compare">
          <p className="small">
            {run.ladder.search.total} characters use {filter.skill}
            {filter.ascendancy ? ` as ${filter.ascendancy}` : " (none as your ascendancy, so all ascendancies)"} on
            poe.ninja's {props.league} ladder. Tried {MODE_TEXT[run.mode]}.
          </p>
          {run.mode !== mode && <p className="small drawback">The settings above have changed since: check again to update.</p>}
          {ranked.length === 0 ? (
            <p className="muted small">You already use everything that at least 20% of them do.</p>
          ) : (
            <ul className="passives">
              {ranked.map((g) => (
                <li key={`${g.kind}${g.name}`} className="passive">
                  <span className="muted small">{KIND[g.kind]} · {pct(g.share)} use it · </span>
                  <strong>{g.name}</strong>
                  {g.where && <span className="muted small"> · {g.where}</span>}{" "}
                  {g.tried && (
                    <span className={(g.gain ?? 0) >= STRONG ? "gain" : "drawback"}>
                      {(g.gain ?? 0) >= STRONG ? "popular and strong for you: " : "popular, small gain for you: "}
                      {changeText({ dps: g.dps ?? 0, ehp: g.ehp ?? 0 }, noDamage)}
                    </span>
                  )}
                  {g.drawbacks && g.drawbacks.length > 0 && <div className="small drawback">Costs: {g.drawbacks.join(", ")}</div>}
                  {g.note && <div className="muted small">{g.note}</div>}
                </li>
              ))}
            </ul>
          )}
          {run.ladder.search.characters.length > 0 && (
            <details>
              <summary className="small">Top characters (poe.ninja's figures, with their own assumptions)</summary>
              <ul className="small">
                {run.ladder.search.characters.slice(0, 10).map((c) => {
                  const url = characterPageUrl(run.ladder.overview, c);
                  return (
                    <li key={`${c.account}/${c.name}`}>
                      {c.name} (level {c.level ?? "?"}) · {c.dps ?? "?"} DPS · {c.ehp ?? "?"} EHP ·{" "}
                      <button type="button" className="link" onClick={() => openLink(url)}>
                        poe.ninja
                      </button>{" "}
                      <button type="button" className="link" onClick={() => navigator.clipboard?.writeText(url)}>
                        copy link
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="muted small">Paste a link into "Compare to a build or guide" to see what to change first, without their assumptions.</p>
            </details>
          )}
          <p className="muted small">
            The ladder leans to rich, late-league characters, and only public profiles are listed. Uniques are tried at
            their usual roll in your best slot; passives within 4 points of your tree, path included.
          </p>
        </div>
      )}
    </section>
  );
}
