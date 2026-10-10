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
    /// The build's stats without the item.
    pub before: BTreeMap<String, f64>,
    /// One entry per slot the item fits; empty if it fits none.
    #[serde(default)]
    pub slots: Vec<SlotTrial>,
}

type Reply<T> = mpsc::Sender<Result<T, String>>;

enum Job {
    LoadBuild(String, Reply<BuildStats>),
    TryItem(String, String, Reply<ItemTrial>),
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
                        Job::TryItem(xml, item, reply) => {
                            let _ = reply.send(api.try_item(&xml, &item));
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
    /// in game or from the trade site, in each slot it fits.
    pub fn try_item(&self, xml: &str, item_text: &str) -> Result<ItemTrial, String> {
        let (reply, result) = mpsc::channel();
        self.jobs
            .send(Job::TryItem(xml.to_string(), item_text.to_string(), reply))
            .map_err(|_| "Path of Building is not running".to_string())?;
        result
            .recv()
            .map_err(|_| "Path of Building stopped while trying the item".to_string())?
    }
}

struct Api {
    lua: Lua,
    load_build: Function,
    try_item: Function,
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

    fn try_item(&self, xml: &str, item_text: &str) -> Result<ItemTrial, String> {
        let value: Value = self
            .try_item
            .call((xml, item_text))
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
        .call((pob_dir, inflate_fn, deflate_fn))
        .map_err(fail)?;
    let load_build: Function = api.get("loadBuild").map_err(fail)?;
    let try_item: Function = api.get("tryItem").map_err(fail)?;
    Ok(Api { lua, load_build, try_item })
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
