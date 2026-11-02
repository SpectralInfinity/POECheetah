import { describe, expect, it } from "vitest";
import {
  characterPageUrl,
  choicesInXml,
  dictionaryUrl,
  ladderFor,
  ladderSearchUrl,
  metaGaps,
  parseDictionary,
  parseLadderSearch,
  popular,
  rankGaps,
} from "./ladder";
import indexState from "./__fixtures__/ninja-index-state.json";
import type { UpgradeResult } from "./upgrades";
import type { PassiveResult } from "./passives";

// A tiny protobuf writer, to make poe.ninja-shaped answers (tests never call the network).
const enc = new TextEncoder();
const varint = (n: number) => {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
};
const int = (no: number, v: number) => [...varint(no * 8), ...varint(v)];
const bytes = (no: number, b: number[] | Uint8Array) => [...varint(no * 8 + 2), ...varint(b.length), ...b];
const str = (no: number, s: string) => bytes(no, [...enc.encode(s)]);
const entry = (index: number, count: number) => bytes(3, [...(index ? int(1, index) : []), ...int(2, count)]);
const dim = (id: string, dict: string, entries: number[][]) => bytes(2, [...str(1, id), ...str(2, dict), ...entries.flat()]);

function search(): Uint8Array {
  const root = [
    ...int(1, 20),
    ...dim("items", "item", [entry(0, 18), entry(1, 15), entry(2, 9), entry(3, 7), entry(4, 2)]),
    ...dim("keypassives", "keypassive", [entry(0, 20), entry(1, 11), entry(2, 6)]),
    ...dim("allgems", "gem", [entry(0, 20), entry(1, 19), entry(2, 8)]),
    ...dim("supportgems-Poisonous Concoction of Bouncing", "gem", [entry(1, 19), entry(2, 8)]),
    ...dim("anointed", "anointed", [entry(0, 5)]),
    ...bytes(6, [...str(1, "item"), ...str(2, "hash-item"), ...str(3, "other")]),
    ...bytes(6, [...str(1, "gem"), ...str(2, "hash-gem")]),
    ...bytes(12, [...str(1, "name"), ...str(2, "name"), ...int(4, 1), ...str(7, "Poison_One"), ...str(7, "Poison_Two")]),
    ...bytes(12, [...str(1, "account"), ...str(2, "account"), ...int(4, 1), ...str(7, "Someone-1234"), ...str(7, "Other-0001")]),
    ...bytes(12, [...str(1, "level"), ...str(2, "level"), ...bytes(6, [98, 97]), ...int(13, 2)]),
    ...bytes(12, [...str(1, "ehp__str"), ...str(2, "ehp"), ...int(4, 1), ...str(7, "179k"), ...str(7, "76k")]),
    ...bytes(12, [...str(1, "dps-Poisonous Concoction of Bouncing"), ...str(2, "dps"), ...int(4, 1), ...str(7, "2.1M"), ...str(7, "3.6M")]),
  ];
  return new Uint8Array(bytes(1, root));
}

/** "NDIC" v2: 36-byte header (count at 12, sparse index size at 28), the index, one length byte per name, the names. */
function ndic(names: string[], sparse = 1): Uint8Array {
  const head = new Uint8Array(36 + 8 * sparse);
  head.set(enc.encode("NDIC"), 0);
  const view = new DataView(head.buffer);
  view.setUint32(12, names.length, true);
  view.setUint32(28, sparse, true);
  const encoded = names.map((n) => enc.encode(n));
  const lens = encoded.map((e) => e.length);
  return new Uint8Array([...head, ...lens, ...encoded.flatMap((e) => [...e])]);
}

const names = new Map<string, string[]>([
  ["item", ["Cloak of Flame", "Asenath's Gentle Touch", "Rare Boots", "The Writhing Jar", "Snakebite"]],
  ["keypassive", ["Tempered by War", " Magebane", "Armour Display"]],
  ["gem", ["Poisonous Concoction of Bouncing", "Unbound Ailments Support", "Vicious Projectiles Support"]],
  ["anointed", ["Whispers of Doom"]],
]);

describe("poe.ninja ladder data", () => {
  it("reads the search answer: total, dimensions, dictionaries, characters", () => {
    const s = parseLadderSearch(search());
    expect(s.total).toBe(20);
    expect(s.dimensions.get("items")?.entries[0]).toEqual({ index: 0, count: 18 });
    expect(s.dictionaries.get("item")).toBe("hash-item");
    expect(s.characters).toEqual([
      { name: "Poison_One", account: "Someone-1234", level: 98, dps: "2.1M", ehp: "179k" },
      { name: "Poison_Two", account: "Other-0001", level: 97, dps: "3.6M", ehp: "76k" },
    ]);
    expect(() => parseLadderSearch(new Uint8Array([0xff]))).toThrow();
  });

  it("reads a name dictionary", () => {
    expect(parseDictionary(ndic(["Acrobatics", "Ancestral Bond", "Ondar's Guile"]))).toEqual(["Acrobatics", "Ancestral Bond", "Ondar's Guile"]);
    expect(() => parseDictionary(enc.encode("NOPE and more bytes than the header needs to be read safely"))).toThrow();
  });

  it("finds the ladder and its addresses", () => {
    const ladder = ladderFor(indexState, "Mercenaries")!;
    expect(ladder).toEqual({ version: "0001-20261001-00001", overview: "mercenaries" });
    expect(ladderFor(indexState, "Gone")).toBeNull();
    expect(ladderSearchUrl(ladder, { ascendancy: "Reliquarian", skill: "Poisonous Concoction of Bouncing" })).toBe(
      "https://poe.ninja/poe1/api/builds/0001-20261001-00001/search?overview=mercenaries&type=exp&class=Reliquarian&skills=Poisonous+Concoction+of+Bouncing",
    );
    expect(dictionaryUrl("abc")).toBe("https://poe.ninja/poe1/api/builds/dictionary/abc");
    expect(characterPageUrl("mercenaries", { name: "Big Poison", account: "Some-1" })).toBe(
      "https://poe.ninja/poe1/builds/mercenaries/character/Some-1/Big%20Poison",
    );
  });

  it("names popular choices as shares, leaving out generic gear", () => {
    const s = parseLadderSearch(search());
    expect(popular(s, "items", names).map((p) => [p.name, p.share])).toEqual([
      ["Cloak of Flame", 0.9],
      ["Asenath's Gentle Touch", 0.75],
      ["The Writhing Jar", 0.35],
      ["Snakebite", 0.1],
    ]);
    expect(popular(s, "keypassives", names)[1].name).toBe("Magebane");
    expect(popular(s, "nope", names)).toEqual([]);
  });
});

