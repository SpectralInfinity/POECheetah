import { describe, expect, it } from "vitest";
import {
  alignedPart,
  allocatedNodes,
  carries,
  closestStage,
  damageFactors,
  fightVerdict,
  gemChanges,
  hybrid,
  planCompare,
  readStages,
  treeChange,
  withStage,
  type CompareResult,
} from "./compare";

// Made-up PoB XML: just the parts the comparison reads.
const MINE = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
<Build level="90" className="Witch" mainSocketGroup="1">
</Build>
<Tree activeSpec="1">
<Spec title="Mine" nodes="1,2,3,4">
<Sockets>
<Socket itemId="3" nodeId="4"/>
</Sockets>
</Spec>
</Tree>
<Skills activeSkillSet="1">
<SkillSet id="1">
<Skill enabled="true" slot="Body Armour"><Gem nameSpec="Fireball" level="20"/><Gem nameSpec="Spell Echo" level="18"/></Skill>
<Skill enabled="false"><Gem nameSpec="Despair" level="1"/></Skill>
</SkillSet>
</Skills>
<Items activeItemSet="1">
<Item id="1">my ring</Item>
<ItemSet id="1"><Slot name="Ring 1" itemId="1"/></ItemSet>
</Items>
<Config activeConfigSet="1"><ConfigSet id="1"><Input name="conditionEnemyIgnited" boolean="true"/></ConfigSet></Config>
</PathOfBuilding>`;

const GUIDE = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
<Build level="100" className="Witch" mainSocketGroup="2">
</Build>
<Tree activeSpec="3">
<Spec title="League start" nodes="1,2"/>
<Spec title="Mid game" nodes="1,2,3,5,6">
<Sockets>
<Socket itemId="9" nodeId="5"/>
</Sockets>
</Spec>
<Spec title="End game" nodes="1,2,3,5,6,7,8,9,10,11"/>
</Tree>
<Skills activeSkillSet="2">
<SkillSet id="1" title="League start"><Skill><Gem nameSpec="Fireball" level="20"/></Skill></SkillSet>
<SkillSet id="2" title="Mid game"><Skill><Gem nameSpec="Fireball" level="21"/><Gem nameSpec="Despair" level="20"/></Skill></SkillSet>
</Skills>
<Items activeItemSet="1">
<Item id="9">guide jewel</Item>
<ItemSet id="1" title="Mid game"><Slot name="Ring 1" itemId="9"/></ItemSet>
<ItemSet id="2" title="End game"/>
</Items>
<Config><Input name="enemyIsBoss" string="Pinnacle"/></Config>
</PathOfBuilding>`;

describe("guide stages", () => {
  it("reads the trees, item sets and skill sets a code holds", () => {
    const st = readStages(GUIDE);
    expect(st.specs).toEqual([
      { id: 1, title: "League start", nodes: 2 },
      { id: 2, title: "Mid game", nodes: 5 },
      { id: 3, title: "End game", nodes: 10 },
    ]);
    expect(st.activeSpec).toBe(3);
    expect(st.itemSets.map((s) => s.title)).toEqual(["Mid game", "End game"]);
    expect(st.skillSets).toEqual([
      { id: 1, title: "League start" },
      { id: 2, title: "Mid game" },
    ]);
    expect(readStages(MINE).itemSets).toEqual([{ id: 1, title: "Item set 1" }]);
  });

  it("picks the stage closest to my tree, matching sets by name", () => {
    const st = readStages(GUIDE);
    expect(allocatedNodes(MINE)).toBe(4);
    expect(closestStage(st, 4)).toEqual({ spec: 2, itemSet: 1, skillSet: 2 });
    expect(closestStage(st, 12)).toEqual({ spec: 3, itemSet: 2, skillSet: 2 });
    expect(closestStage(st, 1)).toEqual({ spec: 1, itemSet: 1, skillSet: 1 });
  });

  it("makes another stage active", () => {
    const xml = withStage(GUIDE, { spec: 1, itemSet: 2, skillSet: 1 });
    const st = readStages(xml);
    expect([st.activeSpec, st.activeItemSet, st.activeSkillSet]).toEqual([1, 2, 1]);
    expect(allocatedNodes(xml)).toBe(2);
  });
});

