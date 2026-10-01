import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * Minimal synchronised player state. Positions are float64 so the shared world
 * can be very large without losing precision on the wire.
 */
export const PlayerState = schema({
  x: t.float64(),
  y: t.float64(),
  z: t.float64(),
  /** Facing angle about +Y. */
  yaw: t.float32(),
  /** Anim enum (idle / walk / run / jump). */
  anim: t.uint8(),
  /** Index into CHARACTERS (chosen by the player). */
  character: t.uint8(),
  /** Display name chosen by the player (validated by the server). */
  name: t.string(),
  /** Current Emote (0 = none). */
  emote: t.uint8().default(0),
  hp: t.uint16().default(100),
  maxHp: t.uint16().default(100),
  /** Knocked out (waiting to respawn). */
  dead: t.boolean().default(false),
  /** Increments each time the player is hit (plays the hit animation). */
  hitSeq: t.uint16().default(0),
  /** Vertical speed and last processed input: only used by the owning client for reconciliation. */
  vy: t.float64(),
  ack: t.uint32(),
  grounded: t.boolean(),
}, 'PlayerState');
export type PlayerState = SchemaType<typeof PlayerState>;

/** An active summon (one per player at most), keyed by its owner's session id. */
export const SummonState = schema({
  ownerId: t.string(),
  /** Summon definition id (shared/src/data/summons). */
  kind: t.string(),
  x: t.float64(),
  y: t.float32(),
  z: t.float64(),
  yaw: t.float32(),
  hp: t.uint16(),
  maxHp: t.uint16(),
  /** SummonMode */
  mode: t.uint8(),
  /** Index in SUMMON_ACTIONS; one-shots replay when actionSeq changes. */
  action: t.uint8(),
  actionSeq: t.uint16(),
  /** Current target: "p:<sessionId>" or "s:<ownerSessionId>", or "". */
  target: t.string(),
}, 'SummonState');
export type SummonState = SchemaType<typeof SummonState>;

export const WorldState = schema({
  players: t.map(PlayerState),
  summons: t.map(SummonState),
}, 'WorldState');
export type WorldState = SchemaType<typeof WorldState>;
