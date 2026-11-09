//! Runs the real Path of Building from src-tauri/pob (scripts/fetch-pob.sh).
//! Expected numbers come from PoB's own headless wrapper in plain LuaJIT, so
//! these tests check that the embedded engine calculates exactly like PoB.
//! Skipped when PoB isn't downloaded, unless REQUIRE_POB is set (CI sets it).

use std::path::PathBuf;

use pob_engine::{Engine, Mode, StatWeight};

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
    let trial = engine.try_item(xml, RING, Mode::Configured).expect("item tried");

    assert_eq!(trial.item, "Test Loop, Gold Ring");
    let slots: Vec<_> = trial.slots.iter().map(|s| s.slot.as_str()).collect();
    assert_eq!(slots, ["Ring 1", "Ring 2"]);
    for slot in &trial.slots {
        assert_eq!(slot.replaces, None);
        assert!(slot.stats["Life"] > trial.before["Life"] + 49.0, "life goes up in {}", slot.slot);
        assert_close(&slot.stats, "FireResist", -30.0);
    }
    assert_close(&trial.before, "Life", 1125.0);
    assert_eq!(trial.required_level, Some(20.0), "Gold Ring's base level");
}

#[test]
fn reports_text_that_is_not_an_item() {
    let Some(dir) = pob_dir() else { return };
    let engine = Engine::start(&dir).expect("engine starts");
    let xml = include_str!("fixtures/fireball-witch.xml");
    let err = engine.try_item(xml, "hello", Mode::Configured).unwrap_err();
    assert!(err.contains("couldn't read that item"), "{err}");
}

#[test]
fn analyses_a_build_and_leaves_it_unchanged() {
    let Some(dir) = pob_dir() else { return };
    let engine = Engine::start(&dir).expect("engine starts");
    let xml = include_str!("fixtures/fireball-witch.xml");
    let before = engine.load_build(xml).expect("build loads");
    let analysis = engine.analyse(xml, Mode::Configured).expect("analysed");

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
    let result = engine.passives(xml, Mode::Configured).expect("passives");

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
    let result = engine.passives(include_str!("fixtures/fireball-witch.xml"), Mode::Configured).expect("passives");
    let candidates = result["candidates"].as_array().expect("candidates");
    assert!(!candidates.is_empty() && candidates.iter().all(|c| c["points"] == 1));
    assert_eq!(result["masterySwaps"], serde_json::json!([]));
}

/// The fireball witch with an active magic Silver Flask, a ring, and the
/// enemy set as shocked (a situational assumption). Made up.
fn witch_with_flask() -> String {
    include_str!("fixtures/fireball-witch.xml")
        .replace(
            "<ItemSet id=\"1\"/>",
            "<Item id=\"1\">Rarity: MAGIC\nSilver Flask\n</Item>\
             <Item id=\"2\">Rarity: RARE\nTest Loop\nGold Ring\n+50 to maximum Life\n</Item>\
             <ItemSet id=\"1\"><Slot name=\"Flask 1\" itemId=\"1\" active=\"true\"/><Slot name=\"Ring 1\" itemId=\"2\"/></ItemSet>",
        )
        .replace("<Config/>", "<Config><Input name=\"conditionEnemyShocked\" boolean=\"true\"/><Input name=\"conditionShockEffect\" number=\"50\"/></Config>")
}

#[test]
fn modes_clear_assumptions_and_leave_the_build_unchanged() {
    let Some(dir) = pob_dir() else { return };
    let engine = Engine::start(&dir).expect("engine starts");
    let xml = witch_with_flask();
    let before = engine.load_build(&xml).expect("build loads");
    let dps = |mode| {
        let r = engine.passives(&xml, mode).expect("passives");
        r["before"]["CombinedDPS"].as_f64().unwrap()
    };
    let (configured, conservative, boss) = (dps(Mode::Configured), dps(Mode::Conservative), dps(Mode::Boss));
    assert_eq!(Some(configured), before.stats.get("CombinedDPS").copied());
    assert!(conservative < configured, "no shocked enemy: {conservative} < {configured}");
    assert!(boss < conservative, "uber boss: {boss} < {conservative}");
    let trial = engine.try_item(&xml, RING, Mode::Boss).expect("item tried");
    assert_eq!(trial.before["CombinedDPS"], boss, "the item check calculates in the mode asked");
    assert_eq!(trial.slots.len(), 2);
    let analysis = engine.analyse(&xml, Mode::Boss).expect("analysed");
    assert_eq!(analysis["cleared"], serde_json::json!(["Is the enemy Shocked?", "Effect of Shock: 50"]));
    assert_eq!(analysis["mode"], "boss");
    assert_eq!(engine.load_build(&xml).expect("build loads again").stats, before.stats);
}

