import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_BUILD, APP_BUILD_DATE, APP_VERSION } from "./buildInfo";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("build info", () => {
  it("exposes the package version, a short build id and a date", () => {
    expect(APP_VERSION).toBe(JSON.parse(read("../package.json")).version);
    expect(APP_BUILD).toMatch(/^([0-9a-f]{7}|dev)$/);
    expect(APP_BUILD_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("keeps the app version the same in package.json, tauri.conf.json and Cargo.toml", () => {
    const tauri = JSON.parse(read("../src-tauri/tauri.conf.json")).version;
    const cargo = read("../src-tauri/Cargo.toml").match(/^version = "([^"]+)"/m)?.[1];
    expect(tauri).toBe(APP_VERSION);
    expect(cargo).toBe(APP_VERSION);
  });
});