const XML = `<PathOfBuilding><Items>
<Item id="1">
Rarity: UNIQUE
Cloak of Flame
Scholar's Robe
</Item>
<Item id="2">
Rarity: RARE
Doom Clasp
Onyx Amulet
{crafted}Allocates Whispers of Doom
</Item>
<Item id="3">Rarity: UNIQUE
Watcher&apos;s Eye
Prismatic Jewel</Item>
</Items><Skills><Skill><Gem nameSpec="Unbound Ailments" level="20"/><Gem nameSpec="Poisonous Concoction of Bouncing"/></Skill></Skills></PathOfBuilding>`;

describe("meta gaps", () => {
  it("reads what my build has, by poe.ninja's names", () => {
    const mine = choicesInXml(XML, ["Armour Display"]);
    expect([...mine.uniques]).toEqual(["Cloak of Flame", "Watcher's Eye"]);
    expect([...mine.anoints]).toEqual(["Whispers of Doom"]);
    expect(mine.gems.has("Unbound Ailments Support")).toBe(true);
    expect(mine.keystones.has("Armour Display")).toBe(true);
    expect(mine.keystones.has("Cloak of Flame")).toBe(true);
  });

  it("lists popular choices I lack, most popular first, the skill's own supports for gems", () => {
    const gaps = metaGaps(parseLadderSearch(search()), names, choicesInXml(XML, ["Armour Display"]), "Poisonous Concoction of Bouncing");
    expect(gaps.map((g) => `${g.kind} ${g.name} ${Math.round(g.share * 100)}%`)).toEqual([
      "keystone Tempered by War 100%",
      "unique Asenath's Gentle Touch 75%",
      "keystone Magebane 55%",
      "gem Vicious Projectiles Support 40%",
      "unique The Writhing Jar 35%",
    ]);
  });

  it("ranks them by real gain on my build; the rest by popularity, with why", () => {
    const gaps = metaGaps(parseLadderSearch(search()), names, choicesInXml(XML, []), "Poisonous Concoction of Bouncing");
    const before = { CombinedDPS: 1000, TotalEHP: 10_000, PhysicalMaximumHitTaken: 30_000 };
    const trial = (name: string, slot: string, dps: number, extra = {}) => ({
      name,
      base: "b",
      slot,
      slotName: slot,
      replaces: "Old",
      level: 60,
      stats: { ...before, CombinedDPS: dps, ...extra },
    });
    const uniques: UpgradeResult = {
      mode: "conservative",
      level: 95,
      before,
      slots: [],
      uniques: [
        trial("Asenath's Gentle Touch", "Gloves", 1050, { PhysicalMaximumHitTaken: 20_000 }),
        trial("The Writhing Jar", "Flask 1", 1000),
      ],
      missing: [],
      flasks: [],
    };
    const passives: PassiveResult = {
      before,
      level: 95,
      pointsUsed: 120,
      extraPoints: 0,
      ascendancyUsed: 8,
      candidates: [{ id: 1, kind: "keystone", name: "Magebane", lines: [], points: 3, via: [], stats: { ...before, CombinedDPS: 1080 } }],
      masterySwaps: [],
    };
    const ranked = rankGaps(gaps, "damage", uniques, passives);
    expect(ranked.map((r) => [r.name, r.tried, r.gain && Math.round(r.gain * 100)])).toEqual([
      ["Magebane", true, 8],
      ["Asenath's Gentle Touch", true, 5],
      ["The Writhing Jar", true, 0],
      ["Tempered by War", false, undefined],
      ["Vicious Projectiles Support", false, undefined],
      ["Armour Display", false, undefined],
    ]);
    expect(ranked[0].where).toBe("3 points");
    expect(ranked[1].where).toBe("Gloves (replacing Old)");
    expect(ranked[1].drawbacks).toEqual(["Physical max hit 30k → 20k"]);
    expect(ranked[2].note).toContain("doesn't model its worms");
    expect(ranked[3].note).toContain("Not within 4 points");
    expect(ranked[4].note).toContain("Deep analysis");
    const unfit = rankGaps([{ kind: "unique", name: "Kintsugi", count: 10, share: 0.5 }], "damage", uniques, passives);
    expect(unfit[0].note).toBe("Doesn't fit your active slots (or reshapes the tree).");
    const unknown = rankGaps([{ kind: "unique", name: "Kintsugi", count: 10, share: 0.5 }], "damage", { ...uniques, missing: ["Kintsugi"] }, passives);
    expect(unknown[0].note).toBe("Path of Building doesn't know this unique.");
  });
});