#[test]
fn tries_uniques_and_ranks_flask_mods() {
    let Some(dir) = pob_dir() else { return };
    let engine = Engine::start(&dir).expect("engine starts");
    let xml = witch_with_flask();
    let before = engine.load_build(&xml).expect("build loads");
    let names = ["Kaom's Heart", "Le Heup of All", "Not A Real Unique"].map(String::from);
    let result = engine.upgrades(&xml, Mode::Configured, &names).expect("upgrades");

    assert_eq!(result["missing"], serde_json::json!(["Not A Real Unique"]));
    let uniques = result["uniques"].as_array().expect("uniques");
    let slots_of = |name: &str| -> Vec<&str> {
        uniques.iter().filter(|u| u["name"].as_str().unwrap().starts_with(name)).map(|u| u["slot"].as_str().unwrap()).collect()
    };
    assert_eq!(slots_of("Kaom's Heart"), ["Body Armour"]);
    assert_eq!(slots_of("Le Heup of All"), ["Ring 1", "Ring 2"]);
    let kaom = uniques.iter().find(|u| u["slot"] == "Body Armour").unwrap();
    assert!(kaom["stats"]["Life"].as_f64().unwrap() > before.stats["Life"] + 400.0);
    let ring1 = uniques.iter().find(|u| u["slot"] == "Ring 1").unwrap();
    assert_eq!(ring1["replaces"], "Test Loop, Gold Ring");

    let flasks = result["flasks"].as_array().expect("flasks");
    assert_eq!(flasks.len(), 1);
    assert_eq!(flasks[0]["slot"], "Flask 1");
    assert_eq!(flasks[0]["active"], true);
    let plain = flasks[0]["plain"]["CombinedDPS"].as_f64().unwrap();
    let prefixes = flasks[0]["prefixes"].as_array().unwrap();
    assert!(prefixes.iter().any(|p| p["stats"]["CombinedDPS"].as_f64().unwrap() > plain), "more flask effect, more cast speed");
    assert!(!flasks[0]["suffixes"].as_array().unwrap().is_empty());

    assert_eq!(engine.load_build(&xml).expect("build loads again").stats, before.stats);
}

#[test]
fn makes_a_weighted_rare_search_for_a_slot() {
    let Some(dir) = pob_dir() else { return };
    let engine = Engine::start(&dir).expect("engine starts");
    let xml = witch_with_flask();
    let weights = [StatWeight { stat: "CombinedDPS".into(), weight_mult: 1.0 }];
    let search = engine.rare_search(&xml, Mode::Conservative, "Ring 1", &weights).expect("search");
    let query: serde_json::Value = serde_json::from_str(&search.query).expect("query is JSON");
    assert_eq!(query["query"]["filters"]["type_filters"]["filters"]["category"]["option"], "accessory.ring");
    assert_eq!(query["query"]["stats"][0]["type"], "weight");
    assert!(!query["query"]["stats"][0]["filters"].as_array().unwrap().is_empty());
    let err = engine.rare_search(&xml, Mode::Conservative, "Ring 9", &weights).unwrap_err();
    assert!(err.contains("Ring 9"), "{err}");
}

