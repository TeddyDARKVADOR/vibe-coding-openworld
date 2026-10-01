/**
 * Mount definitions are data (shared/src/data/mounts/*.json). The movement
 * speeds are read by stepCharacter on both the client (prediction) and the
 * server, so riding stays perfectly predicted.
 */
import horse from '../data/mounts/horse.json' with { type: 'json' };

export interface MountDefinition {
  id: string;
  name: string;
  /** Path under /assets/. */
  model: string;
  scale: number;
  walkSpeed: number;
  runSpeed: number;
  jumpSpeed: number;
  /** Where the rider sits (metres above the ground, forward offset) and its animation clip. */
  rider: { height: number; forward: number; animation: string };
  animations: { idle: string; walk: string; run: string; jump: string };
  animationSpeeds: { walk: number; run: number };
  sounds: { mount: string; dismount: string };
}

/** Index + 1 is the value synchronised in PlayerState.mount (0 = on foot). */
export const MOUNTS: readonly MountDefinition[] = [horse];

export function mountByIndex(mount: number | undefined): MountDefinition | undefined {
  return mount ? MOUNTS[mount - 1] : undefined;
}

/** Seconds between two mount / dismount requests. */
export const MOUNT_COOLDOWN = 1;
