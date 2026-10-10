import { describe, expect, it } from "vitest";
import currency from "./__fixtures__/ninja-currency.json";
import gems from "./__fixtures__/ninja-gems.json";
import uniques from "./__fixtures__/ninja-uniques.json";
import leagues from "./__fixtures__/ninja-index-state.json";
import {
  divinePrice,
  formatPrice,
  gemPrice,
  ninjaCurrencyUrl,
  ninjaItemsUrl,
  gemQuery,
  parseNinjaLines,
  pickLeagues,
  tradeSearchUrl,
  UniquePrices,
  uniqueQuery,
  type NinjaCurrencyLine,
  type NinjaItemLine,
} from "./market";

const gemLines = parseNinjaLines<NinjaItemLine>(gems);
const prices = new UniquePrices(parseNinjaLines<NinjaItemLine>(uniques));

describe("market data", () => {
  it("picks the current challenge league from poe.ninja's league list", () => {
    const { current, all } = pickLeagues(leagues);
    expect(current).toBe("Mercenaries");
    expect(all).toEqual(["Mercenaries", "Hardcore Mercenaries", "Standard", "Hardcore"]);
    expect(pickLeagues({ economyLeagues: [{ name: "SSF Allflame" }, { name: "Standard" }] }).current).toBeNull();
    expect(() => pickLeagues({ error: "x" })).toThrow(/league list/);
  });

  it("uses poe.ninja's PoE 1 API addresses", () => {
    expect(ninjaItemsUrl("Hardcore Allflame", "SkillGem")).toBe(
      "https://poe.ninja/poe1/api/economy/stash/current/item/overview?league=Hardcore%20Allflame&type=SkillGem",
    );
    expect(ninjaCurrencyUrl("Allflame")).toBe(
      "https://poe.ninja/poe1/api/economy/stash/current/currency/overview?league=Allflame&type=Currency",
    );
  });

  it("drops malformed poe.ninja rows and rejects a page without lines", () => {
    expect(gemLines).toHaveLength(6);
    expect(() => parseNinjaLines({})).toThrow(/price list/);
  });

  it("prices uniques by name and base, unlinked and not relics", () => {
    expect(prices.price("Kaom's Heart", "Glorious Plate")).toEqual({ chaos: 150, thin: false });
    expect(prices.price("Precursor's Emblem", "Two-Stone Ring")?.chaos).toBe(25);
    expect(prices.price("Precursor's Emblem", "Topaz Ring")).toEqual({ chaos: 8, thin: true });
    expect(prices.price("Tabula Rasa", "Simple Robe")).toEqual({ chaos: 10, thin: false, note: "6-linked" });
    expect(prices.price("Headhunter", "Leather Belt")).toBeNull();
    // Foulborn (mutated) uniques aren't in Path of Building's list.
    expect(prices.names()).toEqual(["Kaom's Heart", "Le Heup of All", "Precursor's Emblem", "Tabula Rasa"]);
    expect(prices.foulborn).toBe(1);
  });

  it("prices support gems uncorrupted at the calculated level, and finds those nobody sells", () => {
    expect(gemPrice(gemLines, "Unbound Ailments Support", 20)?.chaos).toBe(4);
    // PoB's gem names leave out "Support".
    expect(gemPrice(gemLines, "Unbound Ailments", 20)?.chaos).toBe(4);
    expect(gemPrice(gemLines, "Awakened Deadly Ailments Support", 5)).toEqual({
      chaos: 30,
      thin: false,
      note: "level 1; level it to 5",
    });
    expect(gemPrice(gemLines, "Awakened Empower Support", 4)).toEqual({ chaos: 900, thin: true });
    // Only a corrupted copy with no listings: not obtainable this league.
    expect(gemPrice(gemLines, "Awakened Greater Multiple Projectiles Support", 5)).toBeNull();
    expect(gemPrice(gemLines, "Made Up Support", 20)).toBeNull();
  });

  it("formats prices in chaos or divines", () => {
    const divine = divinePrice(parseNinjaLines<NinjaCurrencyLine>(currency));
    expect(divine).toBe(200);
    expect(formatPrice(0.5, divine)).toBe("0.5c");
    expect(formatPrice(42.4, divine)).toBe("42c");
    expect(formatPrice(300, divine)).toBe("1.5 div");
    expect(formatPrice(4000, divine)).toBe("20 div");
    expect(formatPrice(4000, null)).toBe("4000c");
  });

  it("builds trade site search links", () => {
    const url = tradeSearchUrl("Hardcore Mercenaries", uniqueQuery("Kaom's Heart", "Glorious Plate"));
    expect(url.startsWith("https://www.pathofexile.com/trade/search/Hardcore%20Mercenaries?q=")).toBe(true);
    const q = JSON.parse(decodeURIComponent(url.split("?q=")[1]));
    expect(q.query).toMatchObject({ name: "Kaom's Heart", type: "Glorious Plate", status: { option: "available" } });
    const gem = gemQuery("Unbound Ailments", 20).query;
    expect(gem.type).toBe("Unbound Ailments Support");
    expect(gem.filters.misc_filters.filters.gem_level.min).toBe(20);
    expect(tradeSearchUrl("Standard", '{"query":{}}')).toContain("?q=%7B%22query%22");
  });
});
