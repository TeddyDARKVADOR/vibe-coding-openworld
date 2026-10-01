/**
 * Local player: input → prediction → server reconciliation.
 *
 * Every fixed tick (30 Hz) the current intent is turned into a PlayerInput,
 * sent to the server and immediately simulated locally with the very same
 * shared code (stepCharacter + Rapier), so controls feel instant. When the
 * authoritative state arrives, the local state is reset to it and the inputs
 * the server has not processed yet are replayed. Small differences are
 * smoothed visually; the server always stays the source of truth.
 */
import * as THREE from 'three';
import {
  Anim, Emote, INPUT_AXIS_MAX, createCharacterState, stepCharacter,
  type CharacterState, type PhysicsWorld, type PlayerInput,
} from '@openworld/shared';
import type { CharacterModel } from './CharacterModel.ts';
import type { Input } from './Input.ts';
import type { ThirdPersonCamera } from '../camera/ThirdPersonCamera.ts';

type Collider = ReturnType<PhysicsWorld['createCharacterCollider']>;

export interface ServerPlayerState {
  x: number; y: number; z: number; vy: number; yaw: number; anim: number; ack: number; grounded: boolean; dead: boolean;
}

export class PlayerController {
  readonly state: CharacterState;
  private prev = { x: 0, y: 0, z: 0 };
  private pending: PlayerInput[] = [];
  private seq = 0;
  private collider: Collider | null = null;
  private colliderWorld: PhysicsWorld | null = null;
  /** Visual-only offset that absorbs server corrections smoothly. */
  private correction = new THREE.Vector3();
  private visualYaw = 0;
  /** Local emote (also sent to the server); cancelled when moving. */
  emote: Emote = Emote.None;
  corrections = 0;
  lastCorrection = 0;

  constructor(
    /** Physics world (with colliders loaded) for a character standing at (x, z). */
    private physicsAt: (x: number, z: number) => PhysicsWorld,
    readonly model: CharacterModel,
    private input: Input,
    private camera: ThirdPersonCamera,
    private send: (input: PlayerInput) => void,
    spawn: { x: number; y: number; z: number },
  ) {
    this.state = createCharacterState(spawn.x, spawn.z);
    this.state.y = spawn.y;
    this.prev = { x: spawn.x, y: spawn.y, z: spawn.z };
  }

  /** Simulates one input from the current state (exactly what the server does). */
  private simulate(input: PlayerInput): void {
    const physics = this.physicsAt(this.state.x, this.state.z);
    if (physics !== this.colliderWorld) {
      this.colliderWorld = physics;
      this.collider = physics.createCharacterCollider();
    }
    stepCharacter(physics, this.collider!, this.state, input);
  }

  /** One fixed simulation tick. */
  fixedUpdate(): void {
    const m = this.input.move();
    const b = this.camera.basis();
    let dx = b.fx * m.y + b.rx * m.x, dz = b.fz * m.y + b.rz * m.x;
    const len = Math.hypot(dx, dz);
    if (len > 1) { dx /= len; dz /= len; }
    const input: PlayerInput = {
      seq: ++this.seq,
      mx: Math.round(dx * INPUT_AXIS_MAX),
      mz: Math.round(dz * INPUT_AXIS_MAX),
      run: m.run,
      jump: this.input.consumeJump(),
    };
    this.send(input);
    this.pending.push(input);
    if (this.pending.length > 120) this.pending.shift(); // server unreachable: don't grow forever
    this.prev = { x: this.state.x, y: this.state.y, z: this.state.z };
    this.simulate(input);
  }

  /** Authoritative state for this player arrived from the server. */
  reconcile(s: ServerPlayerState): void {
    this.pending = this.pending.filter((i) => i.seq > s.ack);
    const before = { x: this.state.x, y: this.state.y, z: this.state.z };
    Object.assign(this.state, { x: s.x, y: s.y, z: s.z, vy: s.vy, yaw: s.yaw, anim: s.anim as Anim, grounded: s.grounded, frozen: s.dead });
    for (const i of this.pending) this.simulate(i);
    const ex = before.x - this.state.x, ey = before.y - this.state.y, ez = before.z - this.state.z;
    const err = Math.hypot(ex, ey, ez);
    if (err > 1e-3) { this.corrections++; this.lastCorrection = err; }
    if (err > 5) this.correction.set(0, 0, 0); // teleport-sized difference: snap
    else this.correction.add(new THREE.Vector3(ex, ey, ez));
    // Keep prev consistent so render interpolation doesn't jump.
    this.prev.x -= ex; this.prev.y -= ey; this.prev.z -= ez;
  }

  /**
   * Render-rate update. `alpha` = fraction of the current tick elapsed, used
   * to interpolate between the last two simulated positions.
   */
  render(dt: number, alpha: number, originX: number, originZ: number, out: THREE.Vector3): void {
    this.correction.multiplyScalar(Math.exp(-dt * 10));
    out.set(
      this.prev.x + (this.state.x - this.prev.x) * alpha + this.correction.x - originX,
      this.prev.y + (this.state.y - this.prev.y) * alpha + this.correction.y,
      this.prev.z + (this.state.z - this.prev.z) * alpha + this.correction.z - originZ,
    );
    this.model.root.position.copy(out);
    this.visualYaw = lerpAngle(this.visualYaw, this.state.yaw, Math.min(1, dt * 14));
    this.model.root.rotation.y = this.visualYaw;
    if (this.state.anim !== Anim.Idle) this.emote = Emote.None;
    this.model.setPose(this.state.anim, this.emote, 0.2, !!this.state.frozen);
    this.model.update(dt);
  }

  /** Interpolated world-space position (for streaming, camera physics...). */
  worldPosition(alpha: number): { x: number; y: number; z: number } {
    return {
      x: this.prev.x + (this.state.x - this.prev.x) * alpha,
      y: this.prev.y + (this.state.y - this.prev.y) * alpha,
      z: this.prev.z + (this.state.z - this.prev.z) * alpha,
    };
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}

export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
