/**
 * Network protocol shared by client and server. The Colyseus state schema
 * itself lives in the server (server/src/rooms/schema.ts) and is mirrored on
 * the client through Colyseus' reflection.
 */
import { hashString } from './math/rng.ts';

export const ROOM_NAME = 'world';
export const DEFAULT_SERVER_PORT = 2567;

export enum MsgType {
  Input = 'i',
}

export enum Anim {
  Idle = 0,
  Walk = 1,
  Run = 2,
  Jump = 3,
}

export const INPUT_AXIS_MAX = 127;

/** One simulation tick of player intent. The client never sends positions. */
export interface PlayerInput {
  /** Sequence number, increases by one per tick. */
  seq: number;
  /** Desired horizontal direction in world space, quantised to [-127, 127]. */
  mx: number;
  mz: number;
  run: boolean;
  jump: boolean;
}

/** Compact wire form: [seq, mx, mz, flags]. */
export type InputPacket = [number, number, number, number];

export function encodeInput(i: PlayerInput): InputPacket {
  return [i.seq, i.mx, i.mz, (i.run ? 1 : 0) | (i.jump ? 2 : 0)];
}

export function decodeInput(p: unknown): PlayerInput | null {
  if (!Array.isArray(p) || p.length !== 4 || !p.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return { seq: p[0], mx: p[1], mz: p[2], run: (p[3] & 1) !== 0, jump: (p[3] & 2) !== 0 };
}

/** KayKit Adventurers characters available in the free tier (files in client/public/assets/characters). */
export const CHARACTERS = ['Knight', 'Barbarian', 'Mage', 'Rogue', 'Rogue_Hooded'] as const;
export type CharacterName = (typeof CHARACTERS)[number];

/** Deterministic character choice from a session id. */
export function characterForSession(sessionId: string): number {
  return hashString(sessionId) % CHARACTERS.length;
}
