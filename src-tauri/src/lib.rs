mod account;

use std::path::Path;
use std::sync::OnceLock;

use pob_engine::{Analysis, BuildStats, Compared, Engine, ItemTrial, Mode, Passives, RareSearch, StatWeight, Upgrades};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

/// Must match `DB_URL` in src/data/db.ts.
pub const DB_URL: &str = "sqlite:poecheetah.db";

/// Migrations live in src/data/migrations so the TypeScript tests run the same SQL.
pub fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "builds",
            sql: include_str!("../../src/data/migrations/0001_builds.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "stash snapshots",
            sql: include_str!("../../src/data/migrations/0002_stash_snapshots.sql"),
            kind: MigrationKind::Up,
        },
    ]
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
/// site) in each slot it fits, with the config in `mode` (item check).
#[tauri::command]
async fn pob_try_item(app: tauri::AppHandle, xml: String, item: String, mode: Mode) -> Result<ItemTrial, String> {
    tauri::async_runtime::spawn_blocking(move || engine(&app)?.try_item(&xml, &item, mode))
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

/// A build's numbers with the config in `mode`, the main skill in part `skill_part` if given (build comparison).
#[tauri::command]
async fn pob_calculate_mode(app: tauri::AppHandle, xml: String, mode: Mode, skill_part: Option<u32>) -> Result<Compared, String> {
    tauri::async_runtime::spawn_blocking(move || engine(&app)?.calculate(&xml, mode, skill_part))
        .await
        .map_err(|e| format!("Path of Building stopped: {e}"))?
}

/// My build against a target build (a guide, a ladder character), slot by slot.
#[tauri::command]
async fn pob_compare(
    app: tauri::AppHandle,
    xml: String,
    target: String,
    mode: Mode,
    target_skill_part: Option<u32>,
) -> Result<Compared, String> {
    tauri::async_runtime::spawn_blocking(move || engine(&app)?.compare(&xml, &target, mode, target_skill_part))
        .await
        .map_err(|e| format!("Path of Building stopped: {e}"))?
}

/// The build with each set of modifier lines added (3.30 Wickerman body parts).
#[tauri::command]
async fn pob_mod_sets(app: tauri::AppHandle, xml: String, mode: Mode, sets: Vec<Vec<String>>) -> Result<Compared, String> {
    tauri::async_runtime::spawn_blocking(move || engine(&app)?.mod_sets(&xml, mode, &sets))
        .await
        .map_err(|e| format!("Path of Building stopped: {e}"))?
}

/// The build audit: charges, conditions, stance, flasks and PoB's warnings.
#[tauri::command]
async fn pob_audit(app: tauri::AppHandle, xml: String) -> Result<Compared, String> {
    tauri::async_runtime::spawn_blocking(move || engine(&app)?.audit(&xml))
        .await
        .map_err(|e| format!("Path of Building stopped: {e}"))?
}

/// Where the game keeps its log on Windows (standalone and Steam installs),
/// for the run tracker (design doc §3.4).
const LOG_CANDIDATES: [&str; 4] = [
    r"C:\Program Files (x86)\Grinding Gear Games\Path of Exile\logs\Client.txt",
    r"C:\Program Files\Grinding Gear Games\Path of Exile\logs\Client.txt",
    r"C:\Program Files (x86)\Steam\steamapps\common\Path of Exile\logs\Client.txt",
    r"C:\Program Files\Steam\steamapps\common\Path of Exile\logs\Client.txt",
];

/// The usual places of the game's `Client.txt` that exist on this computer.
#[tauri::command]
fn log_candidates() -> Vec<String> {
    LOG_CANDIDATES.iter().filter(|p| Path::new(p).is_file()).map(|p| p.to_string()).collect()
}

/// A chunk of the game log, from `from` to `to` (byte offsets); `size` is the file's size.
#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LogChunk {
    text: String,
    from: u64,
    to: u64,
    size: u64,
}

