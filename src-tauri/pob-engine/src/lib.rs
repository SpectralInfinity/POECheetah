//! Path of Building Community, run headless in embedded LuaJIT (design doc §5.1).
//!
//! PoB keeps global state and takes seconds to load its data, so one engine
//! lives on its own thread for the life of the app and requests queue to it.

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::os::raw::c_int;
use std::path::Path;
use std::sync::mpsc;
use std::thread;

use mlua::{Function, Lua, LuaOptions, LuaSerdeExt, StdLib, Table, Value};
use serde::{Deserialize, Serialize};

extern "C-unwind" {
    /// From vendor/luautf8 (compiled by build.rs); PoB requires it as "lua-utf8".
    fn luaopen_utf8(state: *mut mlua::ffi::lua_State) -> c_int;
}

/// What PoB calculated for a build.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildStats {
    /// PoB's numeric main output, keyed as in PoB (e.g. `CombinedDPS`, `TotalEHP`, `Life`).
    pub stats: BTreeMap<String, f64>,
    /// Name of the main skill PoB calculated, if any.
    pub main_skill: Option<String>,
    /// PoB's console messages while loading (e.g. missing data warnings).
    #[serde(default)]
    pub messages: Vec<String>,
}

/// A build calculated with an item in one slot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotTrial {
    /// PoB's slot label, e.g. "Ring 1".
    pub slot: String,
    /// Name of the item currently in the slot, if any.
    pub replaces: Option<String>,
    pub stats: BTreeMap<String, f64>,
}

/// An item tried in every slot it fits.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemTrial {
    /// The item's name as PoB read it.
    pub item: String,
    /// The character level the item needs, as PoB read it.
    #[serde(default)]
    pub required_level: Option<f64>,
    /// The build's stats without the item.
    pub before: BTreeMap<String, f64>,
    /// One entry per slot the item fits; empty if it fits none.
    #[serde(default)]
    pub slots: Vec<SlotTrial>,
}

/// Honest DPS, boss check, pantheon and support gem ranking (design doc §3.9),
/// passed through as PoB's JSON-like result; the UI reads its fields.
pub type Analysis = serde_json::Value;

/// Passive advisor candidates (design doc §3.1), each with PoB's stats after
/// allocating it and its path; passed through like [`Analysis`].
pub type Passives = serde_json::Value;

/// Item upgrade trials (design doc §3.2): uniques in every slot they fit and
/// ranked flask mods, passed through like [`Analysis`].
pub type Upgrades = serde_json::Value;

/// A build compared with a target build, or one build's numbers (design doc
/// §3.0), passed through like [`Analysis`].
pub type Compared = serde_json::Value;

/// How the build's config is set for a calculation (design doc §3.1, §3.2, §3.9).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    /// The build's config as the player set it.
    Configured,
    /// Situational assumptions ("When In Combat", "For Effective DPS") cleared.
    Conservative,
    /// Assumptions cleared and the enemy an uber pinnacle boss.
    Boss,
}

impl Mode {
    fn as_str(self) -> &'static str {
        match self {
            Mode::Configured => "configured",
            Mode::Conservative => "conservative",
            Mode::Boss => "boss",
        }
    }
}

/// A stat PoB's weighted rare search scores items by (as its trader's weights).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatWeight {
    /// PoB output key, e.g. `CombinedDPS` or `TotalEHP`.
    pub stat: String,
    pub weight_mult: f64,
}

/// A weighted trade site search for a rare in one slot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RareSearch {
    pub slot: String,
    /// The trade site's query JSON (`{"query": …, "sort": …}`).
    pub query: String,
}

type Reply<T> = mpsc::Sender<Result<T, String>>;

