import { describe, expect, it } from "vitest";
import { activeTier, applyChoice, listTiers, readStages, skillGroupKeys, withMainGroup } from "./compare";

// Made-up PoB XML: a guide with titled tiers, like Goratha's 3.30 code
// (docs/test-builds/goratha-fireball-radiation-rf.txt).
const TIERED = `<PathOfBuilding>
<Build level="73" className="Scion" mainSocketGroup="1"></Build>
<Tree activeSpec="3">
<Spec title="Leveling 1-28" nodes="1"/>
<Spec title="Leveling 28-60" nodes="1,2"/>
<Spec title="Red Maps" nodes="1,2,3"/>
</Tree>
<Skills activeSkillSet="5">
<SkillSet id="1" title="Leveling 1-28"><Skill slot="Helmet"><Gem nameSpec="Rolling Magma"/></Skill></SkillSet>
<SkillSet id="3" title="Leveling 28-60"><Skill slot="Body Armour"><Gem nameSpec="Fireball"/><Gem nameSpec="Spellslinger"/></Skill><Skill slot="Helmet"><Gem nameSpec="Wave of Conviction"/></Skill></SkillSet>
<SkillSet id="5" title="Red Maps"><Skill slot="Helmet"><Gem nameSpec="Fire Trap"/></Skill><Skill slot="Body Armour"><Gem nameSpec="Righteous Fire"/><Gem nameSpec="Fire Trap"/></Skill></SkillSet>
</Skills>
<Items activeItemSet="5">
<ItemSet id="2" title="Leveling 1-28"/>
<ItemSet id="4" title="Leveling 28-60"/>
<ItemSet id="5" title="Red Maps"/>
</Items>
</PathOfBuilding>`;

describe("build tiers", () => {
  it("lists one tier per tree, with the item and skill sets of the same title", () => {
    expect(listTiers(TIERED)).toEqual([
      { title: "Leveling 1-28", choice: { spec: 1, skillSet: 1, itemSet: 2 } },
      { title: "Leveling 28-60", choice: { spec: 2, skillSet: 3, itemSet: 4 } },
      { title: "Red Maps", choice: { spec: 3, skillSet: 5, itemSet: 5 } },
    ]);
    expect(activeTier(TIERED).title).toBe("Red Maps");
  });

  it("is a single tier for a build with one of each", () => {
    const one = TIERED.replace(/<Spec title="Leveling[^>]*\/>\n/g, "")
      .replace(/<SkillSet id="[13]".*?<\/SkillSet>\n/gs, "")
      .replace(/<ItemSet id="[24]"[^>]*\/>\n/g, "");
    expect(listTiers(one)).toHaveLength(1);
  });

  it("makes the chosen tier active", () => {
    const xml = applyChoice(TIERED, { tier: "Leveling 28-60" });
    const st = readStages(xml);
    expect([st.activeSpec, st.activeSkillSet, st.activeItemSet]).toEqual([2, 3, 4]);
    expect(applyChoice(TIERED, { tier: "No such tier" })).toBe(TIERED);
  });
});

describe("main skill", () => {
  it("reads the active skill set's groups by slot and gems", () => {
    expect(skillGroupKeys(TIERED)).toEqual([
      { slot: "Helmet", gems: ["Fire Trap"] },
      { slot: "Body Armour", gems: ["Righteous Fire", "Fire Trap"] },
    ]);
  });

  it("sets the main group by what's in it, per tier", () => {
    const rf = { slot: "Body Armour", gems: ["Righteous Fire", "Fire Trap"] };
    expect(withMainGroup(TIERED, rf)).toContain('mainSocketGroup="2"');
    expect(withMainGroup(TIERED, { slot: "Gloves", gems: ["Nothing"] })).toBe(TIERED);
    const choice = { tier: "Leveling 28-60", main: { "Leveling 28-60": { slot: "Helmet", gems: ["Wave of Conviction"] }, "Red Maps": rf } };
    expect(applyChoice(TIERED, choice)).toContain('mainSocketGroup="2"');
    expect(applyChoice(TIERED, { main: { "Red Maps": rf } })).toContain('mainSocketGroup="2"');
  });
});
