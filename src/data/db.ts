import Database from "@tauri-apps/plugin-sql";
import type { SqlClient } from "./sql";

/** Same URL as the migrations registered in src-tauri/src/lib.rs. */
export const DB_URL = "sqlite:poecheetah.db";

/** True when running inside the Tauri shell rather than a plain browser. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function openDb(): Promise<SqlClient> {
  return Database.load(DB_URL);
}
