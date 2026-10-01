/**
 * Lightweight effects built from the Kenney Particle Pack textures (CC0):
 * billboard bursts, ground rings and decals, simple homing projectiles.
 * Effects are described as data (EFFECTS) so new ones are a table entry.
 */
import * as THREE from 'three';

type Layer =
  | { kind: 'burst'; tex: string; color: number; size: [number, number]; life: number; y: number; count?: number; spread?: number; rise?: number }
  | { kind: 'ring'; tex: string; color: number; size: [number, number]; life: number; spin?: number };

/** Effect name → layers. Names are referenced by the summon JSON files ("vfx"). */
const EFFECTS: Record<string, Layer[]> = {
  impact: [{ kind: 'burst', tex: 'star_07', color: 0xfff1b0, size: [0.6, 2.2], life: 0.35, y: 1 }],
  slash: [{ kind: 'burst', tex: 'slash_03', color: 0xff6a5a, size: [1.2, 2.6], life: 0.3, y: 1.1 }],
  dust: [{ kind: 'burst', tex: 'smoke_05', color: 0xd9c7a2, size: [0.8, 2.4], life: 0.7, y: 0.4, count: 4, spread: 0.8, rise: 0.6 }],
  aura: [{ kind: 'ring', tex: 'light_01', color: 0x8fd7ff, size: [2.6, 3.2], life: 1.2, spin: 1 }, { kind: 'burst', tex: 'spark_05', color: 0xb8ecff, size: [0.4, 1.4], life: 0.9, y: 1, count: 6, spread: 0.9, rise: 1.6 }],
  aura_red: [{ kind: 'ring', tex: 'light_01', color: 0xff6b5a, size: [2.6, 3.2], life: 1.2, spin: 1 }, { kind: 'burst', tex: 'flare_01', color: 0xff8a6a, size: [0.4, 1.4], life: 0.9, y: 1, count: 6, spread: 0.9, rise: 1.6 }],
  shockwave: [{ kind: 'ring', tex: 'circle_05', color: 0xe8f4ff, size: [1, 11], life: 0.6 }, { kind: 'burst', tex: 'dirt_02', color: 0xcbb38a, size: [1, 4], life: 0.6, y: 0.3, count: 5, spread: 2.5, rise: 0.6 }],
  explosion: [{ kind: 'burst', tex: 'flare_01', color: 0xffa050, size: [1, 7], life: 0.5, y: 1 }, { kind: 'ring', tex: 'scorch_02', color: 0x553322, size: [5, 6], life: 1.6 }, { kind: 'burst', tex: 'smoke_05', color: 0x887766, size: [1.5, 4], life: 1.1, y: 1, count: 5, spread: 2, rise: 1.5 }],
  explosion_green: [{ kind: 'burst', tex: 'magic_05', color: 0x9dff6a, size: [1, 8], life: 0.6, y: 1 }, { kind: 'ring', tex: 'circle_05', color: 0x9dff6a, size: [1, 12], life: 0.7 }],
  poison: [{ kind: 'burst', tex: 'smoke_05', color: 0x8fe05a, size: [1.5, 5], life: 1.4, y: 0.8, count: 7, spread: 3, rise: 0.8 }],
  magic: [{ kind: 'burst', tex: 'twirl_02', color: 0xc08bff, size: [0.5, 3], life: 0.5, y: 1 }],
  summon: [{ kind: 'ring', tex: 'magic_02', color: 0xa6e3ff, size: [0.5, 3.6], life: 1.4, spin: 2.5 }, { kind: 'ring', tex: 'circle_05', color: 0xffffff, size: [3.4, 4.2], life: 1.2 }, { kind: 'burst', tex: 'spark_05', color: 0xd8f6ff, size: [0.5, 1.8], life: 1, y: 0.8, count: 10, spread: 1.4, rise: 2.4 }],
  unsummon: [{ kind: 'burst', tex: 'twirl_02', color: 0xa6e3ff, size: [2, 0.2], life: 0.6, y: 1 }],
  death: [{ kind: 'burst', tex: 'smoke_05', color: 0x666677, size: [1, 3.5], life: 1.4, y: 0.8, count: 6, spread: 1.2, rise: 1.2 }],
  mount: [{ kind: 'burst', tex: 'smoke_05', color: 0xd9c7a2, size: [1, 3], life: 0.8, y: 0.3, count: 5, spread: 1.4, rise: 0.4 }],
  heal: [{ kind: 'burst', tex: 'star_07', color: 0x9dff9d, size: [0.4, 1.4], life: 0.9, y: 1, count: 6, spread: 0.8, rise: 1.8 }],
};

/** Projectile looks (sprite following the server-timed flight). */
const PROJECTILES: Record<string, { tex: string; color: number; size: number }> = {
  spore: { tex: 'magic_05', color: 0xb6ff7a, size: 0.9 },
  spore_big: { tex: 'magic_05', color: 0x8cff4a, size: 1.6 },
  laser: { tex: 'spark_05', color: 0x7affea, size: 1.1 },
  fireball: { tex: 'flare_01', color: 0xff8a3a, size: 1.6 },
};

