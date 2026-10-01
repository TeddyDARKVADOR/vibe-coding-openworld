/**
 * Thin wrapper around a Rapier world, shared by client (prediction, camera
 * collision) and server (authoritative movement).
 *
 * Rapier works in 32-bit floats, so each PhysicsWorld has a local `origin`:
 * Rapier position = world position − origin. World positions themselves are
 * always kept in JS doubles, so the world can be arbitrarily large.
 */
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS } from '../constants.ts';
import { quatY30 } from '../math/angles.ts';
import type { ColliderSpec } from '../world/catalog.ts';

export type Rapier = typeof RAPIER_NS;
type World = InstanceType<Rapier['World']>;
type Collider = ReturnType<World['createCollider']>;
type KCC = ReturnType<World['createCharacterController']>;

/**
 * Physics worlds are anchored on a fixed grid of regions. Client prediction
 * and server simulation MUST use the same origin for a given position:
 * Rapier is float32, and different origins round differently, which would
 * make the client's prediction drift from the server (measured: ~10 cm in
 * a few seconds). With the same origin both are bit-identical.
 */
export const PHYSICS_REGION_SIZE = 4096;

export function physicsRegionOf(x: number, z: number): { key: string; originX: number; originZ: number } {
  const rx = Math.floor(x / PHYSICS_REGION_SIZE), rz = Math.floor(z / PHYSICS_REGION_SIZE);
  return { key: `${rx},${rz}`, originX: (rx + 0.5) * PHYSICS_REGION_SIZE, originZ: (rz + 0.5) * PHYSICS_REGION_SIZE };
}

/** Collision groups: environment = bit 0, characters = bit 1. Characters never collide with each other. */
const GROUP_ENV = (0x0001 << 16) | 0xffff;
const GROUP_CHARACTER = (0x0002 << 16) | 0x0001;

export class PhysicsWorld {
  readonly world: World;
  readonly controller: KCC;
  private chunks = new Map<string, Collider[]>();
  private dirty = true;

  constructor(readonly rapier: Rapier, readonly originX: number, readonly originZ: number) {
    this.world = new rapier.World({ x: 0, y: 0, z: 0 }); // gravity handled by the character code
    const c = this.world.createCharacterController(0.02);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.setSlideEnabled(true);
    c.enableAutostep(0.45, 0.2, false);
    c.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    c.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    c.enableSnapToGround(0.35);
    c.setApplyImpulsesToDynamicBodies(false);
    this.controller = c;
  }

  hasChunk(key: string): boolean {
    return this.chunks.has(key);
  }

  chunkKeys(): IterableIterator<string> {
    return this.chunks.keys();
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  addChunk(key: string, specs: readonly ColliderSpec[]): void {
    if (this.chunks.has(key)) return;
    const R = this.rapier;
    const list: Collider[] = [];
    for (const s of specs) {
      let desc: ReturnType<typeof R.ColliderDesc.cuboid> | null;
      if (s.shape === 'cuboid') desc = R.ColliderDesc.cuboid(s.hx, s.hy, s.hz).setRotation(quatY30(s.rot30));
      else if (s.shape === 'cylinder') desc = R.ColliderDesc.cylinder(s.halfHeight, s.radius);
      else desc = R.ColliderDesc.convexHull(new Float32Array(s.points))?.setRotation(quatY30(s.rot30)) ?? null;
      if (!desc) continue;
      desc.setTranslation(s.x - this.originX, s.y, s.z - this.originZ).setCollisionGroups(GROUP_ENV);
      list.push(this.world.createCollider(desc));
    }
    this.chunks.set(key, list);
    this.dirty = true;
  }

  removeChunk(key: string): void {
    const list = this.chunks.get(key);
    if (!list) return;
    for (const c of list) this.world.removeCollider(c, false);
    this.chunks.delete(key);
    this.dirty = true;
  }

  /** Scene queries only see colliders added since the last step after this is called. */
  updateQueries(): void {
    if (!this.dirty) return;
    this.world.step();
    this.dirty = false;
  }

  createCharacterCollider(): Collider {
    const desc = this.rapier.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS).setCollisionGroups(GROUP_CHARACTER);
    const c = this.world.createCollider(desc);
    this.dirty = true;
    return c;
  }

  removeCollider(c: Collider): void {
    this.world.removeCollider(c, false);
  }

  /**
   * Moves a character collider whose feet are at world (x, y, z) by `delta`
   * (world metres) with collision and sliding. Returns the allowed movement.
   */
  moveCharacter(collider: Collider, x: number, y: number, z: number, dx: number, dy: number, dz: number): { dx: number; dy: number; dz: number; grounded: boolean } {
    this.updateQueries();
    const cy = y + CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS;
    collider.setTranslation({ x: x - this.originX, y: cy, z: z - this.originZ });
    this.controller.computeColliderMovement(collider, { x: dx, y: dy, z: dz }, undefined, GROUP_CHARACTER);
    const m = this.controller.computedMovement();
    const grounded = this.controller.computedGrounded();
    collider.setTranslation({ x: x + m.x - this.originX, y: cy + m.y, z: z + m.z - this.originZ });
    return { dx: m.x, dy: m.y, dz: m.z, grounded };
  }

  /** True if a character capsule with its feet at (x, y, z) would not overlap any environment collider. */
  isCapsuleFree(x: number, y: number, z: number): boolean {
    this.updateQueries();
    const shape = new this.rapier.Capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS);
    let free = true;
    this.world.intersectionsWithShape(
      { x: x - this.originX, y: y + CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS + 0.05, z: z - this.originZ }, { x: 0, y: 0, z: 0, w: 1 }, shape,
      () => { free = false; return false; }, undefined, GROUP_CHARACTER,
    );
    return free;
  }

  /** Distance along a ray (world coords) to the first environment hit, or `maxDist`. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number {
    this.updateQueries();
    const ray = new this.rapier.Ray({ x: ox - this.originX, y: oy, z: oz - this.originZ }, { x: dx, y: dy, z: dz });
    const hit = this.world.castRay(ray, maxDist, true, undefined, GROUP_CHARACTER);
    return hit ? hit.timeOfImpact : maxDist;
  }

  free(): void {
    this.world.free();
    this.chunks.clear();
  }
}
