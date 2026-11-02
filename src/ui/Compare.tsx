import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { decodeBuildCode, readBuildSummary } from "../core/buildCode";
import { ninjaCharacterUrl, ninjaCode, readBuildLink } from "../core/buildLink";
import {
  alignedPart,
  allocatedNodes,
  closestStage,
  fightVerdict,
  gemChanges,
  hybrid,
  PIECES,
  planCompare,
  readStages,
  treeChange,
  withStage,
  type Change,
  type CompareResult,
  type GemChange,
  type Piece,
  type StageChoice,
  type Stages,
} from "../core/compare";
import { goalLabel, type Goal, type Mode } from "../core/goals";
import { changeText } from "../core/itemCheck";
import { formatPrice, NINJA_LEAGUES_URL } from "../core/market";
import { formatStat, type Stats } from "../core/stats";
import { isTauri } from "../data/db";
import { MODE_TEXT, message, signed } from "./format";
import { getJson, loadUniqueMarket, type UniqueMarket } from "./market";
import { calculateIn, compareBuilds } from "./pob";

/** A pasted PoB code, or the code a build link holds. */
async function loadCode(text: string): Promise<string> {
  const link = readBuildLink(text);
  if (!link) return text.replace(/\s+/g, "");
  if (!isTauri()) throw new Error("Build links work in the app; in the browser preview, paste the code itself.");
  if (link.kind === "raw") return (await invoke<string>("build_link_get", { url: link.url })).trim();
  return ninjaCode(await getJson(ninjaCharacterUrl(await getJson(NINJA_LEAGUES_URL), link)));
}

interface Target {
  xml: string;
  name: string;
  stages: Stages;
  choice: StageChoice;
}

interface Run {
  mode: Mode;
  stageText: string;
  result: CompareResult;
  wholes: Partial<Record<Piece, Stats>>;
  boss: { mine: Stats; target: Stats };
  /** The target's own skill part, when it was calculated in mine instead. */
  theirPart: string | null;
  tree: { add: number; remove: number };
  gems: GemChange[];
  market: UniqueMarket | null;
}

function stageText(t: Target): string {
  const spec = t.stages.specs.find((s) => s.id === t.choice.spec);
  return spec && t.stages.specs.length > 1 ? `stage "${spec.title}"` : "its active tree";
}

