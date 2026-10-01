/**
 * Visual representation of a character: a real KayKit Adventurers model with
 * its skeleton and animations. Physics never depends on it (the capsule does).
 */
import * as THREE from 'three';
import { Anim, CHARACTER_SCALE, CHARACTERS, RUN_SPEED, WALK_SPEED } from '@openworld/shared';
import { AssetLibrary, type CharacterTemplate } from '../assets/AssetLibrary.ts';

const CLIP: Record<Anim, string> = {
  [Anim.Idle]: 'Idle',
  [Anim.Walk]: 'Walking_A',
  [Anim.Run]: 'Running_A',
  [Anim.Jump]: 'Jump_Idle',
};
/** Playback speed so feet roughly match ground speed. */
const TIME_SCALE: Record<Anim, number> = {
  [Anim.Idle]: 1,
  [Anim.Walk]: WALK_SPEED / 2.6,
  [Anim.Run]: RUN_SPEED / 6.2,
  [Anim.Jump]: 1,
};

export class CharacterModel {
  /** Root placed at the character's feet; rotation.y = facing. */
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private actions = new Map<Anim, THREE.AnimationAction>();
  private current: Anim | null = null;

  constructor(template: CharacterTemplate, readonly characterIndex: number) {
    const model = AssetLibrary.cloneCharacter(template);
    model.scale.setScalar(CHARACTER_SCALE);
    model.traverse((o) => {
      // The pack attaches every weapon/shield to the hands by default; the
      // prototype has no weapons, so hand-held props are hidden.
      if (o.parent && /^handslot/i.test(o.parent.name)) o.visible = false; // three.js strips the '.' of 'handslot.l'
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.frustumCulled = false; // skinned bounds are unreliable when animated
      }
    });
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    for (const anim of [Anim.Idle, Anim.Walk, Anim.Run, Anim.Jump]) {
      const clip = template.clips.find((c) => c.name === CLIP[anim]);
      if (clip) this.actions.set(anim, this.mixer.clipAction(clip));
    }
    this.play(Anim.Idle, 0);
  }

  static async create(assets: AssetLibrary, characterIndex: number): Promise<CharacterModel> {
    const name = CHARACTERS[characterIndex % CHARACTERS.length];
    return new CharacterModel(await assets.loadCharacter(name), characterIndex);
  }

  play(anim: Anim, fade = 0.2): void {
    if (anim === this.current) return;
    const next = this.actions.get(anim);
    if (!next) return;
    const prev = this.current !== null ? this.actions.get(this.current) : undefined;
    next.reset().setEffectiveTimeScale(TIME_SCALE[anim]).setEffectiveWeight(1).play();
    if (prev && fade > 0) prev.crossFadeTo(next, fade, false);
    else prev?.stop();
    this.current = anim;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
