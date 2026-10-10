/**
 * The subset of @tauri-apps/plugin-sql's Database that the data layer uses.
 * Tests run the same queries against node:sqlite through this interface.
 * Placeholders are $1, $2, ... as in the Tauri SQL plugin.
 */
export interface SqlClient {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  execute(query: string, bindValues?: unknown[]): Promise<unknown>;
}
