import type { UniquePrices } from "./market";
import type { Run } from "./gamelog";

// Earnings (design doc §3.5): the owner's stash, read from pathofexile.com's
// account pages with their session cookie, priced with poe.ninja, as
// snapshots over time; income per hour and per map from them and the run
// tracker (§3.4). Parsing and arithmetic only; fetching is in the UI.

// --- poe.ninja's exchange prices (stackables) ----------------------------------

/** poe.ninja's exchange pages (2026-11-03): its item pages answer 404 for these now. */
export const EXCHANGE_TYPES = [
  "Currency",
  "Fragment",
  "DivinationCard",
  "Scarab",
  "Essence",
  "Fossil",
  "Resonator",
  "Oil",
  "Omen",
  "DeliriumOrb",
  "Tattoo",
  "Artifact",
] as const;

/** Item pages that still answer, priced by name (2026-11-03). */
export const NAMED_ITEM_TYPES = ["Invitation"] as const;

export const ninjaExchangeUrl = (league: string, type: string) =>
  `https://poe.ninja/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(league)}&type=${type}`;

/**
 * Reads an exchange page: `lines` (id → value in the primary currency) joined
 * with `items` (id → name). Values must be in chaos, as poe.ninja's
 * `core.primary` says (2026-11-03).
 */
export function parseExchange(json: unknown): Map<string, number> {
  const d = json as { core?: { primary?: string }; lines?: { id: string; primaryValue: number }[]; items?: { id: string; name: string }[] };
  if (!Array.isArray(d?.lines) || !Array.isArray(d?.items)) throw new Error("poe.ninja sent something unexpected (no exchange prices)");
  if (d.core?.primary && d.core.primary !== "chaos") throw new Error(`poe.ninja's exchange prices are in ${d.core.primary}, not chaos`);
  const names = new Map(d.items.map((i) => [i.id, i.name]));
  const out = new Map<string, number>();
  for (const l of d.lines) {
    const name = names.get(l.id);
    if (name && typeof l.primaryValue === "number" && l.primaryValue > 0) out.set(name, l.primaryValue);
  }
  return out;
}

// --- The stash, as pathofexile.com's account pages give it --------------------------

export interface StashTab {
  index: number;
  id: string;
  name: string;
  type: string;
}

export interface StashItem {
  name: string;
  typeLine: string;
  baseType?: string;
  /** 0 normal, 1 magic, 2 rare, 3 unique, 4 gem, 5 currency, 6 divination card… */
  frameType: number;
  stackSize?: number;
}

/** `get-stash-items?tabs=1`: the tab list. */
export function parseStashTabs(json: unknown): StashTab[] {
  const tabs = (json as { tabs?: { i: number; id: string; n: string; type: string; hidden?: boolean }[] })?.tabs;
  if (!Array.isArray(tabs)) throw new Error("pathofexile.com sent something unexpected (no stash tabs)");
  return tabs.filter((t) => !t.hidden).map((t) => ({ index: t.i, id: t.id, name: t.n, type: t.type }));
}

/** `get-stash-items?tabIndex=N`: the tab's items. Names lose the old `<<set:…>>` markup. */
export function parseStashItems(json: unknown): StashItem[] {
  const items = (json as { items?: Record<string, unknown>[] })?.items;
  if (!Array.isArray(items)) throw new Error("pathofexile.com sent something unexpected (no items)");
  const clean = (s: unknown) => (typeof s === "string" ? s.replace(/<<[^>]*>>/g, "").trim() : "");
  return items.map((i) => ({
    name: clean(i.name),
    typeLine: clean(i.typeLine),
    baseType: clean(i.baseType) || undefined,
    frameType: typeof i.frameType === "number" ? i.frameType : 0,
    stackSize: typeof i.stackSize === "number" ? i.stackSize : undefined,
  }));
}

/** `get-account-name`: the account name (with its "#1234" since 2023). */
export function parseAccountName(json: unknown): string {
  const name = (json as { accountName?: unknown })?.accountName;
  if (typeof name !== "string" || !name) throw new Error("pathofexile.com didn't say the account name");
  return name;
}

// --- Prices ------------------------------------------------------------------------

/** Every price the stash needs: stackables by name, uniques by name and base. */
export class PriceBook {
  constructor(
    private readonly stackables: Map<string, number>,
    private readonly uniques: UniquePrices | null,
  ) {}

