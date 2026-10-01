/**
 * Server-authoritative combat: player health, targets, damage, deaths and
 * respawns, homing projectiles, the summons' ATTACK state, simple
 * retaliation and out-of-combat regeneration. Clients only send intentions
 * (target, ability index) and play the events they receive.
 */
import {
  PLAYER_MAX_HP, PLAYER_RESPAWN_DELAY, SummonMode, TARGET_RANGE, computeDamage,
  type AbilityEvent, type DamageEvent, type DeathEvent,
} from '@openworld/shared';
import type { ServerSimulation } from '../simulation/ServerSimulation.ts';
import type { SummonManager } from '../summons/SummonManager.ts';
import { statOf, type SummonEntity } from '../summons/SummonEntity.ts';
import { AbilitySystem } from './AbilitySystem.ts';

const REGEN_DELAY = 6;
const REGEN_PER_SECOND = 6;
const PROJECTILE_HIT_RADIUS = 1.1;
const PROJECTILE_MAX_LIFE = 3;
/** The summon keeps chasing up to this distance from its owner. */
const LEASH = 35;

interface PlayerCombat { hp: number; dead: boolean; respawnAt: number; lastHitAt: number; target: string; hitSeq: number }
interface Projectile { attacker: SummonEntity; target: string; damage: number; speed: number; x: number; y: number; z: number; age: number }

export interface CombatHost {
  sim: ServerSimulation;
  now(): number;
  nameOf(sessionId: string): string;
  broadcastFx(e: AbilityEvent): void;
  broadcastDamage(e: DamageEvent): void;
  broadcastDeath(e: DeathEvent): void;
  respawn(sessionId: string): void;
}

export class CombatSystem {
  readonly players = new Map<string, PlayerCombat>();
  readonly abilities = new AbilitySystem(this);
  private projectiles: Projectile[] = [];

  constructor(private host: CombatHost, readonly summons: SummonManager) {
    summons.onAttack = (e, dt, now) => this.attackState(e, dt, now);
  }

  addPlayer(id: string): void {
    this.players.set(id, { hp: PLAYER_MAX_HP, dead: false, respawnAt: 0, lastHitAt: 0, target: '', hitSeq: 0 });
  }

  removePlayer(id: string): void {
    this.players.delete(id);
    // Nobody keeps targeting someone who left.
    for (const p of this.players.values()) if (p.target === `p:${id}` || p.target === `s:${id}`) p.target = '';
    for (const e of this.summons.summons.values()) if (e.target === `p:${id}` || e.target === `s:${id}`) { e.target = ''; e.mode = SummonMode.Idle; }
  }

  // ------------------------------------------------------------ requests

  /** Owner picks a target. Validated: exists, alive, not himself / his summon, close enough. */
  setTarget(ownerId: string, ref: unknown): void {
    const pc = this.players.get(ownerId);
    if (!pc) return;
    if (ref === '' || ref === null) { pc.target = ''; return; }
    if (typeof ref !== 'string' || !/^[ps]:/.test(ref)) return;
    const id = ref.slice(2);
    if (id === ownerId || !this.isAlive(ref)) return;
    const owner = this.host.sim.getPlayer(ownerId);
    const t = this.position(ref);
    if (!owner || !t || Math.hypot(t.x - owner.state.x, t.z - owner.state.z) > TARGET_RANGE) return;
    pc.target = ref;
  }

  /** Owner orders an ability (0 = basic attack: also switches the summon to ATTACK). */
  useAbility(ownerId: string, index: unknown): void {
    const e = this.summons.summons.get(ownerId);
    const pc = this.players.get(ownerId);
    if (!e || !pc || pc.dead || typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= e.def.abilities.length) return;
    if (e.mode === SummonMode.Dead || e.mode === SummonMode.Spawning) return;
    const a = e.def.abilities[index];
    const needsTarget = a.type === 'melee' || a.type === 'projectile';
    if (pc.target) e.target = pc.target;
    if (needsTarget && !e.target) return;
    if (e.target && this.isAlive(e.target)) e.mode = SummonMode.Attack;
    const now = this.host.now();
    const r = this.abilities.execute(e, index, now);
    if (r === 'out_of_range') e.pending = { index, until: now + 4 };
  }

  // ------------------------------------------------------------ simulation

