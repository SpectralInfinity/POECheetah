import { useCallback, useEffect, useRef, useState } from "react";
import { comparable, income, type Snapshot, type StashTab, type TabValue } from "../core/stash";
import { memorySnapshotStore, sqlSnapshotStore, type SnapshotStore } from "../data/snapshots";
import { isTauri, openDb } from "../data/db";
import {
  accountName,
  accountRequestsLeft,
  forgetSession,
  money,
  priceBook,
  saveSession,
  sessionStatus,
  stashTabs,
  takeSnapshot,
} from "./account";
import { message } from "./format";
import { savedCharacter, savedLogPath, useRunTracker } from "./runTracker";

const TABS_KEY = (league: string) => `poecheetah.stashTabs.${league}`;
const readTabs = (league: string): number[] => {
  try {
    return JSON.parse(localStorage.getItem(TABS_KEY(league)) ?? "[]");
  } catch {
    return [];
  }
};
const writeTabs = (league: string, ids: number[]) => {
  try {
    localStorage.setItem(TABS_KEY(league), JSON.stringify(ids));
  } catch {
    // Not remembering the choice is fine.
  }
};

/** At most one automatic snapshot this often, to stay well inside GGG's limits. */
const AUTO_MIN_MS = 3 * 60 * 1000;

const time = (ms: number) => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Earnings (design doc §3.5): the owner's stash read with their session
 * cookie, priced with poe.ninja, as snapshots over time; income per hour and
 * per map with the run tracker.
 */