/// Only the game's log may be read (design doc §4: Client.txt and nothing else).
fn log_path_allowed(path: &str) -> bool {
    Path::new(path).file_name().is_some_and(|n| n.eq_ignore_ascii_case("Client.txt"))
}

/// Reads the game log from byte `from` (new lines since the last read), or
/// its last `tail` bytes when `from` is missing, at most `max` bytes. The log
/// grows to hundreds of MB, so it's never read whole. A file smaller than
/// `from` was replaced: reading starts over. Lines cut at the start are dropped.
fn read_log(path: &str, from: Option<u64>, tail: u64, max: u64) -> Result<LogChunk, String> {
    use std::io::{Read, Seek, SeekFrom};
    if !log_path_allowed(path) {
        return Err(format!("Not the game's log (Client.txt): {path}"));
    }
    let mut file = std::fs::File::open(path).map_err(|e| format!("Could not open {path}: {e}"))?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    let start = match from {
        Some(f) if f <= size => f,
        Some(_) => 0,
        None => size.saturating_sub(tail),
    };
    let len = (size - start).min(max);
    file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    let mut buf = vec![0; len as usize];
    file.read_exact(&mut buf).map_err(|e| e.to_string())?;
    // Start at a line: drop a partial first line when reading from the middle.
    let skip = if start > 0 && from.is_none() { buf.iter().position(|&b| b == b'\n').map_or(buf.len(), |i| i + 1) } else { 0 };
    // End at a line: keep a partial last line for the next read.
    let keep = buf.iter().rposition(|&b| b == b'\n').map_or(skip, |i| (i + 1).max(skip));
    let text = String::from_utf8_lossy(&buf[skip..keep]).into_owned();
    Ok(LogChunk { text, from: start + skip as u64, to: start + keep as u64, size })
}

/// The game log's new lines since `from`, or its last `tail` bytes (run tracker).
#[tauri::command]
async fn log_read(path: String, from: Option<u64>, tail: Option<u64>) -> Result<LogChunk, String> {
    tauri::async_runtime::spawn_blocking(move || read_log(&path, from, tail.unwrap_or(8 << 20), 16 << 20))
        .await
        .map_err(|e| format!("Could not read the log: {e}"))?
}

/// Sites the app reads market data from (design doc §4): public pages only, no login.
fn market_url_allowed(url: &str) -> bool {
    url.starts_with("https://poe.ninja/poe1/api/")
}

/// Build links the app reads a PoB code from (design doc §3.0): pages that are
/// the code itself. poe.ninja's character data comes through `market_get`.
fn build_link_allowed(url: &str) -> bool {
    let raw = |prefix: &str| url.strip_prefix(prefix).is_some_and(|id| !id.is_empty() && !id.contains(['/', '?', '#']));
    raw("https://pastebin.com/raw/")
        || url
            .strip_prefix("https://pobb.in/")
            .and_then(|rest| rest.strip_suffix("/raw"))
            .is_some_and(|id| !id.is_empty() && !id.contains(['/', '?', '#']))
}

/// Fetches public market data (poe.ninja prices and leagues) as text.
#[tauri::command]
async fn market_get(url: String) -> Result<String, String> {
    if !market_url_allowed(&url) {
        return Err(format!("Not a market data address: {url}"));
    }
    fetch_text(&url).await
}

/// Fetches public market data that isn't text (poe.ninja's ladder search and
/// name dictionaries are binary), same addresses as `market_get`.
#[tauri::command]
async fn market_get_bytes(url: String) -> Result<Vec<u8>, String> {
    if !market_url_allowed(&url) {
        return Err(format!("Not a market data address: {url}"));
    }
    Ok(fetch(&url).await?.bytes().await.map_err(|e| format!("Could not read {url}: {e}"))?.to_vec())
}

/// Fetches the PoB code a build link holds (pobb.in or pastebin raw page).
#[tauri::command]
async fn build_link_get(url: String) -> Result<String, String> {
    if !build_link_allowed(&url) {
        return Err(format!("Not a build link the app reads: {url}"));
    }
    fetch_text(&url).await
}

