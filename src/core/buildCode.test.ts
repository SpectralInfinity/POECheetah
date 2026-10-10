import { describe, expect, it } from "vitest";
import { decodeBuildCode, encodeBuildCode, readBuildSummary } from "./buildCode";

const XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n<PathOfBuilding>\n' +
  '\t<Build level="92" targetVersion="3_0" className="Witch" ascendClassName="Elementalist" mainSocketGroup="1">\n' +
  "\t</Build>\n</PathOfBuilding>";

describe("PoB build codes", () => {
  it("round-trips build XML through a code", async () => {
    const code = await encodeBuildCode(XML);
    expect(code).toMatch(/^[A-Za-z0-9_=-]+$/);
    expect(await decodeBuildCode(code)).toBe(XML);
  });

  it("ignores surrounding whitespace and line breaks in a pasted code", async () => {
    const code = await encodeBuildCode(XML);
    const pasted = `  ${code.slice(0, 20)}\n${code.slice(20)}\n`;
    expect(await decodeBuildCode(pasted)).toBe(XML);
  });

  it("rejects text that isn't a code", async () => {
    await expect(decodeBuildCode("https://pobb.in/abc?x=1")).rejects.toThrow("Not a Path of Building code");
    await expect(decodeBuildCode("aGVsbG8gd29ybGQ=")).rejects.toThrow("Not a Path of Building code");
  });

  it("reads class, ascendancy and level", () => {
    expect(readBuildSummary(XML)).toEqual({ className: "Witch", ascendancy: "Elementalist", level: 92 });
  });
});
