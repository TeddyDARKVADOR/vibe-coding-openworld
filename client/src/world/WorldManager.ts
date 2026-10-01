/**
 * Streams the world around the local player.
 *
 *  - Visual chunks within RENDER_LOAD_RADIUS are generated (deterministically),
 *    their KayKit models loaded (cached), then shown all at once — no
 *    half-built chunk ever appears. Chunks beyond RENDER_UNLOAD_RADIUS are
 *    freed. Far chunks sit behind the fog, so streaming is invisible.
 *  - Colliders of chunks within PHYSICS_RADIUS are added to the client
 *    physics world (used for prediction and camera collision). Its origin
 *    follows the same region grid as the server, so prediction is exact.
 *
 * Not coupled to the UI or the network.
 */
import {
  PHYSICS_RADIUS, RENDER_LOAD_RADIUS, RENDER_UNLOAD_RADIUS,
  PhysicsWorld, chunkCoord, chunkKey, generateChunk, physicsRegionOf, type ChunkData, type Rapier,
} from '@openworld/shared';
import type { AssetLibrary } from '../assets/AssetLibrary.ts';
import { EnvironmentRenderer } from './EnvironmentRenderer.ts';

type ChunkStatus = 'loading' | 'shown';

interface LoadedChunk {
  data: ChunkData;
  status: ChunkStatus;
}

/** Max chunks generated per frame (generation is synchronous, a few ms each). */
const GENERATE_PER_FRAME = 2;

export class WorldManager {
  readonly renderer: EnvironmentRenderer;
  physics: PhysicsWorld;
  private chunks = new Map<string, LoadedChunk>();
  private dataCache = new Map<string, ChunkData>();
  private centerKey = '';
  private physicsCenterKey = '';
  private physicsRegion = '';
  private queue: { cx: number; cz: number; d: number }[] = [];
  onError: (e: unknown) => void = (e) => console.error(e);

  constructor(
    private rapier: Rapier,
    private assets: AssetLibrary,
    renderOriginX: number,
    renderOriginZ: number,
    /** Chebyshev radius (in chunks) of rendered chunks; unloaded beyond loadRadius + 1. */
    readonly loadRadius = RENDER_LOAD_RADIUS,
  ) {
    this.renderer = new EnvironmentRenderer(assets);
    this.renderer.setOrigin(renderOriginX, renderOriginZ);
    const region = physicsRegionOf(renderOriginX, renderOriginZ);
    this.physicsRegion = region.key;
    this.physics = new PhysicsWorld(rapier, region.originX, region.originZ, true);
  }

  getChunkKey(x: number, z: number): string {
    return chunkKey(chunkCoord(x), chunkCoord(z));
  }

  /** Called every frame with the local player's world position. */
  updateAroundPlayer(x: number, z: number): void {
    const cx = chunkCoord(x), cz = chunkCoord(z);
    const key = chunkKey(cx, cz);
    if (key !== this.centerKey) {
      this.centerKey = key;
      this.planChunks(cx, cz);
    }
    for (let n = 0; n < GENERATE_PER_FRAME && this.queue.length; n++) {
      const { cx: qx, cz: qz } = this.queue.shift()!;
      this.loadChunk(qx, qz);
    }
    this.renderer.flush();
  }

