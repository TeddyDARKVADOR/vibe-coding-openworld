/**
 * Target selection (client side; the server validates every target):
 * click near a character/creature on screen, or T to cycle the closest
 * enemies. Shows a ring under the target and a small target frame.
 */
import * as THREE from 'three';
import { TARGET_RANGE } from '@openworld/shared';

export interface Targetable {
  ref: string;
  name: string;
  x: number; y: number; z: number;
  hp: number; maxHp: number;
  alive: boolean;
  /** Height of the body centre above the feet (for screen picking). */
  height: number;
}

export class TargetSystem {
  ref = '';
  private ring: THREE.Mesh;
  private frame = document.getElementById('target-frame')!;

  constructor(scene: THREE.Object3D, private send: (ref: string) => void) {
    const tex = new THREE.TextureLoader().load('/assets/vfx/circle_05.png');
    tex.colorSpace = THREE.SRGBColorSpace;
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ map: tex, color: 0xff4444, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    scene.add(this.ring);
  }

  set(ref: string): void {
    if (ref === this.ref) return;
    this.ref = ref;
    this.send(ref);
  }

  /** Picks the candidate drawn closest to screen point (px, py), within 70 px. */
  pick(px: number, py: number, camera: THREE.Camera, candidates: Targetable[], originX: number, originZ: number): boolean {
    const v = new THREE.Vector3();
    let best: Targetable | null = null, bestD = 70;
    for (const c of candidates) {
      if (!c.alive) continue;
      v.set(c.x - originX, c.y + c.height, c.z - originZ).project(camera);
      if (v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
      const d = Math.hypot(sx - px, sy - py);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best) this.set(best.ref);
    return !!best;
  }

  /** Next closest living enemy within range (T). */
  cycle(me: { x: number; z: number }, candidates: Targetable[]): void {
    const list = candidates.filter((c) => c.alive && Math.hypot(c.x - me.x, c.z - me.z) <= TARGET_RANGE)
      .sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
    if (!list.length) { this.set(''); return; }
    const i = list.findIndex((c) => c.ref === this.ref);
    this.set(list[(i + 1) % list.length].ref);
  }

  update(dt: number, candidates: Targetable[], me: { x: number; z: number }, originX: number, originZ: number): void {
    const t = this.ref ? candidates.find((c) => c.ref === this.ref) : undefined;
    if (this.ref && (!t || !t.alive || Math.hypot(t.x - me.x, t.z - me.z) > TARGET_RANGE * 1.5)) this.set('');
    this.ring.visible = !!t && t.alive;
    this.frame.classList.toggle('hidden', !this.ring.visible);
    if (!t || !this.ring.visible) return;
    this.ring.position.set(t.x - originX, t.y + 0.06, t.z - originZ);
    this.ring.rotation.z += dt * 1.5;
    (this.frame.querySelector('.tf-name') as HTMLElement).textContent = t.name;
    (this.frame.querySelector('.hpbar > div') as HTMLElement).style.width = `${Math.round((t.hp / Math.max(1, t.maxHp)) * 100)}%`;
    (this.frame.querySelector('.tf-hp') as HTMLElement).textContent = `${Math.ceil(t.hp)} / ${t.maxHp}`;
  }
}
