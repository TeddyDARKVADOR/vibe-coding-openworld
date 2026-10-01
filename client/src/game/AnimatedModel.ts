/**
 * A cloned animated GLB (summon, mount...) with crossfaded looping clips and
 * one-shot clips. Animations are the model's own clips — never authored in code.
 */
import * as THREE from 'three';
import { AssetLibrary, type CharacterTemplate } from '../assets/AssetLibrary.ts';

export class AnimatedModel {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private clips = new Map<string, THREE.AnimationClip>();
  private current: THREE.AnimationAction | null = null;
  private currentName = '';
  private oneShotUntil = 0;

  constructor(template: CharacterTemplate, scale: number) {
    this.model = AssetLibrary.cloneCharacter(template);
    this.model.scale.setScalar(scale);
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; }
    });
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const c of template.clips) this.clips.set(c.name, c);
  }

  has(clip: string): boolean {
    return this.clips.has(clip);
  }

  /** Looping clip (ignored while a one-shot is playing unless `force`). */
  loop(clip: string, timeScale = 1, force = false): void {
    if (!force && performance.now() < this.oneShotUntil) return;
    if (clip === this.currentName && this.current) { this.current.setEffectiveTimeScale(timeScale); return; }
    this.fade(clip, timeScale, true);
  }

  /** Plays a clip once; `hold` keeps the last frame (death). */
  once(clip: string, hold = false): void {
    const c = this.clips.get(clip);
    if (!c) return;
    this.fade(clip, 1, false, hold);
    this.oneShotUntil = performance.now() + (hold ? 1e9 : c.duration * 1000 * 0.9);
  }

  private fade(clip: string, timeScale: number, loop: boolean, hold = false): void {
    const c = this.clips.get(clip);
    if (!c) return;
    const next = this.mixer.clipAction(c);
    next.reset().setEffectiveTimeScale(timeScale).setEffectiveWeight(1);
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = hold;
    next.play();
    if (this.current && this.current !== next) this.current.crossFadeTo(next, 0.18, false);
    this.current = next;
    this.currentName = clip;
    if (loop) this.oneShotUntil = 0;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
