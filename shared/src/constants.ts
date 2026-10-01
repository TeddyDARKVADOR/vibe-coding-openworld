/**
 * Global constants shared by client and server. Changing any value that
 * affects world generation (seed, scales, chunk size, spacing...) changes the
 * world for everybody, so client and server must always be rebuilt together.
 */

/** Seed of the single shared world. Same seed + same chunk = same content. */
export const WORLD_SEED = 'friends-world-001';

/** 1 world unit = 1 metre. KayKit hex models are 2 units wide; scaled ×6 → 12 m hexes, ~5.6 m houses. */
export const HEX_SCALE = 6;
/** KayKit characters are ~2.4 units tall; ×0.75 → ~1.8 m. */
export const CHARACTER_SCALE = 0.75;

/** Edge length (= circumradius) of a pointy-top hex, in metres. */
export const HEX_RADIUS = (2 / Math.sqrt(3)) * HEX_SCALE;
/** Flat-to-flat width of a hex (distance between neighbouring centres), in metres. */
export const HEX_WIDTH = 2 * HEX_SCALE;
/** Distance between two hex rows along Z, in metres. */
export const HEX_ROW = 1.5 * HEX_RADIUS;

/** Square chunk size in metres. Chunk (cx, cz) covers [cx*S, (cx+1)*S) × [cz*S, (cz+1)*S). */
export const CHUNK_SIZE = 128;

/** Client: chunks within this Chebyshev radius are rendered; beyond UNLOAD they are freed. */
export const RENDER_LOAD_RADIUS = 3;
export const RENDER_UNLOAD_RADIUS = 4;
/** Colliders are only needed close to a character (client prediction + server). */
export const PHYSICS_RADIUS = 1;

/** Fixed simulation step shared by client prediction and server (30 Hz). */
export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;
/** Server → client state patches per second. */
export const PATCH_RATE = 20;

/** Character movement tuning (metres, seconds). */
export const WALK_SPEED = 4.0;
export const RUN_SPEED = 8.5;
export const GRAVITY = -20;
export const JUMP_SPEED = 6.2;
export const MAX_FALL_SPEED = 40;

/** Physics capsule representing a character (visual model is separate). */
export const CAPSULE_RADIUS = 0.35;
export const CAPSULE_HALF_HEIGHT = 0.55; // cylinder part; total height = 2*(0.55+0.35) = 1.8 m

/** Players spawn close to the origin so friends see each other immediately. */
export const SPAWN_SPACING = 3;
/** No obstacle is generated within this distance of the origin. */
export const SPAWN_CLEAR_RADIUS = 16;
