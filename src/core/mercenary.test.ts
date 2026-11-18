import { describe, expect, it } from "vitest";
import { goldenGlory, hasMercenary, linksOnMercenary, linksOnMercenary329, uncounted, type MercenaryResult } from "./mercenary";

// Shaped like the engine's `mercenary` output on the owner's Luminary (made-up rounding).
const LUMINARY: MercenaryResult = {
  life: 14_885,
  lightRadiusInc: 257,
  links: [
    {
      name: "Flame Link",
      level: 25,
      quality: 20,
      inc: 15,
      more: 1,
      mods: [
        { name: "FireMin", type: "BASE", value: 345 },
        { name: "FireMax", type: "BASE", value: 517 },
        { name: "FireMin", type: "BASE", value: 3, percentOf: "Life" },
        { name: "FireMax", type: "BASE", value: 3, percentOf: "Life" },
      ],
    },
  ],
  nodes: [
    { line: "You can hire a Mercenary permanently", parsed: false },
    { line: "Increases and Reductions to Light Radius also apply to the Effect of", parsed: false },
    { line: "your Link Skill Buffs on your Mercenary at 50% of their value", parsed: false },
    { line: "Link Skills have 5% increased Buff Effect", parsed: true },
  ],
  items: [{ slot: "Helmet", line: "Link Skills can target Damageable Minions", parsed: true }],
};

describe("mercenary", () => {
  it("reads Golden Glory's share from the tree", () => {
    expect(goldenGlory(LUMINARY)).toBe(0.5);
    expect(goldenGlory({ ...LUMINARY, nodes: [] })).toBe(0);
  });

  it("works out what Flame Link gives the mercenary", () => {
    const [flame] = linksOnMercenary(LUMINARY);
    // (1 + (15 + 0.5 × 257) / 100) = 2.435; (345 + 3% of 14,885) × 2.435 and (517 + 446.55) × 2.435
    expect(flame.effect).toBeCloseTo(2.435, 3);
    expect(flame.lines).toEqual(["Adds 1,927 to 2,346 fire damage to its hits"]);
    expect(flame.effectText).toContain("+129% from Golden Glory (257% light radius at 50%)");
    // 3.29: (1 + (15 + 257) / 100) = 3.72; (345 + 5% of 14,885) × 3.72
    expect(linksOnMercenary329(LUMINARY)[0].lines).toEqual(["Adds 4,052 to 4,692 fire damage to its hits"]);
  });

  it("lists the mercenary lines Path of Building doesn't count", () => {
    expect(uncounted(LUMINARY)).toEqual(["You can hire a Mercenary permanently", "your Link Skill Buffs on your Mercenary at 50% of their value"]);
    expect(hasMercenary(LUMINARY)).toBe(true);
    expect(hasMercenary({ ...LUMINARY, links: [], nodes: [], items: [] })).toBe(false);
  });
});
