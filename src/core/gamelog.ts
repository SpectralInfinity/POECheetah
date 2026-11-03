// Run tracker (design doc §3.4): the game's log, `Client.txt`. It records
// areas entered, deaths, level-ups and whispers, with times; never loot,
// damage or gear. Line formats from community parsers; the owner's log
// confirms the area generation line ("[DEBUG Client N] Generating level 83
// area "MapWorldsPark" with seed N"), so maps are told apart by id and seed.

export type LogEvent =
  | { kind: "generated"; at: number; level: number; areaId: string; seed: string }
  | { kind: "entered"; at: number; area: string }
  | { kind: "slain"; at: number; name: string }
  | { kind: "level"; at: number; name: string; className: string; level: number }
  | { kind: "whisper"; at: number; from: boolean; name: string; text: string }
  | { kind: "afk"; at: number; on: boolean };

const PREFIX = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2}) .*?\[\w+ Client \d+\] (.*)$/;

/** Reads log lines; anything else is skipped. Times are the log's (local) clock, in ms. */
export function parseLog(text: string): LogEvent[] {
  const out: LogEvent[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(PREFIX);
    if (!m) continue;
    const at = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    const msg = m[7];
    let x: RegExpMatchArray | null;
    if ((x = msg.match(/^Generating level (\d+) area "([^"]+)"(?: with seed (\d+))?/))) {
      out.push({ kind: "generated", at, level: +x[1], areaId: x[2], seed: x[3] ?? "" });
    } else if ((x = msg.match(/^: You have entered (.+)\.$/))) {
      out.push({ kind: "entered", at, area: x[1] });
    } else if ((x = msg.match(/^: (\S+) has been slain\.$/))) {
      out.push({ kind: "slain", at, name: x[1] });
    } else if ((x = msg.match(/^: (\S+) \((\w+)\) is now level (\d+)$/))) {
      out.push({ kind: "level", at, name: x[1], className: x[2], level: +x[3] });
    } else if ((x = msg.match(/^@(From|To) (?:<[^>]*> )?([^:]+): (.*)$/))) {
      out.push({ kind: "whisper", at, from: x[1] === "From", name: x[2], text: x[3] });
    } else if ((x = msg.match(/^: AFK mode is now (ON|OFF)/))) {
      out.push({ kind: "afk", at, on: x[1] === "ON" });
    }
  }
  return out;
}

// --- Areas ---------------------------------------------------------------------

/** Towns and other safe hubs (the campaign's and league hubs'); hideouts end in "Hideout". */
const TOWNS = new Set([
  "Lioneye's Watch",
  "The Forest Encampment",
  "The Sarn Encampment",
  "Highgate",
  "Overseer's Tower",
  "The Bridge Encampment",
  "Oriath",
  "Oriath Docks",
  "Karui Shores",
  "The Rogue Harbour",
  "Azurite Mine",
  "The Menagerie",
  "Kingsmarch",
]);

export type AreaKind = "hideout" | "town" | "map" | "other";

/** What an area is: a safe place, a map (by its generated id when known), or other content. */
export function areaKind(name: string, areaId?: string): AreaKind {
  if (/hideout/i.test(name) || /hideout/i.test(areaId ?? "")) return "hideout";
  if (TOWNS.has(name) || /town/i.test(areaId ?? "")) return "town";
  if (areaId !== undefined) return /^Map/.test(areaId) && !/Hideout/.test(areaId) ? "map" : "other";
  return "other";
}

// --- Runs and sessions -------------------------------------------------------------

export interface Run {
  /** The map's name, as entered. */
  area: string;
  /** Area level, when the log says. */
  level?: number;
  start: number;
  end: number;
  /** Time spent in the map (and areas opened from it), not in hideout or town. */
  active: number;
  deaths: number;
}

export interface LevelUp {
  at: number;
  level: number;
}

export interface Session {
  start: number;
  end: number;
  runs: Run[];
  /** Deaths of the character, in maps or elsewhere. */
  deaths: number;
  /** Time in hideouts and towns. */
  idle: number;
  /** Time AFK. */
  afk: number;
  levels: LevelUp[];
  /** The character whose deaths and levels count (the one levelling, or the one named). */
  character: string | null;
  /** The area entered last, and since when (the overlay's timer). */
  current: { area: string; kind: AreaKind; since: number; inRun: boolean } | null;
}

/** A break this long between log lines starts a new play session. */
export const SESSION_GAP = 30 * 60 * 1000;

/** The events of the last play session (after the last long break). */
export function lastSession(events: LogEvent[]): LogEvent[] {
  let start = 0;
  for (let i = 1; i < events.length; i++) {
    if (events[i].at - events[i - 1].at > SESSION_GAP) start = i;
  }
  return events.slice(start);
}