enum Job {
    LoadBuild(String, Reply<BuildStats>),
    TryItem(String, String, Mode, Reply<ItemTrial>),
    /// An engine.lua API function returning JSON, with its arguments.
    Json(&'static str, Vec<serde_json::Value>, Reply<serde_json::Value>),
}

/// Handle to the engine thread. Cheap to share; requests run one at a time.
pub struct Engine {
    jobs: mpsc::Sender<Job>,
}

impl Engine {
    /// Starts PoB from `pob_dir` (the folder holding `src/` and `runtime/lua/`,
    /// see scripts/fetch-pob.sh). Blocks until PoB has loaded its data.
    pub fn start(pob_dir: &Path) -> Result<Engine, String> {
        let pob_dir = pob_dir
            .to_str()
            .ok_or("Path of Building folder path is not valid Unicode")?
            .trim_start_matches(r"\\?\")
            .replace('\\', "/");
        let (jobs, queue) = mpsc::channel::<Job>();
        let (ready, started) = mpsc::channel::<Result<(), String>>();
        thread::Builder::new()
            .name("pob-engine".into())
            // PoB's calculations recurse deeply; give LuaJIT room.
            .stack_size(16 * 1024 * 1024)
            .spawn(move || {
                let api = match start_lua(&pob_dir) {
                    Ok(api) => {
                        let _ = ready.send(Ok(()));
                        api
                    }
                    Err(e) => {
                        let _ = ready.send(Err(e));
                        return;
                    }
                };
                for job in queue {
                    match job {
                        Job::LoadBuild(xml, reply) => {
                            let _ = reply.send(api.load_build(&xml));
                        }
                        Job::TryItem(xml, item, mode, reply) => {
                            let _ = reply.send(api.try_item(&xml, &item, mode));
                        }
                        Job::Json(name, args, reply) => {
                            let _ = reply.send(api.call_json(name, args));
                        }
                    }
                }
            })
            .map_err(|e| format!("Could not start the Path of Building thread: {e}"))?;
        started
            .recv()
            .map_err(|_| "Path of Building stopped while starting".to_string())??;
        Ok(Engine { jobs })
    }

    /// Loads a build from PoB's XML (a decoded PoB code) and returns its stats.
    pub fn load_build(&self, xml: &str) -> Result<BuildStats, String> {
        let (reply, result) = mpsc::channel();
        self.jobs
            .send(Job::LoadBuild(xml.to_string(), reply))
            .map_err(|_| "Path of Building is not running".to_string())?;
        result
            .recv()
            .map_err(|_| "Path of Building stopped while loading the build".to_string())?
    }

    /// Calculates the build (PoB XML) with an item, given as the text copied
    /// in game or from the trade site, in each slot it fits, with the config in `mode`.
    pub fn try_item(&self, xml: &str, item_text: &str, mode: Mode) -> Result<ItemTrial, String> {
        let (reply, result) = mpsc::channel();
        self.jobs
            .send(Job::TryItem(xml.to_string(), item_text.to_string(), mode, reply))
            .map_err(|_| "Path of Building is not running".to_string())?;
        result
            .recv()
            .map_err(|_| "Path of Building stopped while trying the item".to_string())?
    }

    /// Recalculates the build under conservative settings, against uber
    /// bosses, with each pantheon, and with alternative support gems (ranked
    /// with the config in `mode`). Takes tens of seconds on a large build.
    pub fn analyse(&self, xml: &str, mode: Mode) -> Result<Analysis, String> {
        self.json("analyse", vec![xml.into(), mode.as_str().into()])
    }

    /// Calculates every passive worth taking next (adjacent nodes, notables
    /// and keystones a few points away, mastery effects, ascendancy notables)
    /// and every free swap of an allocated mastery, with the config in `mode`.
    pub fn passives(&self, xml: &str, mode: Mode) -> Result<Passives, String> {
        self.json("passives", vec![xml.into(), mode.as_str().into()])
    }

    /// Tries each named unique item (names as poe.ninja lists them; PoB's
    /// unique database supplies the item) in every slot it fits, and ranks
    /// magic flask mods for each flask, with the config in `mode`. `["*"]`
    /// tries every unique PoB knows (slow; for checking by hand).
    pub fn upgrades(&self, xml: &str, mode: Mode, uniques: &[String]) -> Result<Upgrades, String> {
        self.json("upgrades", vec![xml.into(), mode.as_str().into(), uniques.into()])
    }

    /// PoB's weighted trade search for a rare in `slot` (PoB's slot name,
    /// e.g. "Ring 1"). Tests every trade mod in the slot: seconds per slot.
    pub fn rare_search(&self, xml: &str, mode: Mode, slot: &str, weights: &[StatWeight]) -> Result<RareSearch, String> {
        let weights = serde_json::to_value(weights).map_err(|e| e.to_string())?;
        let value = self.json("rareSearch", vec![xml.into(), mode.as_str().into(), slot.into(), weights])?;
        serde_json::from_value(value).map_err(|e| format!("Unexpected result from Path of Building: {e}"))
    }

    /// PoB's numbers for a build (PoB XML) with the config in `mode`, the main
    /// skill calculated in part `skill_part` (1-based, as PoB counts) if given.
    pub fn calculate(&self, xml: &str, mode: Mode, skill_part: Option<u32>) -> Result<Compared, String> {
        self.json("calculate", vec![xml.into(), mode.as_str().into(), skill_part.into()])
    }

    /// My build against a target build (both PoB XML) with the config in
    /// `mode`: both builds' numbers, each slot's items swapped both ways, and
    /// the config options that differ. The target's main skill is calculated
    /// in part `target_skill_part` if given. Loads each build once or twice.
    pub fn compare(&self, my_xml: &str, target_xml: &str, mode: Mode, target_skill_part: Option<u32>) -> Result<Compared, String> {
        self.json("compare", vec![my_xml.into(), target_xml.into(), mode.as_str().into(), target_skill_part.into()])
    }

    fn json(&self, name: &'static str, args: Vec<serde_json::Value>) -> Result<serde_json::Value, String> {
        let (reply, result) = mpsc::channel();
        self.jobs
            .send(Job::Json(name, args, reply))
            .map_err(|_| "Path of Building is not running".to_string())?;
        result
            .recv()
            .map_err(|_| "Path of Building stopped while calculating".to_string())?
    }
}

struct Api {
    lua: Lua,
    load_build: Function,
    try_item: Function,
    api: Table,
}

impl Api {
    fn load_build(&self, xml: &str) -> Result<BuildStats, String> {
        let value: Value = self
            .load_build
            .call(xml)
            .map_err(|e| format!("Path of Building could not load the build: {}", lua_message(&e)))?;
        self.lua
            .from_value(value)
            .map_err(|e| format!("Unexpected result from Path of Building: {e}"))
    }

