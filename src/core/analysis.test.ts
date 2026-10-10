import { describe, expect, it } from "vitest";
import { change, pantheonAdvice, supportAdvice } from "./analysis";

const opt = (value: string, ehp: number) => ({ value, label: value, stats: { TotalEHP: ehp } });

describe("analysis advice", () => {
  it("computes relative change", () => {
    expect(change(100, 150)).toBe(0.5);
    expect(change(0, 5)).toBe(0);
  });

  it("recommends a better pantheon, or confirms the current one", () => {
    const better = pantheonAdvice({ current: "Solaris", options: [opt("Lunaris", 110), opt("Solaris", 100)] }, 100);
    expect(better.best?.value).toBe("Lunaris");
    expect(better.gain).toBeCloseTo(0.1);
    const already = pantheonAdvice({ current: "Lunaris", options: [opt("Lunaris", 110), opt("Solaris", 100)] }, 110);
    expect(already.gain).toBe(0);
    expect(pantheonAdvice({ current: "None", options: [opt("A", 50), opt("B", 50)] }, 50).noDifference).toBe(true);
  });

  it("values current supports and keeps only replacements that gain DPS", () => {
    const advice = supportAdvice({
      baseDps: 1000,
      current: [
        { name: "A", dpsWithout: 900 },
        { name: "B", dpsWithout: 600 },
      ],
      replacing: "A",
      candidates: [
        { name: "C", stats: { CombinedDPS: 1100 } },
        { name: "D", stats: { CombinedDPS: 1002 } },
        { name: "E", stats: { CombinedDPS: 950 } },
      ],
    });
    expect(advice.worth.map((w) => [w.name, Math.round(w.loss * 100)])).toEqual([
      ["B", 40],
      ["A", 10],
    ]);
    expect(advice.better.map((b) => b.name)).toEqual(["C"]);
  });

  it("prices replacements and leaves out supports nobody sells", () => {
    const supports = {
      baseDps: 1000,
      current: [{ name: "A", dpsWithout: 900 }],
      replacing: "A",
      candidates: [
        { name: "Awakened Gone", level: 5, stats: { CombinedDPS: 1200 } },
        { name: "Sold", level: 20, stats: { CombinedDPS: 1100 } },
      ],
    };
    const advice = supportAdvice(supports, 5, (name, level) => (name === "Sold" && level === 20 ? { chaos: 3, thin: false } : null));
    expect(advice.better).toEqual([{ name: "Sold", level: 20, gain: 0.1, price: { chaos: 3, thin: false } }]);
    expect(advice.unobtainable).toEqual(["Awakened Gone"]);
    expect(supportAdvice(supports).better.map((b) => b.name)).toEqual(["Awakened Gone", "Sold"]);
  });
});
