/**
 * Plays what the server says happened: ability effects and sounds, floating
 * damage numbers, hit flashes. Pure presentation — no game logic here.
 */
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type * as THREE from 'three';
import type { AbilityEvent, DamageEvent } from '@openworld/shared';
import type { VFXManager } from '../vfx/VFXManager.ts';
import type { AudioManager } from '../audio/AudioManager.ts';

export class CombatFeedback {
  private numbers: { obj: CSS2DObject; age: number; world: { x: number; y: number; z: number } }[] = [];

  constructor(
    private scene: THREE.Object3D,
    private vfx: VFXManager,
    private audio: AudioManager,
    /** Current world position of a target ref (players / summons), for homing effects. */
    private positionOf: (ref: string) => { x: number; y: number; z: number } | null,
  ) {}

  ability(e: AbilityEvent): void {
    const f = e.from;
    this.audio.play(e.sound, f);
    switch (e.type) {
      case 'projectile': {
        const target = e.target;
        this.vfx.projectile(e.vfx, { x: f.x, y: f.y + 1.2, z: f.z }, () => {
          const p = this.positionOf(target);
          return p ? { x: p.x, y: p.y + 1, z: p.z } : null;
        }, e.flight ?? 0.5, 'impact');
        break;
      }
      case 'aoe':
        this.vfx.play(e.vfx, f.x, f.y, f.z);
        this.vfx.play('shockwave', f.x, f.y, f.z);
        break;
      case 'melee': {
        const p = this.positionOf(e.target);
        if (p) this.vfx.play(e.vfx, p.x, p.y, p.z);
        break;
      }
      default:
        this.vfx.play(e.vfx, f.x, f.y, f.z);
    }
  }

  damage(e: DamageEvent, mine: boolean): void {
    this.audio.play(mine ? 'hurt' : 'hit', e, mine ? 1 : 0.7);
    const el = document.createElement('div');
    el.className = `dmg-number${mine ? ' mine' : ''}`;
    el.textContent = `-${e.amount}`;
    const obj = new CSS2DObject(el);
    this.scene.add(obj);
    this.numbers.push({ obj, age: 0, world: { x: e.x + (Math.random() - 0.5) * 0.6, y: e.y + 2.2, z: e.z } });
  }

  update(dt: number, originX: number, originZ: number): void {
    this.numbers = this.numbers.filter((n) => {
      n.age += dt;
      n.world.y += dt * 1.2;
      n.obj.position.set(n.world.x - originX, n.world.y, n.world.z - originZ);
      (n.obj.element as HTMLElement).style.opacity = String(Math.max(0, 1 - n.age / 1.1));
      if (n.age > 1.1) { n.obj.removeFromParent(); n.obj.element.remove(); return false; }
      return true;
    });
  }
}
