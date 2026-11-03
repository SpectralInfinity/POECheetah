import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { areaKind, clock, lastSession, parseLog, sessionStats, summarize } from "./gamelog";

const LOG = readFileSync(new URL("./__fixtures__/client-log.txt", import.meta.url), "utf8");
const at = (hms: string) => new Date(`2026-11-01T${hms}`).getTime();

describe("game log lines", () => {
  it("reads areas, deaths, level-ups, whispers and AFK; skips the rest", () => {
    const e = parseLog(`${LOG}\nnot a log line\n2026/11/01 19:31:05 1 2 [INFO Client 4321] Connecting to instance server at 1.2.3.4:6112\n`);
    expect(e[0]).toEqual({ kind: "entered", at: at("18:00:00"), area: "Celestial Hideout" });
    expect(e.find((x) => x.kind === "generated")).toEqual({ kind: "generated", at: at("19:00:00"), level: 68, areaId: "HideoutCelestial", seed: "1" });
    expect(e.filter((x) => x.kind === "slain").map((x) => x.kind === "slain" && x.name)).toEqual(["Poison_Rel", "Party_Friend", "Poison_Rel"]);
    expect(e.find((x) => x.kind === "level")).toMatchObject({ name: "Poison_Rel", className: "Scion", level: 95 });
    expect(e.find((x) => x.kind === "whisper")).toMatchObject({ from: true, name: "Some_Buyer" });
    expect(e.filter((x) => x.kind === "afk").length).toBe(2);
    expect(e.length).toBe(parseLog(LOG).length);
  });

  it("tells hideouts, towns, maps and other content apart", () => {
    expect(areaKind("Celestial Hideout")).toBe("hideout");
    expect(areaKind("Lioneye's Watch")).toBe("town");
    expect(areaKind("Cemetery", "MapWorldsCemetery")).toBe("map");
    expect(areaKind("Azurite Mine", "Delve_Main")).toBe("town");
    expect(areaKind("Forgotten Grotto", "SideArea_VaalTemple")).toBe("other");
    expect(areaKind("Cemetery")).toBe("other");
  });
});

describe("runs and sessions", () => {
  const events = parseLog(LOG);

  it("starts a new session after a long break", () => {
    const s = lastSession(events);
    expect(s[0].at).toBe(at("19:00:00"));
  });

  it("counts a map once across portals, and side areas as part of it", () => {
    const s = summarize(lastSession(events));
    expect(s.character).toBe("Poison_Rel");
    expect(s.runs.map((r) => [r.area, r.level, r.deaths, clock(r.active)])).toEqual([
      // 19:00:35–19:03:25 and 19:04:30–19:07:35: one run, through a portal.
      ["Cemetery", 83, 1, "5:55"],
      // 19:08:40–19:14:55, the Vaal side area included.
      ["Crimson Temple", 83, 1, "6:15"],
    ]);
    // A party member's death isn't counted.
    expect(s.deaths).toBe(2);
    expect(s.levels.map((l) => l.level)).toEqual([95, 96]);
    expect(s.afk).toBe(10 * 60 * 1000);
    // Delve (from the hideout) isn't a map run, nor added to the last one.
    expect(s.current).toMatchObject({ area: "Celestial Hideout", kind: "hideout" });
  });

  it("gives maps per hour, the median map, deaths per map and leveling pace", () => {
    const st = sessionStats(summarize(lastSession(events)));
    // 19:00:00–19:31:00 = 31 min, minus 10 AFK = 21 min.
    expect(st.hours).toBeCloseTo(21 / 60);
    expect(st.maps).toBe(2);
    expect(st.mapsPerHour).toBeCloseTo(2 / (21 / 60));
    expect(clock(st.medianMap)).toBe("6:05");
    expect(st.deathsByMap).toEqual([
      { area: "Cemetery", runs: 1, deaths: 1 },
      { area: "Crimson Temple", runs: 1, deaths: 1 },
    ]);
    expect(st.leveling).toEqual({ from: 94, to: 96, perHour: 2 / (21 / 60), lastLevelMinutes: 24.5 });
  });

  it("counts deaths of a named character only, and keeps the timer running until now", () => {
    const s = summarize(lastSession(events), "Party_Friend", at("19:40:00"));
    expect(s.deaths).toBe(1);
    expect(s.levels).toEqual([]);
    expect(s.end).toBe(at("19:40:00"));
  });

  it("without area ids, treats an area entered from a hideout or town as a map, by name", () => {
    const noIds = parseLog(LOG.split("\n").filter((l) => !l.includes("Generating")).join("\n"));
    const s = summarize(lastSession(noIds));
    // The limit of names alone: a Delve node entered from Azurite Mine looks like a map.
    expect(s.runs.map((r) => r.area)).toEqual(["Cemetery", "Crimson Temple", "Abyssal Depths"]);
    expect(s.runs[1].deaths).toBe(1);
  });
});

it("formats durations", () => {
  expect(clock(754_000)).toBe("12:34");
  expect(clock(4_000_000)).toBe("1:06:40");
});
