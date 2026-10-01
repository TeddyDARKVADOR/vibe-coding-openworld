/**
 * Executes any ability from its definition (shared/src/data/summons/*.json).
 * Behaviour depends only on the ability TYPE, never on the creature:
 *   melee      – hit the target if within range
 *   projectile – spawn a homing projectile (resolved by CombatSystem)
 *   aoe        – damage every enemy around the summon
 *   dash       – rush towards the target (or forward), hit it on arrival
 *   buff       – temporary stat bonus
 * New creatures = new JSON, no new code.
 */
import { SummonMode, type AbilityDefinition } from '@openworld/shared';
import type { SummonEntity } from '../summons/SummonEntity.ts';
import type { CombatSystem } from './CombatSystem.ts';

/** Extra reach so big creatures can hit what they touch. */
const MELEE_SLACK = 0.9;

export type AbilityResult = 'done' | 'out_of_range' | 'not_ready' | 'invalid';

export class AbilitySystem {
  constructor(private combat: CombatSystem) {}

  /** Tries to use ability `index` of summon `e` on its current target. */
  execute(e: SummonEntity, index: number, now: number): AbilityResult {
    const ability = e.def.abilities[index];
    if (!ability || e.mode === SummonMode.Dead || e.mode === SummonMode.Spawning) return 'invalid';
    if (now < e.readyAt[index]) return 'not_ready';
    const target = e.target ? this.combat.position(e.target) : null;
    const needsTarget = ability.type === 'melee' || ability.type === 'projectile';
    if (needsTarget && (!target || !this.combat.isAlive(e.target))) return 'invalid';
    const s = e.body.state;
    const dist = target ? Math.hypot(target.x - s.x, target.z - s.z) : 0;
    if (needsTarget && dist > (ability.range ?? 2) + (ability.type === 'melee' ? MELEE_SLACK : 0)) return 'out_of_range';

    if (target) s.yaw = Math.atan2(target.x - s.x, target.z - s.z);
    e.readyAt[index] = now + ability.cooldown;
    this.combat.summons.playAction(e, ability.animation, ability.type === 'dash' ? 0.4 : 0.8);
    this.run(e, ability, target, dist, now);
    return 'done';
  }

  private run(e: SummonEntity, a: AbilityDefinition, target: { x: number; y: number; z: number } | null, dist: number, now: number): void {
    const s = e.body.state;
    const event = { ability: e.def.abilities.indexOf(a) };
    switch (a.type) {
      case 'melee':
        this.combat.emit(e, event.ability, e.target);
        this.combat.damage(e, e.target, a.damage ?? 0);
        break;
      case 'projectile': {
        const flight = dist / (a.projectileSpeed ?? 15);
        this.combat.emit(e, event.ability, e.target, { flight });
        this.combat.launchProjectile(e, e.target, a.damage ?? 0, a.projectileSpeed ?? 15);
        break;
      }
      case 'aoe':
        this.combat.emit(e, event.ability, '', { radius: a.radius });
        for (const ref of this.combat.enemiesAround(e.ownerId, s.x, s.z, a.radius ?? 3)) this.combat.damage(e, ref, a.damage ?? 0);
        break;
      case 'dash': {
        // Towards the target (stopping next to it) or straight ahead.
        const len = Math.min(a.range ?? 8, target ? Math.max(0, dist - 1.6) : a.range ?? 8);
        const dx = target ? (target.x - s.x) / Math.max(dist, 1e-6) : Math.sin(s.yaw);
        const dz = target ? (target.z - s.z) / Math.max(dist, 1e-6) : Math.cos(s.yaw);
        const duration = 0.3;
        e.dash = { vx: (dx * len) / duration, vz: (dz * len) / duration, until: now + duration, hit: target ? e.target : '', damage: a.damage ?? 0 };
        this.combat.emit(e, event.ability, e.target);
        break;
      }
      case 'buff':
        if (a.stat) e.buffs.push({ stat: a.stat, amount: a.amount ?? 0, until: now + (a.duration ?? 5) });
        this.combat.emit(e, event.ability, '');
        break;
    }
  }
}
