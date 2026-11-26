// Repository conventions from CLAUDE.md, written as tests so a session that breaks
// one finds out from `npm test` instead of from review. When a rule changes, change
// CLAUDE.md and this file in the same pull request.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function filesUnder(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  if (!existsSync(join(root, dir))) return out;
  for (const name of readdirSync(join(root, dir))) {
    if (name === "node_modules" || name === "target" || name === ".git" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) out.push(...filesUnder(path, exts));
    else if (exts.length === 0 || exts.some((e) => name.endsWith(e))) out.push(path);
  }
  return out;
}

/** Source without comments, so rules apply to code and not to explanations. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** App source: TypeScript under src/, without tests and fixtures. */
const appSource = () =>
  filesUnder("src", [".ts", ".tsx"]).filter((f) => !f.endsWith(".test.ts") && !f.includes("__fixtures__"));

/** League names and ids as poe.ninja lists them, from the fixture, plus the permanent leagues. */
function leagueNames(): Set<string> {
  const names = new Set(["standard", "hardcore", "ssf standard", "ssf hardcore"]);
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const k of ["name", "url", "displayName"]) if (typeof o[k] === "string") names.add(String(o[k]).toLowerCase());
      Object.values(o).forEach(walk);
    }
  };
  walk(JSON.parse(read("src/core/__fixtures__/ninja-index-state.json")));
  return names;
}

describe("conventions", () => {
  it("never hard-codes a league name: leagues come from data", () => {
    const leagues = leagueNames();
    const offenders: string[] = [];
    for (const file of appSource()) {
      for (const m of code(file).matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)) {
        if (leagues.has(m[2].trim().toLowerCase())) offenders.push(`${file}: ${m[0]}`);
      }
    }
    expect(offenders, "Read the league from poe.ninja's index-state or the user's settings").toEqual([]);
  });

  it("keeps src/core free of Tauri, React and DOM code", () => {
    const offenders: string[] = [];
    for (const file of filesUnder("src/core", [".ts"]).filter((f) => !f.endsWith(".test.ts"))) {
      const src = code(file);
      for (const m of src.matchAll(/(?:from|import|require\()\s*["']([^"']+)["']/g)) {
        if (/^(@tauri-apps\/|react|react-dom|\.\.\/ui\/|\.\.\/data\/)/.test(m[1])) offenders.push(`${file}: ${m[1]}`);
      }
      if (/\b(document|window|localStorage|sessionStorage)\./.test(src)) offenders.push(`${file}: uses the DOM`);
    }
    expect(offenders, "src/core is pure domain logic; move this code to src/ui or src/data").toEqual([]);
  });

  it("never commits a real Client.txt (fixtures use made-up log lines)", () => {
    const found = filesUnder(".", []).filter((f) => f.toLowerCase().endsWith("client.txt"));
    expect(found).toEqual([]);
  });
});