/** Build comparison (design doc §3.0, §3.12 items 10–12, 14, 16): a guide or another character against mine. */
export function CompareBuilds(props: { code: string; goal: Goal; mode: Mode; league: string; disabled: boolean }) {
  const { goal, mode } = props;
  const [text, setText] = useState("");
  const [target, setTarget] = useState<Target | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setError("");
    setRun(null);
    setBusy("Reading the build…");
    try {
      const xml = await decodeBuildCode(await loadCode(text));
      const stages = readStages(xml);
      const mine = await decodeBuildCode(props.code);
      const summary = readBuildSummary(xml);
      setTarget({
        xml,
        name: `level ${summary.level} ${summary.ascendancy || summary.className}`,
        stages,
        choice: closestStage(stages, allocatedNodes(mine)),
      });
    } catch (e) {
      setTarget(null);
      setError(message(e));
    } finally {
      setBusy("");
    }
  }

  async function compare() {
    if (!target) return;
    setError("");
    try {
      const mine = await decodeBuildCode(props.code);
      const theirs = withStage(target.xml, target.choice);
      setBusy("Swapping each slot both ways with Path of Building…");
      let result = await compareBuilds(mine, theirs, mode);
      const part = alignedPart(result.mine.skill, result.target.skill);
      const theirPart = part !== undefined ? (result.target.skill.part ?? null) : null;
      if (part !== undefined) {
        setBusy(`Again, with their ${result.target.skill.name} in your part (${result.mine.skill.part})…`);
        result = await compareBuilds(mine, theirs, mode, part);
      }
      const wholes: Partial<Record<Piece, Stats>> = {};
      for (const { piece, label } of PIECES) {
        setBusy(`${label} in your build…`);
        wholes[piece] = (await calculateIn(hybrid(mine, theirs, piece), mode, piece === "skills" ? part : undefined)).stats;
      }
      setBusy("Both builds against an uber pinnacle boss…");
      const boss =
        mode === "boss"
          ? { mine: result.mine.stats, target: result.target.stats }
          : { mine: (await calculateIn(mine, "boss")).stats, target: (await calculateIn(theirs, "boss", part)).stats };
      const market = props.league ? await loadUniqueMarket(props.league).catch(() => null) : null;
      setRun({
        mode,
        stageText: stageText(target),
        result,
        wholes,
        boss,
        theirPart,
        tree: treeChange(mine, theirs),
        gems: gemChanges(mine, theirs),
        market,
      });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }

  const choose = (key: keyof StageChoice, id: number) =>
    setTarget((t) => (t ? { ...t, choice: { ...t.choice, [key]: id } } : t));

  return (
    <section className="panel">
      <h3>Compare to a build or guide</h3>
      <p className="muted small">
        Paste a Path of Building code or a link to one (pobb.in, pastebin, a poe.ninja character). Guides with
        several stages start at the one closest to your tree. The app swaps their gear one slot at a time, and their
        tree, gems and config as wholes, into your build, and lists what to change first. Takes up to a minute.
      </p>
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Target build code or link" />
      <div className="actions">
        <button type="button" className={target ? "secondary" : ""} onClick={load} disabled={props.disabled || busy !== "" || !text.trim()}>
          Load
        </button>
        {target && (
          <button type="button" onClick={compare} disabled={props.disabled || busy !== ""}>
            {busy ? "Working…" : run && run.mode !== mode ? "Compare again" : "Compare"}
          </button>
        )}
      </div>
      {target && (
        <div className="stages small">
          <span className="muted">Target: {target.name}.</span>
          <StagePicker label="Tree" sets={target.stages.specs} value={target.choice.spec} onChange={(id) => choose("spec", id)} />
          <StagePicker label="Items" sets={target.stages.itemSets} value={target.choice.itemSet} onChange={(id) => choose("itemSet", id)} />
          <StagePicker label="Gems" sets={target.stages.skillSets} value={target.choice.skillSet} onChange={(id) => choose("skillSet", id)} />
        </div>
      )}
      {busy && <p className="muted small">{busy}</p>}
      {error && <p className="error">{error}</p>}
      {run && <CompareResultView run={run} goal={goal} modeNow={mode} />}
    </section>
  );
}

