/**
 * Creates / loads / validates player data. All rules about what may be
 * stored live here (ids, names, positions).
 */
import { randomInt } from 'node:crypto';
import type { PlayerData, PlayerDataStore } from './PlayerData.ts';

/** Players can't be restored further than this from the origin (also guards against garbage). */
export const WORLD_LIMIT = 5_000_000;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

export function isValidPlayerId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

export function isValidPosition(p: unknown): p is { x: number; y: number; z: number } {
  if (!p || typeof p !== 'object') return false;
  const { x, y, z } = p as Record<string, unknown>;
  return typeof x === 'number' && typeof y === 'number' && typeof z === 'number'
    && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
    && Math.abs(x) <= WORLD_LIMIT && Math.abs(z) <= WORLD_LIMIT && y > -10 && y < 500;
}

export class PlayerDataService {
  constructor(readonly store: PlayerDataStore, private starterSummons: string[]) {}

  /** In-memory record for a guest (no valid playerId): same defaults, never saved. */
  ephemeral(guestId: string): PlayerData {
    return { ...this.fresh(guestId), friendCode: '' };
  }

  /** Existing data for this id, or a fresh record. */
  loadOrCreate(playerId: string): { data: PlayerData; isNew: boolean } {
    const existing = this.store.get(playerId);
    if (existing) {
      this.migrate(existing);
      return { data: existing, isNew: false };
    }
    const data = this.fresh(playerId);
    this.store.put(data);
    return { data, isNew: true };
  }

  private fresh(playerId: string): PlayerData {
    return {
      playerId,
      friendCode: this.newFriendCode(),
      displayName: `Player_${randomInt(1000, 10000)}`,
      character: -1,
      lastPosition: null,
      lastRotation: 0,
      ownedSummons: [...this.starterSummons],
      activeSummonId: this.starterSummons[0] ?? null,
      freeSummons: { day: '', used: 0 },
      friends: [],
      incomingRequests: [],
      outgoingRequests: [],
      lastSeen: Date.now(),
    };
  }

  /** Saved position if it is valid, else null (the caller then uses the default spawn). */
  restorablePosition(data: PlayerData): { x: number; y: number; z: number } | null {
    return isValidPosition(data.lastPosition) ? data.lastPosition : null;
  }

  savePosition(data: PlayerData, x: number, y: number, z: number, yaw: number): void {
    if (!isValidPosition({ x, y, z })) return;
    data.lastPosition = { x, y, z };
    data.lastRotation = Number.isFinite(yaw) ? yaw : 0;
    this.save(data);
  }

  save(data: PlayerData): void {
    data.lastSeen = Date.now();
    if (data.friendCode) this.store.put(data); // guests (no friend code) are never stored
  }

  private newFriendCode(): string {
    for (;;) {
      let s = '';
      for (let i = 0; i < 4; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      const code = `FRIEND-${s}`;
      if (!this.store.findByFriendCode(code)) return code;
    }
  }

  /** Fill fields added after a record was first saved. */
  private migrate(d: PlayerData): void {
    d.ownedSummons ??= [...this.starterSummons];
    d.activeSummonId ??= d.ownedSummons[0] ?? null;
    d.freeSummons ??= { day: '', used: 0 };
    d.friends ??= [];
    d.incomingRequests ??= [];
    d.outgoingRequests ??= [];
  }
}
