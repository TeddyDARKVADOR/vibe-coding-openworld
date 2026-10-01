/** Noise seeds of large-scale world features, shared by chunk generation and POI placement. */
import { WORLD_SEED } from '../constants.ts';
import { hashInts, hashString } from '../math/rng.ts';

export const SEED = hashString(WORLD_SEED);
export const NOISE = {
  lake: hashInts(SEED, 201),
  mountain: hashInts(SEED, 202),
  forest: hashInts(SEED, 203),
  village: hashInts(SEED, 204),
  poi: hashInts(SEED, 205),
};

/** Hexes within this distance of a village centre (road crossing) belong to the village. */
export const VILLAGE_RADIUS = 3;
/** Probability that a (non-spawn) road crossing hosts a village. */
export const VILLAGE_CHANCE = 0.6;
/** Noise thresholds shared by chunkgen and POI validation. */
export const LAKE_THRESHOLD = 0.7;
export const HILL_THRESHOLD = 0.62;
