/**
 * Visual of a ridden mount (downloaded animated model). The rider stays the
 * player's own character, raised onto the saddle and playing a sitting clip.
 * Physics keeps the player's simple capsule.
 */
import { Anim, type MountDefinition } from '@openworld/shared';
import type { AssetLibrary } from '../assets/AssetLibrary.ts';
import { AnimatedModel } from '../game/AnimatedModel.ts';

export class MountView {
  constructor(readonly def: MountDefinition, readonly anim: AnimatedModel) {}

  static async create(assets: AssetLibrary, def: MountDefinition): Promise<MountView> {
    return new MountView(def, new AnimatedModel(await assets.loadModel(def.model), def.scale));
  }

  get root() { return this.anim.root; }

  setAnim(a: Anim): void {
    const { animations: clips, animationSpeeds: speeds } = this.def;
    if (a === Anim.Run) this.anim.loop(clips.run, speeds.run);
    else if (a === Anim.Walk) this.anim.loop(clips.walk, speeds.walk);
    else if (a === Anim.Jump) this.anim.loop(clips.jump, 1);
    else this.anim.loop(clips.idle, 1);
  }

  update(dt: number): void { this.anim.update(dt); }

  dispose(): void { this.anim.dispose(); }
}
