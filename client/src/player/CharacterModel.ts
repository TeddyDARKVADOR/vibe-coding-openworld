/**
 * Visual representation of a character: a real KayKit Adventurers model with
 * its skeleton and animations. Physics never depends on it (the capsule does).
 */
import * as THREE from 'three';
import { Anim, CHARACTER_SCALE, CHARACTERS, Emote, RUN_SPEED, WALK_SPEED } from '@openworld/shared';
import { AssetLibrary, type CharacterTemplate } from '../assets/AssetLibrary.ts';
import type { MountView } from '../mounts/MountView.ts';

/** What the character is doing visually: a movement anim, or an emote while standing still. */
type Pose = { clip: string; then?: string; timeScale: number };

const MOVE_POSES: Record<Anim, Pose> = {
  [Anim.Idle]: { clip: 'Idle', timeScale: 1 },
  // Playback speed so feet roughly match ground speed.
  [Anim.Walk]: { clip: 'Walking_A', timeScale: WALK_SPEED / 2.6 },
  [Anim.Run]: { clip: 'Running_A', timeScale: RUN_SPEED / 6.2 },
  [Anim.Jump]: { clip: 'Jump_Idle', timeScale: 1 },
};

const EMOTE_POSES: Record<Exclude<Emote, Emote.None>, Pose> = {
  [Emote.Cheer]: { clip: 'Cheer', timeScale: 1 },
  [Emote.Sit]: { clip: 'Sit_Floor_Down', then: 'Sit_Floor_Idle', timeScale: 1 },
  [Emote.Lie]: { clip: 'Lie_Down', then: 'Lie_Idle', timeScale: 1 },
};

const DEAD_POSE: Pose = { clip: 'Death_A', timeScale: 1 };
const HIT_POSE: Pose = { clip: 'Hit_A', timeScale: 1 };

export class CharacterModel {
  /** Root placed at the character's feet; rotation.y = facing. */
  readonly root = new THREE.Group();
  /** Point above the head where name labels / chat bubbles are attached. */
  readonly head = new THREE.Object3D();
  private mixer: THREE.AnimationMixer;
  private clips = new Map<string, THREE.AnimationClip>();
  private currentPose: Pose | null = null;
  private currentAction: THREE.AnimationAction | null = null;
  /** The character mesh (raised onto the saddle when riding). */
  private body: THREE.Object3D;
  /** Ridden mount, if any; mountIndex is the synced PlayerState.mount value. */
  mount: MountView | null = null;
  mountIndex = 0;
  private ridePose: Pose | null = null;

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
    this.body = model;
    this.head.position.y = 2.25;
    this.root.add(this.head);
    this.mixer = new THREE.AnimationMixer(model);
    for (const c of template.clips) this.clips.set(c.name, c);
    // Chain "sit down" → "sitting" etc.
    this.mixer.addEventListener('finished', (e) => {
      const pose = this.currentPose;
      if (pose?.then && e.action === this.currentAction) this.fadeTo(pose.then, pose.timeScale, 0.15, true);
    });
    this.setPose(Anim.Idle, Emote.None, 0);
  }

  static async create(assets: AssetLibrary, characterIndex: number): Promise<CharacterModel> {
    const name = CHARACTERS[characterIndex % CHARACTERS.length];
    return new CharacterModel(await assets.loadCharacter(name), characterIndex);
  }

  /** Puts the character on a mount (or back on foot with null). */
  setMount(view: MountView | null, index: number): void {
    this.mount?.dispose();
    this.mount = view;
    this.mountIndex = index;
    if (view) {
      this.root.add(view.root);
      this.body.position.set(0, view.def.rider.height, view.def.rider.forward);
      this.head.position.y = 2.25 + view.def.rider.height * 0.8;
      this.ridePose = { clip: view.def.rider.animation, timeScale: 1 };
    } else {
      this.body.position.set(0, 0, 0);
      this.head.position.y = 2.25;
      this.ridePose = null;
    }
    this.currentPose = null; // re-apply the pose
  }

  private hitUntil = 0;

  /** Short "hit" reaction (KayKit Hit_A), on top of the current pose. */
  playHit(): void {
    if (this.currentPose === DEAD_POSE) return;
    this.hitUntil = performance.now() + 450;
    this.currentPose = HIT_POSE;
    this.fadeTo(HIT_POSE.clip, 1.4, 0.08, false);
  }

  /** Plays the movement animation, or the emote when standing still. */
  setPose(anim: Anim, emote: Emote, fade = 0.2, dead = false): void {
    if (dead) {
      if (this.mount) this.setMount(null, 0);
      if (this.currentPose !== DEAD_POSE) { this.currentPose = DEAD_POSE; this.fadeTo(DEAD_POSE.clip, 1, 0.15, false); }
      return;
    }
    if (this.mount && this.ridePose) {
      this.mount.setAnim(anim);
      if (this.currentPose !== this.ridePose) { this.currentPose = this.ridePose; this.fadeTo(this.ridePose.clip, 1, fade, true); }
      return;
    }
    if (performance.now() < this.hitUntil) return;
    const pose = (anim === Anim.Idle && emote ? EMOTE_POSES[emote as Exclude<Emote, Emote.None>] : undefined) ?? MOVE_POSES[anim] ?? MOVE_POSES[Anim.Idle];
    if (pose === this.currentPose) return;
    this.currentPose = pose;
    this.fadeTo(pose.clip, pose.timeScale, fade, !pose.then);
  }

  private fadeTo(clipName: string, timeScale: number, fade: number, loop: boolean): void {
    const clip = this.clips.get(clipName);
    if (!clip) return;
    const next = this.mixer.clipAction(clip);
    next.reset().setEffectiveTimeScale(timeScale).setEffectiveWeight(1);
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = !loop;
    next.play();
    const prev = this.currentAction;
    if (prev && prev !== next) {
      if (fade > 0) prev.crossFadeTo(next, fade, false);
      else prev.stop();
    }
    this.currentAction = next;
  }

  update(dt: number): void {
    this.mixer.update(dt);
    this.mount?.update(dt);
  }

  dispose(): void {
    this.mount?.dispose();
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
