import { useCallback, useEffect, useMemo, useState } from "react";
import { APP_BUILD, APP_VERSION } from "../buildInfo";
import { decodeBuildCode, encodeBuildCode, readBuildSummary, type BuildSummary } from "../core/buildCode";
import { activeTier, applyChoice, listTiers, type BuildChoice, type GroupKey } from "../core/compare";
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
import { analyse, audit, calculate, passives, rareSearch, skills, upgrades, type PobResult, type SkillDps } from "./pob";
import { saveChoice, savedChoice } from "./choice";
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
    const result = await calculate(applyChoice(xml));
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
      const result = await calculate(applyChoice(await decodeBuildCode(v.code), savedChoice(v.buildId)));
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
            onAnalyse={analyse}
            onPassives={passives}
            onUpgrades={upgrades}
            onRareSearch={rareSearch}
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
  onAnalyse: (xml: string, mode: Mode) => Promise<Analysis>;
  onPassives: (xml: string, mode: Mode) => Promise<PassiveResult>;
  onUpgrades: (xml: string, mode: Mode, uniques: string[]) => Promise<UpgradeResult>;
  onRareSearch: (xml: string, ...rest: Parameters<RareSearchFn>) => ReturnType<RareSearchFn>;
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

  // The tier and main skill every panel calculates (design doc §3.14).
  const [choice, setChoiceState] = useState<BuildChoice>(() => savedChoice(build.id));
  const setChoice = (c: BuildChoice) => {
    setChoiceState(c);
    saveChoice(build.id, c);
  };
  const [base, setBase] = useState<string | null>(null);
  useEffect(() => {
    decodeBuildCode(latest.code).then(setBase, () => setBase(null));
  }, [latest.code]);
  const tiers = useMemo(() => (base ? listTiers(base) : []), [base]);
  const tierTitle = base ? (tiers.find((t) => t.title === choice.tier) ?? activeTier(base, tiers)).title : "";
  const xml = useMemo(() => (base ? applyChoice(base, choice) : null), [base, choice]);
  const [buildCode, setBuildCode] = useState(latest.code);
  useEffect(() => {
    if (xml) encodeBuildCode(xml).then(setBuildCode, () => setBuildCode(latest.code));
  }, [xml, latest.code]);
  const custom = Boolean(choice.tier) || Boolean(choice.main?.[tierTitle]);
  const [chosen, setChosen] = useState<PobResult | null>(null);
  useEffect(() => {
    setChosen(null);
    if (xml && custom) calculate(xml).then(setChosen, () => setChosen(null));
  }, [xml, custom]);
  const stats = custom ? chosen?.stats ?? null : latest.stats;
  const mainSkill = custom ? chosen?.mainSkill ?? null : latest.mainSkill;
  const variant = `${latest.id}-${tierTitle}-${JSON.stringify(choice.main?.[tierTitle] ?? null)}`;
  const run = <T,>(fn: (xml: string) => Promise<T>) => async () => fn(xml ?? applyChoice(await decodeBuildCode(latest.code)));

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
          {mainSkill && ` · ${mainSkill}`} · updated {when(latest.addedAt)}
        </p>
        {tiers.length > 1 && (
          <div className="actions small">
            <label htmlFor="tier">Tier</label>
            <select
              id="tier"
              value={tierTitle}
              onChange={(e) => setChoice({ ...choice, tier: e.target.value === activeTier(base!, tiers).title ? undefined : e.target.value })}
            >
              {tiers.map((t) => (
                <option key={t.title} value={t.title}>
                  {t.title}
                  {base && t.title === activeTier(base, tiers).title ? " (as saved)" : ""}
                </option>
              ))}
            </select>
            <span className="muted">Every panel below calculates this tier.</span>
          </div>
        )}
        {custom && !chosen && <p className="muted small">Calculating {tierTitle}…</p>}
        {stats?.MinionDamage === 1 && (
          <p className="muted small">
            Combined DPS is your minions': {formatStat("number", stats.MinionDPS ?? 0)} each ×{" "}
            {stats.MinionCount ?? 1} at once (Path of Building's active minion limit). The advice ranks by it.
          </p>
        )}
        {stats ? (
          <>
            <StatGrid stats={stats} />
            {(stats.FullDPS ?? 0) > 0 && Math.abs((stats.FullDPS ?? 0) - (stats.CombinedDPS ?? 0)) > 1 && (
              <p className="muted small">
                Full DPS (the skills ticked "Include in Full DPS" in Path of Building, together): {formatStat("number", stats.FullDPS ?? 0)}. The advice ranks
                by the main skill's DPS; choose the main skill below.
              </p>
            )}
          </>
        ) : custom ? null : (
          <p>
            No stats yet.{" "}
            <button type="button" className="link" onClick={() => props.onRecalculate(latest)} disabled={props.disabled}>
              Calculate with Path of Building
            </button>
          </p>
        )}
      </section>

      {stats && <Health findings={checkBuild(stats, latest.summary.level)} />}

      {stats && xml && (
        <SkillList
          key={`s${variant}`}
          xml={xml}
          tier={tierTitle}
          disabled={props.disabled}
          onMain={(key) => setChoice({ ...choice, main: { ...choice.main, [tierTitle]: key } })}
          onReset={choice.main?.[tierTitle] ? () => setChoice({ ...choice, main: { ...choice.main, [tierTitle]: undefined! } }) : undefined}
        />
      )}

      {stats && base && tiers.length > 1 && <TierTable key={`t${latest.id}`} base={base} choice={choice} tiers={tiers.map((t) => t.title)} current={tierTitle} disabled={props.disabled} />}

      {stats && (
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

      {stats && (
        <NextPassives
          key={`p${variant}`}
          mainSkill={mainSkill}
          goal={goal}
          mode={mode}
          disabled={props.disabled}
          onRun={(m) => run((x) => props.onPassives(x, m))()}
        />
      )}

      {stats && (
        <ItemUpgrades
          key={`u${variant}`}
          goal={goal}
          mode={mode}
          league={league}
          disabled={props.disabled}
          onRun={(m, names) => run((x) => props.onUpgrades(x, m, names))()}
          onRareSearch={(m, slot, weights) => run((x) => props.onRareSearch(x, m, slot, weights))()}
        />
      )}

      {stats && (
        <DeepAnalysis key={`a${variant}`} mode={mode} league={league} disabled={props.disabled} onRun={(m) => run((x) => props.onAnalyse(x, m))()} />
      )}

      {stats && (
        <MetaComparison
          key={`m${variant}`}
          code={buildCode}
          skill={mainSkill}
          ascendancy={latest.summary.ascendancy}
          goal={goal}
          mode={mode}
          league={league}
          disabled={props.disabled}
        />
      )}

      {stats && (
        <WickermanPanel key={`w${variant}`} buildId={build.id} code={buildCode} goal={goal} mode={mode} disabled={props.disabled} />
      )}

      {stats && (
        <BuildAudit
          key={`b${variant}`}
          goal={goal}
          disabled={props.disabled}
          onRun={run(audit)}
        />
      )}

      {stats && (
        <CompareBuilds
          key={`c${variant}`}
          code={buildCode}
          goal={goal}
          mode={mode}
          league={league}
          disabled={props.disabled}
        />
      )}

      {stats && (
        <ItemCheckPanel
          disabled={props.disabled}
          ctx={{ buildId: build.id, buildName: build.name, code: latest.code, level: latest.summary.level, goal, mode, league }}
        />
      )}

      {latest.stats && previous?.stats && !custom && <Changes before={previous.stats} after={latest.stats} since={previous.addedAt} />}

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

const fmt = (n: number | undefined) => formatStat("number", n ?? 0);

/** Every skill's own DPS, to choose the main skill the advice ranks by (design doc §3.14). */
function SkillList(props: { xml: string; tier: string; disabled: boolean; onMain: (key: GroupKey) => void; onReset?: () => void }) {
  const [list, setList] = useState<{ skills: SkillDps[]; fullDps: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    setBusy(true);
    setError("");
    try {
      setList(await skills(props.xml));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const shown = (list?.skills ?? []).filter((s) => s.dps > 0 || s.main).sort((a, b) => b.dps - a.dps);
  const main = shown.find((s) => s.main);
  const best = shown[0];
  return (
    <section className="panel">
      <h3>Main skill{props.tier ? ` · ${props.tier}` : ""}</h3>
      <p className="muted small">
        The advice ranks by the main skill's damage. Path of Building calculates auto-cast skills too (Spellslinger,
        Cast on Crit…) at their trigger rate. If your damage comes from another skill than the one saved as main, choose it here.
      </p>
      <div className="actions">
        <button type="button" className={list ? "secondary" : ""} onClick={load} disabled={props.disabled || busy}>
          {busy ? "Calculating each skill…" : list ? "Calculate again" : "Show every skill's damage"}
        </button>
        {props.onReset && (
          <button type="button" className="link" onClick={props.onReset}>
            Use the main skill saved in the code
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {list && (
        <>
          {main && best && best !== main && best.dps > main.dps * 1.1 && (
            <p className="warning small">
              {best.name} does more damage ({fmt(best.dps)} DPS) than the main skill {main.name} ({fmt(main.dps)} DPS).
            </p>
          )}
          <table className="scenarios small">
            <tbody>
              {shown.map((s, i) => (
                <tr key={i}>
                  <td>
                    <strong>{s.name}</strong> <span className="muted">{s.slot && s.slot !== "None" ? `${s.slot}: ` : ""}{s.gems.filter(Boolean).join(", ")}</span>
                  </td>
                  <td>{fmt(s.dps)} DPS{s.fullDps ? " · in Full DPS" : ""}</td>
                  <td>
                    {s.main ? (
                      <span className="muted">main</span>
                    ) : (
                      <button type="button" className="link" onClick={() => props.onMain({ slot: s.slot, gems: s.gems })} disabled={props.disabled}>
                        make main
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.fullDps > 0 && <p className="muted small">Full DPS (ticked skills together): {fmt(list.fullDps)}</p>}
        </>
      )}
    </section>
  );
}

interface TierRow {
  tier: string;
  result: PobResult | null;
  error?: string;
}

/** The build tier by tier: how it grows (design doc §3.14). */
function TierTable(props: { base: string; choice: BuildChoice; tiers: string[]; current: string; disabled: boolean }) {
  const [rows, setRows] = useState<TierRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    const out: TierRow[] = [];
    for (const tier of props.tiers) {
      try {
        out.push({ tier, result: await calculate(applyChoice(props.base, { ...props.choice, tier })) });
      } catch (e) {
        out.push({ tier, result: null, error: message(e) });
      }
      setRows([...out]);
    }
    setBusy(false);
  };
  const level = Number(props.base.match(/<Build\b[^>]*\slevel="(\d+)"/)?.[1] ?? 0);
  return (
    <section className="panel">
      <h3>Tiers</h3>
      <p className="muted small">
        This code holds {props.tiers.length} tiers (trees, gems and gear saved together). Calculated at the code's
        character level ({level}) and gem levels as written, so early tiers can look stronger than they play.
      </p>
      <div className="actions">
        <button type="button" className={rows ? "secondary" : ""} onClick={load} disabled={props.disabled || busy}>
          {busy ? "Calculating tiers…" : rows ? "Calculate again" : "Calculate every tier"}
        </button>
      </div>
      {rows && (
        <table className="scenarios small">
          <thead>
            <tr>
              <th>Tier</th>
              <th>Main skill</th>
              <th>DPS</th>
              <th>Life</th>
              <th>Effective HP</th>
              <th>Phys max hit</th>
              <th>Fire res</th>
              <th>Free mana</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ tier, result, error }) => {
              const s = result?.stats;
              return (
                <tr key={tier} className={tier === props.current ? "active" : ""}>
                  <td>{tier}</td>
                  {s ? (
                    <>
                      <td>{result?.mainSkill ?? ""}</td>
                      <td>
                        {fmt(s.CombinedDPS)}
                        {(s.FullDPS ?? 0) > (s.CombinedDPS ?? 0) + 1 ? ` (full ${fmt(s.FullDPS)})` : ""}
                      </td>
                      <td>{fmt(s.Life)}</td>
                      <td>{fmt(s.TotalEHP)}</td>
                      <td>{fmt(s.PhysicalMaximumHitTaken)}</td>
                      <td>{s.FireResist ?? ""}%</td>
                      <td>{fmt(s.ManaUnreserved)}</td>
                    </>
                  ) : (
                    <td colSpan={7} className="error">
                      {error}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
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
