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

# ---- Game systems (summons, mount, places, VFX, audio). All CC0, see ASSETS.md.
# Quaternius "Ultimate Monsters" glTF (CC0) as redistributed by the Bomberfan project.
clone_from() {
  local url="$1" dir="$2" rev="$3" extra="${4:-}"
  if [ ! -d ".asset-cache/$dir" ]; then git clone $extra --depth 1 "$url" ".asset-cache/$dir"; fi
  git -C ".asset-cache/$dir" fetch --depth 1 origin "$rev" && git -C ".asset-cache/$dir" checkout -q "$rev"
  echo "$dir @ $(git -C ".asset-cache/$dir" rev-parse HEAD)"
}
clone_from https://github.com/PostWorkCulture/bomberfan bomberfan f005fc4b943776002b51caf63ca0d1170110b0cb
clone KayKit-Dungeon-Remastered-1.0 b0ca9bd96a8072ab36a3a5464f00ed1e06a16d07
clone KayKit-Halloween-Bits-1.0     6dc69bf6b2fa766a985754f35ec6a0324090e6c6
clone_from https://github.com/Calinou/kenney-particle-pack kenney-particle-pack ab7086639ee73be31abd87feb21bf1402d4e8144
# Kenney / OpenGameArt CC0 sound mirror: sparse, only the files we use are downloaded.
clone_from https://github.com/Mcamento8/open-game-sfx-index open-game-sfx-index 34bbe8b525b5ceff3804915ea745532af11f6055 "--filter=blob:none --no-checkout"
git -C .asset-cache/open-game-sfx-index checkout -q 34bbe8b525b5ceff3804915ea745532af11f6055 -- \
  audio/oga-levelup-powerup/Rise03.wav audio/oga-levelup-powerup/Upper01.wav \
  audio/impact-sounds/impactPunch_medium_000.ogg audio/impact-sounds/impactPunch_heavy_000.ogg audio/impact-sounds/impactSoft_heavy_000.ogg \
  audio/oga-battle/battle_sound_effects/swish_2.wav audio/oga-battle/battle_sound_effects/swish_4.wav \
  "audio/oga-rpg-pack/RPG Sound Pack/battle/magic1.wav" "audio/oga-rpg-pack/RPG Sound Pack/battle/spell.wav" \
  "audio/oga-rpg-pack/RPG Sound Pack/NPC/giant/giant3.wav" audio/sci-fi-sounds/lowFrequency_explosion_000.ogg \
  audio/interface-sounds/click_002.ogg audio/interface-sounds/confirmation_002.ogg audio/rpg-audio/cloth2.ogg audio/rpg-audio/dropLeather.ogg \
  LICENSE README.md SOURCES.md
# Quaternius horse (Ultimate Animated Animal Pack, CC0) + CC0 bird ambience, stored with Git LFS in the trailpaw project.
mkdir -p .asset-cache/lfs
TRAILPAW=https://media.githubusercontent.com/media/jpabloglez/trailpaw/9dda59715e8e6f5a1e6b3201d595fe8fd141e312
[ -f .asset-cache/lfs/horse.glb ] || curl -fsSL -o .asset-cache/lfs/horse.glb "$TRAILPAW/assets/animals/horse/horse.glb"
[ -f .asset-cache/lfs/meadow_birds.ogg ] || curl -fsSL -o .asset-cache/lfs/meadow_birds.ogg "$TRAILPAW/assets/audio/ambience/meadow_birds.ogg"
