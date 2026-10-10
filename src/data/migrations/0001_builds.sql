-- Saved builds (design doc §3.0). Each paste of a PoB code is a version, so
-- the app can show what changed since last time.
CREATE TABLE builds (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE build_versions (
  id INTEGER PRIMARY KEY,
  build_id INTEGER NOT NULL REFERENCES builds (id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  -- JSON: { className, ascendancy, level } read from the build XML
  summary TEXT NOT NULL,
  -- Main skill and headline stats (JSON) from Path of Building; null if it failed
  main_skill TEXT,
  stats TEXT,
  added_at TEXT NOT NULL
);

CREATE INDEX build_versions_build ON build_versions (build_id, id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
