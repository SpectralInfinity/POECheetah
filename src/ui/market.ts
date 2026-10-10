import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  divinePrice,
  ninjaCurrencyUrl,
  ninjaItemsUrl,
  parseNinjaLines,
  pickLeagues,
  NINJA_LEAGUES_URL,
  UNIQUE_TYPES,
  UniquePrices,
  type NinjaCurrencyLine,
  type NinjaItemLine,
} from "../core/market";
import { isTauri } from "../data/db";
// Browser preview (`npm run dev`) has no network access through the app: the made-up test data stands in.
import previewCurrency from "../core/__fixtures__/ninja-currency.json";
import previewGems from "../core/__fixtures__/ninja-gems.json";
import previewUniques from "../core/__fixtures__/ninja-uniques.json";
import previewLeagues from "../core/__fixtures__/ninja-index-state.json";

/** poe.ninja updates hourly-ish; the design doc asks for at least 15 minutes of caching (§4). */
const CACHE_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; data: Promise<unknown> }>();

function preview(url: string): unknown {
  if (url === NINJA_LEAGUES_URL) return previewLeagues;
  if (url.includes("/currency/overview")) return previewCurrency;
  if (url.includes("type=SkillGem")) return previewGems;
  if (url.includes("type=UniqueArmour")) return previewUniques;
  return { lines: [] };
}

/** Public market JSON, fetched by the Rust shell (identified in its User-Agent) and cached. */
function getJson(url: string): Promise<unknown> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const data = isTauri()
    ? invoke<string>("market_get", { url }).then((text) => JSON.parse(text) as unknown)
    : Promise.resolve(preview(url));
  data.catch(() => cache.delete(url));
  cache.set(url, { at: Date.now(), data });
  return data;
}

export async function loadLeagues() {
  return pickLeagues(await getJson(NINJA_LEAGUES_URL));
}

export interface UniqueMarket {
  prices: UniquePrices;
  /** Chaos per divine orb, for showing big prices. */
  divine: number | null;
}

/** Every unique's price in `league` (five poe.ninja pages, one after another) and the divine price. */
export async function loadUniqueMarket(league: string): Promise<UniqueMarket> {
  const lines: NinjaItemLine[] = [];
  for (const type of UNIQUE_TYPES) lines.push(...parseNinjaLines<NinjaItemLine>(await getJson(ninjaItemsUrl(league, type))));
  const currency = parseNinjaLines<NinjaCurrencyLine>(await getJson(ninjaCurrencyUrl(league)));
  return { prices: new UniquePrices(lines), divine: divinePrice(currency) };
}

/** Skill and support gem prices in `league`. */
export async function loadGemPrices(league: string): Promise<{ gems: NinjaItemLine[]; divine: number | null }> {
  const gems = parseNinjaLines<NinjaItemLine>(await getJson(ninjaItemsUrl(league, "SkillGem")));
  const divine = divinePrice(parseNinjaLines<NinjaCurrencyLine>(await getJson(ninjaCurrencyUrl(league))));
  return { gems, divine };
}

/** Opens a web page (a trade search) in the player's browser. */
export async function openLink(url: string): Promise<void> {
  if (isTauri()) await openUrl(url);
  else window.open(url, "_blank", "noopener");
}

const LEAGUE_KEY = "poecheetah.league";

/** The league the player chose last time, if any. */
export function savedLeague(): string | null {
  try {
    return localStorage.getItem(LEAGUE_KEY);
  } catch {
    return null;
  }
}

export function saveLeague(league: string): void {
  try {
    localStorage.setItem(LEAGUE_KEY, league);
  } catch {
    // Not remembering the league is fine.
  }
}
