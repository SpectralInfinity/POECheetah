import { change } from "./analysis";
import { goalGain, type Goal } from "./goals";
import { drawbacks, type PassiveResult } from "./passives";
import type { UpgradeResult } from "./upgrades";

// poe.ninja's ladder (design doc §3.11, §3.12 items 1–2): what characters
// with the same main skill and ascendancy use. Its build API is undocumented
// and binary: a protobuf search result, and "NDIC" name dictionaries. Shapes
// checked 2026-10-12 and 2026-11-02 (design doc §3.11).

const NINJA = "https://poe.ninja/poe1/api";

// --- Protobuf, just enough to read the search result -------------------------

interface Field {
  no: number;
  /** Varint value (wire type 0). */
  int?: number;
  /** Length-delimited bytes (wire type 2). */
  bytes?: Uint8Array;
}

function fields(b: Uint8Array): Field[] {
  const out: Field[] = [];
  let i = 0;
  const varint = () => {
    let value = 0;
    let scale = 1;
    for (;;) {
      if (i >= b.length) throw new Error("poe.ninja sent data the app can't read.");
      const c = b[i++];
      value += (c & 0x7f) * scale;
      scale *= 128;
      if (c < 0x80) return value;
    }
  };
  while (i < b.length) {
    const key = varint();
    const no = Math.floor(key / 8);
    const wire = key % 8;
    if (wire === 0) out.push({ no, int: varint() });
    else if (wire === 2) {
      const n = varint();
      out.push({ no, bytes: b.subarray(i, i + n) });
      i += n;
    } else if (wire === 1) i += 8;
    else if (wire === 5) i += 4;
    else throw new Error("poe.ninja sent data the app can't read.");
  }
  return out;
}

const text = (b?: Uint8Array) => (b ? new TextDecoder().decode(b) : "");

export interface Dimension {
  /** Which dictionary names its entries ("item", "gem", "keypassive", "anointed"). */
  dictionary: string;
  entries: { index: number; count: number }[];
}

export interface LadderCharacter {
  name: string;
  account: string;
  level?: number;
  /** poe.ninja's own figures, as it shows them ("2.1M", "179k"). */
  dps?: string;
  ehp?: string;
}

export interface LadderSearch {
  /** Characters matching the filters. */
  total: number;
  /** By dimension id: "items", "keypassives", "allgems", "anointed", "supportgems-<skill>"… */
  dimensions: Map<string, Dimension>;
  /** Dictionary hash by dictionary type. */
  dictionaries: Map<string, string>;
  /** The listed characters, in poe.ninja's order. */
  characters: LadderCharacter[];
}

/** Reads poe.ninja's ladder search result (protobuf). */
export function parseLadderSearch(bytes: Uint8Array): LadderSearch {
  const root = fields(bytes).find((f) => f.no === 1 && f.bytes)?.bytes;
  if (!root) throw new Error("poe.ninja's ladder answer was empty.");
  const s: LadderSearch = { total: 0, dimensions: new Map(), dictionaries: new Map(), characters: [] };
  const columns = new Map<string, Field[]>();
  for (const f of fields(root)) {
    if (f.no === 1 && f.int !== undefined) s.total = f.int;
    else if (f.no === 2 && f.bytes) {
      const d = fields(f.bytes);
      const id = text(d.find((x) => x.no === 1)?.bytes);
      const entries = d
        .filter((x) => x.no === 3 && x.bytes)
        .map((x) => {
          const e = fields(x.bytes!);
          return { index: e.find((y) => y.no === 1)?.int ?? 0, count: e.find((y) => y.no === 2)?.int ?? 0 };
        });
      s.dimensions.set(id, { dictionary: text(d.find((x) => x.no === 2)?.bytes), entries });
    } else if (f.no === 6 && f.bytes) {
      const d = fields(f.bytes);
      s.dictionaries.set(text(d.find((x) => x.no === 1)?.bytes), text(d.find((x) => x.no === 2)?.bytes));
    } else if (f.no === 12 && f.bytes) {
      const c = fields(f.bytes);
      const id = text(c.find((x) => x.no === 1)?.bytes);
      if (!columns.has(id)) columns.set(id, c);
    }
  }
  const strings = (id: string) => (columns.get(id) ?? []).filter((x) => x.no === 7).map((x) => text(x.bytes));
  const names = strings("name");
  const accounts = strings("account");
  const levels = (columns.get("level") ?? []).find((x) => x.no === 6)?.bytes;
  const dpsId = [...columns.keys()].find((k) => k.startsWith("dps") && (columns.get(k) ?? []).some((x) => x.no === 7));
  const dps = dpsId ? strings(dpsId) : [];
  const ehp = strings("ehp__str");
  s.characters = names.map((name, i) => ({
    name,
    account: accounts[i] ?? "",
    level: levels?.[i],
    dps: dps[i],
    ehp: ehp[i],
  }));
  return s;
}

