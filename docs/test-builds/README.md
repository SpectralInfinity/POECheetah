# Test builds

The owner's real characters (PoB codes), for checking each session's feature
by hand on real builds. Not used by automated tests: those use made-up
fixtures (`src/core/__fixtures__/`, `src-tauri/pob-engine/tests/fixtures/`).

| File | Character | Main skill | Good for |
|---|---|---|---|
| `reliquarian-poison-95.txt` | Level 95 Scion / Reliquarian | Poisonous Concoction of Bouncing | Damage and defence advice; the reference numbers in `docs/progress.md` (session 0) |
| `luminary-support-97.txt` | Level 97 Scion / Luminary | Flame Link (no damage of its own; party support with minions) | Builds whose main skill deals no damage; league mechanics (§3.6, Luminary mercenaries) |

To try one with the engine (after `scripts/fetch-pob.sh`):

```sh
python3 -c "import zlib,base64,sys; c=open(sys.argv[1]).read().strip(); print(zlib.decompress(base64.urlsafe_b64decode(c+'='*(-len(c)%4))).decode())" \
  docs/test-builds/reliquarian-poison-95.txt > /tmp/build.xml
cd src-tauri/pob-engine && cargo run --release --example stats -- /tmp/build.xml --passives
```

In the app, paste the file's contents into "Add a build". When the owner
sends a newer code for a character, replace its file.