describe("mixed builds", () => {
  const guide = withStage(GUIDE, { spec: 2, itemSet: 1, skillSet: 2 });

  it("swaps the config or the gems as a whole", () => {
    const config = hybrid(MINE, guide, "config");
    expect(config).toContain('name="enemyIsBoss"');
    expect(config).not.toContain("conditionEnemyIgnited");
    expect(config).toContain('<Spec title="Mine"');
    const skills = hybrid(MINE, guide, "skills");
    expect(skills).toContain('nameSpec="Despair" level="20"');
    expect(skills).toMatch(/<Build [^>]*mainSocketGroup="2"/);
    expect(skills).toContain("my ring");
  });

  it("swaps the tree but keeps my jewels; swaps the gear with theirs", () => {
    const tree = hybrid(MINE, guide, "tree");
    expect(allocatedNodes(tree)).toBe(5);
    expect(tree).toContain('<Socket itemId="3" nodeId="4"/>');
    expect(tree).not.toContain('itemId="9" nodeId="5"');
    expect(tree).toContain("my ring");
    const gear = hybrid(MINE, guide, "gear");
    expect(allocatedNodes(gear)).toBe(4);
    expect(gear).toContain("guide jewel");
    expect(gear).not.toContain("my ring");
    expect(gear).toContain('<Socket itemId="9" nodeId="5"/>');
    expect(gear).not.toContain('itemId="3"');
  });

  it("counts the tree and gem changes", () => {
    expect(treeChange(MINE, guide)).toEqual({ add: 2, remove: 1 });
    expect(gemChanges(MINE, guide)).toEqual([
      { name: "Despair", level: 20 },
      { name: "Fireball", level: 21, mine: 20 },
    ]);
  });
});

describe("what an item carries", () => {
  it("finds curses, granted skills and socketed gem levels", () => {
    const raw = `Rarity: UNIQUE
Asenath's Gentle Touch
Silk Gloves
Implicits: 0
+70 to maximum Life
{crafted}+2 to Level of Socketed Aura Gems
Curse Enemies with Temporal Chains on Hit
Grants Level 20 Despair Skill
Trigger Level 20 Arcane Wake after Spending a total of 200 Mana
Socketed Gems are Supported by Level 20 Elemental Proliferation`;
    expect(carries(raw)).toEqual([
      "+2 to Level of Socketed Aura Gems",
      "Curse Enemies with Temporal Chains on Hit",
      "Grants Level 20 Despair Skill",
      "Trigger Level 20 Arcane Wake after Spending a total of 200 Mana",
      "Socketed Gems are Supported by Level 20 Elemental Proliferation",
    ]);
    expect(carries(undefined)).toEqual([]);
  });
});

const mineStats = {
  CombinedDPS: 1000,
  TotalEHP: 10_000,
  Life: 3000,
  FireResist: 75,
  PhysicalMaximumHitTaken: 30_000,
  FireMaximumHitTaken: 40_000,
  PoisonDamage: 100,
  PoisonStacks: 50,
  Speed: 2,
};

function result(over: Partial<CompareResult> = {}): CompareResult {
  return {
    mode: "conservative",
    mine: { stats: mineStats, skill: { name: "Poisonous Concoction", part: "No Flask", partIndex: 1 } },
    target: { stats: { ...mineStats, CombinedDPS: 1800, PoisonDamage: 160, Speed: 2.04 }, skill: { name: "Poisonous Concoction", part: "No Flask", partIndex: 1 } },
    slots: [
      {
        slot: "Gloves",
        mine: { name: "Plain Gloves", rarity: "RARE", raw: "Rarity: RARE\nCurse Enemies with Despair on Hit" },
        target: { name: "Asenath's Gentle Touch, Silk Gloves", rarity: "UNIQUE", raw: "Rarity: UNIQUE\nCurse Enemies with Temporal Chains on Hit" },
        intoMine: { ...mineStats, CombinedDPS: 900 },
        intoTarget: { ...mineStats, CombinedDPS: 1500 },
      },
      {
        slot: "Body Armour",
        mine: { name: "Cloak of Flame", rarity: "UNIQUE", raw: "x" },
        target: { name: "Cloak of Flame", rarity: "UNIQUE", raw: "y" },
        intoMine: { ...mineStats, CombinedDPS: 1180 },
      },
      {
        slot: "Ring 1",
        mine: { name: "Same Ring", rarity: "RARE", raw: "same" },
        target: { name: "Same Ring", rarity: "RARE", raw: "same" },
        intoMine: mineStats,
      },
      {
        slot: "Boots",
        mine: { name: "Fast Boots", rarity: "RARE", raw: "b" },
        target: { name: "Kintsugi Boots", rarity: "RARE", raw: "c" },
        intoMine: { ...mineStats, CombinedDPS: 1300, PhysicalMaximumHitTaken: 20_000 },
      },
    ],
    config: [],
    ...over,
  };
}

