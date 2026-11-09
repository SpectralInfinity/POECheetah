import { invoke } from "@tauri-apps/api/core";
import { formatPrice, ninjaItemsUrl, parseNinjaLines, type NinjaItemLine } from "../core/market";
import {
  EXCHANGE_TYPES,
  mergePrices,
  NAMED_ITEM_TYPES,
  ninjaExchangeUrl,
  parseAccountName,
  parseExchange,
  parseStashItems,
  parseStashTabs,
  PriceBook,
  requestsLeft,
  valueTab,
  type Snapshot,
  type StashTab,
  type TabValue,
} from "../core/stash";
import { isTauri } from "../data/db";
import { getJson, loadUniqueMarket } from "./market";
// Browser preview: made-up stash data stands in for pathofexile.com.
import previewTabs from "../core/__fixtures__/stash-tabs.json";
import previewItems from "../core/__fixtures__/stash-items.json";
import previewExchange from "../core/__fixtures__/ninja-exchange-currency.json";

// The owner's account, read with their session cookie (design doc §4,
// 2026-11-03). The cookie stays in the Rust shell's credential store.

export const sessionStatus = () => (isTauri() ? invoke<boolean>("poe_session_status") : Promise.resolve(previewConnected));
export const saveSession = (cookie: string) =>
  isTauri() ? invoke<void>("poe_session_set", { cookie }) : Promise.resolve(void (previewConnected = cookie.trim().length > 0));
export const forgetSession = () => (isTauri() ? invoke<void>("poe_session_clear") : Promise.resolve(void (previewConnected = false)));
let previewConnected = false;

/** GGG's rate-limit headers from the last account request. */
let rate: { rules?: string | null; state?: string | null } = {};

/** Requests GGG's limits allow now (with a margin). */
export const accountRequestsLeft = () => requestsLeft(rate.rules, rate.state);

async function accountGet(endpoint: string, query: [string, string][] = []): Promise<unknown> {
  if (!isTauri()) {
    if (endpoint === "get-account-name") return { accountName: "Preview_Player#1234" };
    return query.some(([k, v]) => k === "tabs" && v === "1") ? previewTabs : previewItems;
  }
  const r = await invoke<{ body: string; rateLimit: string | null; rateLimitState: string | null }>("poe_account_get", { endpoint, query });
  rate = { rules: r.rateLimit, state: r.rateLimitState };
  return JSON.parse(r.body);
}

export async function accountName(): Promise<string> {
  return parseAccountName(await accountGet("get-account-name"));
}

export async function stashTabs(league: string, account: string): Promise<StashTab[]> {
  return parseStashTabs(await accountGet("get-stash-items", [["accountName", account], ["realm", "pc"], ["league", league], ["tabs", "1"], ["tabIndex", "0"]]));
}

/** Every price a stash needs in `league`: poe.ninja's exchange pages, uniques, invitations; and the divine price. */
export async function priceBook(league: string): Promise<{ book: PriceBook; divine: number | null; skipped: string[] }> {
  const page = async (type: string, read: () => Promise<Map<string, number>>) => {
    try {
      return { type, prices: await read() };
    } catch (e) {
      return { type, prices: e instanceof Error ? e : new Error(String(e)) };
    }
  };
  const pages = [];
  for (const type of EXCHANGE_TYPES) {
    pages.push(await page(type, async () => parseExchange(isTauri() ? await getJson(ninjaExchangeUrl(league, type)) : previewExchange)));
  }
  for (const type of NAMED_ITEM_TYPES) {
    pages.push(
      await page(type, async () => {
        const lines = isTauri() ? parseNinjaLines<NinjaItemLine>(await getJson(ninjaItemsUrl(league, type))) : [];
        return new Map(lines.filter((l) => l.chaosValue > 0).map((l) => [l.name, l.chaosValue]));
      }),
    );
  }
  const { prices: stackables, skipped } = mergePrices(pages);
  if (stackables.size === 0) throw new Error(`poe.ninja has no prices for ${league} yet.`);
  const uniques = await loadUniqueMarket(league).catch(() => null);
  return {
    book: new PriceBook(stackables, uniques?.prices ?? null),
    divine: stackables.get("Divine Orb") ?? uniques?.divine ?? null,
    skipped: uniques ? skipped : [...skipped, "uniques"],
  };
}

/**
 * Reads and prices the chosen tabs (one request each, spaced by the Rust
 * shell). Stops before GGG's rate limit instead of hitting it.
 */
export async function takeSnapshot(
  league: string,
  account: string,
  tabs: StashTab[],
  book: PriceBook,
  progress: (text: string) => void,
): Promise<{ snapshot: Snapshot; values: TabValue[] }> {
  if (tabs.length > accountRequestsLeft()) {
    throw new Error(`pathofexile.com's rate limit allows ${accountRequestsLeft()} more requests now; ${tabs.length} tabs are chosen. Wait a few minutes or choose fewer tabs.`);
  }
  const values: TabValue[] = [];
  for (const [i, tab] of tabs.entries()) {
    progress(`Reading tab ${i + 1} of ${tabs.length}: ${tab.name}…`);
    const json = await accountGet("get-stash-items", [["accountName", account], ["realm", "pc"], ["league", league], ["tabs", "0"], ["tabIndex", String(tab.index)]]);
    values.push(valueTab(tab, parseStashItems(json), book));
  }
  const total = values.reduce((s, v) => s + v.chaos, 0);
  return { snapshot: { at: Date.now(), league, total, tabs: values.map((v) => ({ index: v.index, name: v.name, chaos: v.chaos })) }, values };
}

export const money = (chaos: number, divine: number | null) =>
  `${chaos < 0 ? "−" : ""}${formatPrice(Math.abs(chaos), divine)}`;
