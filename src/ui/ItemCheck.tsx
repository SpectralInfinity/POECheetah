import { useCallback, useEffect, useRef, useState } from "react";
import { decodeBuildCode } from "../core/buildCode";
import { modeFor, type Goal, type Mode } from "../core/goals";
import { checkBuild, diffFindings } from "../core/health";
import {
  checkItem,
  changeText,
  isEquipment,
  readItemHeader,
  verdictText,
  type ItemHeader,
  type ItemTrial,
} from "../core/itemCheck";
import { formatPrice, tradeSearchUrl, uniqueQuery } from "../core/market";
import { diffStats } from "../core/stats";
import { sqlBuildStore, type BuildStore } from "../data/builds";
import { isTauri, openDb } from "../data/db";
import { openItemCheckWindow, readClipboard } from "./clipboard";
import { message } from "./format";
import { loadUniqueMarket, openLink, savedLeague } from "./market";
import { FindingItem, StatChangeList } from "./parts";
import { tryItem } from "./pob";
import { readBodyPart, type CandidateVerdict } from "../core/wickerman";
import { CandidateView, judgeWickerman, savedWickerman } from "./Wickerman";
import { onSettingsChanged, savedCountAssumptions, savedGoal } from "./settings";

/** How often the clipboard watch looks for a newly copied item. */
const POLL_MS = 1000;

/** The build and settings an item is checked against. */
export interface CheckContext {
  /** The saved build's id (its Wickerman parts are kept per build). */
  buildId: number;
  buildName: string;
  code: string;
  level: number;
  goal: Goal;
  mode: Mode;
  league: string;
}

interface Checked {
  text: string;
  header: ItemHeader | null;
  trial: ItemTrial;
  mode: Mode;
  level: number;
  buildName: string;
  league: string;
  /** A unique's poe.ninja price, as text ("~30c"); null when not a unique or not listed. */
  price: string | null;
}

async function uniquePrice(header: ItemHeader | null, league: string): Promise<string | null> {
  if (header?.rarity !== "Unique" || !league) return null;
  try {
    const market = await loadUniqueMarket(league);
    const p = market.prices.price(header.name, header.base ?? undefined);
    return p ? `~${formatPrice(p.chaos, market.divine)}${p.thin ? " (few listed)" : ""}` : null;
  } catch {
    return null;
  }
}

/**
 * Checks item text against a build (design doc §3.3). Only the latest request
 * shows: an item copied while another is calculating replaces it.
 */
function useItemCheck() {
  const [checked, setChecked] = useState<Checked | null>(null);
  const [bodyPart, setBodyPart] = useState<CandidateVerdict | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef(0);

  const check = useCallback(async (text: string, ctx: CheckContext) => {
    const run = ++latest.current;
    setBusy(true);
    setError("");
    try {
      // A 3.30 Wickerman body part: its worth over the part in its slot (design doc §3.13).
      const part = readBodyPart(text);
      if (part) {
        const j = await judgeWickerman(ctx.code, ctx.mode, ctx.goal, savedWickerman(ctx.buildId), part);
        if (run !== latest.current) return;
        setChecked(null);
        setBodyPart(j.candidate);
        return;
      }
      const header = readItemHeader(text);
      const [trial, price] = await Promise.all([
        tryItem(await decodeBuildCode(ctx.code), text, ctx.mode),
        uniquePrice(header, ctx.league),
      ]);
      if (run !== latest.current) return;
      setBodyPart(null);
      setChecked({ text, header, trial, mode: ctx.mode, level: ctx.level, buildName: ctx.buildName, league: ctx.league, price });
    } catch (e) {
      if (run === latest.current) setError(message(e));
    } finally {
      if (run === latest.current) setBusy(false);
    }
  }, []);

  return { checked, bodyPart, busy, error, check };
}

/**
 * Calls `onItem` with each piece of equipment the player copies (Ctrl+C on an
 * item in game, or on the trade site) while `enabled`. Other clipboard text is
 * ignored, and nothing is kept or sent anywhere.
 */