interface Live { obj: THREE.Object3D; mat: THREE.SpriteMaterial | THREE.MeshBasicMaterial; age: number; life: number; size: [number, number]; base: THREE.Vector3; vel: THREE.Vector3; spin: number; world: { x: number; y: number; z: number } }
interface Flying { sprite: THREE.Sprite; from: THREE.Vector3; to: () => { x: number; y: number; z: number } | null; dur: number; age: number; onHit: string }

export class VFXManager {
  readonly group = new THREE.Group();
  private loader = new THREE.TextureLoader();
  private textures = new Map<string, THREE.Texture>();
  private live: Live[] = [];
  private flying: Flying[] = [];
  private originX = 0;
  private originZ = 0;

  private tex(name: string): THREE.Texture {
    let t = this.textures.get(name);
    if (!t) {
      t = this.loader.load(`/assets/vfx/${name}.png`);
      t.colorSpace = THREE.SRGBColorSpace;
      this.textures.set(name, t);
    }
    return t;
  }

  setOrigin(x: number, z: number): void {
    this.originX = x;
    this.originZ = z;
  }

  /** Plays an effect at a world position. Unknown names are ignored. */
  play(name: string, x: number, y: number, z: number): void {
    for (const layer of EFFECTS[name] ?? []) {
      const n = layer.kind === 'burst' ? layer.count ?? 1 : 1;
      for (let i = 0; i < n; i++) {
        const spread = layer.kind === 'burst' ? layer.spread ?? 0 : 0;
        const ox = (Math.random() - 0.5) * 2 * spread, oz = (Math.random() - 0.5) * 2 * spread;
        if (layer.kind === 'burst') {
          const mat = new THREE.SpriteMaterial({ map: this.tex(layer.tex), color: layer.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
          const sp = new THREE.Sprite(mat);
          this.add(sp, mat, layer.life * (0.8 + Math.random() * 0.4), layer.size, { x: x + ox, y: y + layer.y, z: z + oz }, new THREE.Vector3(0, layer.rise ?? 0, 0), 0);
        } else {
          const mat = new THREE.MeshBasicMaterial({ map: this.tex(layer.tex), color: layer.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
          mesh.rotation.x = -Math.PI / 2;
          this.add(mesh, mat, layer.life, layer.size, { x, y: y + 0.08, z }, new THREE.Vector3(), layer.spin ?? 0);
        }
      }
    }
  }

  /** Visual projectile flying to a (moving) target for `duration` seconds, then `onHit` effect. */
  projectile(kind: string, from: { x: number; y: number; z: number }, to: () => { x: number; y: number; z: number } | null, duration: number, onHit = 'impact'): void {
    const look = PROJECTILES[kind] ?? PROJECTILES.spore;
    const mat = new THREE.SpriteMaterial({ map: this.tex(look.tex), color: look.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(look.size);
    this.group.add(sprite);
    this.flying.push({ sprite, from: new THREE.Vector3(from.x, from.y, from.z), to, dur: Math.max(0.05, duration), age: 0, onHit });
  }

  private add(obj: THREE.Object3D, mat: Live['mat'], life: number, size: [number, number], world: Live['world'], vel: THREE.Vector3, spin: number): void {
    this.group.add(obj);
    this.live.push({ obj, mat, age: 0, life, size, base: new THREE.Vector3(), vel, spin, world: { ...world } });
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const l = this.live[i];
      l.age += dt;
      const k = Math.min(1, l.age / l.life);
      const s = l.size[0] + (l.size[1] - l.size[0]) * Math.sqrt(k);
      l.obj.scale.set(s, s, s);
      l.world.x += l.vel.x * dt; l.world.y += l.vel.y * dt; l.world.z += l.vel.z * dt;
      l.obj.position.set(l.world.x - this.originX, l.world.y, l.world.z - this.originZ);
      if (l.spin) l.obj.rotation.z += l.spin * dt;
      l.mat.opacity = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
      if (k >= 1) {
        this.group.remove(l.obj);
        l.mat.dispose();
        if ((l.obj as THREE.Mesh).geometry) (l.obj as THREE.Mesh).geometry.dispose();
        this.live.splice(i, 1);
      }
    }
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.age += dt;
      const to = f.to();
      const k = Math.min(1, f.age / f.dur);
      if (!to) { this.dropFlying(i); continue; }
      const x = f.from.x + (to.x - f.from.x) * k, y = f.from.y + (to.y - f.from.y) * k + Math.sin(k * Math.PI) * 0.6, z = f.from.z + (to.z - f.from.z) * k;
      f.sprite.position.set(x - this.originX, y, z - this.originZ);
      if (k >= 1) { this.play(f.onHit, to.x, to.y - 1, to.z); this.dropFlying(i); }
    }
  }

  private dropFlying(i: number): void {
    const f = this.flying[i];
    this.group.remove(f.sprite);
    f.sprite.material.dispose();
    this.flying.splice(i, 1);
  }
}
