import { describe, expect, it } from "vitest";
import { FATES, GRIM_FATES, fateTrials, judgeFates } from "./fates";

// Made-up stats shaped like the engine's `trials` output.
const BEFORE = {
  CombinedDPS: 1_000_000,
  TotalEHP: 300_000,
  PhysicalMaximumHitTaken: 18_000,
  FireMaximumHitTaken: 100_000,
  ColdMaximumHitTaken: 100_000,
  LightningMaximumHitTaken: 100_000,
  ChaosMaximumHitTaken: 39_000,
  LifeRegenRecovery: 1700,
  TotalBuildDegen: 460,
  ShockAvoidChance: 100,
};
const pick = (name: string) => FATES.find((f) => f.name === name)!;

describe("Fates", () => {
  it("lists the 25 Fates and the Grim Fates, and asks the engine about a map boss", () => {
    expect(FATES).toHaveLength(25);
    expect(GRIM_FATES.length).toBeGreaterThanOrEqual(10);
    const t = fateTrials(FATES);
    expect(t.shared).toEqual({ enemyIsBoss: "Boss" });
    expect(t.trials.find((x) => x.label === "Doomsayer")).toMatchObject({ enemyResist: { Fire: 75 }, config: { enemyFirePen: 8 } });
  });

  it("judges each Fate on the build: calculated, immune, more damage, or described", () => {
    const fates = ["Doomsayer", "Stormcaller", "Butcher", "Gravewalker", "Black Frost", "Deathbringer", "Tempest"].map(pick);
    const v = judgeFates(fates, BEFORE, [
      { label: "Doomsayer", stats: { ...BEFORE, CombinedDPS: 700_000, TotalEHP: 123_000, FireMaximumHitTaken: 55_000 }, unparsed: [] },
      { label: "Gravewalker", stats: { ...BEFORE, TotalEHP: 71_000, FireMaximumHitTaken: 50_000, LifeRegenRecovery: 300 }, unparsed: [] },
      { label: "Tempest", stats: BEFORE, unparsed: [] },
    ]);
    const by = (n: string) => v.find((x) => x.fate.name === n)!;
    expect(by("Doomsayer").danger).toBe("danger");
    expect(by("Doomsayer").text).toContain("DPS −30%");
    expect(by("Gravewalker").text).toContain("Righteous Fire net −160 life/s");
    expect(by("Stormcaller").danger).toBe("immune");
    expect(by("Butcher")).toMatchObject({ danger: "watch" });
    expect(by("Butcher").text).toContain("effective HP against it −23%");
    expect(by("Black Frost").text).toContain("cold max hit is 100,000");
    expect(by("Deathbringer").danger).toBe("unknown");
    expect(by("Tempest").danger).toBe("safe");
    expect(v[0].danger).toBe("danger");
    expect(v[v.length - 1].danger).toBe("immune");
  });

  it("flags a Fate whose damage hits the build's weakest type", () => {
    const v = judgeFates([pick("Bloodthirsty")], BEFORE, []);
    expect(v[0].danger).toBe("watch");
    expect(v[0].text).toContain("your lowest");
  });
});
