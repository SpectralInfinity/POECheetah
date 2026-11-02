import { describe, expect, it } from "vitest";
import { adviseOptions, adviseStance, findSource, planFlasks, pobLimits, type AuditResult } from "./audit";

const before = {
  CombinedDPS: 1000,
  TotalDPS: 100,
  TotalEHP: 10_000,
  PhysicalMaximumHitTaken: 30_000,
  ChaosMaximumHitTaken: 20_000,
};

const flask = (slot: string, name: string, kind: string, without: Record<string, number>, raw = "", extra = {}) => ({
  slot,
  name,
  base: name.replace(/^.*?(\w+ Flask).*$/, "$1"),
  kind,
  active: true,
  raw: `Rarity: MAGIC\n${name}\n${raw}`,
  without: { ...before, ...without },
  alternatives: [],
  ...extra,
});

function audit(over: Partial<AuditResult> = {}): AuditResult {
  return {
    before,
    skill: { name: "Poisonous Concoction of Bouncing", part: "No Flask" },
    options: [
      { var: "useFrenzyCharges", label: "Do you use Frenzy Charges?", kind: "check", current: "false", tries: [{ value: "true", stats: { ...before, CombinedDPS: 1190 } }] },
      { var: "usePowerCharges", label: "Do you use Power Charges?", kind: "check", current: "true", tries: [{ value: "false", stats: { ...before, CombinedDPS: 900 } }] },
      { var: "buffOnslaught", label: "Do you have Onslaught?", kind: "check", current: "false", tries: [{ value: "true", stats: before }] },
      { var: "buffTailwind", label: "Do you have Tailwind?", kind: "check", current: "true", tries: [{ value: "false", stats: { ...before, CombinedDPS: 920 } }] },
      { var: "conditionKilledRecently", label: "Have you Killed Recently?", kind: "check", current: "true", tries: [{ value: "false", stats: { ...before, CombinedDPS: 950 } }] },
      {
        var: "bloodSandStance",
        label: "Stance",
        kind: "list",
        current: "Blood Stance",
        tries: [{ value: "Sand Stance", stats: { ...before, TotalEHP: 12_500, PhysicalMaximumHitTaken: 37_000 } }],
      },
    ],
    flasks: [
      flask("Flask 1", "Divine Life Flask", "Life", {}),
      flask("Flask 2", "Divine Life Flask of Quashing", "Life", {}, "Grants Immunity to Ignite for 9 seconds if used while Ignited"),
      flask("Flask 3", "Silver Flask of the Owl", "Utility", { CombinedDPS: 880 }, "61% reduced Effect of Curses on you during Effect"),
      flask("Flask 4", "Amethyst Flask", "Utility", { TotalEHP: 9_950 }, "", {
        alternatives: [
          { base: "Sulphur Flask", stats: { ...before, CombinedDPS: 1083 } },
          { base: "Silver Flask", stats: { ...before, CombinedDPS: 1120 } },
          { base: "Diamond Flask", stats: { ...before, CombinedDPS: 1016 } },
          { base: "Granite Flask", stats: { ...before, TotalEHP: 10_002 } },
        ],
      }),
    ],
    warnings: [
      { stat: "ReqInt", text: "You do not meet the Intelligence requirement of Malevolence" },
      { stat: "PoisonDPS", text: "Poison DPS exceeds in game limit" },
    ],
    dotCap: 35_791_394,
    text: {
      items: [
        { slot: "Gloves", name: "Tailwind Gloves", raw: "Rarity: RARE\nYou have Tailwind if you have dealt a Critical Strike Recently" },
        { slot: "Belt", name: "Frenzy Belt", raw: "Rarity: RARE\n+1 to Maximum Frenzy Charges\n10% increased Damage per Frenzy Charge" },
        { slot: "Flask 3", name: "Silver Flask of the Owl", raw: "Silver Flask" },
      ],
      nodes: ["Poisons you inflict deal Damage 20% faster", "20% chance to gain a Power Charge on Kill"],
      gems: ["Poisonous Concoction of Bouncing", "Flesh and Stone"],
    },
    ...over,
  };
}

