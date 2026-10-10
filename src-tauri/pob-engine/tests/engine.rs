//! Runs the real Path of Building from src-tauri/pob (scripts/fetch-pob.sh).
//! Expected numbers come from PoB's own headless wrapper in plain LuaJIT, so
//! these tests check that the embedded engine calculates exactly like PoB.
//! Skipped when PoB isn't downloaded, unless REQUIRE_POB is set (CI sets it).

use std::path::PathBuf;

use pob_engine::Engine;

fn pob_dir() -> Option<PathBuf> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../pob");
    if dir.join("src/HeadlessWrapper.lua").exists() {
        return Some(dir);
    }
    if std::env::var_os("REQUIRE_POB").is_some() {
        panic!("Path of Building not found in src-tauri/pob; run scripts/fetch-pob.sh");
    }
    eprintln!("skipping: Path of Building not downloaded (scripts/fetch-pob.sh)");
    None
}

fn assert_close(stats: &std::collections::BTreeMap<String, f64>, key: &str, expected: f64) {
    let actual = *stats.get(key).unwrap_or_else(|| panic!("{key} missing from PoB output"));
    assert!((actual - expected).abs() < 1e-4, "{key}: expected {expected}, got {actual}");
}

#[test]
fn calculates_a_build_like_path_of_building() {
    let Some(dir) = pob_dir() else { return };
    let engine = Engine::start(&dir).expect("engine starts");
    let xml = include_str!("fixtures/fireball-witch.xml");
    let build = engine.load_build(xml).expect("build loads");

    assert_eq!(build.main_skill.as_deref(), Some("Fireball"));
    assert_close(&build.stats, "CombinedDPS", 2848.596511);
    assert_close(&build.stats, "TotalDPS", 1608.566667);
    assert_close(&build.stats, "AverageHit", 1206.425);
    assert_close(&build.stats, "Life", 1125.0);
    assert_close(&build.stats, "Mana", 590.0);
    assert_close(&build.stats, "TotalEHP", 745.237304);
    assert_close(&build.stats, "FireResist", -60.0);

    // The engine keeps running: a second build on the same engine works too.
    let again = engine.load_build(xml).expect("build loads again");
    assert_eq!(again.stats.get("CombinedDPS"), build.stats.get("CombinedDPS"));
}

#[test]
fn reports_xml_that_is_not_a_build() {
    let Some(dir) = pob_dir() else { return };
    let engine = Engine::start(&dir).expect("engine starts");
    assert!(engine.load_build("this is not build XML").is_err());
}
