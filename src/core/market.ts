/**
 * Market data (design doc §3.2, §4): poe.ninja prices and the official trade
 * site's league list and search links. Prices are chaos orb equivalents.
 * Parsing only; fetching lives in the UI (`src/ui/market.ts`).
 */

/** One row of poe.ninja's `itemoverview` (uniques, gems). Fields it may omit are optional. */
export interface NinjaItemLine {
  name: string;
  baseType?: string;
  /** Linked sockets for body armours and two-handed weapons (5 or 6), absent otherwise. */
  links?: number;
  /** 3 = unique, 9 = relic (foil). */
  itemClass?: number;
  variant?: string | null;
  chaosValue: number;
  listingCount?: number;
  gemLevel?: number;
  gemQuality?: number;
  corrupted?: boolean;
}

/** One row of poe.ninja's `currencyoverview`. */
export interface NinjaCurrencyLine {
  currencyTypeName: string;
  chaosEquivalent: number;
}

/** poe.ninja's item pages the item upgrade advisor reads. */
export const UNIQUE_TYPES = ["UniqueWeapon", "UniqueArmour", "UniqueAccessory", "UniqueFlask", "UniqueJewel"] as const;

/** poe.ninja's PoE 1 API (it moved from `/api/data/`; checked 2026-10-10). */
const NINJA = "https://poe.ninja/poe1/api";
export const ninjaItemsUrl = (league: string, type: string) =>
  `${NINJA}/economy/stash/current/item/overview?league=${encodeURIComponent(league)}&type=${type}`;
export const ninjaCurrencyUrl = (league: string) =>
  `${NINJA}/economy/stash/current/currency/overview?league=${encodeURIComponent(league)}&type=Currency`;
/** poe.ninja's league list (the trade site's own list refuses requests without a login). */
export const NINJA_LEAGUES_URL = `${NINJA}/data/index-state`;

/** Reads poe.ninja's `{ lines: [...] }`, dropping rows without a name or price. */
export function parseNinjaLines<T extends { chaosValue?: number; chaosEquivalent?: number }>(json: unknown): T[] {
  const lines = (json as { lines?: unknown })?.lines;
  if (!Array.isArray(lines)) throw new Error("poe.ninja sent something unexpected (no price list)");
  return lines.filter(
    (l): l is T =>
      !!l &&
      typeof l === "object" &&
      typeof ((l as { name?: unknown }).name ?? (l as { currencyTypeName?: unknown }).currencyTypeName) === "string" &&
      typeof ((l as T).chaosValue ?? (l as T).chaosEquivalent) === "number",
  );
}

/**
 * The leagues poe.ninja prices (`economyLeagues` of its index state). The
 * current challenge league is the first that isn't Standard, Hardcore,
 * Ruthless or SSF.
 */
export function pickLeagues(json: unknown): { current: string | null; all: string[] } {
  const leagues = (json as { economyLeagues?: unknown })?.economyLeagues;
  if (!Array.isArray(leagues)) throw new Error("poe.ninja sent something unexpected (no league list)");
  const all = leagues.filter((l) => l && typeof l.name === "string").map((l) => l.name as string);
  const current = all.find((name) => !/^Standard$|Hardcore|HC\b|Ruthless|SSF/i.test(name)) ?? null;
  return { current, all };
}

export const divinePrice = (lines: NinjaCurrencyLine[]) =>
  lines.find((l) => l.currencyTypeName === "Divine Orb")?.chaosEquivalent ?? null;

/** A price the advisor shows, with how sure it is. */
export interface Price {
  chaos: number;
  /** Few listings: the price may be off. */
  thin: boolean;
  /** Extra words for the price, e.g. "unlinked" or "level 1". */
  note?: string;
}

/** Fewer listings than this and poe.ninja's price is a guess. */
const THIN_LISTINGS = 5;

const priceOf = (l: NinjaItemLine, note?: string): Price => ({
  chaos: l.chaosValue,
  thin: (l.listingCount ?? THIN_LISTINGS) < THIN_LISTINGS,
  ...(note ? { note } : {}),
});

