/**
 * Another player, driven only by server snapshots. Positions are rendered
 * INTERP_DELAY in the past and interpolated between the two surrounding
 * snapshots, so remote characters glide smoothly instead of teleporting at
 * each network packet.
 */
import { Anim } from '@openworld/shared';
import type { CharacterModel } from './CharacterModel.ts';
import { lerpAngle } from './PlayerController.ts';

const INTERP_DELAY = 120; // ms, ~2 patches at 20 Hz
const MAX_EXTRAPOLATION = 150; // ms

interface Snapshot { t: number; x: number; y: number; z: number; yaw: number; anim: Anim }

export class RemotePlayer {
  private buffer: Snapshot[] = [];
  /** Latest interpolated world position. */
  readonly world = { x: 0, y: 0, z: 0 };

  constructor(readonly id: string, readonly model: CharacterModel) {}

  push(t: number, s: { x: number; y: number; z: number; yaw: number; anim: number }): void {
    const last = this.buffer[this.buffer.length - 1];
    // Patches only arrive when something changed: after a quiet period, re-anchor the
    // previous state just before this one so movement doesn't start with a jump.
    if (last && t - last.t > 100) this.buffer.push({ ...last, t: t - 50 });
    this.buffer.push({ t, x: s.x, y: s.y, z: s.z, yaw: s.yaw, anim: s.anim as Anim });
    if (this.buffer.length > 30) this.buffer.shift();
  }

  update(now: number, dt: number, originX: number, originZ: number): void {
    const b = this.buffer;
    if (!b.length) return;
    const rt = now - INTERP_DELAY;
    let a = b[0], c = b[0];
    if (rt <= b[0].t) {
      a = c = b[0];
    } else {
      let i = b.length - 1;
      while (i > 0 && b[i - 1].t > rt) i--;
      a = b[Math.max(0, i - 1)];
      c = b[i];
      if (rt > b[b.length - 1].t) { a = b[Math.max(0, b.length - 2)]; c = b[b.length - 1]; }
    }
    let t = c.t > a.t ? (rt - a.t) / (c.t - a.t) : 1;
    // Limited extrapolation if packets are late, then hold.
    t = Math.min(t, 1 + MAX_EXTRAPOLATION / Math.max(1, c.t - a.t));
    if (c.anim === Anim.Idle || a === c) t = Math.min(t, 1);
    this.world.x = a.x + (c.x - a.x) * t;
    this.world.y = a.y + (c.y - a.y) * t;
    this.world.z = a.z + (c.z - a.z) * t;
    const root = this.model.root;
    root.position.set(this.world.x - originX, this.world.y, this.world.z - originZ);
    root.rotation.y = lerpAngle(root.rotation.y, lerpAngle(a.yaw, c.yaw, Math.min(1, t)), Math.min(1, dt * 14));
    this.model.play(t < 0.5 ? a.anim : c.anim);
    this.model.update(dt);
  }

  dispose(): void {
    this.model.dispose();
  }
}

