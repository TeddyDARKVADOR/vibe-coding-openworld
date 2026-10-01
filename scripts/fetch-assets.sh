#!/usr/bin/env bash
# Downloads the official KayKit packs (CC0) from the official KayKit GitHub
# organisation into .asset-cache/. Run `npm run assets:prepare` afterwards to
# copy/optimise the files actually used by the game into client/public/assets.
#
# The prepared files are committed to the repository, so this is only needed
# to regenerate them or to add more models.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .asset-cache
clone() {
  local repo="$1" rev="$2"
  if [ ! -d ".asset-cache/$repo" ]; then
    git clone --depth 1 "https://github.com/KayKit-Game-Assets/$repo" ".asset-cache/$repo"
  fi
  git -C ".asset-cache/$repo" fetch --depth 1 origin "$rev"
  git -C ".asset-cache/$repo" checkout -q "$rev"
  echo "$repo @ $(git -C ".asset-cache/$repo" rev-parse HEAD)"
}
# Pinned commits (the versions documented in ASSETS.md).
clone KayKit-Character-Pack-Adventures-1.0 672074b73ba276876a19e8816ecdc5241817ab47
clone KayKit-Medieval-Hexagon-Pack-1.0     84fa4e91af6a88989be7c99e0891cede11f2ca38
