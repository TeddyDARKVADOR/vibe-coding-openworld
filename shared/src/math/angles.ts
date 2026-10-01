/**
 * Rotations used by world generation are multiples of 30°. Their sin/cos are
 * stored as literals so client and server compute identical collider poses
 * without relying on engine-specific Math.sin/Math.cos implementations.
 */
const S3 = 0.8660254037844386; // sqrt(3)/2

/** [cos, sin] of k * 30°, k = 0..11. */
export const ANGLE_TABLE: readonly (readonly [number, number])[] = [
  [1, 0], [S3, 0.5], [0.5, S3], [0, 1], [-0.5, S3], [-S3, 0.5],
  [-1, 0], [-S3, -0.5], [-0.5, -S3], [0, -1], [0.5, -S3], [S3, -0.5],
];

export function cos30(k: number): number {
  return ANGLE_TABLE[((k % 12) + 12) % 12][0];
}
export function sin30(k: number): number {
  return ANGLE_TABLE[((k % 12) + 12) % 12][1];
}

/**
 * Rotate a model-space XZ offset by k*30° about +Y, using three.js'
 * convention (rotation.y = θ maps (x, z) to (x cosθ + z sinθ, -x sinθ + z cosθ)).
 */
export function rotateXZ(x: number, z: number, k: number): [number, number] {
  const c = cos30(k), s = sin30(k);
  return [x * c + z * s, -x * s + z * c];
}

/** Quaternion {x,y,z,w} of a k*30° rotation about +Y. cos/sin of half angles (15° steps). */
const HALF: readonly (readonly [number, number])[] = (() => {
  // cos/sin of k*15° for k = 0..23, as exact literals.
  const c15 = 0.9659258262890683, s15 = 0.25881904510252074;
  const base: [number, number][] = [
    [1, 0], [c15, s15], [S3, 0.5], [0.7071067811865476, 0.7071067811865476], [0.5, S3], [s15, c15],
  ];
  const out: [number, number][] = [];
  for (let q = 0; q < 4; q++) {
    for (const [c, s] of base) {
      // rotate by q*90°: (c, s) -> (c*0 - s*1, ...)
      let cc = c, ss = s;
      for (let i = 0; i < q; i++) [cc, ss] = [-ss, cc];
      out.push([cc, ss]);
    }
  }
  return out;
})();

export function quatY30(k: number): { x: number; y: number; z: number; w: number } {
  const [c, s] = HALF[((k % 12) + 12) % 12];
  return { x: 0, y: s, z: 0, w: c };
}
