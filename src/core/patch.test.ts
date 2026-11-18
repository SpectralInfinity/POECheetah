import { describe, expect, it } from "vitest";
import { outdated, patchImpact } from "./patch";

describe("patch impact", () => {
  it("says what an update changed, or nothing when nothing headline changed", () => {
    const before = { stats: { CombinedDPS: 1000, TotalEHP: 20_000, Life: 5000 }, mainSkill: "Aspect of Arakaali", pobVersion: "v2.67.2" };
    const after = { stats: { CombinedDPS: 800, TotalEHP: 25_000, Life: 5000 }, mainSkill: "Poisonous Concoction of Bouncing", pobVersion: "v2.68.1" };
    const p = patchImpact(before, after)!;
    expect(p.text).toBe("With Path of Building v2.68.1 (was v2.67.2): DPS −20%, effective HP +25%.");
    expect(p.skillChange).toEqual({ before: "Aspect of Arakaali", after: "Poisonous Concoction of Bouncing" });
    expect(p.changes.map((c) => c.def.key)).toEqual(expect.arrayContaining(["CombinedDPS", "TotalEHP"]));
    expect(patchImpact(before, { ...before, pobVersion: "v2.68.1" })).toBeNull();
    expect(patchImpact({ ...before, pobVersion: null }, after)!.from).toBe("an earlier version");
  });

  it("finds the builds calculated with another Path of Building", () => {
    const b = (stats: Record<string, number> | null, pobVersion: string | null) => ({ latest: { stats, pobVersion } });
    const list = [b({ Life: 1 }, "v2.68.1"), b({ Life: 1 }, "v2.67.2"), b({ Life: 1 }, null), b(null, null)];
    expect(outdated(list, "v2.68.1")).toEqual([list[1], list[2]]);
    expect(outdated(list, null)).toEqual([]);
  });
});
