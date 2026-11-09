import { useCallback, useEffect, useState } from "react";
import { APP_BUILD, APP_VERSION } from "../buildInfo";
import { decodeBuildCode, readBuildSummary, type BuildSummary } from "../core/buildCode";
import { change, pantheonAdvice, supportAdvice, type Analysis } from "../core/analysis";
import { checkBuild, type Finding } from "../core/health";
import { GOALS, goalLabel, modeFor, type Goal, type Mode } from "../core/goals";
import { formatPrice, gemPrice, gemQuery, tradeSearchUrl, type NinjaItemLine } from "../core/market";
import { ASCENDANCY_POINTS, planPassives, type PassiveAdvice, type PassiveResult } from "../core/passives";
import type { UpgradeResult } from "../core/upgrades";
import { diffStats, formatStat, HEADLINE_STATS, type Stats } from "../core/stats";
import {
  memoryBuildStore,
  sqlBuildStore,
  type BuildStore,
  type BuildVersion,
  type NewVersion,
  type SavedBuild,
} from "../data/builds";
import { isTauri, openDb } from "../data/db";
import { MODE_TEXT, message, signed } from "./format";
import { loadGemPrices, loadLeagues, openLink, savedLeague, saveLeague } from "./market";
import { analyse, audit, calculate, passives, rareSearch, upgrades } from "./pob";
import { BuildAudit } from "./Audit";
import { CompareBuilds } from "./Compare";
import { ItemCheckPanel } from "./ItemCheck";
import { MetaComparison } from "./Meta";
import { RunTracker } from "./Runs";
import { WickermanPanel } from "./Wickerman";
import { Earnings } from "./Earnings";
import { FindingItem, StatChangeList } from "./parts";
import { saveCountAssumptions, saveGoal, savedCountAssumptions, savedGoal } from "./settings";
import { ItemUpgrades, type RareSearchFn } from "./Upgrades";


/** Decodes a pasted code and calculates it with PoB. A PoB failure still saves the build, without stats. */
async function prepare(code: string): Promise<{ version: NewVersion; warning: string }> {
  const clean = code.replace(/\s+/g, "");
  const xml = await decodeBuildCode(clean);
  const summary = readBuildSummary(xml);
  try {
    const result = await calculate(xml);
    return {
      version: { code: clean, summary, mainSkill: result.mainSkill, stats: result.stats },
      warning: "",
    };
  } catch (e) {
    return {
      version: { code: clean, summary, mainSkill: null, stats: null },
      warning: `Saved, but Path of Building couldn't calculate it: ${message(e)}`,
    };
  }
}

const describeBuild = (s: BuildSummary) =>
  `Level ${s.level} ${s.ascendancy && s.ascendancy !== "None" ? `${s.ascendancy} (${s.className})` : s.className}`;