/** The character the log levels most, when the player hasn't named one. */
function guessCharacter(events: LogEvent[]): string | null {
  const counts = new Map<string, number>();
  for (const e of events) if (e.kind === "level") counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Turns a session's events into map runs. A run starts on entering a map and
 * lasts until another map is entered: going back to the hideout and through
 * the portal again (same seed, or same name when the log has no seeds) is
 * the same run. Time in hideouts and towns isn't the map's.
 */
export function summarize(events: LogEvent[], character?: string | null, now?: number): Session {
  const me = character?.trim() || guessCharacter(events);
  const runs: Run[] = [];
  const levels: LevelUp[] = [];
  let pending: { areaId: string; level: number; seed: string } | null = null;
  let current = null as Session["current"];
  let run = null as (Run & { key: string }) | null;
  let idle = 0;
  let afk = 0;
  let afkSince: number | null = null;
  let deaths = 0;

  const leave = (at: number) => {
    if (!current) return;
    const spent = Math.max(0, at - current.since);
    if (current.kind === "hideout" || current.kind === "town") idle += spent;
    else if (current.inRun && run) {
      run.active += spent;
      run.end = at;
    }
  };

  for (const e of events) {
    if (e.kind === "generated") pending = { areaId: e.areaId, level: e.level, seed: e.seed };
    else if (e.kind === "entered") {
      leave(e.at);
      const info = pending;
      pending = null;
      const kind = info ? areaKind(e.area, info.areaId) : areaKind(e.area);
      const fromSafety: boolean = !current || current.kind === "hideout" || current.kind === "town";
      // Without area ids, any area outside hideouts and towns entered from one is a map.
      const isMap: boolean = kind === "map" || (!info && kind === "other" && fromSafety);
      // Areas opened from a map (side areas, abyssal depths) count to its run.
      const inRun: boolean = isMap || (kind === "other" && !fromSafety && !!current?.inRun);
      current = { area: e.area, kind: isMap ? "map" : kind, since: e.at, inRun };
      if (isMap) {
        const key = info?.seed ? `${info.areaId}#${info.seed}` : e.area;
        if (!run || run.key !== key) {
          if (run) runs.push(stripKey(run));
          run = { key, area: e.area, level: info?.level, start: e.at, end: e.at, active: 0, deaths: 0 };
        }
      }
    } else if (e.kind === "slain" && (!me || e.name === me)) {
      deaths++;
      if (run && current?.inRun) run.deaths++;
    } else if (e.kind === "level" && (!me || e.name === me)) levels.push({ at: e.at, level: e.level });
    else if (e.kind === "afk") {
      if (e.on) afkSince = e.at;
      else if (afkSince !== null) {
        afk += e.at - afkSince;
        afkSince = null;
      }
    }
  }
  const end = Math.max(now ?? 0, events.length ? events[events.length - 1].at : 0);
  leave(end);
  if (afkSince !== null) afk += end - afkSince;
  if (run) runs.push(stripKey(run));
  return { start: events[0]?.at ?? end, end, runs, deaths, idle, afk, levels, character: me, current };
}

const stripKey = ({ key: _key, ...run }: Run & { key: string }): Run => run;

export interface SessionStats {
  hours: number;
  maps: number;
  mapsPerHour: number;
  /** Median time in a map (ms). */
  medianMap: number;
  /** Deaths per map name, most first. */
  deathsByMap: { area: string; runs: number; deaths: number }[];
  /** Levels gained this session and the pace; null without level-ups. */
  leveling: { from: number; to: number; perHour: number; lastLevelMinutes: number | null } | null;
  /** Share of the session in hideouts and towns. */
  idleShare: number;
}

const HOUR = 3600 * 1000;

export function sessionStats(s: Session): SessionStats {
  const hours = Math.max(0, (s.end - s.start - s.afk) / HOUR);
  const times = s.runs.map((r) => r.active).sort((a, b) => a - b);
  const mid = times.length ? (times.length % 2 ? times[(times.length - 1) / 2] : (times[times.length / 2 - 1] + times[times.length / 2]) / 2) : 0;
  const byMap = new Map<string, { area: string; runs: number; deaths: number }>();
  for (const r of s.runs) {
    const m = byMap.get(r.area) ?? { area: r.area, runs: 0, deaths: 0 };
    m.runs++;
    m.deaths += r.deaths;
    byMap.set(r.area, m);
  }
  const lv = s.levels;
  const leveling =
    lv.length > 0
      ? {
          from: lv[0].level - 1,
          to: lv[lv.length - 1].level,
          perHour: hours > 0 ? lv.length / hours : 0,
          lastLevelMinutes: lv.length > 1 ? (lv[lv.length - 1].at - lv[lv.length - 2].at) / 60000 : null,
        }
      : null;
  return {
    hours,
    maps: s.runs.length,
    mapsPerHour: hours > 0 ? s.runs.length / hours : 0,
    medianMap: mid,
    deathsByMap: [...byMap.values()].filter((m) => m.deaths > 0).sort((a, b) => b.deaths - a.deaths || b.runs - a.runs),
    leveling,
    idleShare: s.end > s.start ? s.idle / (s.end - s.start) : 0,
  };
}

/** 754000 → "12:34", 4000000 → "1:06:40". */
export function clock(ms: number): string {
  const t = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}
