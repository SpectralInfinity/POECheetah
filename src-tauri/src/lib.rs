use std::sync::OnceLock;

use pob_engine::{Analysis, BuildStats, Engine, ItemTrial, Passives};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

/// Must match `DB_URL` in src/data/db.ts.
pub const DB_URL: &str = "sqlite:poecheetah.db";

/// Migrations live in src/data/migrations so the TypeScript tests run the same SQL.
pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "builds",
        sql: include_str!("../../src/data/migrations/0001_builds.sql"),
        kind: MigrationKind::Up,
    }]
}

/// Path of Building, started once (it takes a few seconds) and kept running.
static ENGINE: OnceLock<Result<Engine, String>> = OnceLock::new();

fn engine(app: &tauri::AppHandle) -> Result<&'static Engine, String> {
    ENGINE
        .get_or_init(|| {
            let dir = app
                .path()
                .resource_dir()
                .map_err(|e| format!("Could not find the app's files: {e}"))?
                .join("pob");
            Engine::start(&dir)
        })
        .as_ref()
        .map_err(Clone::clone)
}

/// Calculates a build (PoB XML from a decoded PoB code) with Path of Building.
#[tauri::command]
async fn pob_calculate(app: tauri::AppHandle, xml: String) -> Result<BuildStats, String> {
    tauri::async_runtime::spawn_blocking(move || engine(&app)?.load_build(&xml))
        .await
        .map_err(|e| format!("Path of Building stopped: {e}"))?
}

/// Calculates the build with an item (text copied in game or from the trade
/// site) in each slot it fits.
#[tauri::command]
async fn pob_try_item(app: tauri::AppHandle, xml: String, item: String) -> Result<ItemTrial, String> {
    tauri::async_runtime::spawn_blocking(move || engine(&app)?.try_item(&xml, &item))
        .await
        .map_err(|e| format!("Path of Building stopped: {e}"))?
}

/// Honest DPS, boss check, pantheon and support gem ranking (tens of seconds).
#[tauri::command]
async fn pob_analyse(app: tauri::AppHandle, xml: String) -> Result<Analysis, String> {
    tauri::async_runtime::spawn_blocking(move || engine(&app)?.analyse(&xml))
        .await
        .map_err(|e| format!("Path of Building stopped: {e}"))?
}

/// Every passive worth taking next, calculated with its path (passive advisor).
#[tauri::command]
async fn pob_passives(app: tauri::AppHandle, xml: String) -> Result<Passives, String> {
    tauri::async_runtime::spawn_blocking(move || engine(&app)?.passives(&xml))
        .await
        .map_err(|e| format!("Path of Building stopped: {e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .setup(|app| {
            // Start PoB in the background so the first calculation is quick.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let _ = engine(&handle);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![pob_calculate, pob_try_item, pob_analyse, pob_passives])
        .run(tauri::generate_context!())
        .expect("error while running POECheetah");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_numbered_in_order() {
        for (i, m) in migrations().iter().enumerate() {
            assert_eq!(m.version, i as i64 + 1);
        }
    }
}
