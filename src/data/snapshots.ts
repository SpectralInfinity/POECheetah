import type { Snapshot } from "../core/stash";
import type { SqlClient } from "./sql";

/** Stash value snapshots (design doc §3.5): SQLite in the app, in memory for the browser preview. */
export interface SnapshotStore {
  /** A league's snapshots, oldest first. */
  list(league: string): Promise<Snapshot[]>;
  add(s: Snapshot): Promise<number>;
  remove(id: number): Promise<void>;
}

interface Row {
  id: number;
  taken_at: string;
  league: string;
  total: number;
  tabs: string;
}

export function sqlSnapshotStore(db: SqlClient): SnapshotStore {
  return {
    async list(league) {
      const rows = await db.select<Row[]>("SELECT * FROM stash_snapshots WHERE league = $1 ORDER BY taken_at, id", [league]);
      return rows.map((r) => ({ id: r.id, at: Date.parse(r.taken_at), league: r.league, total: r.total, tabs: JSON.parse(r.tabs) }));
    },
    async add(s) {
      const rows = await db.select<{ id: number }[]>(
        "INSERT INTO stash_snapshots (taken_at, league, total, tabs) VALUES ($1, $2, $3, $4) RETURNING id",
        [new Date(s.at).toISOString(), s.league, s.total, JSON.stringify(s.tabs)],
      );
      return rows[0].id;
    },
    async remove(id) {
      await db.execute("DELETE FROM stash_snapshots WHERE id = $1", [id]);
    },
  };
}

export function memorySnapshotStore(): SnapshotStore {
  let next = 1;
  const all: Snapshot[] = [];
  return {
    async list(league) {
      return all.filter((s) => s.league === league).sort((a, b) => a.at - b.at);
    },
    async add(s) {
      const id = next++;
      all.push({ ...s, id });
      return id;
    },
    async remove(id) {
      all.splice(all.findIndex((s) => s.id === id), 1);
    },
  };
}