describe("charge and condition audit", () => {
  it("finds what grants a charge, not what only uses it", () => {
    const text = audit().text;
    expect(findSource(text, "useFrenzyCharges")).toBeNull();
    expect(findSource(text, "usePowerCharges")).toEqual({ from: "Passive tree", line: "20% chance to gain a Power Charge on Kill", onKill: true });
    expect(findSource(text, "buffTailwind")?.from).toBe("Tailwind Gloves");
    expect(findSource(text, "buffOnslaught")).toEqual({ from: "Silver Flask of the Owl", line: "Silver Flask", onKill: false });
    const uses = { items: [{ slot: "Ring 1", name: "Ring", raw: "30% increased Damage while you have Tailwind" }], nodes: [], gems: [] };
    expect(findSource(uses, "buffTailwind")).toBeNull();
    expect(findSource({ ...text, gems: ["Blood Rage"] }, "useFrenzyCharges")).toEqual({ from: "Gem", line: "Blood Rage", onKill: true });
  });

  it("says turn it on, not true on a boss, or fine, with each one's worth", () => {
    const advice = adviseOptions(audit(), "damage");
    const by = Object.fromEntries(advice.map((a) => [a.var, a]));
    expect(by.usePowerCharges.verdict).toBe("on-kill");
    expect(by.usePowerCharges.dps).toBeCloseTo(0.1);
    expect(by.usePowerCharges.text).toContain("not true against a lone boss");
    expect(by.buffTailwind.verdict).toBe("ok");
    expect(by.conditionKilledRecently.verdict).toBe("on-kill");
    expect(by.useFrenzyCharges.verdict).toBe("off");
    expect(by.useFrenzyCharges.text).toBe("Off; nothing grants it (with a source it would be worth +19% DPS).");
    expect(by.buffOnslaught.text).toContain("Path of Building already counts that");

    const blood = adviseOptions(audit({ text: { ...audit().text, gems: ["Blood Rage"] } }), "damage");
    expect(blood.find((a) => a.var === "useFrenzyCharges")?.verdict).toBe("off");
    const gloves = audit();
    gloves.text.items.push({ slot: "Ring 1", name: "Frenzy Ring", raw: "Rarity: RARE\nGain a Frenzy Charge on Hit with Poison" });
    const on = adviseOptions(gloves, "damage");
    expect(on[0].var).toBe("useFrenzyCharges");
    expect(on[0].verdict).toBe("turn-on");
    expect(on[0].text).toBe("Off, but Frenzy Ring: Gain a Frenzy Charge on Hit with Poison grants it. Turn it on in Path of Building: +19% DPS.");
  });

  it("weighs the stance and flags Blood Stance on damage over time", () => {
    const st = adviseStance(audit(), "defence")!;
    expect(st.current).toBe("Blood Stance");
    expect(st.others[0].value).toBe("Sand Stance");
    expect(st.others[0].ehp).toBeCloseTo(0.25);
    expect(st.bloodOnDot).toBe(true);
    expect(st.fleshAndStone).toBe(true);
    expect(adviseStance(audit({ options: [] }), "damage")).toBeNull();
  });
});

describe("flask set", () => {
  it("keeps life flasks for a skill that uses their charges and frees the least useful utility flask", () => {
    const p = planFlasks(audit(), "damage");
    expect(p.lifeIsSustain).toBe(true);
    expect(p.flasks[0].role).toContain("Life flask charges for Poisonous Concoction");
    expect(p.flasks[1].protects).toEqual(["Grants Immunity to Ignite for 9 seconds if used while Ignited"]);
    expect(p.flasks[2].role).toBe("Gives +12% DPS.");
    expect(p.flasks[2].protects).toEqual(["61% reduced Effect of Curses on you during Effect"]);
    expect(p.flasks[3].role).toBe("Adds nothing Path of Building can measure.");
    expect(planFlasks(audit({ flasks: [flask("Flask 5", "Progenesis", "Utility", {}, "Rarity: UNIQUE")] }), "damage").flasks[0].role).toContain("values this unique at nothing");
    expect(p.free?.slot).toBe("Flask 4");
    // Silver is worn already (the same kind doesn't stack); Granite gains next to nothing.
    expect(p.options.map((o) => o.base)).toEqual(["Sulphur Flask", "Diamond Flask"]);
    expect(p.options[0].gain).toBeCloseTo(0.083);
  });

  it("can free a spare life flask when the skill doesn't use them", () => {
    const p = planFlasks(audit({ skill: { name: "Fireball" } }), "defence");
    expect(p.lifeIsSustain).toBe(false);
    expect(p.free?.kind).toBe("Life");
  });
});

describe("Path of Building's blind spots", () => {
  it("flags the damage over time cap, faster ailments, flask charges and uptime", () => {
    const ids = pobLimits(audit()).map((l) => l.id);
    expect(ids).toEqual(["cap:PoisonDPS", "faster", "charges", "flasks"]);
    expect(pobLimits(audit())[0].text).toContain("35.8M per type");
  });

  it("flags The Writhing Jar and Aspect of Arakaali", () => {
    const r = audit();
    r.text.items.push({ slot: "Flask 5", name: "The Writhing Jar, Hallowed Hybrid Flask", raw: "x" });
    r.text.items.push({ slot: "Boots", name: "Pain Spur", raw: "Grants Level 20 Aspect of Arakaali Skill" });
    expect(pobLimits(r).map((l) => l.id)).toContain("worms");
    expect(pobLimits(r).map((l) => l.id)).toContain("arakaali");
  });
});