    fn call_json(&self, name: &str, args: Vec<serde_json::Value>) -> Result<serde_json::Value, String> {
        let what = match name {
            "analyse" => "analyse the build",
            "passives" => "check passives",
            "upgrades" => "try items",
            "calculate" => "calculate the build",
            "compare" => "compare the builds",
            _ => "make a trade search",
        };
        let fail = |e: mlua::Error| format!("Path of Building could not {what}: {}", lua_message(&e));
        let function: Function = self.api.get(name).map_err(fail)?;
        let args = args
            .iter()
            .map(|a| self.lua.to_value(a))
            .collect::<mlua::Result<mlua::MultiValue>>()
            .map_err(fail)?;
        let value: Value = function.call(args).map_err(fail)?;
        self.lua
            .from_value(value)
            .map_err(|e| format!("Unexpected result from Path of Building: {e}"))
    }

    fn try_item(&self, xml: &str, item_text: &str, mode: Mode) -> Result<ItemTrial, String> {
        let value: Value = self
            .try_item
            .call((xml, item_text, mode.as_str()))
            .map_err(|e| format!("Path of Building could not try the item: {}", lua_message(&e)))?;
        self.lua
            .from_value(value)
            .map_err(|e| format!("Unexpected result from Path of Building: {e}"))
    }
}

fn start_lua(pob_dir: &str) -> Result<Api, String> {
    let fail = |e: mlua::Error| format!("Path of Building failed to start: {}", lua_message(&e));
    // PoB expects the full standard library, as in the plain `luajit` binary.
    let lua = unsafe { Lua::unsafe_new_with(StdLib::ALL, LuaOptions::default()) };

    let utf8 = unsafe { lua.create_c_function(luaopen_utf8) }.map_err(fail)?;
    let package: Table = lua.globals().get("package").map_err(fail)?;
    let preload: Table = package.get("preload").map_err(fail)?;
    preload.set("lua-utf8", utf8).map_err(fail)?;

    let inflate_fn = lua
        .create_function(|lua, data: mlua::String| match inflate(&data.as_bytes()) {
            Some(out) => Ok(Value::String(lua.create_string(out)?)),
            None => Ok(Value::Nil),
        })
        .map_err(fail)?;
    let deflate_fn = lua
        .create_function(|lua, data: mlua::String| lua.create_string(deflate(&data.as_bytes())))
        .map_err(fail)?;

    let api: Table = lua
        .load(include_str!("../lua/engine.lua"))
        .set_name("@engine.lua")
        .call((pob_dir, inflate_fn, deflate_fn, lua.array_metatable()))
        .map_err(fail)?;
    let load_build: Function = api.get("loadBuild").map_err(fail)?;
    let try_item: Function = api.get("tryItem").map_err(fail)?;
    Ok(Api { lua, load_build, try_item, api })
}

/// Error text without mlua's wrapping (PoB's own messages are what matter).
fn lua_message(e: &mlua::Error) -> String {
    match e {
        mlua::Error::CallbackError { cause, .. } => lua_message(cause),
        mlua::Error::RuntimeError(msg) => msg.clone(),
        other => other.to_string(),
    }
}

/// zlib inflate, as PoB's `Inflate` (build codes, timeless jewel data). None if the data is invalid.
pub fn inflate(data: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    flate2::read::ZlibDecoder::new(data).read_to_end(&mut out).ok()?;
    Some(out)
}

/// zlib deflate, as PoB's `Deflate`.
pub fn deflate(data: &[u8]) -> Vec<u8> {
    let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(data).expect("writing to memory");
    encoder.finish().expect("writing to memory")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zlib_round_trip_and_bad_input() {
        let text = b"<PathOfBuilding><Build level=\"90\"/></PathOfBuilding>";
        assert_eq!(inflate(&deflate(text)).as_deref(), Some(&text[..]));
        assert_eq!(inflate(b"not zlib"), None);
    }
}