function useClipboardItems(enabled: boolean, onItem: (text: string) => void) {
  const last = useRef<string | null>(null);
  const handler = useRef(onItem);
  handler.current = onItem;
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let reading = false;
    const tick = async () => {
      if (reading) return;
      reading = true;
      const text = await readClipboard();
      reading = false;
      if (stopped || text === null || text === last.current) return;
      last.current = text;
      const header = readItemHeader(text);
      if ((header && isEquipment(header)) || readBodyPart(text)) handler.current(text);
    };
    void tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [enabled]);
}

/** The answer for a checked item: verdict, price, and (unless compact) each slot's stat changes. */
function CheckResult({ checked, goal, compact }: { checked: Checked; goal: Goal; compact?: boolean }) {
  const c = checkItem(checked.trial, goal, checked.level);
  const header = checked.header;
  const title = header ? [header.name, header.base].filter(Boolean).join(", ") : checked.trial.item;
  const best = c.best;
  const others = c.slots.filter((s) => s !== best);
  const beforeFindings = checkBuild(checked.trial.before, checked.level);
  const tradeUrl =
    header?.rarity === "Unique" && header.base && checked.league
      ? tradeSearchUrl(checked.league, uniqueQuery(header.name, header.base))
      : null;

  return (
    <div className="item-check">
      <p className="muted small">{title}</p>
      <p className={`verdict ${c.verdict}`}>{verdictText(c)}</p>
      {best && best.drawbacks.length > 0 && c.verdict !== "drawback" && (
        <p className="small drawback">Costs: {best.drawbacks.join(", ")}</p>
      )}
      {best && c.verdict !== "drawback" && best.replaces && (
        <p className="muted small">Replacing {best.replaces}</p>
      )}
      {c.tooHigh && (
        <p className="small drawback">
          Needs level {c.tooHigh.needs}; {checked.buildName} is level {c.tooHigh.level}.
        </p>
      )}
      {(checked.price || tradeUrl) && (
        <p className="small">
          {checked.price && <>Worth {checked.price} on poe.ninja. </>}
          {tradeUrl && (
            <button type="button" className="link" onClick={() => openLink(tradeUrl)}>
              Trade search
            </button>
          )}
        </p>
      )}
      {c.noDamage && <p className="muted small">The main skill deals no damage in Path of Building: judged by effective HP.</p>}
      {compact
        ? others.length > 0 && (
            <p className="muted small">
              Also fits {others.map((s) => `${s.slot} (${changeText(s, c.noDamage)})`).join("; ")}
            </p>
          )
        : c.slots.map((slot) => {
            const changes = diffStats(checked.trial.before, slot.stats);
            const { added, removed } = diffFindings(beforeFindings, checkBuild(slot.stats, checked.level));
            return (
              <div key={slot.slot} className="trial">
                <h4>
                  {slot.slot}
                  <span className="muted small"> {slot.replaces ? `replacing ${slot.replaces}` : "empty slot"}</span>
                </h4>
                {changes.length === 0 ? (
                  <p className="muted small">No headline stat changes.</p>
                ) : (
                  <StatChangeList changes={changes} />
                )}
                {(slot.drawbacks.length > 0 || added.length > 0 || removed.length > 0) && (
                  <ul className="findings">
                    {slot.drawbacks.map((d) => (
                      <li key={`d${d}`} className="warning">
                        <strong>{d}</strong>
                      </li>
                    ))}
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
    </div>
  );
}

const WATCH_HINT =
  "Hover an item in game and press Ctrl+C (or copy it on the trade site). Only item text is looked at; nothing is saved or sent.";

/** Item check in the main window: paste or watch the clipboard; full detail per slot. */
export function ItemCheckPanel(props: { ctx: CheckContext; disabled: boolean }) {
  const { ctx } = props;
  const [text, setText] = useState("");
  const [watching, setWatching] = useState(false);
  const [popError, setPopError] = useState("");
  const { checked, bodyPart, busy, error, check } = useItemCheck();
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const lastText = useRef<string | null>(null);
  const run = (item: string) => {
    lastText.current = item;
    void check(item, ctxRef.current);
  };

  useClipboardItems(watching, (copied) => {
    setText(copied);
    run(copied);
  });

  // Another calculation mode (goal or assumptions switch) or a new build version: check the item again.
  useEffect(() => {
    if (lastText.current) void check(lastText.current, ctxRef.current);
  }, [ctx.mode, ctx.code, check]);

  async function popOut() {
    setPopError("");
    try {
      await openItemCheckWindow();
      setWatching(false);
    } catch (e) {
      setPopError(`Couldn't open the item check window: ${message(e)}`);
    }
  }

  return (
    <section className="panel">
      <h3>Item check</h3>
      <p className="muted small">
        Is it an upgrade for this build? Paste an item, or let the app watch for items you copy. {WATCH_HINT}
      </p>
      <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Item text" />
      <div className="actions">
        <button type="button" onClick={() => run(text)} disabled={props.disabled || busy || !text.trim()}>
          {busy ? "Calculating…" : "Check"}
        </button>
        <label className="small">
          <input type="checkbox" checked={watching} onChange={(e) => setWatching(e.target.checked)} /> Watch the clipboard
        </label>
        {isTauri() && (
          <button type="button" className="secondary" onClick={popOut} title="A small window that stays on top of the game">
            Pop out on top of the game
          </button>
        )}
      </div>
      {isTauri() && (
        <p className="muted small">
          The pop-out stays over the game in windowed or windowed fullscreen mode (not exclusive fullscreen).
        </p>
      )}
      {popError && <p className="error">{popError}</p>}
      {error && <p className="error">{error}</p>}
      {checked && <CheckResult checked={checked} goal={ctx.goal} />}
      {bodyPart && <CandidateView v={bodyPart} />}
    </section>
  );
}

/**
 * The small always-on-top window (opened from the main window): watches the
 * clipboard and checks each copied item against the build selected in the
 * main window, with the goal chosen there.
 */
export function ItemCheckWindow() {
  const [store, setStore] = useState<BuildStore | null>(null);
  const [watching, setWatching] = useState(true);
  const [goal, setGoal] = useState<Goal>(savedGoal());
  const [noBuild, setNoBuild] = useState(false);
  const [startError, setStartError] = useState("");
  const { checked, bodyPart, busy, error, check } = useItemCheck();

  useEffect(() => {
    document.title = "POE Cheetah · Item check";
    if (!isTauri()) {
      setStartError("This window works in the app only; in the browser preview, use the main window's Item check.");
      return;
    }
    openDb()
      .then((db) => setStore(sqlBuildStore(db)))
      .catch((e) => setStartError(message(e)));
  }, []);

  // The build and settings are read for every item, so switching them in the main window applies at once.
  const checkActive = useCallback(
    async (text: string) => {
      if (!store) return;
      const id = await store.activeId();
      const build = (await store.list()).find((b) => b.id === id);
      setNoBuild(!build);
      if (!build) return;
      const g = savedGoal();
      setGoal(g);
      await check(text, {
        buildId: build.id,
        buildName: build.name,
        code: build.latest.code,
        level: build.latest.summary.level,
        goal: g,
        mode: modeFor(g, savedCountAssumptions()),
        league: savedLeague() ?? "",
      });
    },
    [store, check],
  );

  useClipboardItems(watching && store !== null, (text) => void checkActive(text));

  const lastText = checked?.text;
  useEffect(
    () =>
      onSettingsChanged(() => {
        if (lastText) void checkActive(lastText);
        else setGoal(savedGoal());
      }),
    [lastText, checkActive],
  );

  return (
    <div className="popout">
      <div className="actions">
        <label className="small">
          <input type="checkbox" checked={watching} onChange={(e) => setWatching(e.target.checked)} /> Watch the clipboard
        </label>
        {busy && <span className="busy small">Calculating…</span>}
      </div>
      {startError && <p className="error">{startError}</p>}
      {noBuild && <p className="error">Add a build in the main window first.</p>}
      {error && <p className="error">{error}</p>}
      {bodyPart && <CandidateView v={bodyPart} />}
      {checked ? (
        <>
          <p className="muted small">For {checked.buildName}</p>
          <CheckResult checked={checked} goal={goal} compact />
        </>
      ) : bodyPart ? null : (
        <p className="muted small">{watching ? WATCH_HINT : "Not watching the clipboard."}</p>
      )}
    </div>
  );
}
