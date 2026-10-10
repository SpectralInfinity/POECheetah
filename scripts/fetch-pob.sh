#!/usr/bin/env bash
# Downloads the pinned Path of Building Community release (src-tauri/pob-version.txt)
# into src-tauri/pob/, keeping only what the headless engine needs: the Lua
# sources, data, the current passive tree (no images) and PoB's Lua libraries.
# About 210 MB instead of the repository's 1.1 GB. Skips the download when the
# folder already holds the pinned version.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(tr -d '[:space:]' < "$root/src-tauri/pob-version.txt")"
dest="$root/src-tauri/pob"

if [ -f "$dest/VERSION" ] && [ "$(cat "$dest/VERSION")" = "$version" ]; then
  echo "Path of Building $version already in src-tauri/pob"
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
repo="$work/repo"

# Fetch the tree without file contents, then check out only the paths we keep.
git clone --quiet --depth 1 --branch "$version" --filter=blob:none --no-checkout \
  https://github.com/PathOfBuildingCommunity/PathOfBuilding.git "$repo"
latest="$(git -C "$repo" show HEAD:src/GameVersions.lua | sed -n 's/.*"\(3_[0-9]*\)" }$/\1/p' | tail -1)"
if [ -z "$latest" ]; then
  echo "Could not read the latest tree version from GameVersions.lua" >&2
  exit 1
fi
git -C "$repo" ls-tree -r --name-only HEAD \
  | grep -E '^(LICENSE\.md|runtime/lua/.*|src/.*)$' \
  | grep -vE '^src/(Export|Assets)/' \
  | grep -vE '^src/TreeData/' > "$work/keep"
git -C "$repo" ls-tree -r --name-only HEAD \
  | grep -E "^src/TreeData/(${latest}/[^/]+\.lua|3_19/Assets\.lua|legion/[^/]+\.lua|[^/]+\.lua)$" >> "$work/keep" || true
git -C "$repo" -c gc.auto=0 -c maintenance.auto=false checkout --quiet HEAD --pathspec-from-file="$work/keep"

rm -rf "$dest"
mkdir -p "$dest"
cp -R "$repo/src" "$repo/runtime" "$repo/LICENSE.md" "$dest/"
echo "$version" > "$dest/VERSION"
echo "Path of Building $version (tree $latest) → src-tauri/pob ($(du -sh "$dest" | cut -f1))"