#[test]
fn compares_a_build_with_a_target_slot_by_slot() {
    let Some(dir) = pob_dir() else { return };
    let engine = Engine::start(&dir).expect("engine starts");
    let mine = include_str!("fixtures/fireball-witch.xml");
    let target = witch_with_flask();
    let dps = |v: &serde_json::Value| v["CombinedDPS"].as_f64().unwrap();

    // calculate: the mode applies, and no skill part (JSON null) leaves the skill as it is.
    let configured = engine.calculate(&target, Mode::Configured, None).expect("calculated");
    let conservative = engine.calculate(&target, Mode::Conservative, None).expect("calculated");
    assert_eq!(configured["skill"]["name"], "Fireball");
    assert!(dps(&conservative["stats"]) < dps(&configured["stats"]), "shock cleared");

    let c = engine.compare(mine, &target, Mode::Configured, None).expect("compared");
    assert_eq!(dps(&c["target"]["stats"]), dps(&configured["stats"]));
    let slots: Vec<&str> = c["slots"].as_array().unwrap().iter().map(|s| s["slot"].as_str().unwrap()).collect();
    assert_eq!(slots, ["Flask 1", "Ring 1"], "only the target holds items");
    let ring = &c["slots"][1];
    assert_eq!(ring["target"]["name"], "Test Loop, Gold Ring");
    assert!(ring["mine"].is_null());
    assert!(ring["intoMine"]["Life"].as_f64().unwrap() > c["mine"]["stats"]["Life"].as_f64().unwrap() + 49.0);
    assert!(ring["intoTarget"].is_null(), "I have no ring to put in theirs");
    let config: Vec<&str> = c["config"].as_array().unwrap().iter().map(|d| d["var"].as_str().unwrap()).collect();
    assert_eq!(config, ["conditionEnemyShocked", "conditionShockEffect"]);
    assert_eq!(c["config"][0]["target"], "true");
    assert!(c["config"][0]["mine"].is_null());

    // Both builds load as they were afterwards.
    assert_eq!(engine.load_build(mine).expect("loads").stats, engine.load_build(mine).expect("loads again").stats);
    assert_eq!(dps(&engine.calculate(&target, Mode::Configured, None).unwrap()["stats"]), dps(&configured["stats"]));
}

#[test]
fn audits_charges_flasks_and_warnings_and_leaves_the_build_unchanged() {
    let Some(dir) = pob_dir() else { return };
    let engine = Engine::start(&dir).expect("engine starts");
    let xml = witch_with_flask();
    let before = engine.load_build(&xml).expect("build loads");
    let a = engine.audit(&xml).expect("audited");

    let vars: Vec<&str> = a["options"].as_array().unwrap().iter().map(|o| o["var"].as_str().unwrap()).collect();
    assert!(vars.contains(&"usePowerCharges"), "{vars:?}");
    let power = a["options"].as_array().unwrap().iter().find(|o| o["var"] == "usePowerCharges").unwrap();
    assert_eq!(power["current"], "false");
    assert_eq!(power["tries"][0]["value"], "true");
    assert!(power["tries"][0]["stats"]["CombinedDPS"].as_f64().unwrap() > a["before"]["CombinedDPS"].as_f64().unwrap(), "power charges add crit");

    let flask = &a["flasks"][0];
    assert_eq!(flask["slot"], "Flask 1");
    assert_eq!(flask["kind"], "Utility");
    assert!(flask["without"]["CombinedDPS"].is_number());
    let bases: Vec<&str> = flask["alternatives"].as_array().unwrap().iter().map(|x| x["base"].as_str().unwrap()).collect();
    assert!(bases.contains(&"Sulphur Flask") && bases.contains(&"Silver Flask"), "{bases:?}");
    assert!(a["dotCap"].as_f64().unwrap() > 1e7);
    assert!(a["text"]["gems"].as_array().unwrap().iter().any(|g| g == "Fireball"));
    assert_eq!(engine.load_build(&xml).expect("loads again").stats, before.stats);
}

/// The witch with Summon Raging Spirit as her main skill: PoB calculates the
/// minions in `output.Minion`, and the player's own DPS is 0.
fn witch_with_spirits() -> String {
    include_str!("fixtures/fireball-witch.xml").replace(
        r#"<Gem nameSpec="Fireball" skillId="Fireball" gemId="Metadata/Items/Gems/SkillGemFireball""#,
        r#"<Gem nameSpec="Summon Raging Spirit" skillId="SummonRagingSpirit" gemId="Metadata/Items/Gems/SkillGemSummonRagingSpirit""#,
    )
}

