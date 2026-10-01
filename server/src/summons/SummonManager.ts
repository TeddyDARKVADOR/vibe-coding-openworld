/**
 * Owns the live summons: calling / dismissing, the collection (owned,
 * active, free summons), and the simple AI state machine:
 *
 *   SPAWNING → IDLE ⇄ FOLLOW,  far from owner → RETURN,  ordered → ATTACK,  hp 0 → DEAD
 *
 * Combat itself (abilities, damage) is in ../combat.
 */
import { randomInt } from 'node:crypto';
import {
  FREE_SUMMONS_PER_DAY, SUMMON_ACTIONS, SUMMON_RECALL_DELAY, SummonMode, drawSummon, getSummon,
  type CollectionInfo, type SummonAction,
} from '@openworld/shared';
import type { ServerSimulation } from '../simulation/ServerSimulation.ts';
import type { PlayerData } from '../persistence/PlayerData.ts';
import { createSummonEntity, statOf, type SummonEntity } from './SummonEntity.ts';

const FOLLOW_DISTANCE = 2.5;
const RUN_DISTANCE = 7;
const RETURN_DISTANCE = 28;
const TELEPORT_DISTANCE = 60;
const DEATH_REMOVAL_DELAY = 3;

export interface SummonHost {
  sim: ServerSimulation;
  /** Room clock in seconds. */
  now(): number;
  data(ownerId: string): PlayerData | undefined;
  saveData(data: PlayerData): void;
  sendCollection(ownerId: string, info: CollectionInfo): void;
}

export class SummonManager {
  readonly summons = new Map<string, SummonEntity>();
  /** Owner → time when calling again is allowed (after a death). */
  private recallAt = new Map<string, number>();

  constructor(private host: SummonHost) {}

  // ---------------------------------------------------------------- requests

  call(ownerId: string): void {
    const data = this.host.data(ownerId);
    const owner = this.host.sim.getPlayer(ownerId);
    if (!data || !owner || this.summons.has(ownerId)) return;
    const def = data.activeSummonId ? getSummon(data.activeSummonId) : undefined;
    if (!def || !data.ownedSummons.includes(def.id)) return;
    if ((this.recallAt.get(ownerId) ?? 0) > this.host.now()) return this.sendCollection(ownerId);
    // Appear 2 m in front of the owner.
    const s = owner.state;
    const body = this.host.sim.addBody(`summon:${ownerId}`, s.x + Math.sin(s.yaw) * 2, s.z + Math.cos(s.yaw) * 2, s.y + 0.05);
    body.state.yaw = s.yaw;
    this.summons.set(ownerId, createSummonEntity(ownerId, def, body, this.host.now()));
  }

  dismiss(ownerId: string): void {
    const e = this.summons.get(ownerId);
    if (!e || e.mode === SummonMode.Dead) return;
    this.remove(ownerId);
  }

  select(ownerId: string, id: string): void {
    const data = this.host.data(ownerId);
    if (!data || !data.ownedSummons.includes(id) || !getSummon(id)) return;
    data.activeSummonId = id;
    this.host.saveData(data);
    // Swap the creature if one is out (and alive).
    const live = this.summons.get(ownerId);
    if (live && live.mode !== SummonMode.Dead && live.def.id !== id) { this.remove(ownerId); this.call(ownerId); }
    this.sendCollection(ownerId);
  }

  /** Free random summon (no money involved): unlocks a creature. */
  draw(ownerId: string): void {
    const data = this.host.data(ownerId);
    if (!data) return;
    const day = new Date().toISOString().slice(0, 10);
    if (data.freeSummons.day !== day) data.freeSummons = { day, used: 0 };
    if (data.freeSummons.used >= FREE_SUMMONS_PER_DAY) return this.sendCollection(ownerId);
    data.freeSummons.used++;
    const def = drawSummon(randomInt(1_000_000) / 1_000_000);
    const isNew = !data.ownedSummons.includes(def.id);
    if (isNew) data.ownedSummons.push(def.id);
    this.host.saveData(data);
    this.sendCollection(ownerId, { id: def.id, isNew });
  }

  sendCollection(ownerId: string, draw?: { id: string; isNew: boolean }): void {
    const data = this.host.data(ownerId);
    if (!data) return;
    const day = new Date().toISOString().slice(0, 10);
    const used = data.freeSummons.day === day ? data.freeSummons.used : 0;
    const recallIn = Math.max(0, (this.recallAt.get(ownerId) ?? 0) - this.host.now());
    this.host.sendCollection(ownerId, {
      owned: [...data.ownedSummons], active: data.activeSummonId, freeLeft: Math.max(0, FREE_SUMMONS_PER_DAY - used),
      ...(draw ? { draw } : {}), ...(recallIn > 0 ? { recallIn } : {}),
    });
  }