export function Earnings(props: { league: string }) {
  const { league } = props;
  const [store, setStore] = useState<SnapshotStore | null>(null);
  const [connected, setConnected] = useState(false);
  const [cookie, setCookie] = useState("");
  const [account, setAccount] = useState("");
  const [tabs, setTabs] = useState<StashTab[]>([]);
  const [chosen, setChosen] = useState<number[]>(readTabs(league));
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [latest, setLatest] = useState<TabValue[]>([]);
  const [divine, setDivine] = useState<number | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => setStore(isTauri() ? sqlSnapshotStore(await openDb()) : memorySnapshotStore()))().catch((e) => setError(message(e)));
    sessionStatus().then(setConnected).catch(() => setConnected(false));
  }, []);

  const refresh = useCallback(async () => {
    if (store && league) setSnapshots(await store.list(league));
  }, [store, league]);

  useEffect(() => {
    setChosen(readTabs(league));
    refresh().catch((e) => setError(message(e)));
  }, [league, refresh]);

  async function run(label: string, task: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }

  const connect = () =>
    run("Checking the session cookie with pathofexile.com…", async () => {
      await saveSession(cookie);
      setCookie("");
      setConnected(true);
      setAccount(await accountName());
    });

  const loadTabs = () =>
    run("Reading your stash tabs…", async () => {
      if (!league) throw new Error("Choose a league first.");
      const name = account || (await accountName());
      setAccount(name);
      setTabs(await stashTabs(league, name));
    });

  const snapshot = useCallback(
    () =>
      run("Pricing with poe.ninja…", async () => {
        if (!store) return;
        const name = account || (await accountName());
        setAccount(name);
        const all = tabs.length ? tabs : await stashTabs(league, name);
        if (!tabs.length) setTabs(all);
        const pick = all.filter((t) => chosen.includes(t.index));
        if (!pick.length) throw new Error("Choose the stash tabs to count first.");
        const prices = await priceBook(league);
        setDivine(prices.divine);
        setSkipped(prices.skipped);
        const { snapshot: s, values } = await takeSnapshot(league, name, pick, prices.book, setBusy);
        await store.add(s);
        setLatest(values);
        await refresh();
      }),
    [store, account, tabs, league, chosen, refresh],
  );

  // Automatic snapshots: after each map, once back in the hideout or town (run tracker, §3.4).
  const { session, load: loadLog } = useRunTracker(auto ? savedLogPath() : "", savedCharacter(), auto);
  const lastAuto = useRef({ runs: -1, at: 0 });
  useEffect(() => {
    lastAuto.current = { runs: -1, at: 0 };
    if (auto) void loadLog();
  }, [auto, loadLog]);
  useEffect(() => {
    if (!auto || !session || busy) return;
    const runs = session.runs.length;
    const safe = session.current?.kind === "hideout" || session.current?.kind === "town";
    if (lastAuto.current.runs < 0) lastAuto.current.runs = runs;
    if (runs > lastAuto.current.runs && safe && Date.now() - lastAuto.current.at > AUTO_MIN_MS && chosen.length <= accountRequestsLeft()) {
      lastAuto.current = { runs, at: Date.now() };
      void snapshot();
    }
  }, [auto, session, busy, chosen.length, snapshot]);

  const series = comparable(snapshots);
  const inc = income(series, session?.runs ?? []);
  const last = series[series.length - 1];

  return (
    <section className="panel">
      <h3>Earnings</h3>
      <p className="muted small">
        Your stash's value over time, priced with poe.ninja, and what you earn per hour and per map. Reads your own
        account on pathofexile.com with your session cookie.
      </p>

      {!connected ? (
        <>
          <p className="small">
            Paste your POESESSID: in your browser, on pathofexile.com while logged in, open the developer tools →
            Storage (or Application) → Cookies → POESESSID. It's kept in Windows Credential Manager and only sent to
            pathofexile.com. It gives full access to your account: never share it. Logging out of the website ends it.
          </p>
          <div className="actions">
            <input type="password" value={cookie} onChange={(e) => setCookie(e.target.value)} placeholder="POESESSID" aria-label="POESESSID" className="wide" autoComplete="off" />
            <button type="button" onClick={connect} disabled={!cookie.trim() || busy !== ""}>
              Connect
            </button>
          </div>
        </>
      ) : (
        <div className="actions small">
          <span>Connected{account && <> as {account}</>}.</span>
          <button
            type="button"
            className="link"
            onClick={() => run("", async () => (await forgetSession(), setConnected(false), setAccount(""), setTabs([])))}
          >
            Forget the cookie
          </button>
        </div>
      )}

      {connected && (
        <>
          <div className="actions">
            <button type="button" className="secondary" onClick={loadTabs} disabled={busy !== "" || !league}>
              {tabs.length ? "Reload tabs" : "Choose stash tabs"}
            </button>
            <button type="button" onClick={snapshot} disabled={busy !== "" || !league || chosen.length === 0}>
              Snapshot now
            </button>
            <label className="small">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} disabled={!savedLogPath()} /> After each map
              (follows the game log)
            </label>
          </div>
          {!savedLogPath() && <p className="muted small">Set the game log in the Run tracker to snapshot after each map.</p>}
          {tabs.length > 0 && (
            <div className="stages small">
              {tabs.map((t) => (
                <label key={t.id}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(t.index)}
                    onChange={(e) => {
                      const next = e.target.checked ? [...chosen, t.index] : chosen.filter((i) => i !== t.index);
                      setChosen(next);
                      writeTabs(league, next);
                    }}
                  />{" "}
                  {t.name}
                </label>
              ))}
            </div>
          )}
          <p className="muted small">
            Each tab is one request; pathofexile.com allows about 30 a minute and 180 per 2 hours, so choose the tabs
            where loot lands (currency, fragments, scarabs, cards, a dump tab). {chosen.length} chosen.
          </p>
        </>
      )}

      {busy && <p className="muted small">{busy}</p>}
      {error && <p className="error">{error}</p>}
      {skipped.length > 0 && (
        <p className="muted small">poe.ninja had no prices for: {skipped.join(", ")} (counted at nothing this time).</p>
      )}

      {last && (
        <div className="compare">
          <dl className="stat-grid">
            <div className="stat">
              <dt>Net worth (chosen tabs)</dt>
              <dd>{money(last.total, divine)}</dd>
            </div>
            {inc && (
              <>
                <div className="stat">
                  <dt>Per hour</dt>
                  <dd>{money(inc.perHour, divine)}</dd>
                </div>
                <div className="stat">
                  <dt>Since the first snapshot</dt>
                  <dd>{money(inc.change, divine)}</dd>
                </div>
                {inc.perMap !== null && (
                  <div className="stat">
                    <dt>Per map ({inc.maps})</dt>
                    <dd>{money(inc.perMap, divine)}</dd>
                  </div>
                )}
              </>
            )}
          </dl>
          {latest.length > 0 && (
            <details>
              <summary className="small">What the last snapshot counted</summary>
              <ul className="small">
                {latest.map((v) => (
                  <li key={v.index}>
                    {v.name}: {money(v.chaos, divine)} ({v.top.map((l) => `${l.count}× ${l.name}`).join(", ")}
                    {v.unpriced > 0 && `; ${v.unpriced} items without a poe.ninja price`})
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details>
            <summary className="small">Snapshots ({series.length})</summary>
            <table className="scenarios small">
              <tbody>
                {[...series].reverse().map((s, i, all) => (
                  <tr key={s.id ?? s.at}>
                    <td>{time(s.at)}</td>
                    <td>{money(s.total, divine)}</td>
                    <td>{all[i + 1] ? money(s.total - all[i + 1].total, divine) : ""}</td>
                    <td>
                      {s.id !== undefined && (
                        <button type="button" className="link" onClick={() => run("", async () => (await store?.remove(s.id!), await refresh()))}>
                          delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <p className="muted small">
            Income is the change in value of the chosen tabs, at today's prices when each snapshot was taken: moving
            items in or out of them, buying or selling, also counts. Rares, gems and maps have no poe.ninja price and
            count at nothing. Only snapshots of the same league and tabs compare.
          </p>
        </div>
      )}
    </section>
  );
}
