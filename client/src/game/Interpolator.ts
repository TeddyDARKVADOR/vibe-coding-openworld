/**
 * Snapshot interpolation for anything driven by server state: rendered
 * INTERP_DELAY in the past, between the two surrounding snapshots, never
 * extrapolated (late packets → hold the last position).
 */
export const INTERP_DELAY = 140; // ms, ~3 patches at 20 Hz

export interface Pose { x: number; y: number; z: number; yaw: number }
interface Snap extends Pose { t: number }

export class Interpolator {
  private buffer: Snap[] = [];
  readonly current: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  /** Fraction between the two snapshots used last (0..1) and whether the newest one was reached. */
  t = 1;

  push(t: number, p: Pose): void {
    const last = this.buffer[this.buffer.length - 1];
    if (last && Math.hypot(p.x - last.x, p.z - last.z) > 30) { this.reset(p); this.buffer.push({ t, x: p.x, y: p.y, z: p.z, yaw: p.yaw }); return; } // teleport
    // Patches only arrive when something changed: re-anchor after a quiet period.
    if (last && t - last.t > 100) this.buffer.push({ ...last, t: t - 50 });
    this.buffer.push({ t, x: p.x, y: p.y, z: p.z, yaw: p.yaw });
    if (this.buffer.length > 30) this.buffer.shift();
    if (this.buffer.length === 1) Object.assign(this.current, p);
  }

  /** Teleport (no glide), e.g. respawn or "join friend". */
  reset(p: Pose): void {
    this.buffer = [];
    Object.assign(this.current, p);
  }

  update(now: number): Pose {
    const b = this.buffer;
    if (!b.length) return this.current;
    const rt = now - INTERP_DELAY;
    let a = b[0], c = b[0];
    if (rt > b[0].t) {
      let i = b.length - 1;
      while (i > 0 && b[i - 1].t > rt) i--;
      a = b[Math.max(0, i - 1)];
      c = b[i];
      if (rt > b[b.length - 1].t) { a = b[Math.max(0, b.length - 2)]; c = b[b.length - 1]; }
    }
    const t = c.t > a.t ? Math.min(1, Math.max(0, (rt - a.t) / (c.t - a.t))) : 1;
    this.t = t;
    this.current.x = a.x + (c.x - a.x) * t;
    this.current.y = a.y + (c.y - a.y) * t;
    this.current.z = a.z + (c.z - a.z) * t;
    let d = (c.yaw - a.yaw) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    this.current.yaw = a.yaw + d * t;
    return this.current;
  }
}
