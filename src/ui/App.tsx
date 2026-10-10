import { useCallback, useEffect, useState } from "react";
import { APP_BUILD, APP_VERSION } from "../buildInfo";
import { decodeBuildCode, readBuildSummary, type BuildSummary } from "../core/buildCode";
import { change, pantheonAdvice, supportAdvice, type Analysis } from "../core/analysis";
import { checkBuild, diffFindings, type Finding } from "../core/health";
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
import { analyse, calculate, tryItem, type ItemTrial } from "./pob";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
            onTryItem={async (item) => tryItem(await decodeBuildCode(active.latest.code), item)}
            onAnalyse={async () => analyse(await decodeBuildCode(active.latest.code))}
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
  onTryItem: (item: string) => Promise<ItemTrial>;
  onAnalyse: () => Promise<Analysis>;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const { build, versions } = props;
  const latest = versions[0] ?? build.latest;
  const previous = versions.slice(1).find((v) => v.stats);
  const [code, setCode] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(build.name);

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

      {latest.stats && <DeepAnalysis key={`a${latest.id}`} disabled={props.disabled} onRun={props.onAnalyse} />}

      {latest.stats && (
        <TryItem
          level={latest.summary.level}
          disabled={props.disabled}
          onTry={props.onTryItem}
          key={latest.id}
        />
      )}

      {latest.stats && previous?.stats && <Changes before={previous.stats} after={latest.stats} since={previous.addedAt} />}

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
        <ul className="changes">
          {changes.map(({ def, before: a, after: b }) => (
            <li key={def.key} className={b > a ? "up" : "down"}>
              {def.label}: {formatStat(def.kind, a)} → {formatStat(def.kind, b)}
              {def.kind === "number" && a !== 0 && ` (${b > a ? "+" : ""}${Math.round(((b - a) / Math.abs(a)) * 100)}%)`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FindingItem({ finding }: { finding: Finding }) {
  return (
    <li className={finding.severity}>
      <strong>{finding.title}</strong>
      <span className="muted small"> {finding.detail}</span>
    </li>
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

function TryItem(props: { level: number; disabled: boolean; onTry: (item: string) => Promise<ItemTrial> }) {
  const [text, setText] = useState("");
  const [trial, setTrial] = useState<ItemTrial | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    setTrial(null);
    try {
      setTrial(await props.onTry(text));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const beforeFindings = trial ? checkBuild(trial.before, props.level) : [];
  return (
    <section className="panel">
      <h3>Try an item</h3>
      <p className="muted small">
        Paste an item: hover it in game and press Ctrl+C, or copy it from the trade site.
      </p>
      <textarea
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        aria-label="Item text"
      />
      <div className="actions">
        <button type="button" onClick={run} disabled={props.disabled || busy || !text.trim()}>
          {busy ? "Calculating…" : "Try it"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {trial && trial.slots.length === 0 && <p className="muted">{trial.item} doesn't fit any slot of this build.</p>}
      {trial?.slots.map((slot) => {
        const changes = diffStats(trial.before, slot.stats);
        const { added, removed } = diffFindings(beforeFindings, checkBuild(slot.stats, props.level));
        return (
          <div key={slot.slot} className="trial">
            <h4>
              {slot.slot}
              <span className="muted small"> {slot.replaces ? `replacing ${slot.replaces}` : "empty slot"}</span>
            </h4>
            {changes.length === 0 ? (
              <p className="muted small">No headline stat changes.</p>
            ) : (
              <ul className="changes">
                {changes.map(({ def, before: a, after: b }) => (
                  <li key={def.key} className={b > a ? "up" : "down"}>
                    {def.label}: {formatStat(def.kind, a)} → {formatStat(def.kind, b)}
                    {def.kind === "number" && a !== 0 && ` (${b > a ? "+" : ""}${Math.round(((b - a) / Math.abs(a)) * 100)}%)`}
                  </li>
                ))}
              </ul>
            )}
            {(added.length > 0 || removed.length > 0) && (
              <ul className="findings">
                {added.map((f) => (
                  <FindingItem key={`+${f.id}`} finding={{ ...f, title: `New: ${f.title}` }} />
                ))}
                {removed.map((f) => (
                  <li key={`-${f.id}`} className="fixed">
                    <strong>Fixes: {f.title}</strong>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}

const pct = (x: number) => `${x > 0 ? "+" : ""}${Math.round(x * 100)}%`;

function DeepAnalysis(props: { disabled: boolean; onRun: () => Promise<Analysis> }) {
  const [result, setResult] = useState<Analysis | null>(null);
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

  const a = result;
  const dps = (s: Stats) => s.CombinedDPS ?? 0;
  const ehp = (s: Stats) => s.TotalEHP ?? 0;
  return (
    <section className="panel">
      <h3>Honest DPS, bosses, gems and pantheon</h3>
      {!a && (
        <>
          <p className="muted small">
            Recalculates your build without situational assumptions, against uber bosses, with each pantheon and
            with other support gems. Takes up to a minute on a big build.
          </p>
          <div className="actions">
            <button type="button" onClick={run} disabled={props.disabled || busy}>
              {busy ? "Analysing…" : "Analyse"}
            </button>
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
      {a && (
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
          <Supports analysis={a} />
          <Pantheon title="Major god" group={a.pantheonMajor} ehp={ehp(a.configured)} />
          <Pantheon title="Minor god" group={a.pantheonMinor} ehp={ehp(a.configured)} />
        </>
      )}
    </section>
  );
}

function Supports({ analysis }: { analysis: Analysis }) {
  if (!analysis.supports) return <p className="muted small">No support gems to rank for the main skill.</p>;
  const advice = supportAdvice(analysis.supports);
  return (
    <div>
      <h4>Support gems</h4>
      {advice.better.length === 0 ? (
        <p className="small">No support beats your current links.</p>
      ) : (
        <ul className="changes">
          {advice.better.map((b) => (
            <li key={b.name} className="up">
              Replace {advice.replacing} with {b.name}: {pct(b.gain)} DPS
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        What each current support is worth:{" "}
        {advice.worth.map((w) => `${w.name} ${Math.round(w.loss * 100)}%`).join(" · ")}. Candidates at level 20,
        quality 0.
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