function StagePicker(props: { label: string; sets: { id: number; title: string }[]; value: number; onChange: (id: number) => void }) {
  if (props.sets.length < 2) return null;
  return (
    <label>
      {props.label}:{" "}
      <select value={props.value} onChange={(e) => props.onChange(Number(e.target.value))}>
        {props.sets.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A unique's poe.ninja price ("Name, Base" as PoB names it); rares have none. */
function priceText(c: Change, market: UniqueMarket | null): string | null {
  if (c.kind !== "slot") return null;
  if (c.rarity !== "UNIQUE") return "rare: price it on the trade site";
  const [name, ...base] = (c.item ?? "").split(", ");
  const p = market?.prices.price(name, base.join(", ") || undefined);
  return p ? `~${formatPrice(p.chaos, market?.divine ?? null)}${p.note ? ` (${p.note})` : ""}` : null;
}

function ChangeItem({ c, run, noDamage }: { c: Change; run: Run; noDamage: boolean }) {
  const price = priceText(c, run.market);
  return (
    <li className="passive">
      <strong>{c.label}</strong>
      {c.item && <>: {c.item}</>}
      {c.replaces && <span className="muted small"> replacing {c.replaces}</span>}{" "}
      <span className={c.gain > 0 ? "gain" : "drawback"}>{changeText(c, noDamage)}</span>
      {price && <span className="muted small"> · {price}</span>}
      {c.kind === "tree" && (
        <span className="muted small">
          {" "}
          · {run.tree.add} passives to take, {run.tree.remove} to refund
        </span>
      )}
      {c.kind === "skills" && run.gems.length > 0 && (
        <div className="muted small">
          Gems: {run.gems.map((g) => `${g.name} ${g.mine === undefined ? `level ${g.level}` : `${g.mine} → ${g.level}`}`).join(", ")}
        </div>
      )}
      {c.drawbacks.length > 0 && <div className="small drawback">Costs: {c.drawbacks.join(", ")}</div>}
      {c.losing.length > 0 && <div className="small">Yours gives: {c.losing.join("; ")}</div>}
      {c.gaining.length > 0 && <div className="small">Theirs gives: {c.gaining.join("; ")}</div>}
    </li>
  );
}

const factorValue = (v: number) => (Math.abs(v) >= 100 ? formatStat("number", v) : String(Math.round(v * 100) / 100));

function CompareResultView({ run, goal, modeNow }: { run: Run; goal: Goal; modeNow: Mode }) {
  const plan = planCompare(run.result, run.wholes, goal);
  const fight = fightVerdict(run.boss.mine, run.boss.target);
  const mineSkill = run.result.mine.skill;
  const theirSkill = run.result.target.skill;
  const rest = plan.all.filter((c) => !plan.first.includes(c));
  return (
    <div className="compare">
      {run.mode !== modeNow && (
        <p className="small drawback">Calculated {MODE_TEXT[run.mode]}; the settings above have changed since. Compare again to update.</p>
      )}
      <p>
        Against {run.stageText}, {MODE_TEXT[run.mode]}, the target has{" "}
        {plan.noDamage ? "" : <strong>{signed(plan.gap.dps)} DPS</strong>}
        {plan.noDamage ? "" : " and "}
        <strong>{signed(plan.gap.ehp)} effective HP</strong>.
      </p>
      {plan.otherSkill && (
        <p className="small drawback">
          Different main skills ({mineSkill.name} vs {theirSkill.name}): DPS isn't like for like.
        </p>
      )}
      {run.theirPart && (
        <p className="muted small">
          Their {theirSkill.name} is calculated in your part ({mineSkill.part}), not theirs ({run.theirPart}), to compare like
          with like.
        </p>
      )}
      <p className="small">{fight.text}</p>

      <h4>Do these first · {goalLabel(goal)}</h4>
      {plan.first.length === 0 ? (
        <p className="muted small">Nothing of theirs alone makes your build better for this goal.</p>
      ) : (
        <ul className="passives">
          {plan.first.map((c) => (
            <ChangeItem key={`${c.kind}${c.label}`} c={c} run={run} noDamage={plan.noDamage} />
          ))}
        </ul>
      )}

      {plan.config && (
        <>
          <h4>Their assumptions</h4>
          <p className="small">
            Their Path of Building config in your build: {changeText(plan.config, plan.noDamage)}. That part of the gap is
            what they assume (enemy ignited, buffs up…), not something to buy.
          </p>
          {run.result.config.length > 0 && (
            <details>
              <summary className="small">{run.result.config.length} config options differ</summary>
              <ul className="small">
                {run.result.config.map((d) => (
                  <li key={d.var}>
                    {d.label}: yours {d.mine ?? "off"} → theirs {d.target ?? "off"}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {plan.factors.length > 0 && (
        <>
          <h4>Where the damage differs</h4>
          <table className="scenarios small">
            <thead>
              <tr>
                <th>Path of Building factor</th>
                <th>Yours</th>
                <th>Theirs</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {plan.factors.slice(0, 8).map((f) => (
                <tr key={f.key}>
                  <td>{f.label}</td>
                  <td>{factorValue(f.mine)}</td>
                  <td>{factorValue(f.target)}</td>
                  <td>×{Math.round(f.ratio * 100) / 100}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {rest.length > 0 && (
        <details>
          <summary className="small">Everything else tried ({rest.length})</summary>
          <ul className="passives">
            {rest.map((c) => (
              <ChangeItem key={`${c.kind}${c.label}`} c={c} run={run} noDamage={plan.noDamage} />
            ))}
          </ul>
        </details>
      )}
      <p className="muted small">
        Jewels go with "All their gear" (in the sockets your tree has); abyssal jewels aren't swapped on their own.
      </p>
    </div>
  );
}
