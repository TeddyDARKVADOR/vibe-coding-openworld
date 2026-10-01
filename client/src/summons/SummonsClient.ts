/**
 * Client side of summons: creates / updates / removes SummonViews from the
 * synchronised state, plays the arrival and death effects.
 */
import * as THREE from 'three';
import { SummonMode, getSummon } from '@openworld/shared';
import type { AssetLibrary } from '../assets/AssetLibrary.ts';
import type { VFXManager } from '../vfx/VFXManager.ts';
import type { AudioManager } from '../audio/AudioManager.ts';
import { SummonView, type NetSummon } from './SummonView.ts';

export class SummonsClient {
  readonly views = new Map<string, SummonView>();
  private loading = new Set<string>();

  constructor(
    private scene: THREE.Object3D,
    private assets: AssetLibrary,
    private vfx: VFXManager,
    private audio: AudioManager,
    private myId: () => string,
    private nameOf: (sessionId: string) => string,
    private onError: (e: unknown) => void,
  ) {}

  sync(list: NetSummon[], t: number): void {
    const seen = new Set<string>();
    for (const s of list) {
      seen.add(s.ownerId);
      const v = this.views.get(s.ownerId);
      if (v && v.def.id !== s.kind) { this.remove(s.ownerId, false); } // swapped creature
      const view = this.views.get(s.ownerId);
      if (view) {
        if (s.mode === SummonMode.Dead && view.last.mode !== SummonMode.Dead) {
          this.vfx.play('death', s.x, s.y, s.z);
          this.audio.play('death', s);
        }
        view.push(t, s);
      } else this.create(s, t);
    }
    for (const id of [...this.views.keys()]) if (!seen.has(id)) this.remove(id, true);
  }

  private create(s: NetSummon, t: number): void {
    if (this.loading.has(s.ownerId)) return;
    const def = getSummon(s.kind);
    if (!def) return;
    this.loading.add(s.ownerId);
    this.assets.loadModel(def.model).then((tpl) => {
      if (!this.loading.delete(s.ownerId)) return;
      const view = new SummonView(def, tpl, s, this.nameOf(s.ownerId), s.ownerId === this.myId());
      view.push(t, s);
      this.views.set(s.ownerId, view);
      this.scene.add(view.anim.root);
      if (s.mode === SummonMode.Spawning) {
        this.vfx.play('summon', s.x, s.y, s.z);
        this.audio.play('summon', s);
      }
    }, this.onError);
  }

  private remove(ownerId: string, effect: boolean): void {
    this.loading.delete(ownerId);
    const v = this.views.get(ownerId);
    if (!v) return;
    if (effect && v.last.mode !== SummonMode.Dead) this.vfx.play('unsummon', v.world.x, v.world.y, v.world.z);
    v.dispose();
    this.views.delete(ownerId);
  }

  update(now: number, dt: number, originX: number, originZ: number, me: { x: number; z: number }): void {
    for (const v of this.views.values()) {
      const d = Math.hypot(v.world.x - me.x, v.world.z - me.z);
      v.update(now, dt, originX, originZ, d);
      v.anim.root.visible = d < 460;
    }
  }

  mine(): SummonView | undefined {
    return this.views.get(this.myId());
  }
}