const cheapest = (lines: NinjaItemLine[]) => lines.reduce<NinjaItemLine | null>((a, l) => (!a || l.chaosValue < a.chaosValue ? l : a), null);

const listed = (l: NinjaItemLine) => l.listingCount === undefined || l.listingCount > 0;

/**
 * Unique prices by name and base: the cheapest normal (not relic, not 5/6-linked)
 * listing. Foulborn (mutated) uniques are left out: Path of Building's unique
 * list doesn't have them, and their price depends on which mods mutated.
 */
export class UniquePrices {
  private byName = new Map<string, NinjaItemLine[]>();
  /** Foulborn listings left out. */
  readonly foulborn: number = 0;

  constructor(lines: NinjaItemLine[]) {
    let foulborn = 0;
    for (const l of lines) {
      if (/^Foulborn /.test(l.name)) {
        foulborn++;
        continue;
      }
      if (l.itemClass === 9 || !listed(l)) continue;
      const list = this.byName.get(l.name) ?? [];
      list.push(l);
      this.byName.set(l.name, list);
    }
    this.foulborn = foulborn;
  }

  /** Names with a price, for the engine to try. */
  names(): string[] {
    return [...this.byName.keys()].sort();
  }

  /** The price of `name` on `base` (any base when poe.ninja doesn't say); unlinked when there's a choice. */
  price(name: string, base?: string): Price | null {
    const lines = (this.byName.get(name) ?? []).filter((l) => !base || !l.baseType || l.baseType === base);
    const unlinked = cheapest(lines.filter((l) => !l.links || l.links < 5));
    if (unlinked) return priceOf(unlinked);
    const any = cheapest(lines);
    return any ? priceOf(any, `${any.links}-linked`) : null;
  }
}

/**
 * The price of a support gem at the level the engine calculated it (20, or 5
 * for an Awakened gem), uncorrupted; else level 1 to level up yourself. Null
 * when poe.ninja has no listing this league: the gem doesn't drop (e.g. most
 * Awakened supports since 3.25), so it isn't advice.
 */
export function gemPrice(lines: NinjaItemLine[], name: string, level: number): Price | null {
  const market = supportName(name);
  const own = lines.filter((l) => l.name === market && !l.corrupted && listed(l));
  const atLevel = cheapest(own.filter((l) => (l.gemLevel ?? 0) >= level));
  if (atLevel) return priceOf(atLevel);
  const low = cheapest(own);
  return low ? priceOf(low, `level ${low.gemLevel ?? 1}; level it to ${level}`) : null;
}

/** A support gem's market name: PoB says "Unbound Ailments", poe.ninja and the trade site "Unbound Ailments Support". */
export const supportName = (name: string) => (/ Support$/.test(name) ? name : `${name} Support`);

/** "40c", "0.5c" or, with a divine price, "3.5 div". */
export function formatPrice(chaos: number, divine: number | null): string {
  if (divine && chaos >= divine) return `${(chaos / divine).toFixed(chaos >= divine * 10 ? 0 : 1)} div`;
  if (chaos >= 10) return `${Math.round(chaos)}c`;
  return `${Math.round(chaos * 10) / 10}c`;
}

/** The trade site's search page for a query (`{ query, sort }`), opened in the browser. */
export function tradeSearchUrl(league: string, query: unknown): string {
  const q = typeof query === "string" ? query : JSON.stringify(query);
  return `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}?q=${encodeURIComponent(q)}`;
}

/** Trade search for a unique by name and base, instant buyout or in person, cheapest first. */
export function uniqueQuery(name: string, base: string) {
  return {
    query: { status: { option: "available" }, name, type: base, stats: [{ type: "and", filters: [] }] },
    sort: { price: "asc" },
  };
}

/** Trade search for an uncorrupted support gem of at least `level`, cheapest first. */
export function gemQuery(name: string, level: number) {
  return {
    query: {
      status: { option: "available" },
      type: supportName(name),
      stats: [{ type: "and", filters: [] }],
      filters: {
        misc_filters: { filters: { gem_level: { min: level }, corrupted: { option: "false" } } },
      },
    },
    sort: { price: "asc" },
  };
}