/** Reads a poe.ninja name dictionary ("NDIC" v2): the names, by index. */
export function parseDictionary(b: Uint8Array): string[] {
  if (text(b.subarray(0, 4)) !== "NDIC") throw new Error("poe.ninja sent a name list the app can't read.");
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const count = view.getUint32(12, true);
  const sparse = view.getUint32(28, true);
  const start = 36 + 8 * sparse;
  const names: string[] = [];
  let at = start + count;
  for (let k = 0; k < count; k++) {
    const n = b[start + k];
    names.push(text(b.subarray(at, at + n)));
    at += n;
  }
  if (at !== b.length) throw new Error("poe.ninja sent a name list the app can't read.");
  return names;
}

// --- Addresses ------------------------------------------------------------------

/** The ladder (snapshot) for a league, from poe.ninja's `index-state`; null when it has none. */
export function ladderFor(indexState: unknown, league: string): { version: string; overview: string } | null {
  const list = (indexState as { snapshotVersions?: { url: string; type: string; version: string; name?: string }[] })?.snapshotVersions ?? [];
  const v = list.find((x) => x.type === "exp" && (x.name === league || x.url === league));
  return v ? { version: v.version, overview: v.url } : null;
}

export function ladderSearchUrl(ladder: { version: string; overview: string }, filter: { ascendancy?: string; skill?: string }): string {
  const q = new URLSearchParams({ overview: ladder.overview, type: "exp" });
  if (filter.ascendancy) q.set("class", filter.ascendancy);
  if (filter.skill) q.set("skills", filter.skill);
  return `${NINJA}/builds/${encodeURIComponent(ladder.version)}/search?${q}`;
}

export const dictionaryUrl = (hash: string) => `${NINJA}/builds/dictionary/${encodeURIComponent(hash)}`;

/** A character's page on poe.ninja (the Compare panel reads these links). */
export const characterPageUrl = (overview: string, c: LadderCharacter) =>
  `https://poe.ninja/poe1/builds/${encodeURIComponent(overview)}/character/${encodeURIComponent(c.account)}/${encodeURIComponent(c.name)}`;

// --- What the ladder uses that I don't -------------------------------------------

export interface Popular {
  name: string;
  count: number;
  /** Share of the matching characters (0.78 = 78%). */
  share: number;
}

/** poe.ninja counts non-unique gear too, as "Rare Boots", "Magic Flask". */
const GENERIC_ITEM = /^(Normal|Magic|Rare) /;

/** A dimension's entries named and as shares, most used first. */
export function popular(s: LadderSearch, dimension: string, names: Map<string, string[]>): Popular[] {
  const d = s.dimensions.get(dimension);
  const dict = d && names.get(d.dictionary);
  if (!d || !dict || s.total === 0) return [];
  return d.entries
    .filter((e) => dict[e.index]?.trim() && e.count > 0)
    .map((e) => ({ name: dict[e.index].trim(), count: e.count, share: e.count / s.total }))
    .filter((p) => !(d.dictionary === "item" && GENERIC_ITEM.test(p.name)))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export type GapKind = "unique" | "keystone" | "gem" | "anoint";

export interface MetaGap extends Popular {
  kind: GapKind;
}

export interface MyChoices {
  uniques: Set<string>;
  keystones: Set<string>;
  gems: Set<string>;
  anoints: Set<string>;
}

/** Below this share (20%) a choice isn't "popular". */
export const MIN_SHARE = 0.2;

/** Popular choices the build doesn't have (design doc §3.11): "78% use X". */
export function metaGaps(s: LadderSearch, names: Map<string, string[]>, mine: MyChoices, skill: string, minShare = MIN_SHARE): MetaGap[] {
  const out: MetaGap[] = [];
  const add = (kind: GapKind, dimension: string, have: Set<string>) => {
    for (const p of popular(s, dimension, names)) {
      if (p.share >= minShare && !have.has(p.name) && !(kind === "gem" && p.name === skill)) out.push({ ...p, kind });
    }
  };
  add("unique", "items", mine.uniques);
  add("keystone", "keypassives", mine.keystones);
  // The main skill's own supports when poe.ninja has them; else every gem.
  add("gem", s.dimensions.has(`supportgems-${skill}`) ? `supportgems-${skill}` : "allgems", mine.gems);
  add("anoint", "anointed", mine.anoints);
  return out.sort((a, b) => b.share - a.share);
}

const unescape = (s: string) =>
  s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/**
 * Uniques, gems and anoints a build (PoB XML) has, by the names poe.ninja
 * uses; `allocated` is the engine's list of allocated keystones, notables and
 * ascendancy nodes (poe.ninja's "keypassives" mixes all three).
 */
export function choicesInXml(xml: string, allocated: string[]): MyChoices {
  xml = unescape(xml);
  const uniques = new Set<string>();
  const anoints = new Set<string>();
  for (const m of xml.matchAll(/<Item\b[^>]*>([\s\S]*?)<\/Item>/g)) {
    const lines = m[1].split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const rarity = lines.findIndex((l) => /^Rarity:\s*UNIQUE/i.test(l));
    if (rarity >= 0 && lines[rarity + 1]) uniques.add(lines[rarity + 1]);
    for (const l of lines) {
      const a = l.replace(/^(\{[^}]*\})+/, "").match(/^Allocates (.+?)(?: if you have the matching modifier on Forbidden \w+)?$/);
      if (a) anoints.add(a[1]);
    }
  }
  const gems = new Set<string>();
  for (const m of xml.matchAll(/<Gem\b[^>]*\snameSpec="([^"]+)"[^>]*>/g)) {
    gems.add(m[1]);
    // poe.ninja names supports "… Support"; PoB doesn't.
    gems.add(`${m[1]} Support`);
  }
  // A unique can grant a keystone of its own name (Dawnbreaker).
  return { uniques, keystones: new Set([...allocated, ...uniques]), gems, anoints };
}

