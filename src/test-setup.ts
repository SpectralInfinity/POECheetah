// Tests never call the network (CLAUDE.md): poe.ninja, trade and PoB responses come
// from made-up fixtures in src/core/__fixtures__/. A test that needs fetch stubs it
// with vi.stubGlobal("fetch", ...), which replaces this guard for that test.
globalThis.fetch = (input: unknown) => {
  throw new Error(`Tests never call the network; tried to fetch ${String(input)}. Use a fixture and vi.stubGlobal.`);
};
