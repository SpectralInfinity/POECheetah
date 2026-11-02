//! Prints PoB's headline stats for a build XML file (a decoded PoB code):
//! `cargo run --release --example stats -- build.xml [--all | --item item.txt | --analyse | --passives
//!   | --upgrades [names.txt] | --rare SLOT | --compare target.xml] [--mode configured|conservative|boss] [--json out.json]`
//! `--upgrades` without a file tries every unique PoB knows.

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
    let mode = match args.iter().position(|a| a == "--mode").map(|i| args[i + 1].as_str()) {
        Some("boss") => pob_engine::Mode::Boss,
        Some("conservative") => pob_engine::Mode::Conservative,
        _ => pob_engine::Mode::Configured,
    };
    let write_json = |value: &serde_json::Value| {
        if let Some(i) = args.iter().position(|a| a == "--json") {
            std::fs::write(&args[i + 1], value.to_string()).expect("write JSON");
        }
    };
    if let Some(i) = args.iter().position(|a| a == "--compare") {
        let target = std::fs::read_to_string(&args[i + 1]).expect("read target XML");
        let t = std::time::Instant::now();
        let c = engine.compare(&xml, &target, mode, None).expect("compare");
        write_json(&c);
        let dps = |s: &serde_json::Value| s["CombinedDPS"].as_f64().unwrap_or(0.0);
        let (mine, theirs) = (dps(&c["mine"]["stats"]), dps(&c["target"]["stats"]));
        println!("mine {} ({}) {mine:.0} vs target {} ({}) {theirs:.0}", c["mine"]["skill"]["name"], c["mine"]["skill"]["part"],
            c["target"]["skill"]["name"], c["target"]["skill"]["part"]);
        for s in c["slots"].as_array().into_iter().flatten() {
            println!("{}: {} -> {}  into mine {:+.1}%  mine into target {:+.1}%", s["slot"], s["mine"]["name"], s["target"]["name"],
                (dps(&s["intoMine"]) / mine - 1.0) * 100.0, (dps(&s["intoTarget"]) / theirs - 1.0) * 100.0);
        }
        println!("config: {}", c["config"]);
        println!("compare {:.1}s", t.elapsed().as_secs_f32());
        return;
    }
    if let Some(i) = args.iter().position(|a| a == "--rare") {
        let t = std::time::Instant::now();
        let weights = [pob_engine::StatWeight { stat: "CombinedDPS".into(), weight_mult: 1.0 },
            pob_engine::StatWeight { stat: "TotalEHP".into(), weight_mult: 0.5 }];
        let search = engine.rare_search(&xml, mode, &args[i + 1], &weights).expect("rare search");
        println!("{}: {}", search.slot, search.query);
        println!("rare search {:.1}s", t.elapsed().as_secs_f32());
        return;
    }
    if let Some(i) = args.iter().position(|a| a == "--upgrades") {
        let names: Vec<String> = match args.get(i + 1).filter(|a| !a.starts_with("--")) {
            Some(file) => std::fs::read_to_string(file).expect("read names").lines().map(str::to_string).collect(),
            None => vec!["*".to_string()],
        };
        let t = std::time::Instant::now();
        let result = engine.upgrades(&xml, mode, &names).expect("upgrades");
        write_json(&result);
        let before = &result["before"];
        let gain = |c: &serde_json::Value, key: &str| {
            let (a, b) = (before[key].as_f64().unwrap_or(0.0), c["stats"][key].as_f64().unwrap_or(0.0));
            if a == 0.0 { 0.0 } else { (b - a) / a }
        };
        let mut rows: Vec<_> = result["uniques"].as_array().into_iter().flatten().collect();
        rows.sort_by(|a, b| (gain(b, "CombinedDPS") + gain(b, "TotalEHP")).total_cmp(&(gain(a, "CombinedDPS") + gain(a, "TotalEHP"))));
        for c in rows.iter().take(20) {
            println!("{:+.1}% DPS {:+.1}% EHP  {} in {} (replacing {})", gain(c, "CombinedDPS") * 100.0, gain(c, "TotalEHP") * 100.0,
                c["name"], c["slot"], c["replaces"]);
        }
        for f in result["flasks"].as_array().into_iter().flatten() {
            println!("{} {} (active {}): best prefix {} {}, best suffix {} {}", f["slot"], f["flask"], f["active"],
                f["prefixes"][0]["lines"], gain(&f["prefixes"][0], "CombinedDPS"), f["suffixes"][0]["lines"], gain(&f["suffixes"][0], "CombinedDPS"));
        }
        println!("{} trials, {} missing; upgrades {:.1}s", rows.len(), result["missing"].as_array().map_or(0, |a| a.len()), t.elapsed().as_secs_f32());
        return;
    }
    if args.iter().any(|a| a == "--passives") {
        let t = std::time::Instant::now();
        let passives = engine.passives(&xml, mode).expect("passives");
        write_json(&passives);
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
        let analysis = engine.analyse(&xml, mode).expect("analyse");
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
        let trial = engine.try_item(&xml, &item, mode).expect("try item");
        write_json(&serde_json::to_value(&trial).expect("trial as JSON"));
        println!("item: {} (requires level {:?})", trial.item, trial.required_level);
        for slot in &trial.slots {
            println!("{} (replacing {}):", slot.slot, slot.replaces.as_deref().unwrap_or("nothing"));
            for key in ["CombinedDPS", "TotalEHP", "Life", "FireResist", "PhysicalMaximumHitTaken", "ColdMaximumHitTaken", "ChaosMaximumHitTaken", "Str", "ReqStr", "Int", "ReqInt"] {
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
