//! Prints PoB's headline stats for a build XML file (a decoded PoB code):
//! `cargo run --release --example stats -- build.xml [--all | --item item.txt | --analyse | --passives [--json out.json]]`

use std::path::PathBuf;

fn main() {
    let path = std::env::args().nth(1).expect("usage: stats <build.xml>");
    let xml = std::fs::read_to_string(&path).expect("read build XML");
    let pob = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../pob");
    let started = std::time::Instant::now();
    let engine = pob_engine::Engine::start(&pob).expect("start Path of Building");
    let loaded = std::time::Instant::now();
    let build = engine.load_build(&xml).expect("load build");
    println!("main skill: {}", build.main_skill.as_deref().unwrap_or("-"));
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--passives") {
        let t = std::time::Instant::now();
        let passives = engine.passives(&xml).expect("passives");
        if let Some(i) = args.iter().position(|a| a == "--json") {
            std::fs::write(&args[i + 1], passives.to_string()).expect("write JSON");
        }
        let n = passives["candidates"].as_array().map_or(0, |a| a.len());
        let swaps = passives["masterySwaps"].as_array().map_or(0, |a| a.len());
        let before = &passives["before"];
        let mut rows: Vec<_> = passives["candidates"].as_array().into_iter().flatten().collect();
        let gain = |c: &serde_json::Value| {
            let (a, b) = (before["CombinedDPS"].as_f64().unwrap_or(0.0), c["stats"]["CombinedDPS"].as_f64().unwrap_or(0.0));
            if a == 0.0 { 0.0 } else { (b - a) / a / c["points"].as_f64().unwrap_or(1.0).max(1.0) }
        };
        rows.sort_by(|a, b| gain(b).total_cmp(&gain(a)));
        let show = |c: &&serde_json::Value| {
            println!("{:+.2}%/pt  {} pts  {} {}  {}", gain(c) * 100.0, c["points"], c["kind"], c["name"], c["lines"]);
        };
        rows.iter().take(15).for_each(show);
        println!("best mastery effects and ascendancy notables:");
        rows.iter().filter(|c| c["kind"] == "mastery" || c["kind"] == "ascendancy").take(5).for_each(show);
        println!("mastery swaps:");
        let mut swap_rows: Vec<_> = passives["masterySwaps"].as_array().into_iter().flatten().collect();
        swap_rows.sort_by(|a, b| gain(b).total_cmp(&gain(a)));
        swap_rows.iter().take(3).for_each(show);
        let mut kinds = std::collections::BTreeMap::new();
        for c in passives["candidates"].as_array().into_iter().flatten() {
            *kinds.entry(c["kind"].as_str().unwrap_or("?").to_string()).or_insert(0) += 1;
        }
        println!("{n} candidates {kinds:?}, {swaps} mastery swaps; used {} points, {} ascendancy, level {}",
            passives["pointsUsed"], passives["ascendancyUsed"], passives["level"]);
        println!("passives {:.1}s", t.elapsed().as_secs_f32());
        return;
    }
    if args.iter().any(|a| a == "--analyse") {
        let t = std::time::Instant::now();
        let analysis = engine.analyse(&xml).expect("analyse");
        let mut v = analysis.clone();
        for key in ["configured", "conservative", "uber"] {
            let stats = &analysis[key];
            v[key] = serde_json::json!({ "CombinedDPS": stats["CombinedDPS"], "TotalEHP": stats["TotalEHP"] });
        }
        println!("{}", serde_json::to_string_pretty(&v).unwrap());
        println!("analyse {:.1}s", t.elapsed().as_secs_f32());
        return;
    }
    if let Some(i) = args.iter().position(|a| a == "--item") {
        let item = std::fs::read_to_string(&args[i + 1]).expect("read item text");
        let trial = engine.try_item(&xml, &item).expect("try item");
        println!("item: {}", trial.item);
        for slot in &trial.slots {
            println!("{} (replacing {}):", slot.slot, slot.replaces.as_deref().unwrap_or("nothing"));
            for key in ["CombinedDPS", "TotalEHP", "Life", "FireResist", "ColdMaximumHitTaken", "Str", "ReqStr", "Int", "ReqInt"] {
                let (a, b) = (trial.before.get(key), slot.stats.get(key));
                println!("  {key}: {a:?} -> {b:?}");
            }
        }
        return;
    }
    if args.iter().any(|a| a == "--all") {
        for (key, value) in &build.stats {
            println!("{key}: {value}");
        }
        return;
    }
    for key in [
        "CombinedDPS", "TotalDPS", "TotalEHP", "Life", "EnergyShield", "Mana", "Armour", "Evasion",
        "EffectiveBlockChance", "EffectiveSpellSuppressionChance", "FireResist", "ColdResist",
        "LightningResist", "ChaosResist", "PhysicalMaximumHitTaken", "FireMaximumHitTaken",
        "ColdMaximumHitTaken", "LightningMaximumHitTaken", "ChaosMaximumHitTaken",
    ] {
        println!("{key}: {}", build.stats.get(key).map_or("-".to_string(), |v| format!("{v:.2}")));
    }
    for message in &build.messages {
        println!("PoB: {message}");
    }
    println!(
        "start {:.1}s, build {:.1}s",
        (loaded - started).as_secs_f32(),
        loaded.elapsed().as_secs_f32()
    );
}