// --- Real gain on my build -------------------------------------------------------

export interface RankedGap extends MetaGap {
  /** Path of Building tried it on my build. */
  tried: boolean;
  /** Relative DPS and effective HP change (0.1 = +10%), and the goal's gain. */
  dps?: number;
  ehp?: number;
  gain?: number;
  drawbacks?: string[];
  /** Where: the slot, or "3 points" for a passive. */
  where?: string;
  /** Why it wasn't tried, or what to know. */
  note?: string;
}

/** Popular uniques whose point Path of Building doesn't model. */
const UNMODELLED: Record<string, string> = {
  "The Writhing Jar": "Path of Building doesn't model its worms: players run it for on-kill effects (charges, Killed Recently) against a boss.",
};

/** Below this gain a popular choice is "popular, small gain for you". */
export const STRONG = 0.01;

/**
 * Each popular choice with its real gain on my build (design doc §3.11):
 * uniques from the engine's unique trials (the best slot), passives from the
 * passive advisor's candidates (path included). Gems and anoints are shown by
 * popularity only. Tried ones first, by gain; then the rest by share.
 */
export function rankGaps(
  gaps: MetaGap[],
  goal: Goal,
  uniques: UpgradeResult | null,
  passives: PassiveResult | null,
): RankedGap[] {
  const out: RankedGap[] = gaps.map((g) => {
    if (g.kind === "unique" && uniques) {
      const before = uniques.before;
      const noDamage = !((before.CombinedDPS ?? 0) > 0);
      const trials = uniques.uniques.filter((t) => t.name === g.name && t.level <= uniques.level);
      if (trials.length === 0) {
        const note = uniques.missing.includes(g.name)
          ? "Path of Building doesn't know this unique."
          : uniques.uniques.some((t) => t.name === g.name)
            ? "Needs a higher level."
            : "Doesn't fit your active slots (or reshapes the tree).";
        return { ...g, tried: false, note };
      }
      const best = trials
        .map((t) => {
          const dps = change(before.CombinedDPS ?? 0, t.stats.CombinedDPS ?? 0);
          const ehp = change(before.TotalEHP ?? 0, t.stats.TotalEHP ?? 0);
          return { t, dps, ehp, gain: noDamage ? ehp : goalGain(goal, dps, ehp) };
        })
        .sort((a, b) => b.gain - a.gain)[0];
      return {
        ...g,
        tried: true,
        dps: best.dps,
        ehp: best.ehp,
        gain: best.gain,
        drawbacks: drawbacks(before, best.t.stats),
        where: best.t.slot + (best.t.replaces ? ` (replacing ${best.t.replaces})` : ""),
        note: UNMODELLED[g.name],
      };
    }
    if (g.kind === "keystone" && passives) {
      const before = passives.before;
      const noDamage = !((before.CombinedDPS ?? 0) > 0);
      const c = passives.candidates
        .filter((x) => x.name === g.name)
        .sort((a, b) => a.points - b.points)[0];
      if (!c) return { ...g, tried: false, note: "Not within 4 points of your tree (or from a timeless jewel or another ascendancy)." };
      const dps = change(before.CombinedDPS ?? 0, c.stats.CombinedDPS ?? 0);
      const ehp = change(before.TotalEHP ?? 0, c.stats.TotalEHP ?? 0);
      return {
        ...g,
        tried: true,
        dps,
        ehp,
        gain: noDamage ? ehp : goalGain(goal, dps, ehp),
        drawbacks: drawbacks(before, c.stats),
        where: `${c.points} point${c.points === 1 ? "" : "s"}`,
      };
    }
    const note =
      g.kind === "gem" ? "Popularity only: Deep analysis ranks support gems on your build." : "Popularity only: anoints aren't tried yet.";
    return { ...g, tried: false, note };
  });
  return out.sort((a, b) => Number(b.tried) - Number(a.tried) || (b.gain ?? 0) - (a.gain ?? 0) || b.share - a.share);
}
