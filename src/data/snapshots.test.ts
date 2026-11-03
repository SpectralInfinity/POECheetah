import { describe, expect, it } from "vitest";
import { memorySnapshotStore, sqlSnapshotStore } from "./snapshots";
import { createTestDb } from "./testing";

const snap = (minutes: number, league = "Some League") => ({
  at: Date.UTC(2026, 10, 3, 18, minutes),
  league,
  total: 1000 + minutes,
  tabs: [{ index: 0, name: "Currency", chaos: 1000 + minutes }],
});

for (const [name, make] of [
  ["SQLite", () => sqlSnapshotStore(createTestDb())],
  ["memory", () => memorySnapshotStore()],
] as const) {
  describe(`stash snapshots (${name})`, () => {
    it("keeps a league's snapshots, oldest first, and removes one", async () => {
      const store = make();
      const late = await store.add(snap(30));
      await store.add(snap(0));
      await store.add(snap(10, "Other"));
      const list = await store.list("Some League");
      expect(list.map((s) => s.total)).toEqual([1000, 1030]);
      expect(list[1]).toEqual({ ...snap(30), id: late });
      await store.remove(late);
      expect((await store.list("Some League")).map((s) => s.total)).toEqual([1000]);
    });
  });
}