  /** Owner left the world. */
  ownerLeft(ownerId: string): void {
    this.remove(ownerId);
    this.recallAt.delete(ownerId);
  }

  // ---------------------------------------------------------------- AI

  update(dt: number): void {
    const now = this.host.now();
    for (const e of [...this.summons.values()]) {
      const owner = this.host.sim.getPlayer(e.ownerId);
      if (!owner) { this.remove(e.ownerId); continue; }
      if (e.mode === SummonMode.Dead) {
        if (now >= e.removeAt) this.remove(e.ownerId);
        continue;
      }
      if (e.dash) continue; // moved by CombatSystem
      if (e.mode === SummonMode.Spawning) {
        if (now >= e.spawnUntil) e.mode = SummonMode.Idle;
        this.host.sim.moveBody(e.body, 0, 0, dt);
        continue;
      }
      const s = e.body.state, o = owner.state;
      const dOwner = Math.hypot(s.x - o.x, s.z - o.z);
      if (dOwner > TELEPORT_DISTANCE) {
        this.host.sim.teleport(e.body, o.x - Math.sin(o.yaw) * 2, o.z - Math.cos(o.yaw) * 2, o.y + 0.05);
        e.mode = SummonMode.Idle;
        continue;
      }
      if (e.mode === SummonMode.Attack && this.onAttack) {
        if (dOwner > RETURN_DISTANCE * 1.5) { e.target = ''; e.mode = SummonMode.Return; }
        else if (this.onAttack(e, dt, now)) continue;
        else { e.target = ''; e.mode = SummonMode.Idle; }
      }
      if (e.mode !== SummonMode.Return && dOwner > RETURN_DISTANCE) e.mode = SummonMode.Return;

      // Follow: stand behind-right of the owner.
      const fx = o.x - Math.sin(o.yaw) * 1.6 + Math.cos(o.yaw) * 1.4;
      const fz = o.z - Math.cos(o.yaw) * 1.6 - Math.sin(o.yaw) * 1.4;
      const dx = fx - s.x, dz = fz - s.z, d = Math.hypot(dx, dz);
      const speed = statOf(e, 'speed', now);
      if (e.mode === SummonMode.Return) {
        if (dOwner < 4) e.mode = SummonMode.Idle;
        this.moveTowards(e, dx, dz, d, speed * 1.8, dt, 'run');
      } else if (d > FOLLOW_DISTANCE) {
        e.mode = SummonMode.Follow;
        const run = d > RUN_DISTANCE;
        this.moveTowards(e, dx, dz, d, run ? speed * 1.4 : speed, dt, run ? 'run' : 'walk');
      } else {
        e.mode = SummonMode.Idle;
        this.host.sim.moveBody(e.body, 0, 0, dt);
        if (now >= e.actionUntil) e.action = 'idle';
      }
    }
  }

  /** Combat hook (set by CombatSystem): runs the ATTACK state, returns false when the attack is over. */
  onAttack: ((e: SummonEntity, dt: number, now: number) => boolean) | null = null;

  moveTowards(e: SummonEntity, dx: number, dz: number, d: number, speed: number, dt: number, anim: SummonAction): void {
    const ux = d > 1e-6 ? dx / d : 0, uz = d > 1e-6 ? dz / d : 0;
    const step = Math.min(speed, d / dt); // don't overshoot
    this.host.sim.moveBody(e.body, ux * step, uz * step, dt);
    if (d > 0.05) e.body.state.yaw = Math.atan2(ux, uz);
    if (this.host.now() >= e.actionUntil) e.action = anim;
  }

  /** Plays a one-shot animation slot. */
  playAction(e: SummonEntity, action: SummonAction, duration: number): void {
    e.action = action;
    e.actionSeq = (e.actionSeq + 1) & 0xffff;
    e.actionUntil = this.host.now() + duration;
  }

  kill(e: SummonEntity): void {
    e.hp = 0;
    e.mode = SummonMode.Dead;
    e.target = '';
    e.pending = null;
    this.playAction(e, 'death', DEATH_REMOVAL_DELAY);
    e.removeAt = this.host.now() + DEATH_REMOVAL_DELAY;
    this.recallAt.set(e.ownerId, this.host.now() + SUMMON_RECALL_DELAY);
    this.sendCollection(e.ownerId);
  }

  private remove(ownerId: string): void {
    const e = this.summons.get(ownerId);
    if (!e) return;
    this.host.sim.removeBody(e.body.id);
    this.summons.delete(ownerId);
  }

  static actionIndex(a: SummonAction): number {
    return SUMMON_ACTIONS.indexOf(a);
  }
}