  /** Loads everything around a point and resolves when it is all visible (initial loading screen). */
  async preload(x: number, z: number, onProgress: (p: number) => void): Promise<void> {
    const cx = chunkCoord(x), cz = chunkCoord(z);
    const jobs: Promise<void>[] = [];
    const r = this.loadRadius;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) jobs.push(this.loadChunk(cx + dx, cz + dz));
    }
    let done = 0;
    await Promise.all(jobs.map((j) => j.then(() => onProgress(++done / jobs.length))));
    this.centerKey = chunkKey(cx, cz);
    this.physicsAt(x, z);
    this.renderer.flush();
  }

  loadChunk(cx: number, cz: number): Promise<void> {
    const key = chunkKey(cx, cz);
    if (this.chunks.has(key)) return Promise.resolve();
    const data = this.chunkData(cx, cz);
    const entry: LoadedChunk = { data, status: 'loading' };
    this.chunks.set(key, entry);
    const models = [...new Set(data.placements.map((p) => p.model))];
    return Promise.all(models.map((m) => this.assets.loadEnv(m))).then(
      () => {
        if (this.chunks.get(key) !== entry) return; // unloaded meanwhile
        this.renderer.addChunk(key, cx, cz, data.placements);
        entry.status = 'shown';
      },
      (e) => {
        this.chunks.delete(key);
        this.onError(e);
      },
    );
  }

  unloadChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    if (!this.chunks.delete(key)) return;
    this.renderer.removeChunk(key);
  }

  /** Floating origin of the renderer (visual only). */
  setRenderOrigin(originX: number, originZ: number): void {
    this.renderer.setOrigin(originX, originZ);
  }

  /**
   * Physics world to simulate a character standing at (x, z): switches region
   * (same grid as the server) and loads the colliders around if needed.
   */
  physicsAt(x: number, z: number): PhysicsWorld {
    const region = physicsRegionOf(x, z);
    if (region.key !== this.physicsRegion) {
      this.physicsRegion = region.key;
      this.physics.free();
      this.physics = new PhysicsWorld(this.rapier, region.originX, region.originZ, true);
      this.physicsCenterKey = '';
    }
    const cx = chunkCoord(x), cz = chunkCoord(z);
    const key = chunkKey(cx, cz);
    if (key !== this.physicsCenterKey) {
      this.physicsCenterKey = key;
      this.updatePhysics(cx, cz);
    }
    return this.physics;
  }

  /** Data of a loaded chunk (undefined if not loaded). */
  getLoadedChunk(key: string): ChunkData | undefined {
    return this.chunks.get(key)?.data;
  }

  /** Loaded placements whose model name starts with `prefix`, nearest first (debug / tests). */
  placementsNear(prefix: string, x: number, z: number, maxDist: number) {
    const out: { model: string; x: number; z: number; d: number }[] = [];
    for (const c of this.chunks.values()) {
      for (const p of c.data.placements) {
        if (!p.model.startsWith(prefix)) continue;
        const d = Math.hypot(p.x - x, p.z - z);
        if (d <= maxDist) out.push({ model: p.model, x: p.x, z: p.z, d });
      }
    }
    return out.sort((a, b) => a.d - b.d);
  }

  isChunkShown(key: string): boolean {
    return this.chunks.get(key)?.status === 'shown';
  }

  get stats() {
    let shown = 0;
    for (const c of this.chunks.values()) if (c.status === 'shown') shown++;
    return { chunks: this.chunks.size, shown, queued: this.queue.length, physicsChunks: this.physics.chunkCount, ...this.renderer.stats };
  }

  // ------------------------------------------------------------------ private

  private chunkData(cx: number, cz: number): ChunkData {
    const key = chunkKey(cx, cz);
    let d = this.dataCache.get(key);
    if (!d) {
      d = generateChunk(cx, cz);
      this.dataCache.set(key, d);
      if (this.dataCache.size > 200) {
        // Drop the oldest cached data that is not in use.
        for (const k of this.dataCache.keys()) {
          if (!this.chunks.has(k) && !this.physics.hasChunk(k)) { this.dataCache.delete(k); break; }
        }
      }
    }
    return d;
  }

  private planChunks(cx: number, cz: number): void {
    // Unload far chunks.
    for (const c of [...this.chunks.values()]) {
      if (Math.max(Math.abs(c.data.cx - cx), Math.abs(c.data.cz - cz)) > this.loadRadius + (RENDER_UNLOAD_RADIUS - RENDER_LOAD_RADIUS)) this.unloadChunk(c.data.cx, c.data.cz);
    }
    // Queue missing ones, nearest first.
    this.queue = [];
    const r = this.loadRadius;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (!this.chunks.has(chunkKey(cx + dx, cz + dz))) this.queue.push({ cx: cx + dx, cz: cz + dz, d: dx * dx + dz * dz });
      }
    }
    this.queue.sort((a, b) => a.d - b.d);
  }

  private updatePhysics(cx: number, cz: number): void {
    for (let dz = -PHYSICS_RADIUS; dz <= PHYSICS_RADIUS; dz++) {
      for (let dx = -PHYSICS_RADIUS; dx <= PHYSICS_RADIUS; dx++) {
        const k = chunkKey(cx + dx, cz + dz);
        if (!this.physics.hasChunk(k)) this.physics.addChunk(k, this.chunkData(cx + dx, cz + dz).colliders);
      }
    }
    for (const k of [...this.physics.chunkKeys()]) {
      const [kx, kz] = k.split(',').map(Number);
      if (Math.max(Math.abs(kx - cx), Math.abs(kz - cz)) > PHYSICS_RADIUS + 1) this.physics.removeChunk(k);
    }
  }
}

