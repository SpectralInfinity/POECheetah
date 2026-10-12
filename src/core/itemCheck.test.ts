import { describe, expect, it } from "vitest";
import { checkItem, isEquipment, readItemHeader, verdictText, type ItemTrial } from "./itemCheck";

const RARE_RING = `Item Class: Rings\r
Rarity: Rare\r
Storm Loop\r
Gold Ring\r
--------\r
Requirements:\r
Level: 68\r
--------\r
Item Level: 84\r
--------\r
+71 to maximum Life\r
+38% to Fire Resistance\r
`;

const MAGIC_FLASK = `Item Class: Utility Flasks
Rarity: Magic
Experimenter's Quicksilver Flask of Adrenaline
--------
Lasts 6.00 Seconds
`;

const OLD_UNIQUE = `Rarity: Unique
Kintsugi
Exquisite Leather
--------
Evasion Rating: 1068
`;

describe("item text", () => {
  it("reads the header of copied item text", () => {
    expect(readItemHeader(RARE_RING)).toEqual({ itemClass: "Rings", rarity: "Rare", name: "Storm Loop", base: "Gold Ring" });
    expect(readItemHeader(MAGIC_FLASK)).toEqual({
      itemClass: "Utility Flasks",
      rarity: "Magic",
      name: "Experimenter's Quicksilver Flask of Adrenaline",
      base: null,
    });
    expect(readItemHeader(`\n${OLD_UNIQUE}`)).toMatchObject({ itemClass: null, rarity: "Unique", name: "Kintsugi" });
  });

  it("ignores text that isn't a copied item", () => {
    expect(readItemHeader("hello")).toBeNull();
    expect(readItemHeader("Rarity: Rare\nno separator")).toBeNull();
    expect(readItemHeader("eNrtfWtz2sqy6Of8iik--------")).toBeNull();
    expect(readItemHeader("Item Class: Rings\nStorm Loop\n--------")).toBeNull();
  });

  it("knows what a build can wear", () => {
    const h = (itemClass: string | null, rarity: string) => ({ itemClass, rarity, name: "x", base: null });
    expect(isEquipment(h("Rings", "Rare"))).toBe(true);
    expect(isEquipment(h(null, "Unique"))).toBe(true);
    expect(isEquipment(h("Jewels", "Magic"))).toBe(true);
    expect(isEquipment(h("Maps", "Rare"))).toBe(false);
    expect(isEquipment(h("Stackable Currency", "Currency"))).toBe(false);
    expect(isEquipment(h("Skill Gems", "Gem"))).toBe(false);
    expect(isEquipment(h("Heist Brooches", "Unique"))).toBe(false);
  });
});

const before = {
  CombinedDPS: 1000,
  TotalEHP: 10_000,
  Life: 3000,
  FireResist: 75,
  PhysicalMaximumHitTaken: 30_000,
};

function trial(slots: [string, Record<string, number>][], requiredLevel = 1): ItemTrial {
  return {
    item: "Storm Loop, Gold Ring",
    requiredLevel,
    before,
    slots: slots.map(([slot, s]) => ({ slot, replaces: "Old Ring", stats: { ...before, ...s } })),
  };
}

describe("item check", () => {
  it("says upgrade, in the best slot", () => {
    const c = checkItem(trial([["Ring 1", { CombinedDPS: 1050 }], ["Ring 2", { CombinedDPS: 1140, TotalEHP: 10_200 }]]), "balanced", 90);
    expect(c.verdict).toBe("upgrade");
    expect(c.best?.slot).toBe("Ring 2");
    expect(c.slots.map((s) => s.slot)).toEqual(["Ring 2", "Ring 1"]);
    expect(verdictText(c)).toBe("Upgrade for Balanced: +14% DPS, +2% effective HP in Ring 2");
  });

  it("flags an item that cuts a max hit: not for Balanced, an upgrade with a cost for Defence", () => {
    const kintsugi = trial([["Body Armour", { TotalEHP: 13_200, PhysicalMaximumHitTaken: 23_000 }]]);
    const balanced = checkItem(kintsugi, "balanced", 90);
    expect(balanced.verdict).toBe("drawback");
    expect(verdictText(balanced)).toBe("Not for Balanced: Physical max hit 30k → 23k");
    const defence = checkItem(kintsugi, "defence", 90);
    expect(defence.verdict).toBe("upgrade");
    expect(defence.best?.drawbacks).toEqual(["Physical max hit 30k → 23k"]);
  });

  it("prefers a slot without drawbacks for Balanced and Bossing", () => {
    const t = trial([
      ["Ring 1", { CombinedDPS: 1300, FireResist: 60 }],
      ["Ring 2", { CombinedDPS: 1100 }],
    ]);
    expect(checkItem(t, "bossing", 90).best?.slot).toBe("Ring 2");
    expect(checkItem(t, "damage", 90).best?.slot).toBe("Ring 1");
  });

  it("says about the same, worse, or doesn't fit", () => {
    expect(checkItem(trial([["Ring 1", { CombinedDPS: 1005 }]]), "damage", 90).verdict).toBe("same");
    const worse = checkItem(trial([["Ring 1", { CombinedDPS: 900 }]]), "damage", 90);
    expect(worse.verdict).toBe("worse");
    expect(verdictText(worse)).toBe("Not an upgrade for Damage: −10% DPS in Ring 1");
    const none = checkItem(trial([]), "damage", 90);
    expect(none.verdict).toBe("no-slot");
    expect(verdictText(none)).toBe("Doesn't fit any of this build's slots");
  });

  it("ranks by effective HP when the main skill deals no damage", () => {
    const t: ItemTrial = { ...trial([]), before: { ...before, CombinedDPS: 0 }, slots: [{ slot: "Helmet", replaces: null, stats: { ...before, CombinedDPS: 0, TotalEHP: 10_500 } }] };
    const c = checkItem(t, "damage", 90);
    expect(c.noDamage).toBe(true);
    expect(c.verdict).toBe("upgrade");
    expect(verdictText(c)).toBe("Upgrade for Damage: +5% effective HP in Helmet");
  });

  it("notes a level requirement above the character's", () => {
    expect(checkItem(trial([["Ring 1", {}]], 68), "damage", 60).tooHigh).toEqual({ needs: 68, level: 60 });
    expect(checkItem(trial([["Ring 1", {}]], 68), "damage", 68).tooHigh).toBeNull();
  });
});
