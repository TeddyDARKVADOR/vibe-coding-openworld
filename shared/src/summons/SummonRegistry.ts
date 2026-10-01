/**
 * Summon definitions are data (shared/src/data/summons/*.json): adding a new
 * creature = download a model + write its JSON + add it to the list below.
 * Client and server read the same definitions.
 */
import yeti from '../data/summons/yeti.json' with { type: 'json' };
import demon from '../data/summons/demon.json' with { type: 'json' };
import mushroomKing from '../data/summons/mushroom-king.json' with { type: 'json' };
import dino from '../data/summons/dino.json' with { type: 'json' };
import orc from '../data/summons/orc.json' with { type: 'json' };
import alien from '../data/summons/alien.json' with { type: 'json' };
import dragon from '../data/summons/evolved-dragon.json' with { type: 'json' };

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type AbilityType = 'melee' | 'projectile' | 'aoe' | 'dash' | 'buff';
export type AbilityKey = 'M1' | 'Q' | 'E' | 'R';
export type BuffStat = 'attack' | 'defense' | 'speed';
/** Logical animation slots, mapped to real clip names per model in `animations`. */
export type AnimSlot = 'idle' | 'walk' | 'run' | 'attack' | 'special' | 'hit' | 'death' | 'spawn' | 'cheer';

export interface AbilityDefinition {
  id: string;
  name: string;
  key: AbilityKey;
  type: AbilityType;
  /** Seconds. */
  cooldown: number;
  /** Base damage (scaled by the attacker's attack stat). */
  damage?: number;
  /** Max distance to the target (melee / projectile / dash length). */
  range?: number;
  /** AoE radius around the summon. */
  radius?: number;
  projectileSpeed?: number;
  /** Buff: stat, amount (defense: flat points; attack/speed: +ratio), duration in seconds. */
  stat?: BuffStat;
  amount?: number;
  duration?: number;
  animation: AnimSlot;
  /** Names of client-side effects (see client/src/vfx and client/src/audio). */
  vfx: string;
  sound: string;
}

export interface SummonDefinition {
  id: string;
  name: string;
  rarity: Rarity;
  role: string;
  description: string;
  /** Path under /assets/. */
  model: string;
  scale: number;
  flying?: boolean;
  stats: { maxHp: number; speed: number; attack: number; defense: number };
  animations: Record<AnimSlot, string>;
  abilities: AbilityDefinition[];
}

const ALL = [yeti, demon, mushroomKing, dino, orc, alien, dragon] as unknown as SummonDefinition[];

const KEYS: AbilityKey[] = ['M1', 'Q', 'E', 'R'];
for (const d of ALL) {
  if (d.abilities.length > 4) throw new Error(`summon ${d.id}: max 4 abilities`);
  d.abilities.forEach((a, i) => {
    if (a.key !== KEYS[i]) throw new Error(`summon ${d.id}: ability ${i} must use key ${KEYS[i]}`);
    if (!['melee', 'projectile', 'aoe', 'dash', 'buff'].includes(a.type)) throw new Error(`summon ${d.id}: bad ability type ${a.type}`);
  });
}

export const SUMMONS: ReadonlyMap<string, SummonDefinition> = new Map(ALL.map((d) => [d.id, d]));
export const SUMMON_IDS = ALL.map((d) => d.id);

export function getSummon(id: string): SummonDefinition | undefined {
  return SUMMONS.get(id);
}

/** Free summon draw weights. */
export const RARITY_WEIGHTS: Record<Rarity, number> = { common: 60, rare: 28, epic: 9, legendary: 3 };
export const RARITY_LABELS: Record<Rarity, string> = { common: 'Commun', rare: 'Rare', epic: 'Épique', legendary: 'Légendaire' };
/** Free summons per player per day (no money anywhere: everything is free). */
export const FREE_SUMMONS_PER_DAY = 5;

/** Weighted random pick; `rand` in [0, 1). */
export function drawSummon(rand: number): SummonDefinition {
  const total = ALL.reduce((s, d) => s + RARITY_WEIGHTS[d.rarity], 0);
  let r = rand * total;
  for (const d of ALL) {
    r -= RARITY_WEIGHTS[d.rarity];
    if (r < 0) return d;
  }
  return ALL[ALL.length - 1];
}
