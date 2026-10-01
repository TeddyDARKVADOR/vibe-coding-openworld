/**
 * Process-wide singletons (one game server process = one world).
 * DATA_DIR (default server/data) holds the persistent JSON files.
 */
import path from 'node:path';
import { JsonPlayerStore } from './persistence/JsonPlayerStore.ts';
import { PlayerDataService } from './persistence/PlayerDataService.ts';
import { STARTER_SUMMONS } from '@openworld/shared';

const dataDir = process.env.DATA_DIR ?? path.resolve(import.meta.dirname, '../data');
export const playerStore = new JsonPlayerStore(path.join(dataDir, 'players.json'), Number(process.env.SAVE_INTERVAL_MS ?? 10_000));
export const playerData = new PlayerDataService(playerStore, STARTER_SUMMONS);

// Never lose the last positions on shutdown (Ctrl+C, tsx watch restart, kill).
process.on('exit', () => playerStore.flushSync());
