import { describe, expect, it } from "vitest";
import type { Price } from "./market";
import { flaskAdvice, planUpgrades, type UniqueTrial, type UpgradeResult } from "./upgrades";

const before = { CombinedDPS: 1000, TotalEHP: 10_000, Life: 3000, FireResist: 75, Str: 100, ReqStr: 100 };

function trial(name: string, slot: string, stats: Record<string, number>, extra: Partial<UniqueTrial> = {}): UniqueTrial {
  return { name, base: "Base", slot, slotName: slot, replaces: "Old", level: 60, stats: { ...before, ...stats }, ...extra };
}

function result(uniques: UniqueTrial[], over: Partial<UpgradeResult> = {}): UpgradeResult {
  return {
    mode: "conservative",
    level: 90,
    before,
    slots: [
      { slot: "Ring 1", slotName: "Ring 1", item: "Old", links: 0 },
      { slot: "Ring 2", slotName: "Ring 2", item: "Old", links: 0 },
      { slot: "Body Armour", slotName: "Body Armour", item: "Six", links: 6 },
    ],
    uniques,
    missing: [],
    flasks: [],
    ...over,
  };
}

const table: Record<string, number> = { Cheap: 2, Pricey: 400, Body: 100, Glass: 5, High: 1, Weak: 1 };
const priceOf = (name: string): Price | null => (name in table ? { chaos: table[name], thin: false } : null);

describe("item upgrade advisor", () => {
  it("ranks uniques by gain per chaos, each item in its best slot", () => {
    const r = result([
      trial("Cheap", "Ring 1", { CombinedDPS: 1040 }),
      trial("Cheap", "Ring 2", { CombinedDPS: 1060 }),
      trial("Pricey", "Ring 1", { CombinedDPS: 1300 }),
      trial("Unknown", "Ring 1", { CombinedDPS: 2000 }),
      trial("Weak", "Ring 1", { CombinedDPS: 1005 }),
    ]);
    const plan = planUpgrades(r, "damage", priceOf);
    expect(plan.best.map((a) => [a.name, a.slot])).toEqual([
      ["Cheap", "Ring 2"],
      ["Pricey", "Ring 1"],
    ]);
    expect(plan.best[0].perChaos).toBeCloseTo(0.03);
    expect(plan.unpriced).toBe(1);
    expect(plan.noDamage).toBe(false);
    expect(plan.bySlot.find((s) => s.slot === "Ring 1")?.upgrades.map((a) => a.name)).toEqual(["Pricey", "Cheap"]);
  });

  it("respects a budget and the character's level", () => {
    const r = result([trial("Pricey", "Ring 1", { CombinedDPS: 1300 }), trial("High", "Ring 1", { CombinedDPS: 1100 }, { level: 95 })]);
    expect(planUpgrades(r, "damage", priceOf, { budget: 100 }).best).toEqual([]);
  });

  it("keeps items with drawbacks out of Balanced and Bossing, and flags them for Damage", () => {
    const r = result([trial("Glass", "Ring 1", { CombinedDPS: 1500, FireResist: 60, Str: 80 })]);
    expect(planUpgrades(r, "bossing", priceOf).best).toEqual([]);
    const [glass] = planUpgrades(r, "damage", priceOf).best;
    expect(glass.drawbacks).toEqual(["Fire res 75% → 60%", "Strength 80 of 100 needed"]);
  });

  it("notes when the slot's links aren't in the price", () => {
    const [body] = planUpgrades(result([trial("Body", "Body Armour", { TotalEHP: 12_000 })]), "defence", priceOf).best;
    expect(body.needsLinks).toBe(6);
  });

  it("finds the best flask prefix and suffix over the flask without mods", () => {
    const plain = { ...before, CombinedDPS: 900 };
    const r = result([], {
      flasks: [
        {
          slot: "Flask 2",
          slotName: "Flask 2",
          flask: "Quicksilver Flask of Adrenaline",
          active: true,
          plain,
          prefixes: [
            { modId: "A", lines: ["25% increased effect"], stats: { ...plain, CombinedDPS: 990 } },
            { modId: "B", lines: ["nothing"], stats: plain },
          ],
          suffixes: [{ modId: "C", lines: ["no gain"], stats: plain }],
        },
      ],
    });
    const [f] = flaskAdvice(r, "damage");
    expect(f.prefix?.lines).toEqual(["25% increased effect"]);
    expect(f.prefix?.gain).toBeCloseTo(0.1);
    expect(f.suffix).toBeNull();
    expect(f.current).toBeCloseTo(0.111, 2);
    expect(f.improvement).toBeLessThan(0);
  });
});
