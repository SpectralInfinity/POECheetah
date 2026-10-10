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

const RING: &str = "Item Class: Rings
Rarity: Rare
Test Loop
Gold Ring
--------
Item Level: 80
--------
+50 to maximum Life
+30% to Fire Resistance
";

#[test]
fn tries_an_item_in_every_slot_it_fits() {
    let Some(dir) = pob_dir() else { return };
    let engine = Engine::start(&dir).expect("engine starts");
    let xml = include_str!("fixtures/fireball-witch.xml");
    let trial = engine.try_item(xml, RING).expect("item tried");

    assert_eq!(trial.item, "Test Loop, Gold Ring");
    let slots: Vec<_> = trial.slots.iter().map(|s| s.slot.as_str()).collect();
    assert_eq!(slots, ["Ring 1", "Ring 2"]);
    for slot in &trial.slots {
        assert_eq!(slot.replaces, None);
        assert!(slot.stats["Life"] > trial.before["Life"] + 49.0, "life goes up in {}", slot.slot);
        assert_close(&slot.stats, "FireResist", -30.0);
    }
    assert_close(&trial.before, "Life", 1125.0);
}

#[test]
fn reports_text_that_is_not_an_item() {
    let Some(dir) = pob_dir() else { return };
    let engine = Engine::start(&dir).expect("engine starts");
    let xml = include_str!("fixtures/fireball-witch.xml");
    let err = engine.try_item(xml, "hello").unwrap_err();
    assert!(err.contains("couldn't read that item"), "{err}");
}

#[test]
fn analyses_a_build_and_leaves_it_unchanged() {
    let Some(dir) = pob_dir() else { return };
    let engine = Engine::start(&dir).expect("engine starts");
    let xml = include_str!("fixtures/fireball-witch.xml");
    let before = engine.load_build(xml).expect("build loads");
    let analysis = engine.analyse(xml).expect("analysed");

    assert_eq!(analysis["configured"]["CombinedDPS"].as_f64(), before.stats.get("CombinedDPS").copied());
    assert_eq!(analysis["cleared"].as_array().map_or(0, |a| a.len()), 0, "fixture changes no PoB defaults");
    assert!(analysis["uber"]["CombinedDPS"].as_f64().unwrap() < before.stats["CombinedDPS"]);
    assert_eq!(analysis["pantheonMajor"]["options"].as_array().unwrap().len(), 4);
    assert!(analysis["supports"].is_null(), "Fireball alone has no supports to rank");

    let after = engine.load_build(xml).expect("build loads again");
    assert_eq!(after.stats.get("CombinedDPS"), before.stats.get("CombinedDPS"));
}

#[test]
fn finds_passives_to_take_and_leaves_the_build_unchanged() {
    let Some(dir) = pob_dir() else { return };
    let engine = Engine::start(&dir).expect("engine starts");
    // Made-up: the fireball witch with 116 points around the Witch start, three
    // Elementalist points and a Life Mastery.
    let xml = include_str!("fixtures/elementalist-tree.xml");
    let before = engine.load_build(xml).expect("build loads");
    let result = engine.passives(xml).expect("passives");

    assert_eq!(result["pointsUsed"].as_f64(), Some(116.0));
    assert_eq!(result["ascendancyUsed"].as_f64(), Some(3.0));
    assert_eq!(result["before"]["CombinedDPS"].as_f64(), before.stats.get("CombinedDPS").copied());
    let candidates = result["candidates"].as_array().expect("candidates");
    for kind in ["small", "notable", "keystone", "mastery", "ascendancy"] {
        assert!(candidates.iter().any(|c| c["kind"] == kind), "no {kind} candidate");
    }
    for c in candidates {
        let points = c["points"].as_u64().unwrap();
        let via = c["via"].as_array().expect("via is a list").len() as u64;
        match c["kind"].as_str().unwrap() {
            "small" | "mastery" => assert_eq!((points, via), (1, 0), "{c}"),
            "notable" | "keystone" => assert!((1..=4).contains(&points) && via == points - 1, "{c}"),
            "ascendancy" => assert!(points <= 5 && via == points - 1, "{c}"),
            other => panic!("unexpected kind {other}"),
        }
    }
    let gains = candidates.iter().filter(|c| c["stats"]["CombinedDPS"].as_f64() > before.stats.get("CombinedDPS").copied());
    assert!(gains.count() > 10, "Fireball gains from nodes near the Witch start");

    let swaps = result["masterySwaps"].as_array().expect("swaps");
    const CURRENT_EFFECT: &str = "10% more Maximum Life if you have at least 6 Life Masteries allocated";
    assert!(!swaps.is_empty());
    assert!(swaps.iter().all(|s| s["lines"][0] != CURRENT_EFFECT), "the current effect is not a swap");
    assert!(swaps.iter().all(|s| s["name"] == "Life Mastery" && s["replaces"] == serde_json::json!([CURRENT_EFFECT])));

    let after = engine.load_build(xml).expect("build loads again");
    assert_eq!(after.stats, before.stats);
}

#[test]
fn passives_on_an_empty_tree_are_its_start_neighbours() {
    let Some(dir) = pob_dir() else { return };
    let engine = Engine::start(&dir).expect("engine starts");
    let result = engine.passives(include_str!("fixtures/fireball-witch.xml")).expect("passives");
    let candidates = result["candidates"].as_array().expect("candidates");
    assert!(!candidates.is_empty() && candidates.iter().all(|c| c["points"] == 1));
    assert_eq!(result["masterySwaps"], serde_json::json!([]));
}
