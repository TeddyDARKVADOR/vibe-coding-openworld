# Third-party assets

All 3D content in the game (characters, ground tiles, roads, rivers, lakes,
trees, rocks, hills, mountains, buildings, props, clouds) comes from real,
downloaded asset packs. The code only chooses **which** model to place,
**where**, with which rotation, in which chunk, and when to load/unload it.
No visual geometry is generated in code.

| | |
|---|---|
| Download date | 2026-10-01 |
| Download method | `git clone` of the official KayKit GitHub repositories (`scripts/fetch-assets.sh`, commits pinned) |
| Preparation | `scripts/prepare-assets.mjs` (see "Modifications" below) |
| Location in the repo | `client/public/assets/` |

## KayKit – Character Pack: Adventurers (1.0, free tier)

- **Creator:** Kay Lousberg — <https://kaylousberg.com>
- **Official page:** <https://kaylousberg.itch.io/kaykit-adventurers>
- **Source used:** official repository <https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0>,
  commit `672074b73ba276876a19e8816ecdc5241817ab47` (2023-09-16)
- **License:** CC0 1.0 Universal (public domain dedication) — "free to use in personal,
  educational and commercial projects", attribution not required.
  Original license file kept at `client/public/assets/characters/LICENSE.txt`.
- **Files used:** `Characters/gltf/Knight.glb`, `Barbarian.glb`, `Mage.glb`, `Rogue.glb`, `Rogue_Hooded.glb`
  → `client/public/assets/characters/*.glb` (with their embedded textures).
- **Usage:** one of the 5 free characters is chosen deterministically from each
  player's session id. Animations used: `Idle`, `Walking_A`, `Running_A`, `Jump_Idle`
  (plus `Jump_Start`, `Jump_Land` kept for later), all already embedded in the
  character files.
- **Modifications:** the original GLBs contain 76 animation clips (~3.6 MB each).
  `prepare-assets.mjs` removes the unused clips (→ ~530 KB each). Meshes,
  skeletons, skins, materials and textures are unchanged. At runtime the
  weapons/shields that the pack attaches to the hands are hidden (the
  prototype has no weapons); helmets, hats, capes etc. stay as designed.
- Not used: EXTRA / SOURCE paid tiers.

> Note: itch.io currently lists "Adventurers 2.0". The GitHub repository
> published by KayKit holds the 1.0 free tier (same 5 free characters, CC0),
> which allows a reproducible scripted download.

## KayKit – Medieval Hexagon Pack (1.0, free tier)

- **Creator:** Kay Lousberg — <https://kaylousberg.com>
- **Official page:** <https://kaylousberg.itch.io/kaykit-medieval-hexagon>
- **Source used:** official repository <https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0>,
  commit `84fa4e91af6a88989be7c99e0891cede11f2ca38` (2024-04-26)
- **License:** CC0 1.0 Universal, attribution not required.
  Original license file kept at `client/public/assets/environment/hexagon/LICENSE.txt`.
- **Files used (147 models, `.gltf` + `.bin`, unmodified) + the shared atlas
  `hexagons_medieval.png`** → `client/public/assets/environment/hexagon/`:
  - tiles: `hex_grass`, `hex_water`, `hex_road_A…M`, `hex_river_A…L`,
    `hex_river_A_curvy`, `hex_river_crossing_A/B`, `hex_coast_A…E`
  - buildings (blue/red/green/yellow): `home_A`, `home_B`, `tavern`, `church`,
    `market`, `well`, `windmill`, `blacksmith`, `lumbermill`, `tower_A`,
    `barracks`, `archeryrange`, `watermill`; neutral: `bridge_A/B`, `grain`,
    `fence_wood_straight`, `stage_A`
  - nature: `mountain_A/B/C` (+ `_grass`, `_grass_trees`), `hills_A/B/C`
    (+ `_trees`), `hill_single_A/B/C`, `rock_single_A…E`, `tree_single_A/B`
    (+ `_A_cut`), `trees_A/B_small/medium/large/cut`, `waterlily_A/B`,
    `waterplant_A/B`, `cloud_big`, `cloud_small`
  - props: `barrel`, `crate_A_big`, `crate_B_small`, `crate_long_A`, `sack`,
    `tent`, `wheelbarrow`, `bucket_water`, `resource_lumber`, `resource_stone`,
    `pallet`, `flag_*`
- **Usage:** the whole world (ground hexes scaled ×6 → 12 m tiles, roads,
  rivers with bridges, lakes with coasts, forests, mountains, villages).
  A few copied models are not placed yet (`hex_river_A_curvy`, `building_bridge_B`,
  `building_stage_A`, `fence_wood_straight`, `*_cut` trees, `pallet`,
  `watermill`); they are never downloaded by the game unless placed.
- **Modifications:** none to the files. At runtime all models share one
  material using the pack's atlas texture (they all reference the same atlas),
  which enables GPU instancing.
- **Derived data:** `shared/src/world/assetBounds.generated.ts` (bounding boxes
  and a reduced set of hull points per model) is computed from these files and
  used to build simple colliders.

## KayKit – Forest Nature Pack — *not included yet*

- **Creator:** Kay Lousberg — official page <https://kaylousberg.itch.io/kaykit-forest>
  (also <https://kaylousberg.com/game-assets/forest-nature-pack>)
- **License (per the official page):** CC0, free tier with 100+ models.
- **Status:** this pack is distributed only through itch.io (no official
  GitHub repository). itch.io, kaylousberg.com and their CDNs were blocked by
  the network policy of the environment used to build this prototype, so the
  files could not be downloaded. The world currently uses the trees, rocks,
  hills and mountains of the Medieval Hexagon pack instead — still real KayKit
  models, same art style. No placeholder geometry was made.
- **To add it later:** download the free tier from itch.io, put the `.gltf`
  files in `client/public/assets/environment/forest/`, add their names to
  `prepare-assets.mjs` (bounds) and to the lists in
  `shared/src/world/chunkgen.ts` (e.g. `SINGLE_TREES`, `ROCKS`). Document the
  date and file list here.

## KayKit – Character Animations — *not needed*

- **Official page:** <https://kaylousberg.itch.io/kaykit-character-animations> (CC0 per the page)
- Not downloaded (itch.io only, blocked as above) and not required: the
  Adventurers characters already embed the Idle / Walk / Run / Jump animations
  the prototype uses.

## Software dependencies (npm)

three.js (MIT), @dimforge/rapier3d-compat (Apache-2.0), Colyseus + @colyseus/sdk
(MIT), Vite (MIT), TypeScript (Apache-2.0), concurrently (MIT), tsx (MIT),
@gltf-transform (MIT, asset preparation only), Playwright (Apache-2.0, dev tests only).
