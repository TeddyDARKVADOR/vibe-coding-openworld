/**
 * Simple third-person orbit camera: behind and slightly above the character,
 * mouse to orbit, wheel to zoom, pulled forward when a wall is in the way
 * (ray cast in the client physics world).
 */
import * as THREE from 'three';
import type { PhysicsWorld } from '@openworld/shared';

const TARGET_HEIGHT = 1.55;
const MIN_PITCH = -0.45, MAX_PITCH = 1.25;

export class ThirdPersonCamera {
  yaw = 0; // 0 = camera south of the player, looking north (-Z)
  pitch = 0.32;
  distance = 7;
  private currentDistance = 7;
  private target = new THREE.Vector3();

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  rotate(dx: number, dy: number, wheel: number): void {
    this.yaw -= dx * 0.0025;
    this.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, this.pitch + dy * 0.0022));
    if (wheel) this.distance = Math.min(16, Math.max(2.5, this.distance * (wheel > 0 ? 1.12 : 1 / 1.12)));
  }

  /** Horizontal forward/right vectors of the view (for camera-relative movement). */
  basis(): { fx: number; fz: number; rx: number; rz: number } {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    return { fx, fz, rx: -fz, rz: fx };
  }

  /**
   * @param renderPos character feet in render space (world − floating origin)
   * @param worldPos  same point in world space (for physics queries)
   */
  update(dt: number, renderPos: THREE.Vector3, worldPos: { x: number; y: number; z: number }, physics: PhysicsWorld): void {
    this.target.set(renderPos.x, renderPos.y + TARGET_HEIGHT, renderPos.z);
    const cp = Math.cos(this.pitch);
    const dir = { x: Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: Math.cos(this.yaw) * cp };
    // Camera collision: stop 0.3 m before the first obstacle between head and camera.
    const hit = physics.raycast(worldPos.x, worldPos.y + TARGET_HEIGHT, worldPos.z, dir.x, dir.y, dir.z, this.distance + 0.3);
    const allowed = Math.max(0.8, Math.min(this.distance, hit - 0.3));
    // Snap closer immediately (never see through walls), ease back out.
    this.currentDistance = allowed < this.currentDistance ? allowed : this.currentDistance + (allowed - this.currentDistance) * Math.min(1, dt * 4);
    const d = this.currentDistance;
    this.camera.position.set(this.target.x + dir.x * d, Math.max(this.target.y + dir.y * d, renderPos.y + 0.3), this.target.z + dir.z * d);
    this.camera.lookAt(this.target);
  }
}
