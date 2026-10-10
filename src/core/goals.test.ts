import { describe, expect, it } from "vitest";
import { avoidsDrawbacks, goalGain, modeFor, searchWeights } from "./goals";

describe("goals", () => {
  it("clears situational assumptions unless the player counts them; bossing always against an uber boss", () => {
    expect(modeFor("damage", false)).toBe("conservative");
    expect(modeFor("balanced", true)).toBe("configured");
    expect(modeFor("bossing", true)).toBe("boss");
    expect(modeFor("bossing", false)).toBe("boss");
  });

  it("weighs DPS and effective HP per goal", () => {
    expect(goalGain("damage", 0.1, 0.2)).toBe(0.1);
    expect(goalGain("defence", 0.1, 0.2)).toBe(0.2);
    expect(goalGain("bossing", 0.1, 0.2)).toBeCloseTo(0.15);
    expect(avoidsDrawbacks("bossing")).toBe(true);
    expect(avoidsDrawbacks("damage")).toBe(false);
    expect(searchWeights("defence")).toEqual([{ stat: "TotalEHP", weightMult: 1 }]);
  });
});
