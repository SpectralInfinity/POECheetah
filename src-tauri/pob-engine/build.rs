// Compiles the lua-utf8 module PoB requires. Its Lua symbols resolve against
// the LuaJIT that mlua builds and links (`vendored` feature).
fn main() {
    cc::Build::new()
        .file("vendor/luautf8/lutf8lib.c")
        .include("vendor/luajit-include")
        .include("vendor/luautf8")
        .warnings(false)
        .compile("luautf8");
    println!("cargo:rerun-if-changed=vendor");
}
