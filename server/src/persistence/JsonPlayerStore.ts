/**
 * PlayerDataStore backed by a single JSON file, kept in memory and written
 * atomically (temp file + rename) at most every `intervalMs`. Plenty for a
 * single-process prototype with a few hundred players.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { PlayerData, PlayerDataStore } from './PlayerData.ts';

export class JsonPlayerStore implements PlayerDataStore {
  private players = new Map<string, PlayerData>();
  private byCode = new Map<string, string>();
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> | null = null;

  constructor(private file: string, intervalMs = 10_000) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      try {
        const list = JSON.parse(fs.readFileSync(file, 'utf8')) as PlayerData[];
        for (const p of list) this.index(p);
        console.log(`[persistence] ${this.players.size} players loaded from ${file}`);
      } catch (e) {
        const backup = `${file}.corrupt-${Date.now()}`;
        fs.renameSync(file, backup);
        console.error(`[persistence] could not read ${file} (${(e as Error).message}); moved to ${backup}`);
      }
    }
    if (intervalMs > 0) {
      this.timer = setInterval(() => { void this.flush(); }, intervalMs);
      this.timer.unref();
    }
  }

  private index(p: PlayerData): void {
    this.players.set(p.playerId, p);
    this.byCode.set(p.friendCode, p.playerId);
  }

  get(playerId: string): PlayerData | undefined {
    return this.players.get(playerId);
  }

  findByFriendCode(code: string): PlayerData | undefined {
    const id = this.byCode.get(code.trim().toUpperCase());
    return id ? this.players.get(id) : undefined;
  }

  put(data: PlayerData): void {
    this.index(data);
    this.dirty = true;
  }

  async flush(): Promise<void> {
    if (this.writing) await this.writing;
    if (!this.dirty) return;
    this.dirty = false;
    const json = JSON.stringify([...this.players.values()]);
    const tmp = `${this.file}.tmp`;
    this.writing = fs.promises.writeFile(tmp, json).then(() => fs.promises.rename(tmp, this.file)).catch((e) => {
      this.dirty = true;
      console.error('[persistence] write failed', e);
    }).finally(() => { this.writing = null; });
    await this.writing;
  }

  flushSync(): void {
    if (!this.dirty) return;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify([...this.players.values()]));
    fs.renameSync(tmp, this.file);
    this.dirty = false;
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.flushSync();
  }
}
