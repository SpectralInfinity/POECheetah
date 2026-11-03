import { useEffect, useState } from "react";
import { clock, sessionStats, type Session } from "../core/gamelog";
import { isTauri } from "../data/db";
import { message } from "./format";
import {
  logCandidates,
  saveCharacter,
  saveLogPath,
  savedCharacter,
  savedLogPath,
  setOverlayClickThrough,
  toggleOverlay,
  useRunTracker,
} from "./runTracker";

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const one = (x: number) => (Math.round(x * 10) / 10).toString();

/** Run tracker (design doc §3.4): maps per hour, time per map, deaths and leveling from the game's log. */
export function RunTracker() {
  const [path, setPath] = useState(savedLogPath());
  const [character, setCharacter] = useState(savedCharacter());
  const [candidates, setCandidates] = useState<string[]>([]);
  const [live, setLive] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const [clickThrough, setClickThrough] = useState(false);
  const [overlayError, setOverlayError] = useState("");
  const { session, stale, error, load, loaded } = useRunTracker(path, character, live);

  useEffect(() => {
    logCandidates()
      .then((found) => {
        setCandidates(found);
        setPath((p) => p || found[0] || "");
      })
      .catch(() => setCandidates([]));
  }, []);

  async function start(follow: boolean) {
    saveLogPath(path);
    saveCharacter(character);
    await load();
    setLive(follow);
  }

  async function flipOverlay() {
    setOverlayError("");
    try {
      saveLogPath(path);
      saveCharacter(character);
      setOverlay(await toggleOverlay());
      setClickThrough(false);
    } catch (e) {
      setOverlayError(`Couldn't open the overlay: ${message(e)}`);
    }
  }

  return (
    <section className="panel">
      <h3>Run tracker</h3>
      <p className="muted small">
        Reads the game's log (Client.txt, read only) for areas, deaths and level-ups: maps per hour, time per map,
        deaths per map and leveling speed. The log has no loot or damage.
      </p>
      <label className="small league">
        Log file:{" "}
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          list="log-candidates"
          placeholder="…\Path of Exile\logs\Client.txt"
          aria-label="Game log file"
          className="wide"
        />
        <datalist id="log-candidates">
          {candidates.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label className="small league">
        Character:{" "}
        <input value={character} onChange={(e) => setCharacter(e.target.value)} placeholder="found from level-ups" aria-label="Character name" />
      </label>
      <div className="actions">
        <button type="button" className={loaded ? "secondary" : ""} onClick={() => start(false)} disabled={!path}>
          Read my last session
        </button>
        <button type="button" className={live ? "" : "secondary"} onClick={() => (live ? setLive(false) : start(true))} disabled={!path}>
          {live ? "Stop following" : "Follow live"}
        </button>
        {isTauri() && (
          <button type="button" className="secondary" onClick={flipOverlay} disabled={!path}>
            {overlay ? "Close overlay" : "Overlay on top of the game"}
          </button>
        )}
        {overlay && (
          <label className="small">
            <input
              type="checkbox"
              checked={clickThrough}
              onChange={(e) => {
                setClickThrough(e.target.checked);
                setOverlayClickThrough(e.target.checked).catch((err) => setOverlayError(message(err)));
              }}
            />{" "}
            Clicks go through it
          </label>
        )}
      </div>
      {isTauri() && (
        <p className="muted small">
          The overlay shows over the game in windowed or windowed fullscreen mode; drag it by its text (with clicks
          going through, it can't be dragged).
        </p>
      )}
      {(error || overlayError) && <p className="error">{error || overlayError}</p>}
      {session && <SessionView session={session} live={live && !stale} />}
    </section>
  );
}

function SessionView({ session, live }: { session: Session; live: boolean }) {
  const st = sessionStats(session);
  const runs = [...session.runs].reverse();
  return (
    <div className="compare">
      <p className="small">
        {live ? "This session" : "Last session"}: {time(session.start)}–{time(session.end)}
        {session.character && <> · {session.character}</>}
        {session.afk > 0 && <> · {clock(session.afk)} AFK left out</>}
      </p>
      <dl className="stat-grid">
        <div className="stat">
          <dt>Maps per hour</dt>
          <dd>{one(st.mapsPerHour)}</dd>
        </div>
        <div className="stat">
          <dt>Maps</dt>
          <dd>{st.maps}</dd>
        </div>
        <div className="stat">
          <dt>Median map</dt>
          <dd>{st.maps ? clock(st.medianMap) : "–"}</dd>
        </div>
        <div className="stat">
          <dt>Deaths</dt>
          <dd>{session.deaths}</dd>
        </div>
        <div className="stat">
          <dt>Hideout and town</dt>
          <dd>{Math.round(st.idleShare * 100)}%</dd>
        </div>
        {st.leveling && (
          <div className="stat">
            <dt>Levels per hour</dt>
            <dd>{one(st.leveling.perHour)}</dd>
          </div>
        )}
      </dl>
      {st.leveling && (
        <p className="small">
          Level {st.leveling.from} → {st.leveling.to} this session
          {st.leveling.lastLevelMinutes !== null && <>; the last level took {Math.round(st.leveling.lastLevelMinutes)} minutes</>}.
        </p>
      )}
      {st.deathsByMap.length > 0 && (
        <>
          <h4>Deaths per map</h4>
          <ul className="small">
            {st.deathsByMap.map((m) => (
              <li key={m.area}>
                {m.area}: {m.deaths} in {m.runs} run{m.runs === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
        </>
      )}
      {runs.length > 0 && (
        <details>
          <summary className="small">Runs ({runs.length})</summary>
          <table className="scenarios small">
            <thead>
              <tr>
                <th>Started</th>
                <th>Map</th>
                <th>Level</th>
                <th>Time in map</th>
                <th>Deaths</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.start}>
                  <td>{time(r.start)}</td>
                  <td>{r.area}</td>
                  <td>{r.level ?? "?"}</td>
                  <td>{clock(r.active)}</td>
                  <td>{r.deaths}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <p className="muted small">
        A run is one map, through any number of portals; time in your hideout or town isn't the map's. A break of 30
        minutes starts a new session.
      </p>
    </div>
  );
}

/** The overlay window: the current area's timer, maps per hour, deaths and leveling, following the log live. */
export function RunOverlay() {
  const path = savedLogPath();
  const { session, stale, error, load } = useRunTracker(path, savedCharacter(), true);

  useEffect(() => {
    document.title = "POE Cheetah · Runs";
    document.documentElement.classList.add("overlay-page");
    void load();
  }, [load]);

  if (!path) return <div className="overlay" data-tauri-drag-region>Choose the game's log in the main window first.</div>;
  if (error) return <div className="overlay" data-tauri-drag-region>{error}</div>;
  if (!session) return <div className="overlay" data-tauri-drag-region>Waiting for the game's log…</div>;
  const st = sessionStats(session);
  const here = session.current;
  return (
    <div className="overlay" data-tauri-drag-region>
      <div data-tauri-drag-region>
        {stale ? (
          <span className="muted" data-tauri-drag-region>
            Last session, ended {time(session.end)}
          </span>
        ) : (
          <>
            <strong data-tauri-drag-region>{here ? here.area : "–"}</strong>{" "}
            <span data-tauri-drag-region>{here ? clock(session.end - here.since) : ""}</span>
          </>
        )}
      </div>
      <div data-tauri-drag-region>
        {one(st.mapsPerHour)} maps/h · {st.maps} maps · median {st.maps ? clock(st.medianMap) : "–"}
      </div>
      <div data-tauri-drag-region>
        {session.deaths} death{session.deaths === 1 ? "" : "s"}
        {st.leveling && <> · level {st.leveling.to} · {one(st.leveling.perHour)}/h</>}
      </div>
    </div>
  );
}
