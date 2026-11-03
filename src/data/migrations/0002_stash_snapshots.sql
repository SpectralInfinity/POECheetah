-- Stash value snapshots (design doc §3.5): the chosen tabs' value in chaos,
-- priced with poe.ninja when taken, for income over time.
CREATE TABLE stash_snapshots (
  id INTEGER PRIMARY KEY,
  taken_at TEXT NOT NULL,
  league TEXT NOT NULL,
  total REAL NOT NULL,
  -- JSON: [{ index, name, chaos }]
  tabs TEXT NOT NULL
);

CREATE INDEX stash_snapshots_league ON stash_snapshots (league, taken_at);
