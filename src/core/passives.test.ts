import { describe, expect, it } from "vitest";
import { drawbacks, planPassives, type PassiveCandidate, type PassiveResult } from "./passives";

const before = { CombinedDPS: 1000, TotalEHP: 10_000, Life: 3000, FireResist: 75, ColdResist: 75, ChaosResist: 20 };

let nextId = 1;
function node(over: Partial<PassiveCandidate> & { stats: Record<string, number> }): PassiveCandidate {
  const { stats, ...rest } = over;
  return { id: nextId++, kind: "notable", name: `Node ${nextId}`, lines: [], points: 1, via: [], ...rest, stats: { ...before, ...stats } };
}

function result(candidates: PassiveCandidate[], masterySwaps: PassiveCandidate[] = []): PassiveResult {
  return { before, level: 90, pointsUsed: 110, extraPoints: 2, ascendancyUsed: 6, candidates, masterySwaps };
}

describe("passive advisor", () => {
  it("ranks by gain per point, path included", () => {
    const near = node({ name: "Near", points: 1, stats: { CombinedDPS: 1040 } });
    const far = node({ name: "Far", points: 4, stats: { CombinedDPS: 1120 } });
    const big = node({ name: "Big", points: 2, stats: { CombinedDPS: 1100 } });
    const plan = planPassives(result([far, near, big]), "damage");
    expect(plan.passives.map((p) => p.name)).toEqual(["Big", "Near", "Far"]);
    expect(plan.passives[0].score).toBeCloseTo(0.05);
    expect(plan.passives[2].dps).toBeCloseTo(0.12);
  });

  it("switches goal: defence ranks by effective HP, balanced averages both", () => {
    const dmg = node({ name: "Dmg", stats: { CombinedDPS: 1100 } });
    const life = node({ name: "Life", stats: { TotalEHP: 10_500, Life: 3150 } });
    const both = node({ name: "Both", stats: { CombinedDPS: 1060, TotalEHP: 10_600 } });
    const r = result([dmg, life, both]);
    expect(planPassives(r, "damage").passives.map((p) => p.name)).toEqual(["Dmg", "Both"]);
    expect(planPassives(r, "defence").passives.map((p) => p.name)).toEqual(["Both", "Life"]);
    expect(planPassives(r, "balanced").passives.map((p) => p.name)).toEqual(["Both", "Dmg", "Life"]);
  });

  it("never recommends a resist drop or a sharp life loss for Balanced, and flags them otherwise", () => {
    const keystone = node({ name: "Glass", kind: "keystone", stats: { CombinedDPS: 1500, Life: 1, TotalEHP: 4000 } });
    const resist = node({ name: "Cold", stats: { CombinedDPS: 1200, ColdResist: 60 } });
    const r = result([keystone, resist]);
    expect(planPassives(r, "balanced").passives).toEqual([]);
    const damage = planPassives(r, "damage").passives;
    expect(damage.map((p) => p.name)).toEqual(["Glass", "Cold"]);
    expect(damage[0].drawbacks).toEqual(["Life −100%", "Effective HP −60%"]);
    expect(damage[1].drawbacks).toEqual(["Cold res 75% → 60%"]);
  });

  it("lists drawbacks only for real losses", () => {
    expect(drawbacks(before, { ...before, Life: 2900, FireResist: 74.6 })).toEqual([]);
    expect(drawbacks(before, { ...before, ChaosResist: -10 })).toEqual(["Chaos res 20% → -10%"]);
  });

  it("keeps a mastery's best effect, leaves out what gains nothing, and separates ascendancy and swaps", () => {
    const mastery = [
      node({ kind: "mastery", name: "Life Mastery", stats: { TotalEHP: 10_300 } }),
      node({ kind: "mastery", name: "Life Mastery", stats: { TotalEHP: 10_800 } }),
      node({ kind: "small", name: "Nothing", stats: {} }),
      node({ kind: "ascendancy", name: "Asc", points: 2, stats: { TotalEHP: 12_000 } }),
    ];
    mastery[1].id = mastery[0].id;
    const swap = node({ kind: "swap", name: "Swap", points: 0, stats: { TotalEHP: 10_200 } });
    const plan = planPassives(result(mastery, [swap]), "defence");
    expect(plan.passives.map((p) => p.ehp)).toEqual([0.08]);
    expect(plan.ascendancy.map((p) => p.name)).toEqual(["Asc"]);
    expect(plan.swaps[0].score).toBeCloseTo(0.02);
  });

  it("merges identical choices into one entry with a count", () => {
    const a = node({ kind: "small", name: "Poison", stats: { CombinedDPS: 1030 } });
    const b = node({ kind: "small", name: "Poison", stats: { CombinedDPS: 1030 } });
    const swaps = [1050, 1080].map((dps, i) =>
      node({ kind: "swap", name: "M", points: 0, replaces: [`old ${i}`], stats: { CombinedDPS: dps } }),
    );
    const plan = planPassives(result([a, b], swaps), "damage");
    expect(plan.passives.map((p) => [p.name, p.count])).toEqual([["Poison", 2]]);
    expect(plan.swaps.map((p) => [p.replaces, p.count])).toEqual([[["old 1"], 2]]);
  });

  it("notices a main skill without damage", () => {
    expect(planPassives({ ...result([]), before: { ...before, CombinedDPS: 0 } }, "damage").noDamage).toBe(true);
    expect(planPassives(result([]), "damage").noDamage).toBe(false);
  });

  it("counts the points available at this level with every quest done", () => {
    const plan = planPassives(result([]), "damage");
    expect(plan.available).toBe(89 + 23 + 2);
    expect(plan.used).toBe(110);
  });
});
