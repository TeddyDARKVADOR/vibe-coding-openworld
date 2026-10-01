/** Server-side live summon (one per player at most). */
import { SummonMode, type SummonAction, type SummonDefinition } from '@openworld/shared';
import type { SimBody } from '../simulation/ServerSimulation.ts';

export interface Buff { stat: 'attack' | 'defense' | 'speed'; amount: number; until: number }

export interface SummonEntity {
  /** Owner's session id (also the key of the summon in the room state). */
  ownerId: string;
  def: SummonDefinition;
  body: SimBody;
  hp: number;
  mode: SummonMode;
  /** Locomotion or one-shot animation slot, with a counter to replay one-shots. */
  action: SummonAction;
  actionSeq: number;
  /** One-shot animation lock (seconds since epoch of the room clock). */
  actionUntil: number;
  /** Target reference: "p:<sessionId>" (player) or "s:<ownerId>" (summon), or "". */
  target: string;
  /** Ability index → time when it is ready again. */
  readyAt: number[];
  buffs: Buff[];
  /** Ability the owner asked for, executed once in range. */
  pending: { index: number; until: number } | null;
  spawnUntil: number;
  /** Dash in progress (velocity until a time, target to hit at the end). */
  dash: { vx: number; vz: number; until: number; hit: string; damage: number } | null;
  lastHitAt: number;
  /** When dead: removal time. */
  removeAt: number;
}

export function createSummonEntity(ownerId: string, def: SummonDefinition, body: SimBody, now: number): SummonEntity {
  return {
    ownerId, def, body, hp: def.stats.maxHp, mode: SummonMode.Spawning, action: 'spawn', actionSeq: 1, actionUntil: now + 1,
    target: '', readyAt: def.abilities.map(() => 0), buffs: [], pending: null, spawnUntil: now + 1.1, removeAt: 0, dash: null, lastHitAt: 0,
  };
}

/** Stat including active buffs. */
export function statOf(e: SummonEntity, stat: 'attack' | 'defense' | 'speed', now: number): number {
  const base = e.def.stats[stat];
  let flat = 0, ratio = 0;
  for (const b of e.buffs) {
    if (b.until <= now || b.stat !== stat) continue;
    if (stat === 'defense') flat += b.amount; else ratio += b.amount;
  }
  return (base + flat) * (1 + ratio);
}
