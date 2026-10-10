import { describe, expect, it } from "vitest";
import { checkBuild, diffFindings } from "./health";

/** Shaped like the reference build: −50% cold/lightning covered by damage taken as fire. */
const covered = {
  Life: 2959,
  EnergyShield: 69,
  TotalEHP: 56898,
  PhysicalMaximumHitTaken: 31591,
  FireMaximumHitTaken: 47845,
  ColdMaximumHitTaken: 47845,
  LightningMaximumHitTaken: 45998,
  ChaosMaximumHitTaken: 22947,
  FireResist: 90,
  FireResistOverCap: 27,
  ColdResist: -50,
  ColdResistOverCap: 0,
  LightningResist: -50,
  LightningResistOverCap: 0,
  ChaosResist: 75,
  ManaCost: 25,
  ManaUnreserved: 130,
  ManaPerSecondCost: 61.8,
  ManaRegenRecovery: 17.2,
  ManaLeechGainRate: 349.8,
  HitChance: 88,
  Str: 202,
  ReqStr: 159,
  Int: 91,
  ReqInt: 98,
  EffectiveSpellSuppressionChance: 100,
};

const ids = (f: { id: string; severity: string }[]) => f.map((x) => `${x.severity}:${x.id}`);

describe("build health check", () => {
  it("flags the real problems of a build like the reference one", () => {
    expect(ids(checkBuild(covered, 95))).toEqual([
      "warning:weak-Chaos",
      "warning:hit-chance",
      "warning:attr-Int",
      "warning:pool",
      "info:res-Cold",
      "info:res-Lightning",
      "info:mana-sustain",
    ]);
  });

  it("warns about uncapped resistance when nothing covers it", () => {
    const f = checkBuild({ ...covered, ColdMaximumHitTaken: 9000 }, 95);
    expect(f.find((x) => x.id === "res-Cold")).toMatchObject({ severity: "warning", title: "Cold resistance -50% is below cap" });
  });

  it("warns when mana can't sustain or afford the skill", () => {
    const f = checkBuild({ ...covered, ManaLeechGainRate: 0, ManaUnreserved: 10 }, 95);
    expect(f.filter((x) => x.id.startsWith("mana")).map((x) => [x.id, x.severity])).toEqual([
      ["mana-cost", "warning"],
      ["mana-sustain", "warning"],
    ]);
  });

  it("stays quiet for a healthy build and skips the pool check at low level", () => {
    const healthy = {
      Life: 5200,
      PhysicalMaximumHitTaken: 30000,
      FireMaximumHitTaken: 40000,
      ColdMaximumHitTaken: 40000,
      LightningMaximumHitTaken: 40000,
      ChaosMaximumHitTaken: 25000,
      FireResist: 75,
      ColdResist: 75,
      LightningResist: 75,
      ChaosResist: 20,
      HitChance: 100,
    };
    expect(checkBuild(healthy, 95)).toEqual([]);
    expect(ids(checkBuild({ ...healthy, Life: 1200 }, 60))).toEqual([]);
    expect(ids(checkBuild({ ...healthy, ChaosResist: -30, EffectiveSpellSuppressionChance: 64 }, 95))).toEqual([
      "warning:res-Chaos",
      "info:suppression",
    ]);
  });

  it("lists what an item swap adds and removes", () => {
    const before = checkBuild(covered, 95);
    const after = checkBuild({ ...covered, Int: 111, LightningMaximumHitTaken: 12000 }, 95);
    const { added, removed } = diffFindings(before, after);
    expect(added.map((f) => f.id)).toEqual(["weak-Lightning"]);
    expect(removed.map((f) => f.id)).toEqual(["attr-Int"]);
    // The resist finding changes from "covered" to a warning: same id, so not listed as added.
    expect(after.find((f) => f.id === "res-Lightning")?.severity).toBe("warning");
  });
});
