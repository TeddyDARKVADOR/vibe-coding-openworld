/**
 * Character movement step, shared by server (authoritative) and client
 * (prediction / replay). Pure function of (state, input, physics world).
 */
import { GRAVITY, JUMP_SPEED, MAX_FALL_SPEED, RUN_SPEED, TICK_DT, WALK_SPEED } from '../constants.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { Anim, INPUT_AXIS_MAX, type PlayerInput } from '../protocol.ts';

export interface CharacterState {
  /** Feet position, world metres. */
  x: number;
  y: number;
  z: number;
  /** Vertical velocity (m/s). */
  vy: number;
  grounded: boolean;
  /** Facing angle about +Y (0 = facing +Z). */
  yaw: number;
  anim: Anim;
}

export function createCharacterState(x: number, z: number): CharacterState {
  return { x, y: 0.05, z, vy: 0, grounded: false, yaw: 0, anim: Anim.Idle };
}

type ColliderOf<P> = P extends { createCharacterCollider(): infer C } ? C : never;

export function stepCharacter(
  physics: PhysicsWorld,
  collider: ColliderOf<PhysicsWorld>,
  s: CharacterState,
  input: PlayerInput,
  dt = TICK_DT,
): void {
  let mx = clampAxis(input.mx) / INPUT_AXIS_MAX;
  let mz = clampAxis(input.mz) / INPUT_AXIS_MAX;
  const len = Math.sqrt(mx * mx + mz * mz);
  if (len > 1) { mx /= len; mz /= len; }
  const moving = len > 0.05;
  const speed = input.run ? RUN_SPEED : WALK_SPEED;

  if (s.grounded && input.jump) {
    s.vy = JUMP_SPEED;
    s.grounded = false;
  }

  moveBody(physics, collider, s, mx * speed, mz * speed, dt);
  if (moving) s.yaw = Math.atan2(mx, mz);
  s.anim = !s.grounded ? Anim.Jump : moving ? (input.run ? Anim.Run : Anim.Walk) : Anim.Idle;
}

/** A body moved by the character controller (players, summons). */
export interface Body { x: number; y: number; z: number; vy: number; grounded: boolean }

/**
 * Moves a body with horizontal velocity (vx, vz) for dt seconds: gravity,
 * collisions, sliding, steps. Shared by players and summons.
 */
export function moveBody(physics: PhysicsWorld, collider: ColliderOf<PhysicsWorld>, s: Body, vx: number, vz: number, dt = TICK_DT): void {
  if (!s.grounded || s.vy !== 0) s.vy = Math.max(-MAX_FALL_SPEED, s.vy + GRAVITY * dt);
  else s.vy = GRAVITY * dt; // keep pressing on the ground so slopes/steps are followed
  const want = { x: vx * dt, y: s.vy * dt, z: vz * dt };
  const res = physics.moveCharacter(collider, s.x, s.y, s.z, want.x, want.y, want.z);
  s.x += res.dx;
  s.y += res.dy;
  s.z += res.dz;
  if (res.grounded && s.vy <= 0) s.vy = 0;
  if (s.vy > 0 && res.dy < want.y - 1e-4) s.vy = 0; // bumped head
  s.grounded = res.grounded;
  if (s.y < -50) { s.y = 2; s.vy = 0; } // safety net, should never happen
}

function clampAxis(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-INPUT_AXIS_MAX, Math.min(INPUT_AXIS_MAX, Math.round(v)));
}
