import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SqlClient } from "./sql";

const MIGRATIONS_DIR = join(import.meta.dirname, "migrations");

/** An in-memory SQLite database with all migrations applied, for tests. */
export function createTestDb(): SqlClient {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  // The Tauri plugin's $1, $2 placeholders are named parameters to SQLite.
  const params = (values: unknown[] = []) =>
    Object.fromEntries(values.map((v, i) => [`$${i + 1}`, v])) as Record<string, SQLInputValue>;
  return {
    async select<T>(query: string, bindValues?: unknown[]) {
      return db.prepare(query).all(params(bindValues)) as T;
    },
    async execute(query: string, bindValues?: unknown[]) {
      return db.prepare(query).run(params(bindValues));
    },
  };
}
