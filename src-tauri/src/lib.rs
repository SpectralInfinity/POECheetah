use std::sync::OnceLock;

use pob_engine::{Analysis, BuildStats, Engine, ItemTrial, Mode, Passives, RareSearch, StatWeight, Upgrades};
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

/// Honest DPS, boss check, pantheon and support gem ranking (tens of seconds);
/// supports ranked with the config in `mode`.
#[tauri::command]
async fn pob_analyse(app: tauri::AppHandle, xml: String, mode: Mode) -> Result<Analysis, String> {
    tauri::async_runtime::spawn_blocking(move || engine(&app)?.analyse(&xml, mode))
        .await
        .map_err(|e| format!("Path of Building stopped: {e}"))?
}

/// Every passive worth taking next, calculated with its path (passive advisor).
#[tauri::command]
async fn pob_passives(app: tauri::AppHandle, xml: String, mode: Mode) -> Result<Passives, String> {
    tauri::async_runtime::spawn_blocking(move || engine(&app)?.passives(&xml, mode))
        .await
        .map_err(|e| format!("Path of Building stopped: {e}"))?
}

/// Unique items (names from poe.ninja) tried in every slot, and flask mods (item upgrade advisor).
#[tauri::command]
async fn pob_upgrades(app: tauri::AppHandle, xml: String, mode: Mode, uniques: Vec<String>) -> Result<Upgrades, String> {
    tauri::async_runtime::spawn_blocking(move || engine(&app)?.upgrades(&xml, mode, &uniques))
        .await
        .map_err(|e| format!("Path of Building stopped: {e}"))?
}

/// PoB's weighted trade search for a rare in one slot.
#[tauri::command]
async fn pob_rare_search(
    app: tauri::AppHandle,
    xml: String,
    mode: Mode,
    slot: String,
    weights: Vec<StatWeight>,
) -> Result<RareSearch, String> {
    tauri::async_runtime::spawn_blocking(move || engine(&app)?.rare_search(&xml, mode, &slot, &weights))
        .await
        .map_err(|e| format!("Path of Building stopped: {e}"))?
}

/// Sites the app reads market data from (design doc §4): public pages only, no login.
fn market_url_allowed(url: &str) -> bool {
    ["https://poe.ninja/api/", "https://www.pathofexile.com/api/trade/data/"]
        .iter()
        .any(|prefix| url.starts_with(prefix))
}

/// Fetches public market data (poe.ninja prices, the trade site's league list) as text.
#[tauri::command]
async fn market_get(url: String) -> Result<String, String> {
    if !market_url_allowed(&url) {
        return Err(format!("Not a market data address: {url}"));
    }
    let client = reqwest::Client::builder()
        .user_agent(concat!(
            "POECheetah/",
            env!("CARGO_PKG_VERSION"),
            " (+https://github.com/SpectralInfinity/POECheetah)"
        ))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client.get(&url).send().await.map_err(|e| format!("Could not reach {url}: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("{url} answered {status}"));
    }
    response.text().await.map_err(|e| format!("Could not read {url}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
        .invoke_handler(tauri::generate_handler![
            pob_calculate,
            pob_try_item,
            pob_analyse,
            pob_passives,
            pob_upgrades,
            pob_rare_search,
            market_get
        ])
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

    #[test]
    fn market_data_comes_only_from_public_market_sites() {
        assert!(market_url_allowed("https://poe.ninja/api/data/itemoverview?league=Standard&type=SkillGem"));
        assert!(market_url_allowed("https://www.pathofexile.com/api/trade/data/leagues"));
        assert!(!market_url_allowed("https://www.pathofexile.com/character-window/get-stash-items"));
        assert!(!market_url_allowed("https://poe.ninja.example.com/api/"));
        assert!(!market_url_allowed("http://poe.ninja/api/data"));
    }
}