  /** One item's unit price in chaos; null when poe.ninja doesn't price it (rares, gems, maps…). */
  unit(item: StashItem): number | null {
    if (item.frameType === 3) return this.uniques?.price(item.name, item.baseType)?.chaos ?? null;
    if (item.frameType === 2 || item.frameType === 1 || item.frameType === 4) return null;
    return this.stackables.get(item.typeLine) ?? (item.baseType ? this.stackables.get(item.baseType) : undefined) ?? null;
  }
}

export interface TabValue {
  index: number;
  name: string;
  /** Total in chaos. */
  chaos: number;
  /** Items priced, and items poe.ninja has no price for (counted at nothing). */
  priced: number;
  unpriced: number;
  /** The most valuable lines: name, count and total. */
  top: { name: string; count: number; chaos: number }[];
}

export function valueTab(tab: StashTab, items: StashItem[], book: PriceBook): TabValue {
  const lines = new Map<string, { name: string; count: number; chaos: number }>();
  let priced = 0;
  let unpriced = 0;
  for (const item of items) {
    const unit = book.unit(item);
    if (unit === null) {
      unpriced++;
      continue;
    }
    priced++;
    const count = item.stackSize ?? 1;
    const name = item.frameType === 3 ? item.name : item.typeLine;
    const line = lines.get(name) ?? { name, count: 0, chaos: 0 };
    line.count += count;
    line.chaos += unit * count;
    lines.set(name, line);
  }
  const top = [...lines.values()].sort((a, b) => b.chaos - a.chaos);
  return { index: tab.index, name: tab.name, chaos: top.reduce((s, l) => s + l.chaos, 0), priced, unpriced, top: top.slice(0, 5) };
}

// --- Snapshots and income ------------------------------------------------------------

export interface Snapshot {
  id?: number;
  /** When it was taken (ms). */
  at: number;
  league: string;
  /** Total of the chosen tabs, in chaos. */
  total: number;
  tabs: { index: number; name: string; chaos: number }[];
}

export interface Income {
  /** Change from the first to the last snapshot, and per hour. */
  change: number;
  perHour: number;
  /** Change since the snapshot before the last one. */
  lastChange: number | null;
  /** Per map: the change over the snapshots' span divided by the maps run in it (run tracker). */
  perMap: number | null;
  maps: number;
}

/**
 * Income from snapshots of the same tabs (design doc §3.5): the change in
 * value over time. Only snapshots of the same league and the same tab
 * choice compare; moving items between chosen and other tabs, or trading
 * them away, looks like income or loss too.
 */
export function income(snapshots: Snapshot[], runs: Run[] = []): Income | null {
  const list = [...snapshots].sort((a, b) => a.at - b.at);
  if (list.length < 2) return null;
  const first = list[0];
  const last = list[list.length - 1];
  const hours = (last.at - first.at) / 3_600_000;
  const change = last.total - first.total;
  const maps = runs.filter((r) => r.start >= first.at && r.end <= last.at).length;
  return {
    change,
    perHour: hours > 0 ? change / hours : 0,
    lastChange: last.total - list[list.length - 2].total,
    perMap: maps > 0 ? change / maps : null,
    maps,
  };
}

/** Snapshots that compare with the newest: same league and same tabs. */
export function comparable(snapshots: Snapshot[]): Snapshot[] {
  const list = [...snapshots].sort((a, b) => a.at - b.at);
  const last = list[list.length - 1];
  if (!last) return [];
  const key = (s: Snapshot) => `${s.league}|${s.tabs.map((t) => t.index).sort((a, b) => a - b).join(",")}`;
  return list.filter((s) => key(s) === key(last));
}

// --- GGG's rate limits ------------------------------------------------------------------

/**
 * How many more requests GGG's limits allow now, from `X-Rate-Limit-Ip`
 * ("30:60:120,90:1800:600,…": hits:period:penalty) and its `-State`
 * ("1:60:0,…": hits so far). The app keeps a margin of 2 per rule.
 */
export function requestsLeft(rules: string | null | undefined, state: string | null | undefined, margin = 2): number {
  if (!rules || !state) return Number.POSITIVE_INFINITY;
  const max = rules.split(",").map((r) => Number(r.split(":")[0]));
  const used = state.split(",").map((r) => Number(r.split(":")[0]));
  const penalty = state.split(",").some((r) => Number(r.split(":")[2]) > 0);
  if (penalty) return 0;
  return Math.max(0, Math.min(...max.map((m, i) => m - (used[i] ?? 0) - margin)));
}
