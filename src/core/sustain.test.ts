import { describe, expect, it } from "vitest";
import { burnCheck, manaCheck } from "./sustain";

// Made-up numbers shaped like the engine's audit `sustain`.
const RF = { Life: 6000, LifeRegenRecovery: 1700, TotalBuildDegen: 460, FireResist: 90, FireResistOverCap: 200, LifePerSecondCost: 210 };

describe("burn check", () => {
  it("is nothing for a build that doesn't burn itself", () => {
    expect(burnCheck({ base: { Life: 5000, LifeRegenRecovery: 100 }, scenarios: [] })).toBeNull();
  });

  it("gives the margin and names the map mods that make it negative", () => {
    const c = burnCheck({
      base: RF,
      scenarios: [
        { label: "Map mod of Smothering", stats: { ...RF, LifeRegenRecovery: 400 } },
        { label: "Map mod of Exposure", stats: { ...RF, TotalBuildDegen: 900 } },
      ],
    })!;
    expect(c.net).toBe(1240);
    expect(c.scenarios.map((s) => s.label)).toEqual(["Map mod of Smothering", "Map mod of Exposure"]);
    expect(c.severity).toBe("thin");
    expect(c.text).toContain("Under Map mod of Smothering you'd burn faster than you regenerate");
  });

  it("warns when fire resistance isn't at its maximum, and when the burn wins", () => {
    expect(burnCheck({ base: { ...RF, FireResistOverCap: 0, FireResist: 80 }, scenarios: [] })!.text).toContain("not at its maximum");
    const losing = burnCheck({ base: { ...RF, LifeRegenRecovery: 300 }, scenarios: [] })!;
    expect(losing.severity).toBe("negative");
    expect(losing.text).toContain("160 life/s short");
  });
});

describe("mana check", () => {
  it("says when the main skill can't be cast or runs out", () => {
    expect(manaCheck({ ManaUnreserved: 10, ManaCost: 20 }).severity).toBe("negative");
    const tight = manaCheck({ ManaUnreserved: 96, ManaCost: 18, ManaPerSecondCost: 30, ManaRegenRecovery: 26 });
    expect(tight.severity).toBe("thin");
    expect(tight.text).toContain("lasts about 24 seconds");
    expect(manaCheck({ ManaUnreserved: 96, ManaCost: 18, ManaPerSecondCost: 24, ManaRegenRecovery: 28 }).severity).toBe("ok");
    expect(manaCheck({ ManaUnreserved: 40, LifeCost: 121 }).text).toContain("costs 121 life");
  });
});
