/**
 * Another player, driven only by server snapshots. Positions are rendered
 * INTERP_DELAY in the past and interpolated between the two surrounding
 * snapshots, so remote characters glide smoothly instead of teleporting at
 * each network packet.
 */
import { Anim, Emote } from '@openworld/shared';
import type { CharacterModel } from './CharacterModel.ts';
import { lerpAngle } from './PlayerController.ts';

/**
 * ~3 patches at 20 Hz. No extrapolation: guessing ahead when a packet is late
 * makes a player who just stopped overshoot and snap back.
 */
const INTERP_DELAY = 140; // ms

interface Snapshot { t: number; x: number; y: number; z: number; yaw: number; anim: Anim; emote: Emote }

export class RemotePlayer {
  private buffer: Snapshot[] = [];
  /** Latest interpolated world position. */
  readonly world = { x: 0, y: 0, z: 0 };

  name = '';
  dead = false;
  hp = 100;
  maxHp = 100;
  private hitSeq = -1;

  /** Combat state from the latest snapshot. */
  setCombat(hp: number, maxHp: number, dead: boolean, hitSeq: number): void {
    this.hp = hp; this.maxHp = maxHp; this.dead = dead;
    if (this.hitSeq >= 0 && hitSeq !== this.hitSeq && !dead) this.model.playHit();
    this.hitSeq = hitSeq;
  }

  constructor(readonly id: string, readonly model: CharacterModel) {}

  push(t: number, s: { x: number; y: number; z: number; yaw: number; anim: number; emote: Emote }): void {
    let last: Snapshot | undefined = this.buffer[this.buffer.length - 1];
    if (last && Math.hypot(s.x - last.x, s.z - last.z) > 30) { this.buffer = []; last = undefined; } // teleport: no glide
    // Patches only arrive when something changed: after a quiet period, re-anchor the
    // previous state just before this one so movement doesn't start with a jump.
    if (last && t - last.t > 100) this.buffer.push({ ...last, t: t - 50 });
    this.buffer.push({ t, x: s.x, y: s.y, z: s.z, yaw: s.yaw, anim: s.anim as Anim, emote: s.emote });
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
    // Late packets: hold the last known position instead of extrapolating.
    const t = c.t > a.t ? Math.min(1, Math.max(0, (rt - a.t) / (c.t - a.t))) : 1;
    this.world.x = a.x + (c.x - a.x) * t;
    this.world.y = a.y + (c.y - a.y) * t;
    this.world.z = a.z + (c.z - a.z) * t;
    const root = this.model.root;
    root.position.set(this.world.x - originX, this.world.y, this.world.z - originZ);
    root.rotation.y = lerpAngle(root.rotation.y, lerpAngle(a.yaw, c.yaw, t), Math.min(1, dt * 14));
    const snap = t < 0.5 ? a : c;
    this.model.setPose(snap.anim, snap.emote, 0.2, this.dead);
    this.model.update(dt);
  }

  dispose(): void {
    this.model.dispose();
  }
}

