import { useState } from "react";
import { goalLabel, searchWeights, type Goal, type Mode } from "../core/goals";
import { formatPrice, tradeSearchUrl, uniqueQuery } from "../core/market";
import { flaskAdvice, planUpgrades, type UpgradeAdvice, type UpgradeResult } from "../core/upgrades";
import { MODE_TEXT, message, signed } from "./format";
import { loadUniqueMarket, openLink, type UniqueMarket } from "./market";

export type RareSearchFn = (
  mode: Mode,
  slot: string,
  weights: { stat: string; weightMult: number }[],
) => Promise<{ slot: string; query: string }>;

interface Run {
  result: UpgradeResult;
  market: UniqueMarket;
  league: string;
}

/** Item upgrade advisor (design doc §3.2): priced uniques, flask mods, PoB's weighted rare search. */
export function ItemUpgrades(props: {
  goal: Goal;
  mode: Mode;
  league: string;
  disabled: boolean;
  onRun: (mode: Mode, uniques: string[]) => Promise<UpgradeResult>;
  onRareSearch: RareSearchFn;
}) {
  const { goal, mode, league } = props;
  const [runs, setRuns] = useState<Partial<Record<Mode, Run>>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [budget, setBudget] = useState("");

  async function run() {
    setError("");
    try {
      if (!league) throw new Error("Choose a league for prices first.");
      setBusy(`Loading ${league} prices from poe.ninja…`);
      const market = await loadUniqueMarket(league);
      setBusy("Trying every priced unique in your slots with Path of Building…");
      const result = await props.onRun(mode, market.prices.names());
      setRuns((all) => ({ ...all, [mode]: { result, market, league } }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }

  const current = runs[mode];
  const max = Number(budget);
  const plan =
    current &&
    planUpgrades(current.result, goal, (n, b) => current.market.prices.price(n, b), {
      budget: budget.trim() && max > 0 ? max : undefined,
    });
  const flasks = current ? flaskAdvice(current.result, goal) : [];
  const price = (chaos: number) => formatPrice(chaos, current?.market.divine ?? null);

  return (
    <section className="panel">
      <h3>Item upgrades · {goalLabel(goal)}</h3>
      {!current && (
        <>
          <p className="muted small">
            Tries every unique poe.ninja prices in {league || "the chosen league"} in each of your slots with Path of
            Building, {MODE_TEXT[mode]}, and ranks them by gain per chaos. Also ranks magic flask mods and makes Path
            of Building's weighted trade search for rares. Takes up to a minute.
          </p>
          <div className="actions">
            <button type="button" onClick={run} disabled={props.disabled || busy !== ""}>
              {busy ? "Working…" : "Find upgrades"}
            </button>
          </div>
        </>
      )}
      {busy && <p className="muted small">{busy}</p>}
      {error && <p className="error">{error}</p>}
      {current && plan && (
        <>
          <label className="small">
            Most I'd pay per item (chaos):{" "}
            <input
              className="budget"
              inputMode="numeric"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="any"
              aria-label="Budget in chaos"
            />
          </label>
          {plan.noDamage && goal !== "defence" && (
            <p className="small">
              Your main skill deals no damage in Path of Building, so only effective HP counts here. To rank damage,
              choose your damage skill as the main skill in Path of Building and paste the code again.
            </p>
          )}
          <h4>Best buys for the price</h4>
          {plan.best.length === 0 ? (
            <p className="small">No priced unique improves this goal by 1% or more{goal === "balanced" || goal === "bossing" ? " without a cost" : ""}.</p>
          ) : (
            <ol className="passives">
              {plan.best.map((a) => (
                <Upgrade key={`${a.name}|${a.base}`} a={a} price={price} league={current.league} />
              ))}
            </ol>
          )}
          <details>
            <summary className="small">Biggest gain per slot, any price</summary>
            {plan.bySlot.map((s) => (
              <div key={s.slotName}>
                <h4>
                  {s.slot} <span className="muted small">{s.current ?? "empty"}</span>
                </h4>
                <ul className="passives">
                  {s.upgrades.map((a) => (
                    <Upgrade key={`${a.name}|${a.base}`} a={a} price={price} league={current.league} />
                  ))}
                </ul>
              </div>
            ))}
          </details>
          {flasks.length > 0 && (
            <>
              <h4>Flask mods</h4>
              <p className="muted small">
                Path of Building doesn't value movement speed, ailment immunity or charge gain: keep the mods you need
                for those. It counts every flask as always active.
              </p>
              <ul className="passives">
                {flasks.map((f) => (
                  <li key={f.slot} className="passive">
                    <div>
                      <strong>{f.slot}</strong> <span className="muted small">{f.flask}{f.active ? "" : " (not active in PoB)"}</span>
                    </div>
                    {!f.prefix && !f.suffix ? (
                      <div className="muted small">No mod changes this goal for this flask in Path of Building.</div>
                    ) : (
                      <>
                        {f.prefix && (
                          <div className="small">
                            Best prefix: {f.prefix.lines.join("; ")} <span className="gain">{signed(f.prefix.gain)}</span>
                          </div>
                        )}
                        {f.suffix && (
                          <div className="small">
                            Best suffix: {f.suffix.lines.join("; ")} <span className="gain">{signed(f.suffix.gain)}</span>
                          </div>
                        )}
                        <div className="muted small">
                          {f.improvement > 0.005
                            ? `About ${signed(f.improvement)} over your current mods (each mod measured alone). Magic flasks are cheap: craft or buy one.`
                            : "Your current mods are as good or better."}
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          <RareSearch
            result={current.result}
            goal={goal}
            mode={mode}
            league={current.league}
            disabled={props.disabled}
            onSearch={props.onRareSearch}
          />
          <p className="muted small">
            Calculated {MODE_TEXT[current.result.mode]}. Prices from poe.ninja ({current.league}); uniques at average
            rolls. Cluster and timeless jewels aren't tried (they reshape the tree).
            {current.result.missing.length > 0 &&
              ` ${current.result.missing.length} uniques poe.ninja lists aren't in the bundled Path of Building.`}
            {current.market.prices.foulborn > 0 &&
              ` Foulborn uniques (${current.market.prices.foulborn} listings) aren't tried: Path of Building's list doesn't have them.`}
          </p>
          <div className="actions">
            <button type="button" className="link" onClick={run} disabled={props.disabled || busy !== ""}>
              {busy ? "Working…" : "Calculate again"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function Upgrade({ a, price, league }: { a: UpgradeAdvice; price: (c: number) => string; league: string }) {
  return (
    <li className={a.drawbacks.length ? "passive warn" : "passive"}>
      <div>
        <strong>{a.slot}:</strong> {a.name} <span className="muted small">{a.base}</span>
      </div>
      <div className="small gain">
        {signed(a.dps)} DPS, {signed(a.ehp)} effective HP for ~{price(a.price.chaos)}
        {a.price.note && <span className="muted"> ({a.price.note})</span>}
        {a.price.thin && <span className="muted"> (few listed, price uncertain)</span>}{" "}
        <button type="button" className="link" onClick={() => openLink(tradeSearchUrl(league, uniqueQuery(a.name, a.base))).catch(() => {})}>
          Trade
        </button>
      </div>
      <div className="muted small">Replaces {a.replaces ?? "nothing (empty slot)"}</div>
      {a.needsLinks > 0 && <div className="muted small">Price is unlinked; your {a.slot.toLowerCase()} has {a.needsLinks} links.</div>}
      {a.drawbacks.length > 0 && <div className="small drawback">Costs: {a.drawbacks.join(", ")}</div>}
    </li>
  );
}

function RareSearch(props: {
  result: UpgradeResult;
  goal: Goal;
  mode: Mode;
  league: string;
  disabled: boolean;
  onSearch: RareSearchFn;
}) {
  const slots = props.result.slots;
  const [slot, setSlot] = useState(slots[0]?.slotName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function search() {
    setBusy(true);
    setError("");
    try {
      const { query } = await props.onSearch(props.mode, slot, searchWeights(props.goal));
      await openLink(tradeSearchUrl(props.league, query));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h4>Rares</h4>
      <p className="muted small">
        Path of Building weighs every trade mod by what it adds to your build ({goalLabel(props.goal)}) and opens the
        trade site with that weighted search, best matches first.
      </p>
      <div className="actions">
        <select value={slot} onChange={(e) => setSlot(e.target.value)} aria-label="Slot">
          {slots.map((s) => (
            <option key={s.slotName} value={s.slotName}>
              {s.slot}
              {s.item ? ` (${s.item})` : ""}
            </option>
          ))}
        </select>
        <button type="button" onClick={search} disabled={props.disabled || busy || !slot}>
          {busy ? "Weighing mods…" : "Search the trade site"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </>
  );
}