  update(dt: number): void {
    const now = this.host.now();
    // Dashes in progress.
    for (const e of this.summons.summons.values()) {
      if (!e.dash) continue;
      if (now >= e.dash.until || e.mode === SummonMode.Dead) {
        if (e.dash.hit && e.mode !== SummonMode.Dead) {
          const t = this.position(e.dash.hit);
          const s = e.body.state;
          if (t && Math.hypot(t.x - s.x, t.z - s.z) < 3 && e.dash.damage > 0) this.damage(e, e.dash.hit, e.dash.damage);
        }
        e.dash = null;
      } else {
        this.host.sim.moveBody(e.body, e.dash.vx, e.dash.vz, dt);
      }
    }
    this.updateProjectiles(dt);
    // Deaths, respawns, regeneration.
    for (const [id, pc] of this.players) {
      if (pc.dead) {
        if (now >= pc.respawnAt) { pc.dead = false; pc.hp = PLAYER_MAX_HP; this.host.respawn(id); }
        continue;
      }
      if (pc.hp < PLAYER_MAX_HP && now - pc.lastHitAt > REGEN_DELAY) pc.hp = Math.min(PLAYER_MAX_HP, pc.hp + REGEN_PER_SECOND * dt);
      if (pc.target && !this.isAlive(pc.target)) pc.target = '';
    }
    for (const e of this.summons.summons.values()) {
      if (e.mode !== SummonMode.Dead && e.hp < e.def.stats.maxHp && now - (e.lastHitAt ?? 0) > REGEN_DELAY) {
        e.hp = Math.min(e.def.stats.maxHp, e.hp + REGEN_PER_SECOND * dt);
      }
      e.buffs = e.buffs.filter((b) => b.until > now);
    }
  }

  /** ATTACK state of a summon. Returns false when the fight is over (→ IDLE). */
  private attackState(e: SummonEntity, dt: number, now: number): boolean {
    if (e.dash) return true; // moved by update()
    if (!e.target || !this.isAlive(e.target)) { e.pending = null; return false; }
    const t = this.position(e.target)!;
    const owner = this.host.sim.getPlayer(e.ownerId);
    if (!owner || Math.hypot(t.x - owner.state.x, t.z - owner.state.z) > LEASH) { e.pending = null; return false; }
    const s = e.body.state;
    const dx = t.x - s.x, dz = t.z - s.z, d = Math.hypot(dx, dz);
    // Requested ability first, else the basic attack (index 0).
    if (e.pending && now > e.pending.until) e.pending = null;
    const index = e.pending?.index ?? 0;
    const a = e.def.abilities[index];
    const reach = (a.range ?? 2) + (a.type === 'melee' ? 0.6 : 0) - 0.3;
    if (a.type === 'melee' || a.type === 'projectile' || a.type === 'dash') {
      if (d > reach && (a.type !== 'dash' || d > (a.range ?? 8))) {
        this.summons.moveTowards(e, dx, dz, d, statOf(e, 'speed', now) * 1.3, dt, 'run');
        return true;
      }
    }
    this.host.sim.moveBody(e.body, 0, 0, dt);
    if (d > 0.05) s.yaw = Math.atan2(dx, dz);
    const r = this.abilities.execute(e, index, now);
    if (r === 'done' && e.pending) e.pending = null;
    if (now >= e.actionUntil) e.action = 'idle';
    return true;
  }

  // ------------------------------------------------------------ helpers

  isAlive(ref: string): boolean {
    const id = ref.slice(2);
    if (ref.startsWith('p:')) { const p = this.players.get(id); return !!p && !p.dead; }
    const e = this.summons.summons.get(id);
    return !!e && e.mode !== SummonMode.Dead && e.mode !== SummonMode.Spawning;
  }

  position(ref: string): { x: number; y: number; z: number } | null {
    const id = ref.slice(2);
    const s = ref.startsWith('p:') ? this.host.sim.getPlayer(id)?.state : this.summons.summons.get(id)?.body.state;
    return s ? { x: s.x, y: s.y, z: s.z } : null;
  }

  /** Living enemies (players and summons not belonging to `ownerId`) within `radius`. */
  enemiesAround(ownerId: string, x: number, z: number, radius: number): string[] {
    const out: string[] = [];
    for (const id of this.players.keys()) {
      if (id === ownerId) continue;
      const ref = `p:${id}`, p = this.position(ref);
      if (p && this.isAlive(ref) && Math.hypot(p.x - x, p.z - z) <= radius) out.push(ref);
    }
    for (const id of this.summons.summons.keys()) {
      if (id === ownerId) continue;
      const ref = `s:${id}`, p = this.position(ref);
      if (p && this.isAlive(ref) && Math.hypot(p.x - x, p.z - z) <= radius + 0.5) out.push(ref);
    }
    return out;
  }

