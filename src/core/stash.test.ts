import { describe, expect, it } from "vitest";
import { UniquePrices } from "./market";
import {
  comparable,
  income,
  ninjaExchangeUrl,
  parseAccountName,
  parseExchange,
  parseStashItems,
  parseStashTabs,
  PriceBook,
  requestsLeft,
  valueTab,
  type Snapshot,
} from "./stash";
import exchange from "./__fixtures__/ninja-exchange-currency.json";
import tabsJson from "./__fixtures__/stash-tabs.json";
import itemsJson from "./__fixtures__/stash-items.json";

describe("poe.ninja exchange prices", () => {
  it("joins values to names, in chaos, leaving out what has no name or no value", () => {
    const prices = parseExchange(exchange);
    expect(Object.fromEntries(prices)).toEqual({
      "Chaos Orb": 1,
      "Divine Orb": 400,
      "Abyss Scarab of Descending": 2.5,
      "The Doctor": 900,
    });
    expect(() => parseExchange({ ...exchange, core: { primary: "divine" } })).toThrow("not chaos");
    expect(() => parseExchange({ lines: [] })).toThrow();
    expect(ninjaExchangeUrl("Some League", "Scarab")).toBe(
      "https://poe.ninja/poe1/api/economy/exchange/current/overview?league=Some%20League&type=Scarab",
    );
  });
});

describe("the stash", () => {
  it("reads tabs (hidden ones left out), items (markup removed) and the account name", () => {
    expect(parseStashTabs(tabsJson).map((t) => [t.index, t.name])).toEqual([
      [0, "Currency"],
      [1, "Dump"],
      [3, "Cards"],
    ]);
    const items = parseStashItems(itemsJson);
    expect(items[2]).toEqual({ name: "Cloak of Flame", typeLine: "Scholar's Robe", baseType: "Scholar's Robe", frameType: 3, stackSize: undefined });
    expect(parseAccountName({ accountName: "Some_Player#1234" })).toBe("Some_Player#1234");
    expect(() => parseAccountName({})).toThrow();
  });

  it("values a tab: stacks by count, uniques by name and base, rares unpriced", () => {
    const uniques = new UniquePrices([{ name: "Cloak of Flame", baseType: "Scholar's Robe", chaosValue: 45, listingCount: 100 }]);
    const book = new PriceBook(parseExchange(exchange), uniques);
    const v = valueTab({ index: 0, id: "aa11", name: "Currency", type: "CurrencyStash" }, parseStashItems(itemsJson), book);
    // 150 chaos + 3 × 400 + 45 + 4 × 2.5 + 2 × 900
    expect(v.chaos).toBeCloseTo(150 + 1200 + 45 + 10 + 1800);
    expect(v.priced).toBe(6);
    expect(v.unpriced).toBe(1);
    expect(v.top.map((l) => [l.name, l.count])).toEqual([
      ["The Doctor", 2],
      ["Divine Orb", 3],
      ["Chaos Orb", 150],
      ["Cloak of Flame", 1],
      ["Abyss Scarab of Descending", 4],
    ]);
  });
});

const snap = (minutes: number, total: number, tabs = [0, 3], league = "Some League"): Snapshot => ({
  at: Date.UTC(2026, 10, 3, 18, minutes),
  league,
  total,
  tabs: tabs.map((index) => ({ index, name: `Tab ${index}`, chaos: total / tabs.length })),
});

describe("income", () => {
  it("is the change over time, per hour, and per map from the run tracker", () => {
    const runs = [5, 15, 25].map((m) => ({ area: "Park", start: Date.UTC(2026, 10, 3, 18, m), end: Date.UTC(2026, 10, 3, 18, m + 8), active: 0, deaths: 0 }));
    const inc = income([snap(0, 1000), snap(30, 1300), snap(40, 1500)], runs)!;
    expect(inc.change).toBe(500);
    expect(inc.perHour).toBeCloseTo(750);
    expect(inc.lastChange).toBe(200);
    expect(inc.maps).toBe(3);
    expect(inc.perMap).toBeCloseTo(500 / 3);
    expect(income([snap(0, 1000)])).toBeNull();
  });

  it("compares only snapshots of the same league and tabs as the newest", () => {
    const list = [snap(0, 900, [0]), snap(10, 1000), snap(20, 1100), snap(30, 50, [0, 3], "Other")];
    expect(comparable(list).map((s) => s.total)).toEqual([50]);
    expect(comparable(list.slice(0, 3)).map((s) => s.total)).toEqual([1000, 1100]);
  });
});

describe("GGG's rate limits", () => {
  it("counts requests left under every rule, with a margin, and none during a penalty", () => {
    expect(requestsLeft("30:60:120,90:1800:600,180:7200:3600", "1:60:0,1:1800:0,1:7200:0")).toBe(27);
    expect(requestsLeft("30:60:120,90:1800:600,180:7200:3600", "10:60:0,87:1800:0,100:7200:0")).toBe(1);
    expect(requestsLeft("30:60:120", "30:60:118")).toBe(0);
    expect(requestsLeft(null, null)).toBe(Number.POSITIVE_INFINITY);
  });
});
