# POE Cheetah

A Windows app that tells you what to do next for your Path of Exile build:
which passives to take, which items to buy, what to farm and how to make
currency. It runs Path of Building behind the scenes and ranks every option by
how much it improves your build for what it costs.

Status: early. See `docs/product-design.md` for the plan and
`docs/progress.md` for where it stands.

## Develop

```sh
npm install
npm run dev        # UI in a browser at http://localhost:1420
npm test           # unit tests
npm run tauri dev  # the desktop app (needs Rust and, on Linux, WebKitGTK)
```

Windows installers are built by GitHub Actions on every push (artifact
`poecheetah-windows-<sha>`).

POE Cheetah is not affiliated with or endorsed by Grinding Gear Games.