async fn fetch_text(url: &str) -> Result<String, String> {
    fetch(url).await?.text().await.map_err(|e| format!("Could not read {url}: {e}"))
}

async fn fetch(url: &str) -> Result<reqwest::Response, String> {
    let client = reqwest::Client::builder()
        .user_agent(concat!(
            "POECheetah/",
            env!("CARGO_PKG_VERSION"),
            " (+https://github.com/SpectralInfinity/POECheetah)"
        ))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client.get(url).send().await.map_err(|e| format!("Could not reach {url}: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("{url} answered {status}"));
    }
    Ok(response)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Only read: the item check watches for item text the player copies in game (design doc §3.3, §4).
        .plugin(tauri_plugin_clipboard_manager::init())
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
            pob_calculate_mode,
            pob_compare,
            pob_audit,
            pob_mod_sets,
            market_get,
            market_get_bytes,
            build_link_get,
            log_candidates,
            log_read,
            account::poe_session_set,
            account::poe_session_clear,
            account::poe_session_status,
            account::poe_account_get
        ])
        .run(tauri::generate_context!())
        .expect("error while running POE Cheetah");
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
    fn reads_only_the_game_log_whole_lines_from_an_offset_or_the_tail() {
        let dir = std::env::temp_dir().join(format!("poecheetah-log-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("Client.txt");
        std::fs::write(&path, "line one\nline two\nline thr").unwrap();
        let p = path.to_str().unwrap();

        let all = read_log(p, Some(0), 0, 1 << 20).unwrap();
        assert_eq!(all.text, "line one\nline two\n");
        assert_eq!((all.from, all.to, all.size), (0, 18, 26));
        // The partial last line comes with the next read, once finished.
        std::fs::write(&path, "line one\nline two\nline three\n").unwrap();
        let next = read_log(p, Some(all.to), 0, 1 << 20).unwrap();
        assert_eq!(next.text, "line three\n");
        // The tail starts at a whole line.
        let tail = read_log(p, None, 12, 1 << 20).unwrap();
        assert_eq!(tail.text, "line three\n");
        // A smaller file was replaced: start over.
        std::fs::write(&path, "new\n").unwrap();
        assert_eq!(read_log(p, Some(29), 0, 1 << 20).unwrap().text, "new\n");

        let other = dir.join("secrets.txt");
        std::fs::write(&other, "x\n").unwrap();
        assert!(read_log(other.to_str().unwrap(), Some(0), 0, 1 << 20).is_err());
        assert!(!log_path_allowed("C:\\Users\\me\\Documents\\notes.txt"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn build_links_are_only_raw_code_pages() {
        assert!(build_link_allowed("https://pobb.in/AbC-12_x/raw"));
        assert!(build_link_allowed("https://pastebin.com/raw/Xy12Ab"));
        assert!(!build_link_allowed("https://pobb.in/AbC"));
        assert!(!build_link_allowed("https://pobb.in//raw"));
        assert!(!build_link_allowed("https://pobb.in/a/b/raw"));
        assert!(!build_link_allowed("https://pastebin.com/raw/"));
        assert!(!build_link_allowed("https://pastebin.com/raw/a/../b"));
        assert!(!build_link_allowed("http://pastebin.com/raw/Xy12Ab"));
        assert!(!build_link_allowed("https://pastebin.com.example.com/raw/Xy"));
    }

    #[test]
    fn market_data_comes_only_from_public_market_sites() {
        assert!(market_url_allowed(
            "https://poe.ninja/poe1/api/economy/stash/current/item/overview?league=Standard&type=SkillGem"
        ));
        assert!(market_url_allowed("https://poe.ninja/poe1/api/data/index-state"));
        assert!(!market_url_allowed("https://www.pathofexile.com/character-window/get-stash-items"));
        assert!(!market_url_allowed("https://poe.ninja.example.com/poe1/api/"));
        assert!(!market_url_allowed("http://poe.ninja/poe1/api/data/index-state"));
    }
}
