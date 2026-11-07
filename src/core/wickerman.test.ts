import { describe, expect, it } from "vitest";
import { judgeParts, partSets, readBodyPart, wickermanLines, type BodyPart, type Wickerman } from "./wickerman";

// Made up, laid out like the keynote's tooltip (to check on a real copy at launch).
const STONE = `Item Class: Wickerman Parts
Rarity: Normal
Greater Golemic Stone
--------
Torso
--------
You cannot be Stunned if you've been Stunned or Blocked a Stunning Hit in the past 2 seconds
--------
Take this to the Wickerman in a town or hideout to attach it.
`;
const ARM = `Rarity: Normal
Lesser Warden's Arm
--------
Arm
+50 to maximum Life
--------
Take this to the Wickerman in a town or hideout to attach it.`;

describe("body parts", () => {
  it("reads a copied body part: name, slot, tier, modifier lines", () => {
    expect(readBodyPart(STONE)).toEqual({
      name: "Greater Golemic Stone",
      slot: "Torso",
      tier: "Greater",
      lines: ["You cannot be Stunned if you've been Stunned or Blocked a Stunning Hit in the past 2 seconds"],
    });
    expect(readBodyPart(ARM)).toEqual({ name: "Lesser Warden's Arm", slot: "Arm", tier: "Lesser", lines: ["+50 to maximum Life"] });
    expect(readBodyPart("Rarity: Rare\nStorm Loop\nGold Ring\n--------\n+71 to maximum Life")).toBeNull();
  });
});

const part = (name: string, slot: BodyPart["slot"], lines: string[]): BodyPart => ({ name, slot, tier: "Normal", lines });
const W: Wickerman = { Arm: part("Warden's Arm", "Arm", ["+50 to maximum Life"]), Head: part("Bandit Warrior's Head", "Head", ["Regenerate 1% of Life per second"]) };

describe("the Wickerman", () => {
  it("builds the sets to calculate: all, all but each part, and with a candidate", () => {
    const cand = part("Greater Warden's Arm", "Arm", ["+90 to maximum Life"]);
    expect(wickermanLines(W)).toEqual(["Regenerate 1% of Life per second", "+50 to maximum Life"]);
    expect(partSets(W, cand)).toEqual([
      { id: "all", lines: ["Regenerate 1% of Life per second", "+50 to maximum Life"] },
      { id: "without:Head", lines: ["+50 to maximum Life"] },
      { id: "without:Arm", lines: ["Regenerate 1% of Life per second"] },
      { id: "candidate", lines: ["Regenerate 1% of Life per second", "+90 to maximum Life"] },
    ]);
  });

  it("says what each part is worth and whether to attach a candidate", () => {
    const base = { CombinedDPS: 1000, TotalEHP: 10_000, LifeRegenRecovery: 30, PhysicalMaximumHitTaken: 20_000 };
    const all = { ...base, TotalEHP: 10_300, LifeRegenRecovery: 60 };
    const cand = part("Greater Warden's Arm", "Arm", ["+90 to maximum Life", "Something new in 3.30"]);
    const sets = partSets(W, cand);
    const results = [
      { stats: all, unparsed: [] },
      // Without the head: no regen; without the arm: less effective HP.
      { stats: { ...all, LifeRegenRecovery: 30 }, unparsed: [] },
      { stats: { ...all, TotalEHP: 10_000 }, unparsed: [] },
      { stats: { ...all, TotalEHP: 10_600 }, unparsed: ["Something new in 3.30"] },
    ];
    const j = judgeParts(W, sets, results, "defence", cand);
    expect(j.attached.map((a) => [a.slot, Math.round(a.ehp * 1000) / 10, Math.round(a.regen)])).toEqual([
      ["Head", 0, 30],
      ["Arm", 3, 0],
    ]);
    expect(j.candidate?.attach).toBe(true);
    expect(j.candidate?.text).toBe("Attach it in place of Warden's Arm: +2.9% effective HP.");
    expect(j.candidate?.unparsed).toEqual(["Something new in 3.30"]);

    const worse = judgeParts(W, sets, [results[0], results[1], results[2], { stats: { ...all, TotalEHP: 10_100 }, unparsed: [] }], "defence", cand);
    expect(worse.candidate?.text).toBe("Keep Warden's Arm: −1.9% effective HP.");
    const empty = judgeParts({}, partSets({}, cand), [{ stats: base, unparsed: [] }, { stats: base, unparsed: ["x"] }], "defence", cand);
    expect(empty.candidate?.text).toBe("Attach it: nothing Path of Building can measure.");
  });

  it("leaves out a part that cuts a max hit for Balanced", () => {
    const all = { CombinedDPS: 1000, TotalEHP: 10_000, PhysicalMaximumHitTaken: 20_000 };
    const cand = part("Glass Head", "Head", ["10% increased Damage", "10% increased Physical Damage taken"]);
    const sets = partSets({}, cand);
    const j = judgeParts({}, sets, [{ stats: all, unparsed: [] }, { stats: { ...all, CombinedDPS: 1100, PhysicalMaximumHitTaken: 18_000 }, unparsed: [] }], "balanced", cand);
    expect(j.candidate?.attach).toBe(false);
    expect(j.candidate?.drawbacks).toEqual(["Physical max hit 20k → 18k"]);
  });
});