describe("comparison plan", () => {
  const wholes = {
    tree: { ...mineStats, CombinedDPS: 1100 },
    skills: { ...mineStats, CombinedDPS: 1210 },
    gear: { ...mineStats, CombinedDPS: 950 },
    config: { ...mineStats, CombinedDPS: 1400 },
  };

  it("lists what to change first by gain, the config apart, identical items skipped", () => {
    const plan = planCompare(result(), wholes, "damage");
    expect(plan.gap.dps).toBeCloseTo(0.8);
    expect(plan.first.map((c) => c.label)).toEqual(["Boots", "Their gems", "Body Armour", "Their passive tree"]);
    expect(plan.all.map((c) => c.label)).not.toContain("Ring 1");
    expect(plan.config?.dps).toBeCloseTo(0.4);
    const gloves = plan.all.find((c) => c.label === "Gloves")!;
    expect(gloves.dps).toBeCloseTo(-0.1);
    expect(gloves.losing).toEqual(["Curse Enemies with Despair on Hit"]);
    expect(gloves.gaining).toEqual(["Curse Enemies with Temporal Chains on Hit"]);
  });

  it("leaves out a change that cuts a max hit for Balanced", () => {
    const plan = planCompare(result(), wholes, "balanced");
    expect(plan.first.map((c) => c.label)).not.toContain("Boots");
    expect(plan.all.find((c) => c.label === "Boots")?.drawbacks).toEqual(["Physical max hit 30k → 20k"]);
  });

  it("names the damage factors that differ, biggest first", () => {
    const f = damageFactors(mineStats, { ...mineStats, PoisonDamage: 160, Speed: 2.04, PoisonStacks: 40 });
    expect(f.map((x) => x.label)).toEqual(["Damage per poison", "Poison stacks"]);
    expect(f[0].ratio).toBeCloseTo(1.6);
  });

  it("flags a different main skill, and aligns the skill part when the skill is the same", () => {
    const other = result({ target: { stats: mineStats, skill: { name: "Fireball" } } });
    expect(planCompare(other, {}, "damage").otherSkill).toBe(true);
    expect(planCompare(result(), {}, "damage").otherSkill).toBe(false);
    expect(alignedPart({ name: "PC", partIndex: 2 }, { name: "PC", partIndex: 1 })).toBe(2);
    expect(alignedPart({ name: "PC", partIndex: 1 }, { name: "PC", partIndex: 1 })).toBeUndefined();
    expect(alignedPart({ name: "PC", partIndex: 2 }, { name: "Fireball", partIndex: 1 })).toBeUndefined();
  });
});

describe("fight verdict", () => {
  const boss = { CombinedDPS: 1000, PhysicalMaximumHitTaken: 30_000, FireMaximumHitTaken: 20_000 };

  it("picks the build that kills faster without dying sooner", () => {
    const v = fightVerdict(boss, { ...boss, CombinedDPS: 1500, FireMaximumHitTaken: 25_000 });
    expect(v.better).toBe("target");
    expect(v.text).toBe(
      "Against an uber pinnacle boss the target is better: 50% more DPS and 25% bigger hits survived (weakest max hit 25k fire vs your 20k fire).",
    );
  });

  it("calls a trade-off: faster kills but smaller hits kill it", () => {
    const v = fightVerdict(boss, { ...boss, CombinedDPS: 1130, PhysicalMaximumHitTaken: 15_000 });
    expect(v.better).toBe("tradeoff");
    expect(v.text).toBe(
      "Against an uber pinnacle boss the target kills faster (13% more DPS) but dies to 25% smaller hits (weakest max hit 15k physical vs your 20k fire).",
    );
    expect(fightVerdict(boss, { ...boss, CombinedDPS: 870, FireMaximumHitTaken: 28_000 }).text).toContain(
      "yours kills faster (the target has 13% less DPS) but the target survives 40% bigger hits",
    );
  });

  it("says when the builds are even, or mine is better", () => {
    expect(fightVerdict(boss, { ...boss, CombinedDPS: 1030 }).better).toBe("same");
    expect(fightVerdict(boss, { ...boss, CombinedDPS: 600 }).better).toBe("mine");
  });
});
