/**
 * Authoritative movement simulation.
 *
 * Physics runs in "regions" of PHYSICS_REGION_SIZE metres, each with its own
 * Rapier world whose origin is the region centre (Rapier uses float32) — the
 * same origins the client uses for prediction. A player
 * belongs to the region containing it; the region loads the colliders of the
 * chunks around its players (deterministically generated, identical to the
 * client) and frees them when nobody is near anymore.
 *
 * Players don't collide with each other, so splitting space into regions has
 * no visible effect.
 */
import type { Rapier } from '@openworld/shared';
import {
  Anim, PHYSICS_RADIUS, PhysicsWorld, physicsRegionOf, chunkCoord, chunkKey, createCharacterState, generateChunk, stepCharacter,
  type CharacterState, type ChunkData, type PlayerInput,
} from '@openworld/shared';

/**
 * Input budget: a player may never be simulated faster than real time
 * (+1 input per tick), but unused budget is kept for up to 1 s so a backlog
 * caused by network jitter is drained right away instead of lingering.
 * Inputs are only dropped beyond 3 s of backlog: dropping inputs the client
 * already predicted would make the character snap backwards.
 */
const MAX_QUEUED_INPUTS = 90;
const MAX_INPUT_BURST = 30;

type Collider = ReturnType<PhysicsWorld['createCharacterCollider']>;

interface Region {
  key: string;
  physics: PhysicsWorld;
  players: Set<SimPlayer>;
}

export interface SimPlayer {
  id: string;
  state: CharacterState;
  queue: PlayerInput[];
  lastSeq: number;
  budget: number;
  /** Ticks since the last processed input (client paused, tab hidden, lag...). */
  starved: number;
  region: Region | null;
  collider: Collider | null;
}

export class ServerSimulation {
  private regions = new Map<string, Region>();
  private players = new Map<string, SimPlayer>();
  /** Small cache so chunks needed by several regions/players are generated once. */
  private chunkCache = new Map<string, ChunkData>();

  constructor(private readonly rapier: Rapier) {}

  addPlayer(id: string, x: number, z: number, y?: number): SimPlayer {
    const state = createCharacterState(x, z);
    if (y !== undefined) state.y = y;
    const p: SimPlayer = { id, state, queue: [], lastSeq: -1, budget: MAX_INPUT_BURST, starved: 0, region: null, collider: null };
    this.players.set(id, p);
    this.updateRegion(p);
    this.moveToFreeSpot(p);
    return p;
  }

  /** Spiral search for the closest spot where the character doesn't overlap a house, tree, lake... */
  private moveToFreeSpot(p: SimPlayer): void {
    const x0 = p.state.x, z0 = p.state.z;
    for (let ring = 0; ring <= 40; ring++) {
      const n = Math.max(1, ring * 6);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = x0 + Math.cos(a) * ring * 1.5, z = z0 + Math.sin(a) * ring * 1.5;
        p.state.x = x; p.state.z = z;
        this.updateRegion(p);
        if (p.region!.physics.isCapsuleFree(x, p.state.y, z)) return;
      }
    }
    p.state.x = x0; p.state.z = z0;
  }

  getPlayer(id: string): SimPlayer | undefined {
    return this.players.get(id);
  }

  removePlayer(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    this.leaveRegion(p);
    this.players.delete(id);
  }

  queueInput(id: string, input: PlayerInput): void {
    const p = this.players.get(id);
    if (!p || input.seq <= p.lastSeq) return; // stale or duplicate
    if (p.queue.length && input.seq <= p.queue[p.queue.length - 1].seq) return;
    p.queue.push(input);
    if (p.queue.length > MAX_QUEUED_INPUTS) p.queue.splice(0, p.queue.length - MAX_QUEUED_INPUTS);
  }

  /** One fixed simulation tick. */
  tick(): void {
    for (const p of this.players.values()) {
      p.budget = Math.min(MAX_INPUT_BURST, p.budget + 1);
      while (p.queue.length && p.budget >= 1) {
        const input = p.queue.shift()!;
        p.budget -= 1;
        this.updateRegion(p);
        stepCharacter(p.region!.physics, p.collider!, p.state, input);
        p.lastSeq = input.seq;
        p.starved = 0;
      }
      // No input for a while: show the character idle instead of walking on the spot.
      if (++p.starved > 10 && p.state.grounded) p.state.anim = Anim.Idle;
    }
    this.collectChunks();
  }

  get stats() {
    let chunks = 0;
    for (const r of this.regions.values()) chunks += r.physics.chunkCount;
    return { players: this.players.size, regions: this.regions.size, chunks };
  }

  // ------------------------------------------------------------------ regions

  private updateRegion(p: SimPlayer): void {
    const { key, originX, originZ } = physicsRegionOf(p.state.x, p.state.z);
    if (p.region?.key !== key) {
      this.leaveRegion(p);
      let region = this.regions.get(key);
      if (!region) {
        region = { key, physics: new PhysicsWorld(this.rapier, originX, originZ), players: new Set() };
        this.regions.set(key, region);
      }
      region.players.add(p);
      p.region = region;
      p.collider = region.physics.createCharacterCollider();
    }
    // Make sure the colliders around the player exist before moving it.
    const cx = chunkCoord(p.state.x), cz = chunkCoord(p.state.z);
    for (let dz = -PHYSICS_RADIUS; dz <= PHYSICS_RADIUS; dz++) {
      for (let dx = -PHYSICS_RADIUS; dx <= PHYSICS_RADIUS; dx++) {
        const k = chunkKey(cx + dx, cz + dz);
        if (!p.region!.physics.hasChunk(k)) p.region!.physics.addChunk(k, this.chunk(cx + dx, cz + dz).colliders);
      }
    }
  }

  private leaveRegion(p: SimPlayer): void {
    const region = p.region;
    if (!region) return;
    if (p.collider) region.physics.removeCollider(p.collider);
    region.players.delete(p);
    p.region = null;
    p.collider = null;
    if (region.players.size === 0) {
      region.physics.free();
      this.regions.delete(region.key);
    }
  }

  /** Frees chunk colliders no player needs anymore (with one chunk of hysteresis). */
  private collectChunks(): void {
    for (const region of this.regions.values()) {
      const keep = new Set<string>();
      for (const p of region.players) {
        const cx = chunkCoord(p.state.x), cz = chunkCoord(p.state.z);
        const r = PHYSICS_RADIUS + 1;
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) keep.add(chunkKey(cx + dx, cz + dz));
      }
      for (const k of [...region.physics.chunkKeys()]) if (!keep.has(k)) region.physics.removeChunk(k);
    }
    if (this.chunkCache.size > 256) this.chunkCache.clear();
  }

  private chunk(cx: number, cz: number): ChunkData {
    const k = chunkKey(cx, cz);
    let c = this.chunkCache.get(k);
    if (!c) {
      c = generateChunk(cx, cz);
      this.chunkCache.set(k, c);
    }
    return c;
  }
}