#[test]
fn counts_minion_damage_as_the_builds() {
    let Some(dir) = pob_dir() else { return };
    let engine = Engine::start(&dir).expect("engine starts");
    let xml = witch_with_spirits();
    let build = engine.load_build(&xml).expect("build loads");
    assert_eq!(build.main_skill.as_deref(), Some("Summon Raging Spirit"));
    let per = build.stats["MinionDPS"];
    let count = build.stats["MinionCount"];
    assert!(per > 0.0 && count >= 1.0, "{per} × {count}");
    assert_close(&build.stats, "CombinedDPS", per * count);
    assert_eq!(build.stats.get("MinionDamage"), Some(&1.0));
    assert!(build.stats.get("MinionMissing").is_none());

    // Every advisor sees it: the passive advisor's numbers are the minions' too.
    let passives = engine.passives(&xml, Mode::Configured).expect("passives");
    assert_eq!(passives["before"]["CombinedDPS"].as_f64(), Some(per * count));

    // The Fireball witch deals her own damage: no minion keys.
    let fireball = engine.load_build(include_str!("fixtures/fireball-witch.xml")).expect("loads");
    assert!(fireball.stats.get("MinionDamage").is_none());
}

#[test]
fn says_when_a_minion_skill_has_no_minion() {
    let Some(dir) = pob_dir() else { return };
    let engine = Engine::start(&dir).expect("engine starts");
    // Raise Spectre with no spectre chosen, as poe.ninja's ladder exports it.
    let xml = include_str!("fixtures/fireball-witch.xml").replace(
        r#"<Gem nameSpec="Fireball" skillId="Fireball" gemId="Metadata/Items/Gems/SkillGemFireball""#,
        r#"<Gem nameSpec="Raise Spectre" skillId="RaiseSpectre" gemId="Metadata/Items/Gems/SkillGemRaiseSpectre""#,
    );
    let build = engine.load_build(&xml).expect("build loads");
    assert_eq!(build.stats.get("MinionMissing"), Some(&1.0));
    assert_eq!(build.stats.get("CombinedDPS"), Some(&0.0));
    let calculated = engine.calculate(&xml, Mode::Conservative, None).expect("calculated");
    assert_eq!(calculated["stats"]["MinionMissing"], 1.0);
}

#[test]
fn adds_modifier_lines_and_says_which_pob_doesnt_understand() {
    let Some(dir) = pob_dir() else { return };
    let engine = Engine::start(&dir).expect("engine starts");
    let xml = include_str!("fixtures/fireball-witch.xml");
    let before = engine.load_build(xml).expect("build loads");
    let sets = vec![
        vec!["+100 to maximum Life".to_string()],
        vec!["+100 to maximum Life".to_string(), "Gain a Wickerman's blessing every Tuesday".to_string()],
        vec![],
    ];
    let r = engine.mod_sets(xml, Mode::Configured, &sets).expect("calculated");
    let life = |v: &serde_json::Value| v["Life"].as_f64().unwrap();
    assert_eq!(life(&r["before"]), before.stats["Life"]);
    assert!(life(&r["results"][0]["stats"]) > life(&r["before"]) + 99.0, "life added");
    assert_eq!(r["results"][0]["unparsed"], serde_json::json!([]));
    assert_eq!(r["results"][1]["unparsed"], serde_json::json!(["Gain a Wickerman's blessing every Tuesday"]));
    assert_eq!(life(&r["results"][2]["stats"]), life(&r["before"]));
    // The custom lines are gone afterwards.
    assert_eq!(engine.load_build(xml).expect("loads again").stats, before.stats);
    let again = engine.mod_sets(xml, Mode::Configured, &[vec![]]).expect("calculated");
    assert_eq!(life(&again["results"][0]["stats"]), before.stats["Life"]);
}