const defaultName = (v: NewVersion) => {
  const cls = v.summary.ascendancy && v.summary.ascendancy !== "None" ? v.summary.ascendancy : v.summary.className;
  return v.mainSkill ? `${cls} – ${v.mainSkill}` : cls;
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function App() {
  const [store, setStore] = useState<BuildStore | null>(null);
  const [builds, setBuilds] = useState<SavedBuild[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [versions, setVersions] = useState<BuildVersion[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => setStore(isTauri() ? sqlBuildStore(await openDb()) : memoryBuildStore()))().catch((e) =>
      setError(message(e)),
    );
  }, []);

  const refresh = useCallback(
    async (select?: number | null) => {
      if (!store) return;
      const list = await store.list();
      let id = select !== undefined ? select : await store.activeId();
      if (id === null || !list.some((b) => b.id === id)) id = list[0]?.id ?? null;
      await store.setActive(id);
      setBuilds(list);
      setActiveId(id);
      setVersions(id === null ? [] : await store.versions(id));
      if (list.length === 0) setAdding(true);
    },
    [store],
  );

  useEffect(() => {
    refresh().catch((e) => setError(message(e)));
  }, [refresh]);

  async function run(label: string, task: () => Promise<string | void>) {
    setBusy(label);
    setError("");
    try {
      const warning = await task();
      if (warning) setError(warning);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }

  const addBuild = (code: string, name: string) =>
    run("Calculating with Path of Building…", async () => {
      const { version, warning } = await prepare(code);
      const id = await store!.add(name.trim() || defaultName(version), version);
      setAdding(false);
      await refresh(id);
      return warning;
    });

  const addVersion = (code: string) =>
    run("Calculating with Path of Building…", async () => {
      const { version, warning } = await prepare(code);
      const added = await store!.addVersion(activeId!, version);
      await refresh(activeId);
      return added ? warning : "That's the same code as the latest version.";
    });

  const recalculate = (v: BuildVersion) =>
    run("Calculating with Path of Building…", async () => {
      const result = await calculate(await decodeBuildCode(v.code));
      await store!.setStats(v.id, result.mainSkill, result.stats);
      await refresh(activeId);
    });

  const active = builds.find((b) => b.id === activeId) ?? null;

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>POE Cheetah</h1>
        <h2>Builds</h2>
        <ul className="build-list">
          {builds.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                className={b.id === activeId && !adding ? "build-item active" : "build-item"}
                onClick={() => {
                  setAdding(false);
                  refresh(b.id).catch((e) => setError(message(e)));
                }}
              >
                <span className="build-name">{b.name}</span>
                <span className="muted small">{describeBuild(b.latest.summary)}</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="secondary" onClick={() => setAdding(true)} disabled={!store}>
          + Add build
        </button>
        <footer className="muted small">
          v{APP_VERSION} · {APP_BUILD}
          <br />
          Not affiliated with Grinding Gear Games.
        </footer>
      </aside>

      <main className="main">
        {busy && <p className="busy">{busy}</p>}
        {error && <p className="error">{error}</p>}
        {!isTauri() && (
          <p className="muted small">Browser preview: builds aren't saved and stats are sample numbers.</p>
        )}
        {adding || !active ? (
          <AddBuild
            disabled={!store || busy !== ""}
            onAdd={addBuild}
            onCancel={builds.length > 0 ? () => setAdding(false) : undefined}
          />
        ) : (
          <BuildView
            key={active.id}
            build={active}
            versions={versions}
            disabled={busy !== ""}
            onUpdate={addVersion}
            onRecalculate={recalculate}
            onAnalyse={async (mode) => analyse(await decodeBuildCode(active.latest.code), mode)}
            onPassives={async (mode) => passives(await decodeBuildCode(active.latest.code), mode)}
            onUpgrades={async (mode, names) => upgrades(await decodeBuildCode(active.latest.code), mode, names)}
            onRareSearch={async (mode, slot, weights) => rareSearch(await decodeBuildCode(active.latest.code), mode, slot, weights)}
            onRename={(name) => run("", async () => (await store!.rename(active.id, name), await refresh(active.id)))}
            onDelete={() => run("", async () => (await store!.remove(active.id), await refresh(null)))}
          />
        )}
      </main>
    </div>
  );
}

function AddBuild(props: {
  disabled: boolean;
  onAdd: (code: string, name: string) => void;
  onCancel?: () => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  return (
    <section className="panel">
      <h2>Add a build</h2>
      <p className="muted">
        In Path of Building: Import/Export Build → Generate → Copy, then paste the code here.
      </p>
      <label htmlFor="code">Path of Building code</label>
      <textarea id="code" rows={5} value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} />
      <label htmlFor="name">Name (optional)</label>
      <input
        id="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Main – Reliquarian"
      />
      <div className="actions">
        <button type="button" onClick={() => props.onAdd(code, name)} disabled={props.disabled || !code.trim()}>
          Add build
        </button>
        {props.onCancel && (
          <button type="button" className="secondary" onClick={props.onCancel}>
            Cancel
          </button>
        )}
      </div>
    </section>
  );
}

function BuildView(props: {
  build: SavedBuild;
  versions: BuildVersion[];
  disabled: boolean;
  onUpdate: (code: string) => void;
  onRecalculate: (v: BuildVersion) => void;
  onAnalyse: (mode: Mode) => Promise<Analysis>;
  onPassives: (mode: Mode) => Promise<PassiveResult>;
  onUpgrades: (mode: Mode, uniques: string[]) => Promise<UpgradeResult>;
  onRareSearch: RareSearchFn;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const { build, versions } = props;
  const latest = versions[0] ?? build.latest;
  const previous = versions.slice(1).find((v) => v.stats);
  const [code, setCode] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(build.name);
  const [goal, setGoal] = useState<Goal>(savedGoal);
  const [countAssumptions, setCountAssumptions] = useState(savedCountAssumptions);
  const [league, setLeague] = useState(savedLeague() ?? "");
  const [leagues, setLeagues] = useState<string[]>([]);
  const mode = modeFor(goal, countAssumptions);

  useEffect(() => {
    loadLeagues()
      .then(({ current, all }) => {
        setLeagues(all);
        setLeague((l) => (l && all.includes(l) ? l : (current ?? all[0] ?? l)));
      })
      .catch(() => setLeagues([]));
  }, []);

  return (
    <>
      <section className="panel">
        <div className="title-row">
          {renaming ? (
            <>
              <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Build name" />
              <button
                type="button"
                onClick={() => {
                  if (name.trim()) props.onRename(name.trim());
                  setRenaming(false);
                }}
              >
                Save
              </button>
            </>
          ) : (
            <>
              <h2>{build.name}</h2>
              <button type="button" className="link" onClick={() => setRenaming(true)}>
                Rename
              </button>
              <button
                type="button"
                className="link"
                onClick={() => props.onRecalculate(latest)}
                disabled={props.disabled}
                title="Calculate again with the bundled Path of Building"
              >
                Recalculate
              </button>
            </>
          )}
        </div>
        <p className="muted">
          {describeBuild(latest.summary)}
          {latest.mainSkill && ` · ${latest.mainSkill}`} · updated {when(latest.addedAt)}
        </p>
        {latest.stats?.MinionDamage === 1 && (
          <p className="muted small">
            Combined DPS is your minions': {formatStat("number", latest.stats.MinionDPS ?? 0)} each ×{" "}
            {latest.stats.MinionCount ?? 1} at once (Path of Building's active minion limit). The advice ranks by it.
          </p>
        )}
        {latest.stats ? (
          <StatGrid stats={latest.stats} />
        ) : (
          <p>
            No stats yet.{" "}
            <button type="button" className="link" onClick={() => props.onRecalculate(latest)} disabled={props.disabled}>
              Calculate with Path of Building
            </button>
          </p>
        )}
      </section>

      {latest.stats && <Health findings={checkBuild(latest.stats, latest.summary.level)} />}

      {latest.stats && (
        <AdviceSettings
          goal={goal}
          onGoal={(g) => {
            setGoal(g);
            saveGoal(g);
          }}
          countAssumptions={countAssumptions}
          onCountAssumptions={(on) => {
            setCountAssumptions(on);
            saveCountAssumptions(on);
          }}
          league={league}
          leagues={leagues}
          onLeague={(l) => {
            setLeague(l);
            saveLeague(l);
          }}
        />
      )}

      {latest.stats && (
        <NextPassives
          key={`p${latest.id}`}
          mainSkill={latest.mainSkill}
          goal={goal}
          mode={mode}
          disabled={props.disabled}
          onRun={props.onPassives}
        />
      )}

      {latest.stats && (
        <ItemUpgrades
          key={`u${latest.id}`}
          goal={goal}
          mode={mode}
          league={league}
          disabled={props.disabled}
          onRun={props.onUpgrades}
          onRareSearch={props.onRareSearch}
        />
      )}

      {latest.stats && (
        <DeepAnalysis key={`a${latest.id}`} mode={mode} league={league} disabled={props.disabled} onRun={props.onAnalyse} />
      )}

      {latest.stats && (
        <MetaComparison
          key={`m${latest.id}`}
          code={latest.code}
          skill={latest.mainSkill}
          ascendancy={latest.summary.ascendancy}
          goal={goal}
          mode={mode}
          league={league}
          disabled={props.disabled}
        />
      )}

      {latest.stats && (
        <WickermanPanel key={`w${build.id}`} buildId={build.id} code={latest.code} goal={goal} mode={mode} disabled={props.disabled} />
      )}

      {latest.stats && (
        <BuildAudit
          key={`b${latest.id}`}
          goal={goal}
          disabled={props.disabled}
          onRun={async () => audit(await decodeBuildCode(latest.code))}
        />
      )}

      {latest.stats && (
        <CompareBuilds
          key={`c${latest.id}`}
          code={latest.code}
          goal={goal}
          mode={mode}
          league={league}
          disabled={props.disabled}
        />
      )}

      {latest.stats && (
        <ItemCheckPanel
          disabled={props.disabled}
          ctx={{ buildId: build.id, buildName: build.name, code: latest.code, level: latest.summary.level, goal, mode, league }}
        />
      )}

      {latest.stats && previous?.stats && <Changes before={previous.stats} after={latest.stats} since={previous.addedAt} />}

      <RunTracker />

      <Earnings league={league} />

      <section className="panel">
        <h3>Update this build</h3>
        <p className="muted small">Paste a newer code for the same character to see what changed.</p>
        <textarea rows={3} value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} aria-label="Newer Path of Building code" />
        <div className="actions">
          <button
            type="button"
            disabled={props.disabled || !code.trim()}
            onClick={() => {
              props.onUpdate(code);
              setCode("");
            }}
          >
            Save new version
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>Versions</h3>
        <ul className="versions">
          {versions.map((v) => (
            <li key={v.id}>
              {when(v.addedAt)} · level {v.summary.level}
              {v.stats?.CombinedDPS !== undefined && ` · ${formatStat("number", v.stats.CombinedDPS)} DPS`}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="link danger"
          onClick={() => {
            if (window.confirm(`Delete "${build.name}" and all its versions?`)) props.onDelete();
          }}
        >
          Delete build
        </button>
      </section>
    </>
  );
}

function StatGrid({ stats }: { stats: Stats }) {
  return (
    <dl className="stat-grid">
      {HEADLINE_STATS.filter((d) => stats[d.key] !== undefined).map((d) => (
        <div key={d.key} className="stat">
          <dt>{d.label}</dt>
          <dd>{formatStat(d.kind, stats[d.key])}</dd>
        </div>
      ))}
    </dl>
  );
}

function Changes({ before, after, since }: { before: Stats; after: Stats; since: string }) {
  const changes = diffStats(before, after);
  return (
    <section className="panel">
      <h3>Changes since {when(since)}</h3>
      {changes.length === 0 ? (
        <p className="muted">No headline stat changed.</p>
      ) : (
        <StatChangeList changes={changes} />
      )}
    </section>
  );
}

function Health({ findings }: { findings: Finding[] }) {
  return (
    <section className="panel">
      <h3>Health check</h3>
      {findings.length === 0 ? (
        <p className="muted">No problems found.</p>
      ) : (
        <ul className="findings">
          {findings.map((f) => (
            <FindingItem key={f.id} finding={f} />
          ))}
        </ul>
      )}
    </section>
  );
}

const pct = (x: number) => `${x > 0 ? "+" : ""}${Math.round(x * 100)}%`;

/** Goal, assumptions switch and league: shared by the passive, item and gem advice. */
function AdviceSettings(props: {
  goal: Goal;
  onGoal: (g: Goal) => void;
  countAssumptions: boolean;
  onCountAssumptions: (on: boolean) => void;
  league: string;
  leagues: string[];
  onLeague: (l: string) => void;
}) {
  const hint = GOALS.find((g) => g.id === props.goal)?.hint;
  return (
    <section className="panel">
      <h3>Advice for</h3>
      <div className="actions goal">
        {GOALS.map((g) => (
          <button
            key={g.id}
            type="button"
            className={g.id === props.goal ? "" : "secondary"}
            onClick={() => props.onGoal(g.id)}
            aria-pressed={g.id === props.goal}
            title={g.hint}
          >
            {g.label}
          </button>
        ))}
      </div>
      <p className="muted small">Ranked by {hint}.</p>
      <label className="small check">
        <input
          type="checkbox"
          checked={props.countAssumptions}
          disabled={props.goal === "bossing"}
          onChange={(e) => props.onCountAssumptions(e.target.checked)}
        />{" "}
        Count my situational assumptions (the "When In Combat" and "For Effective DPS" boxes ticked in Path of Building)
      </label>
      <label className="small league">
        League for prices:{" "}
        {props.leagues.length > 0 ? (
          <select value={props.league} onChange={(e) => props.onLeague(e.target.value)}>
            {props.leagues.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        ) : (
          <input
            value={props.league}
            onChange={(e) => props.onLeague(e.target.value)}
            placeholder="League name (league list unavailable)"
            aria-label="League"
          />
        )}
      </label>
    </section>
  );
}

function DeepAnalysis(props: { mode: Mode; league: string; disabled: boolean; onRun: (mode: Mode) => Promise<Analysis> }) {
  const [result, setResult] = useState<{ analysis: Analysis; mode: Mode; gems: GemPrices } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    try {
      const mode = props.mode;
      const league = props.league;
      const [analysis, gems] = await Promise.all([
        props.onRun(mode),
        league
          ? loadGemPrices(league).then(
              (g) => ({ ...g, league, error: "" }),
              (e) => ({ gems: null, divine: null, league, error: message(e) }),
            )
          : Promise.resolve({ gems: null, divine: null, league, error: "No league chosen" }),
      ]);
      setResult({ analysis, mode, gems });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const a = result?.analysis;
  const dps = (s: Stats) => s.CombinedDPS ?? 0;
  const ehp = (s: Stats) => s.TotalEHP ?? 0;
  return (
    <section className="panel">
      <h3>Honest DPS, bosses, gems and pantheon</h3>
      {!a && (
        <>
          <p className="muted small">
            Recalculates your build without situational assumptions, against uber bosses, with each pantheon and
            with other support gems (priced on poe.ninja). Takes up to a minute on a big build.
          </p>
          <div className="actions">
            <button type="button" onClick={run} disabled={props.disabled || busy}>
              {busy ? "Analysing…" : "Analyse"}
            </button>
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
      {a && result && (
        <>
          <table className="scenarios">
            <thead>
              <tr>
                <th />
                <th>Combined DPS</th>
                <th>Effective HP</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>As configured (enemy: {a.enemyIsBoss})</td>
                <td>{formatStat("number", dps(a.configured))}</td>
                <td>{formatStat("number", ehp(a.configured))}</td>
              </tr>
              <tr>
                <td>Without situational assumptions</td>
                <td>
                  {formatStat("number", dps(a.conservative))} <span className="muted">{pct(change(dps(a.configured), dps(a.conservative)))}</span>
                </td>
                <td>{formatStat("number", ehp(a.conservative))}</td>
              </tr>
              <tr>
                <td>Against uber pinnacle bosses</td>
                <td>
                  {formatStat("number", dps(a.uber))} <span className="muted">{pct(change(dps(a.configured), dps(a.uber)))}</span>
                </td>
                <td>{formatStat("number", ehp(a.uber))}</td>
              </tr>
            </tbody>
          </table>
          {a.cleared.length > 0 && (
            <details>
              <summary className="small">Assumptions turned off ({a.cleared.length})</summary>
              <ul className="small">
                {a.cleared.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </details>
          )}
          <Supports analysis={a} mode={result.mode} gems={result.gems} />
          <Pantheon title="Major god" group={a.pantheonMajor} ehp={ehp(a.configured)} />
          <Pantheon title="Minor god" group={a.pantheonMinor} ehp={ehp(a.configured)} />
          <div className="actions">
            <button type="button" className="link" onClick={run} disabled={props.disabled || busy}>
              {busy ? "Analysing…" : result.mode !== props.mode ? "Analyse again for the advice settings above" : "Analyse again"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

interface GemPrices {
  gems: NinjaItemLine[] | null;
  divine: number | null;
  league: string;
  error: string;
}

function Supports({ analysis, mode, gems }: { analysis: Analysis; mode: Mode; gems: GemPrices }) {
  if (!analysis.supports) return <p className="muted small">No support gems to rank for the main skill.</p>;
  const lines = gems.gems;
  const advice = supportAdvice(analysis.supports, 5, lines ? (name, level) => gemPrice(lines, name, level) : undefined);
  return (
    <div>
      <h4>Support gems</h4>
      <p className="muted small">Ranked {MODE_TEXT[mode]}.</p>
      {advice.better.length === 0 ? (
        <p className="small">No support {lines ? "sold this league " : ""}beats your current links.</p>
      ) : (
        <ul className="changes">
          {advice.better.map((b) => (
            <li key={b.name} className="up">
              Replace {advice.replacing} with {b.name}: {pct(b.gain)} DPS
              {b.price && (
                <>
                  {" "}
                  for ~{formatPrice(b.price.chaos, gems.divine)}
                  {b.price.note && <span className="muted"> ({b.price.note})</span>}
                  {b.price.thin && <span className="muted"> (few listed)</span>}{" "}
                  <button
                    type="button"
                    className="link"
                    onClick={() => openLink(tradeSearchUrl(gems.league, gemQuery(b.name, b.level))).catch(() => {})}
                  >
                    Trade
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {advice.unobtainable.length > 0 && (
        <p className="muted small">
          Left out, nobody sells them in {gems.league} (no poe.ninja listing): {advice.unobtainable.join(", ")}.
        </p>
      )}
      {!lines && <p className="muted small">Gem prices unavailable ({gems.error}); gems that no longer drop may be listed.</p>}
      <p className="muted small">
        What each current support is worth:{" "}
        {advice.worth.map((w) => `${w.name} ${Math.round(w.loss * 100)}%`).join(" · ")}. Candidates at their highest
        normal level, quality 0.
      </p>
    </div>
  );
}

function Pantheon(props: { title: string; group: Analysis["pantheonMajor"]; ehp: number }) {
  const advice = pantheonAdvice(props.group, props.ehp);
  let text: string;
  if (advice.noDifference) text = "None of them changes your effective HP or max hits; choose by their other effects.";
  else if (advice.best && advice.gain > 0.005) text = `${advice.best.label} gives ${pct(advice.gain)} effective HP over your current choice.`;
  else text = "Your current choice is already the best for effective HP.";
  return (
    <p className="small">
      <strong>{props.title}:</strong> {text}
    </p>
  );
}

const KIND_LABEL: Record<PassiveAdvice["kind"], string> = {
  small: "",
  notable: "notable",
  keystone: "keystone",
  mastery: "mastery",
  ascendancy: "ascendancy",
  swap: "mastery",
};


/** "+3.5% DPS per point · +7% DPS, +0.4% effective HP" (per point only when the path costs more than one). */
function gainText(p: PassiveAdvice, goal: Goal): string {
  const totals = `${signed(p.dps)} DPS, ${signed(p.ehp)} effective HP`;
  if (p.points <= 1) return totals;
  const perPoint =
    goal === "damage" ? "DPS per point" : goal === "defence" ? "effective HP per point" : "per point (DPS and EHP averaged)";
  return `${signed(p.score)} ${perPoint} · ${totals}`;
}

function PassiveItem({ p, goal, unit = "point" }: { p: PassiveAdvice; goal: Goal; unit?: string }) {
  return (
    <li className={p.drawbacks.length ? "passive warn" : "passive"}>
      <div>
        <strong>{p.name}</strong>
        {KIND_LABEL[p.kind] && <span className="muted small"> {KIND_LABEL[p.kind]}</span>}
        {p.count > 1 && (
          <span className="muted small">
            {" "}
            · {p.kind === "swap" ? `fits ${p.count} of your masteries` : `${p.count} like this within reach`}
          </span>
        )}
        {p.points > 0 && (
          <span className="muted small">
            {" "}
            · {p.points} {unit}
            {p.points > 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div className="small gain">{gainText(p, goal)}</div>
      {p.replaces && <div className="muted small">Instead of: {p.replaces.join("; ")}</div>}
      <div className="muted small">{p.lines.join("; ")}</div>
      {p.via.length > 0 && <div className="muted small">Path through: {p.via.join(" → ")}</div>}
      {p.drawbacks.length > 0 && <div className="small drawback">Costs: {p.drawbacks.join(", ")}</div>}
    </li>
  );
}

function NextPassives(props: {
  mainSkill: string | null;
  goal: Goal;
  mode: Mode;
  disabled: boolean;
  onRun: (mode: Mode) => Promise<PassiveResult>;
}) {
  const { goal, mode } = props;
  const [results, setResults] = useState<Partial<Record<Mode, PassiveResult>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    try {
      const r = await props.onRun(mode);
      setResults((all) => ({ ...all, [mode]: r }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const result = results[mode];
  const plan = result && planPassives(result, goal);
  const ascFree = plan ? ASCENDANCY_POINTS - plan.ascendancyUsed : 0;
  return (
    <section className="panel">
      <h3>Next passives · {goalLabel(goal)}</h3>
      {!plan && (
        <>
          <p className="muted small">
            Calculates every passive next to your tree, and every notable and keystone up to 4 points away (the path
            included), with Path of Building, {MODE_TEXT[mode]}. Balanced and Bossing never suggest a passive that
            lowers a resistance or costs much life. Takes up to a minute on a big build.
          </p>
          <div className="actions">
            <button type="button" onClick={run} disabled={props.disabled || busy}>
              {busy ? "Calculating passives…" : "Find passives"}
            </button>
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
      {plan && (
        <>
          <p className="muted small">
            {plan.used} of {plan.available} points spent (level {result.level}, every quest done)
            {plan.available > plan.used ? ` · ${plan.available - plan.used} to spend` : ""}. Calculated {MODE_TEXT[mode]}.
          </p>
          {plan.noDamage && goal !== "defence" && (
            <p className="small">
              Your main skill{props.mainSkill ? ` (${props.mainSkill})` : ""} deals no damage in Path of Building, so
              passives are ranked by defence only. To rank damage, choose your damage skill as the main skill in Path of
              Building and paste the code again.
            </p>
          )}
          {plan.passives.length === 0 ? (
            <p className="small">No passive within reach improves this goal{goal === "balanced" ? " without a cost" : ""}.</p>
          ) : (
            <ol className="passives">
              {plan.passives.map((p) => (
                <PassiveItem key={`${p.id}`} p={p} goal={goal} />
              ))}
            </ol>
          )}
          {plan.swaps.length > 0 && (
            <>
              <h4>Better mastery effects (no points, only a respec)</h4>
              <ul className="passives">
                {plan.swaps.map((p) => (
                  <PassiveItem key={`s${p.id}`} p={p} goal={goal} />
                ))}
              </ul>
            </>
          )}
          {ascFree > 0 && plan.ascendancy.length > 0 && (
            <>
              <h4>
                Ascendancy ({plan.ascendancyUsed} of {ASCENDANCY_POINTS} points used; for your next labyrinth)
              </h4>
              <ul className="passives">
                {plan.ascendancy.map((p) => (
                  <PassiveItem key={`a${p.id}`} p={p} goal={goal} unit="ascendancy point" />
                ))}
              </ul>
            </>
          )}
          <div className="actions">
            <button type="button" className="link" onClick={run} disabled={props.disabled || busy}>
              {busy ? "Calculating…" : "Calculate again"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
