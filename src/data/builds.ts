import type { BuildSummary } from "../core/buildCode";
import type { Stats } from "../core/stats";
import type { SqlClient } from "./sql";

/** One pasted PoB code for a build. */
export interface BuildVersion {
  id: number;
  buildId: number;
  code: string;
  summary: BuildSummary;
  mainSkill: string | null;
  /** Headline stats from Path of Building; null if it couldn't calculate. */
  stats: Stats | null;
  addedAt: string;
}

export interface SavedBuild {
  id: number;
  name: string;
  updatedAt: string;
  latest: BuildVersion;
}

export type NewVersion = Pick<BuildVersion, "code" | "summary" | "mainSkill" | "stats">;

/** Saved builds (design doc §3.0): SQLite in the app, in memory for the browser preview. */
export interface BuildStore {
  /** Most recently updated first. */
  list(): Promise<SavedBuild[]>;
  /** Newest first. */
  versions(buildId: number): Promise<BuildVersion[]>;
  add(name: string, version: NewVersion, now?: Date): Promise<number>;
  /** Adds a version unless the code is the same as the latest one. Returns whether it was added. */
  addVersion(buildId: number, version: NewVersion, now?: Date): Promise<boolean>;
  /** Stores stats calculated later for an existing version. */
  setStats(versionId: number, mainSkill: string | null, stats: Stats): Promise<void>;
  rename(buildId: number, name: string): Promise<void>;
  remove(buildId: number): Promise<void>;
  activeId(): Promise<number | null>;
  setActive(buildId: number | null): Promise<void>;
}

interface VersionRow {
  id: number;
  build_id: number;
  code: string;
  summary: string;
  main_skill: string | null;
  stats: string | null;
  added_at: string;
}

const toVersion = (r: VersionRow): BuildVersion => ({
  id: r.id,
  buildId: r.build_id,
  code: r.code,
  summary: JSON.parse(r.summary) as BuildSummary,
  mainSkill: r.main_skill,
  stats: r.stats === null ? null : (JSON.parse(r.stats) as Stats),
  addedAt: r.added_at,
});

const ACTIVE_KEY = "active_build_id";

export function sqlBuildStore(db: SqlClient): BuildStore {
  async function latest(buildId: number): Promise<BuildVersion | null> {
    const rows = await db.select<VersionRow[]>(
      "SELECT * FROM build_versions WHERE build_id = $1 ORDER BY id DESC LIMIT 1",
      [buildId],
    );
    return rows[0] ? toVersion(rows[0]) : null;
  }

  async function insertVersion(buildId: number, v: NewVersion, now: Date) {
    await db.execute(
      `INSERT INTO build_versions (build_id, code, summary, main_skill, stats, added_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [buildId, v.code, JSON.stringify(v.summary), v.mainSkill, v.stats && JSON.stringify(v.stats), now.toISOString()],
    );
    await db.execute("UPDATE builds SET updated_at = $1 WHERE id = $2", [now.toISOString(), buildId]);
  }

  return {
    async list() {
      const builds = await db.select<{ id: number; name: string; updated_at: string }[]>(
        "SELECT id, name, updated_at FROM builds ORDER BY updated_at DESC, id DESC",
      );
      const out: SavedBuild[] = [];
      for (const b of builds) {
        const v = await latest(b.id);
        if (v) out.push({ id: b.id, name: b.name, updatedAt: b.updated_at, latest: v });
      }
      return out;
    },
    async versions(buildId) {
      const rows = await db.select<VersionRow[]>(
        "SELECT * FROM build_versions WHERE build_id = $1 ORDER BY id DESC",
        [buildId],
      );
      return rows.map(toVersion);
    },
    async add(name, version, now = new Date()) {
      const rows = await db.select<{ id: number }[]>(
        "INSERT INTO builds (name, created_at, updated_at) VALUES ($1, $2, $2) RETURNING id",
        [name, now.toISOString()],
      );
      const id = rows[0].id;
      await insertVersion(id, version, now);
      return id;
    },
    async addVersion(buildId, version, now = new Date()) {
      if ((await latest(buildId))?.code === version.code) return false;
      await insertVersion(buildId, version, now);
      return true;
    },
    async setStats(versionId, mainSkill, stats) {
      await db.execute("UPDATE build_versions SET main_skill = $1, stats = $2 WHERE id = $3", [
        mainSkill,
        JSON.stringify(stats),
        versionId,
      ]);
    },
    async rename(buildId, name) {
      await db.execute("UPDATE builds SET name = $1 WHERE id = $2", [name, buildId]);
    },
    async remove(buildId) {
      await db.execute("DELETE FROM build_versions WHERE build_id = $1", [buildId]);
      await db.execute("DELETE FROM builds WHERE id = $1", [buildId]);
      if ((await this.activeId()) === buildId) await this.setActive(null);
    },
    async activeId() {
      const rows = await db.select<{ value: string }[]>("SELECT value FROM settings WHERE key = $1", [ACTIVE_KEY]);
      return rows[0] ? Number(rows[0].value) : null;
    },
    async setActive(buildId) {
      if (buildId === null) {
        await db.execute("DELETE FROM settings WHERE key = $1", [ACTIVE_KEY]);
      } else {
        await db.execute(
          `INSERT INTO settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
          [ACTIVE_KEY, String(buildId)],
        );
      }
    },
  };
}

/** Same behaviour as sqlBuildStore, kept in memory (browser preview without Tauri). */
export function memoryBuildStore(): BuildStore {
  let nextId = 1;
  let active: number | null = null;
  const builds: { id: number; name: string; updatedAt: string }[] = [];
  const versions: BuildVersion[] = [];
  const latest = (buildId: number) => versions.filter((v) => v.buildId === buildId).at(-1) ?? null;
  const push = (buildId: number, v: NewVersion, now: Date) => {
    versions.push({ ...v, id: nextId++, buildId, addedAt: now.toISOString() });
    builds.find((b) => b.id === buildId)!.updatedAt = now.toISOString();
  };

  return {
    async list() {
      return [...builds]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
        .map((b) => ({ ...b, latest: latest(b.id)! }));
    },
    async versions(buildId) {
      return versions.filter((v) => v.buildId === buildId).reverse();
    },
    async add(name, version, now = new Date()) {
      const id = nextId++;
      builds.push({ id, name, updatedAt: now.toISOString() });
      push(id, version, now);
      return id;
    },
    async addVersion(buildId, version, now = new Date()) {
      if (latest(buildId)?.code === version.code) return false;
      push(buildId, version, now);
      return true;
    },
    async setStats(versionId, mainSkill, stats) {
      const v = versions.find((x) => x.id === versionId);
      if (v) Object.assign(v, { mainSkill, stats });
    },
    async rename(buildId, name) {
      const b = builds.find((x) => x.id === buildId);
      if (b) b.name = name;
    },
    async remove(buildId) {
      builds.splice(builds.findIndex((b) => b.id === buildId) >>> 0, 1);
      for (let i = versions.length - 1; i >= 0; i--) if (versions[i].buildId === buildId) versions.splice(i, 1);
      if (active === buildId) active = null;
    },
    async activeId() {
      return active;
    },
    async setActive(buildId) {
      active = buildId;
    },
  };
}
