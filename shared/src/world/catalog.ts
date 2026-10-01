/**
 * Environment model catalogue: which simple collider each KayKit model gets.
 *
 * Visual = detailed KayKit model, physics = one simple shape (box, cylinder or
 * reduced convex hull) derived from the model's bounds, computed offline by
 * scripts/prepare-assets.mjs (assetBounds.generated.ts).
 */
import { ASSET_BOUNDS } from './assetBounds.generated.ts';
import { rotateXZ } from '../math/angles.ts';

export type ColliderKind =
  | { kind: 'none' }
  | { kind: 'box'; shrink: number }
  | { kind: 'cylinder'; radiusFactor: number }
  | { kind: 'hull' };

const NONE: ColliderKind = { kind: 'none' };

export function colliderKindFor(model: string): ColliderKind {
  if (model.startsWith('hex_')) return NONE; // ground handled globally, water by chunk generator
  if (model.startsWith('building_grain')) return { kind: 'box', shrink: 0.95 }; // raised crop field (2.3 m)
  if (model.startsWith('building_well')) return { kind: 'cylinder', radiusFactor: 0.85 };
  if (model.startsWith('building_windmill')) return { kind: 'box', shrink: 0.7 };
  if (model.startsWith('building_bridge')) return { kind: 'hull' };
  if (model.startsWith('building_')) return { kind: 'box', shrink: 0.92 };
  if (model.startsWith('fence_')) return { kind: 'box', shrink: 1 };
  if (model.startsWith('mountain_') || model.startsWith('hill')) return { kind: 'hull' };
  if (model.startsWith('rock_single')) return { kind: 'hull' };
  if (/^trees_[AB]_(small|medium|large)$/.test(model)) return { kind: 'cylinder', radiusFactor: 0.62 };
  if (model.startsWith('tree_single')) return { kind: 'cylinder', radiusFactor: 0.3 };
  if (model === 'barrel' || model.startsWith('flag_')) return { kind: 'cylinder', radiusFactor: 0.9 };
  if (/^(crate_|sack|tent|wheelbarrow|resource_)/.test(model)) return { kind: 'box', shrink: 0.95 };
  return NONE; // clouds, water plants, pallets, buckets...
}

export interface Placement {
  model: string;
  x: number;
  y: number;
  z: number;
  /** Rotation about +Y in multiples of 30°. */
  rot30: number;
  scale: number;
}

export type ColliderSpec = (
  | { shape: 'cuboid'; x: number; y: number; z: number; rot30: number; hx: number; hy: number; hz: number }
  | { shape: 'cylinder'; x: number; y: number; z: number; halfHeight: number; radius: number }
  | { shape: 'hull'; x: number; y: number; z: number; rot30: number; points: number[] }
) & {
  /** Only stops the camera (e.g. tree foliage), never characters. */
  cameraOnly?: boolean;
};

/**
 * Camera-only collider for foliage, so the third-person camera doesn't end
 * up inside a tree crown. Characters walk under/through it.
 */
export function cameraColliderForPlacement(p: Placement): ColliderSpec | null {
  if (!p.model.startsWith('tree') && !/^(hills|mountain)_.*trees$/.test(p.model)) return null;
  const b = ASSET_BOUNDS[p.model];
  if (!b) return null;
  const s = p.scale;
  const hx = ((b.max[0] - b.min[0]) / 2) * s, hz = ((b.max[2] - b.min[2]) / 2) * s;
  const y1 = b.max[1] * s, y0 = y1 * 0.3;
  const cx = ((b.min[0] + b.max[0]) / 2) * s, cz = ((b.min[2] + b.max[2]) / 2) * s;
  const [ox, oz] = rotateXZ(cx, cz, p.rot30);
  return {
    shape: 'cylinder', x: p.x + ox, y: p.y + (y0 + y1) / 2, z: p.z + oz,
    halfHeight: (y1 - y0) / 2, radius: Math.min(hx, hz) * 0.85, cameraOnly: true,
  };
}

/** Simple collider of a placed model, or null if it should not block characters. */
export function colliderForPlacement(p: Placement): ColliderSpec | null {
  const kind = colliderKindFor(p.model);
  if (kind.kind === 'none') return null;
  const b = ASSET_BOUNDS[p.model];
  if (!b) throw new Error(`No bounds for model ${p.model} (run npm run assets:prepare)`);
  const s = p.scale;
  if (kind.kind === 'hull') {
    const points: number[] = [];
    for (const [x, y, z] of b.hull) points.push(x * s, y * s, z * s);
    return { shape: 'hull', x: p.x, y: p.y, z: p.z, rot30: p.rot30, points };
  }
  const cx = ((b.min[0] + b.max[0]) / 2) * s, cz = ((b.min[2] + b.max[2]) / 2) * s;
  const hx = ((b.max[0] - b.min[0]) / 2) * s, hz = ((b.max[2] - b.min[2]) / 2) * s;
  const y0 = Math.max(0, b.min[1]) * s, y1 = b.max[1] * s;
  const [ox, oz] = rotateXZ(cx, cz, p.rot30);
  if (kind.kind === 'box') {
    return {
      shape: 'cuboid', x: p.x + ox, y: p.y + (y0 + y1) / 2, z: p.z + oz, rot30: p.rot30,
      hx: hx * kind.shrink, hy: (y1 - y0) / 2, hz: hz * kind.shrink,
    };
  }
  return {
    shape: 'cylinder', x: p.x + ox, y: p.y + (y0 + y1) / 2, z: p.z + oz,
    halfHeight: (y1 - y0) / 2, radius: Math.min(hx, hz) * kind.radiusFactor,
  };
}
