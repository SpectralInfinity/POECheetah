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
import { dictionaryUrl, ladderFor, ladderSearchUrl, parseDictionary, parseLadderSearch, type LadderSearch } from "../core/ladder";
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
export function getJson(url: string): Promise<unknown> {
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

const bytesCache = new Map<string, { at: number; data: Promise<Uint8Array> }>();

/** Public binary market data (poe.ninja's ladder search and name lists), fetched by the Rust shell and cached. */
function getBytes(url: string): Promise<Uint8Array> {
  const hit = bytesCache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const data = invoke<number[]>("market_get_bytes", { url }).then((b) => new Uint8Array(b));
  data.catch(() => bytesCache.delete(url));
  bytesCache.set(url, { at: Date.now(), data });
  return data;
}

export interface Ladder {
  search: LadderSearch;
  /** Names by dictionary type (item, keypassive, gem, anointed). */
  names: Map<string, string[]>;
  /** The ladder's name in poe.ninja's addresses, for character links. */
  overview: string;
  /** The filter that found characters: the skill with the ascendancy, else the skill alone. */
  filter: { ascendancy?: string; skill: string };
}

const DICTIONARIES = ["item", "keypassive", "gem", "anointed"];

/** poe.ninja's ladder for characters using `skill` (with `ascendancy` when any do), and the names it needs. */
export async function loadLadder(league: string, ascendancy: string, skill: string): Promise<Ladder> {
  if (!isTauri()) return previewLadder(ascendancy, skill);
  const ladder = ladderFor(await getJson(NINJA_LEAGUES_URL), league);
  if (!ladder) throw new Error(`poe.ninja has no ladder for ${league}.`);
  let filter: Ladder["filter"] = { ascendancy, skill };
  let search = parseLadderSearch(await getBytes(ladderSearchUrl(ladder, filter)));
  if (search.total === 0) {
    filter = { skill };
    search = parseLadderSearch(await getBytes(ladderSearchUrl(ladder, filter)));
  }
  const names = new Map<string, string[]>();
  for (const type of DICTIONARIES) {
    const hash = search.dictionaries.get(type);
    if (hash) names.set(type, parseDictionary(await getBytes(dictionaryUrl(hash))));
  }
  return { search, names, overview: ladder.overview, filter };
}

/** Browser preview: a made-up ladder of 20 characters. */
function previewLadder(ascendancy: string, skill: string): Ladder {
  const entries = (counts: number[]) => counts.map((count, index) => ({ index, count }));
  const search: LadderSearch = {
    total: 20,
    dimensions: new Map([
      ["items", { dictionary: "item", entries: entries([18, 9, 7, 5]) }],
      ["keypassives", { dictionary: "keypassive", entries: entries([18, 11]) }],
      [`supportgems-${skill}`, { dictionary: "gem", entries: entries([19, 4]) }],
      ["anointed", { dictionary: "anointed", entries: entries([4]) }],
    ]),
    dictionaries: new Map(),
    characters: [
      { name: "Preview_One", account: "Someone-1234", level: 98, dps: "4.4M", ehp: "74k" },
      { name: "Preview_Two", account: "Other-0001", level: 97, dps: "2.1M", ehp: "179k" },
    ],
  };
  const names = new Map([
    ["item", ["Cloak of Flame", "Asenath's Gentle Touch", "The Writhing Jar", "Snakebite"]],
    ["keypassive", ["Armour Display", "Magebane"]],
    ["gem", ["Unbound Ailments Support", "Vicious Projectiles Support"]],
    ["anointed", ["Whispers of Doom"]],
  ]);
  return { search, names, overview: "preview", filter: { ascendancy, skill } };
}