  launchProjectile(e: SummonEntity, target: string, damage: number, speed: number): void {
    const s = e.body.state;
    this.projectiles.push({ attacker: e, target, damage, speed, x: s.x, y: s.y + 1.2, z: s.z, age: 0 });
  }

  private updateProjectiles(dt: number): void {
    this.projectiles = this.projectiles.filter((p) => {
      p.age += dt;
      const t = this.position(p.target);
      if (!t || !this.isAlive(p.target) || p.age > PROJECTILE_MAX_LIFE) return false;
      const dx = t.x - p.x, dy = t.y + 1 - p.y, dz = t.z - p.z, d = Math.hypot(dx, dy, dz);
      const step = p.speed * dt;
      if (d <= Math.max(PROJECTILE_HIT_RADIUS, step)) {
        this.damage(p.attacker, p.target, p.damage); // still lands if the shooter died meanwhile
        return false;
      }
      p.x += (dx / d) * step; p.y += (dy / d) * step; p.z += (dz / d) * step;
      return true;
    });
  }

  emit(e: SummonEntity, ability: number, target: string, extra: { flight?: number; radius?: number } = {}): void {
    const a = e.def.abilities[ability];
    const s = e.body.state;
    this.host.broadcastFx({
      owner: e.ownerId, summon: e.def.id, ability, type: a.type, vfx: a.vfx, sound: a.sound, cooldown: a.cooldown,
      from: { x: s.x, y: s.y, z: s.z }, target, ...extra,
    });
  }

  /** Applies damage from summon `attacker` to `ref`. */
  damage(attacker: SummonEntity, ref: string, base: number): void {
    if (base <= 0 || !this.isAlive(ref)) return;
    const now = this.host.now();
    const id = ref.slice(2);
    const pos = this.position(ref)!;
    const atk = statOf(attacker, 'attack', now);
    if (ref.startsWith('p:')) {
      const pc = this.players.get(id)!;
      const amount = computeDamage(base, atk, 0);
      pc.hp = Math.max(0, pc.hp - amount);
      pc.lastHitAt = now;
      pc.hitSeq = (pc.hitSeq + 1) & 0xffff;
      this.host.broadcastDamage({ target: ref, amount, hp: Math.ceil(pc.hp), maxHp: PLAYER_MAX_HP, ...pos, by: attacker.ownerId });
      this.retaliate(id, `s:${attacker.ownerId}`);
      if (pc.hp <= 0) {
        pc.dead = true;
        pc.respawnAt = now + PLAYER_RESPAWN_DELAY;
        pc.target = '';
        this.host.broadcastDeath({ target: ref, by: attacker.ownerId, victimName: this.host.nameOf(id), killerName: this.host.nameOf(attacker.ownerId) });
      }
    } else {
      const e = this.summons.summons.get(id)!;
      const amount = computeDamage(base, atk, statOf(e, 'defense', now));
      e.hp = Math.max(0, e.hp - amount);
      e.lastHitAt = now;
      this.host.broadcastDamage({ target: ref, amount, hp: Math.ceil(e.hp), maxHp: e.def.stats.maxHp, ...pos, by: attacker.ownerId });
      if (e.hp <= 0) {
        this.summons.kill(e);
        this.host.broadcastDeath({ target: ref, by: attacker.ownerId, victimName: `${e.def.name} de ${this.host.nameOf(id)}`, killerName: this.host.nameOf(attacker.ownerId) });
      } else {
        if (now >= e.actionUntil && !e.dash) this.summons.playAction(e, 'hit', 0.35);
        this.retaliate(id, `s:${attacker.ownerId}`);
      }
    }
  }

  /** A player (or his summon) was attacked: an idle summon fights back. */
  private retaliate(ownerId: string, attackerRef: string): void {
    const mine = this.summons.summons.get(ownerId);
    if (!mine || mine.mode === SummonMode.Dead || mine.mode === SummonMode.Spawning || mine.mode === SummonMode.Attack) return;
    if (!this.isAlive(attackerRef)) return;
    mine.target = attackerRef;
    mine.mode = SummonMode.Attack;
  }
}
