import { describe, expect, it } from "vitest";
import { ninjaCharacterUrl, ninjaCode, readBuildLink } from "./buildLink";
import indexState from "./__fixtures__/ninja-index-state.json";

describe("build links", () => {
  it("reads pobb.in and pastebin links as their raw pages", () => {
    expect(readBuildLink("https://pobb.in/AbC-12_x")).toEqual({ kind: "raw", url: "https://pobb.in/AbC-12_x/raw" });
    expect(readBuildLink(" https://pobb.in/AbC/raw ")).toEqual({ kind: "raw", url: "https://pobb.in/AbC/raw" });
    expect(readBuildLink("https://pobb.in/u/someone/AbC")).toEqual({ kind: "raw", url: "https://pobb.in/AbC/raw" });
    expect(readBuildLink("https://pastebin.com/Xy12Ab")).toEqual({ kind: "raw", url: "https://pastebin.com/raw/Xy12Ab" });
    expect(readBuildLink("https://pastebin.com/raw/Xy12Ab")).toEqual({ kind: "raw", url: "https://pastebin.com/raw/Xy12Ab" });
  });

  it("reads poe.ninja character pages", () => {
    expect(readBuildLink("https://poe.ninja/poe1/builds/testleague/character/Some-Account_1234/Big%20Poison?i=3")).toEqual({
      kind: "ninja",
      league: "testleague",
      account: "Some-Account_1234",
      name: "Big Poison",
    });
    expect(readBuildLink("https://poe.ninja/builds/testleague/character/A/B")).toMatchObject({ kind: "ninja", account: "A" });
    expect(readBuildLink("https://poe.ninja/poe1/builds/testleague")).toBeNull();
  });

  it("ignores codes and other sites", () => {
    expect(readBuildLink("eNrtfWtz2sqy6Of8iik")).toBeNull();
    expect(readBuildLink("https://maxroll.gg/poe/planner/abc")).toBeNull();
    expect(readBuildLink("https://example.com/AbC")).toBeNull();
  });

  it("finds poe.ninja's character data for the page's ladder", () => {
    const link = { kind: "ninja" as const, league: "hardcore-mercenaries", account: "Some Account", name: "Big Poison" };
    expect(ninjaCharacterUrl(indexState, link)).toBe(
      "https://poe.ninja/poe1/api/builds/0003-20261001-00003/character?account=Some+Account&name=Big+Poison&overview=mercenarieshc&type=exp",
    );
    expect(() => ninjaCharacterUrl(indexState, { ...link, league: "gone" })).toThrow('no ladder called "gone"');
    expect(ninjaCode({ pathOfBuildingExport: " eNrt " })).toBe("eNrt");
    expect(() => ninjaCode({})).toThrow("no Path of Building code");
  });
});
