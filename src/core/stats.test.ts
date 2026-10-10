import { describe, expect, it } from "vitest";
import { diffStats, formatStat, pickHeadline } from "./stats";

describe("stats", () => {
  it("keeps only finite headline stats", () => {
    expect(pickHeadline({ CombinedDPS: 5, Life: 10, SomethingElse: 3, Mana: Number.NaN })).toEqual({
      CombinedDPS: 5,
      Life: 10,
    });
  });

  it("formats numbers compactly and percentages plainly", () => {
    expect(formatStat("number", 5358662.42)).toBe("5.36M");
    expect(formatStat("number", 56897.64)).toBe("56.9k");
    expect(formatStat("number", 2959)).toBe("2,959");
    expect(formatStat("percent", 75)).toBe("75%");
    expect(formatStat("percent", -50)).toBe("-50%");
  });

  it("lists stats that changed, ignoring tiny differences", () => {
    const changes = diffStats(
      { CombinedDPS: 1_000_000, Life: 3000, FireResist: 75 },
      { CombinedDPS: 1_200_000, Life: 3001, FireResist: 70 },
    );
    expect(changes.map((c) => [c.def.key, c.before, c.after])).toEqual([
      ["CombinedDPS", 1_000_000, 1_200_000],
      ["FireResist", 75, 70],
    ]);
  });
});
