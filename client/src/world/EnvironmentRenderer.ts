/**
 * Draws environment models with GPU instancing: one InstancedMesh per
 * (model, mesh, bucket of 2×2 chunks). Loading/unloading a chunk only
 * rewrites the instance matrices of the batches it touches. Buckets keep the
 * draw-call count low while still letting three.js frustum-cull whole areas
 * (main camera and the sun's shadow camera).
 *
 * Instance matrices are expressed relative to the floating origin, so values
 * sent to the GPU stay small however far players travel.
 */
import * as THREE from 'three';
import { ANGLE_TABLE, type Placement } from '@openworld/shared';

/** Chunks per bucket side. */
const BUCKET = 2;
import type { AssetLibrary } from '../assets/AssetLibrary.ts';

interface ModelBatch {
  model: string;
  bucket: string;
  meshes: THREE.InstancedMesh[];
  capacity: number;
  chunks: Map<string, Placement[]>;
  dirty: boolean;
}

/** Models that cast shadows (big vertical things). Ground tiles only receive. */
const CASTS_SHADOW = /^(building_|trees_|tree_|mountain_|hill|rock_|barrel|crate|tent|wheelbarrow|flag|poi\/)/;

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class EnvironmentRenderer {
  readonly group = new THREE.Group();
  private batches = new Map<string, ModelBatch>();
  private originX = 0;
  private originZ = 0;

  constructor(private assets: AssetLibrary) {
    this.group.name = 'environment';
  }

  /** All models of `placements` must already be loaded in the AssetLibrary. */
  addChunk(key: string, cx: number, cz: number, placements: readonly Placement[]): void {
    const bucket = `${Math.floor(cx / BUCKET)},${Math.floor(cz / BUCKET)}`;
    const byModel = new Map<string, Placement[]>();
    for (const p of placements) {
      let list = byModel.get(p.model);
      if (!list) byModel.set(p.model, (list = []));
      list.push(p);
    }
    for (const [model, list] of byModel) {
      const b = this.batch(model, bucket);
      b.chunks.set(key, list);
      b.dirty = true;
    }
  }

  removeChunk(key: string): void {
    for (const b of this.batches.values()) {
      if (b.chunks.delete(key)) b.dirty = true;
    }
  }

  setOrigin(x: number, z: number): void {
    this.originX = x;
    this.originZ = z;
    for (const b of this.batches.values()) b.dirty = true;
  }

  /** Rewrites instance buffers of the models touched since the last call. */
  flush(): void {
    for (const b of this.batches.values()) {
      if (!b.dirty) continue;
      b.dirty = false;
      let count = 0;
      for (const list of b.chunks.values()) count += list.length;
      if (count > b.capacity) this.grow(b, Math.max(count, b.capacity * 2));
      let i = 0;
      for (const list of b.chunks.values()) {
        for (const p of list) {
          const [c, s] = ANGLE_TABLE[((p.rot30 % 12) + 12) % 12];
          tmpQ.setFromAxisAngle(UP, Math.atan2(s, c));
          tmpP.set(p.x - this.originX, p.y, p.z - this.originZ);
          tmpS.setScalar(p.scale);
          tmpM.compose(tmpP, tmpQ, tmpS);
          for (const m of b.meshes) m.setMatrixAt(i, tmpM);
          i++;
        }
      }
      if (count === 0) {
        for (const m of b.meshes) { this.group.remove(m); m.dispose(); }
        this.batches.delete(`${b.model}@${b.bucket}`);
        continue;
      }
      for (const m of b.meshes) {
        m.count = count;
        m.instanceMatrix.needsUpdate = true;
        m.visible = count > 0;
        if (count > 0) m.computeBoundingSphere();
      }
    }
  }

  get stats() {
    let instances = 0, drawCalls = 0;
    for (const b of this.batches.values()) {
      for (const m of b.meshes) if (m.count > 0) { drawCalls++; instances += m.count; }
    }
    return { instances, drawCalls };
  }

  private batch(model: string, bucket: string): ModelBatch {
    const key = `${model}@${bucket}`;
    let b = this.batches.get(key);
    if (!b) {
      b = { model, bucket, meshes: [], capacity: 0, chunks: new Map(), dirty: true };
      this.batches.set(key, b);
      this.grow(b, 16);
    }
    return b;
  }

  private grow(b: ModelBatch, capacity: number): void {
    const model = b.model;
    const env = this.assets.getEnv(model);
    if (!env) throw new Error(`model ${model} not loaded`);
    for (const m of b.meshes) {
      this.group.remove(m);
      m.dispose();
    }
    b.meshes = env.geometries.map((g, i) => {
      const m = new THREE.InstancedMesh(g, env.materials[i] ?? this.assets.envMaterial, capacity);
      m.name = model;
      m.count = 0;
      m.receiveShadow = true;
      m.castShadow = CASTS_SHADOW.test(model);
      m.frustumCulled = true;
      this.group.add(m);
      return m;
    });
    b.capacity = capacity;
    b.dirty = true;
  }
}
