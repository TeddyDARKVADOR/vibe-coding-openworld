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
  /** Index into CHARACTERS. */
  character: t.uint8(),
  /** Vertical speed and last processed input: only used by the owning client for reconciliation. */
  vy: t.float64(),
  ack: t.uint32(),
  grounded: t.boolean(),
}, 'PlayerState');
export type PlayerState = SchemaType<typeof PlayerState>;

export const WorldState = schema({
  players: t.map(PlayerState),
}, 'WorldState');
export type WorldState = SchemaType<typeof WorldState>;
