Made-up responses shaped like the real services, for tests (tests never call
the network). Names are real game items; prices and counts are invented.

Shapes checked against the live API on 2026-10-10 (`https://poe.ninja/poe1/api/`).

- `ninja-index-state.json`: `data/index-state` (leagues; `snapshotVersions`, the
  ladders, shaped like the live response on 2026-11-02).
- `ninja-gems.json`: `economy/stash/current/item/overview?type=SkillGem`.
- `ninja-uniques.json`: the same with `type=UniqueArmour` (and alike).
- `ninja-currency.json`: `economy/stash/current/currency/overview?type=Currency`.
- `client-log.txt`: lines shaped like the game's `logs/Client.txt` (made up:
  characters, times and seeds are invented; never commit a real log).
- `ninja-exchange-currency.json`: `economy/exchange/current/overview` (lines with
  ids and chaos values, joined to items by id; shape checked live 2026-11-03).
- `stash-tabs.json`, `stash-items.json`: pathofexile.com's
  `character-window/get-stash-items` (tab list; one tab's items), made up.
