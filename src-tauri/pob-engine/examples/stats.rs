//! Prints PoB's headline stats for a build XML file (a decoded PoB code):
//! `cargo run --release --example stats -- build.xml`

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
