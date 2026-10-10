import { describe, expect, it } from "vitest";
import { memoryBuildStore, sqlBuildStore, type BuildStore, type NewVersion } from "./builds";
import { createTestDb } from "./testing";

const version = (code: string, level = 90): NewVersion => ({
  code,
  summary: { className: "Witch", ascendancy: "Elementalist", level },
  mainSkill: "Fireball",
  stats: { CombinedDPS: 1000 * level, Life: 3000 },
});
const day = (d: number) => new Date(Date.UTC(2026, 9, d));

describe.each([
  ["SQLite", () => sqlBuildStore(createTestDb())],
  ["memory", () => memoryBuildStore()],
])("%s build store", (_name, create: () => BuildStore) => {
  it("saves builds and lists the most recently updated first", async () => {
    const store = create();
    const a = await store.add("League starter", version("A"), day(1));
    const b = await store.add("Main", version("B"), day(2));
    expect((await store.list()).map((x) => x.id)).toEqual([b, a]);

    await store.addVersion(a, version("A2", 92), day(3));
    const list = await store.list();
    expect(list.map((x) => x.name)).toEqual(["League starter", "Main"]);
    expect(list[0].latest).toMatchObject({ code: "A2", mainSkill: "Fireball", stats: { CombinedDPS: 92000 } });
    expect(list[0].latest.summary.level).toBe(92);
  });

  it("keeps every version, newest first, and skips pasting the same code twice", async () => {
    const store = create();
    const id = await store.add("Main", version("A"), day(1));
    expect(await store.addVersion(id, version("A"), day(2))).toBe(false);
    expect(await store.addVersion(id, version("B", 91), day(3))).toBe(true);
    expect((await store.versions(id)).map((v) => v.code)).toEqual(["B", "A"]);
  });

  it("stores stats calculated later", async () => {
    const store = create();
    const id = await store.add("Main", { ...version("A"), mainSkill: null, stats: null }, day(1));
    const [v] = await store.versions(id);
    expect(v.stats).toBeNull();
    await store.setStats(v.id, "Fireball", { Life: 1 });
    expect((await store.versions(id))[0]).toMatchObject({ mainSkill: "Fireball", stats: { Life: 1 } });
  });

  it("renames, remembers the active build and forgets it when deleted", async () => {
    const store = create();
    const a = await store.add("A", version("A"), day(1));
    const b = await store.add("B", version("B"), day(2));
    await store.rename(a, "Renamed");
    await store.setActive(a);
    expect(await store.activeId()).toBe(a);

    await store.remove(a);
    expect(await store.activeId()).toBeNull();
    expect((await store.list()).map((x) => [x.id, x.name])).toEqual([[b, "B"]]);
    expect(await store.versions(a)).toEqual([]);
  });
});
