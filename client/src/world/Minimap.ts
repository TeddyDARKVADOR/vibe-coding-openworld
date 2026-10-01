/**
 * Round minimap drawn from the chunks already loaded (same deterministic data
 * as the 3D world): water, roads, forests, mountains, buildings, and players.
 * The map turns with the camera (up = where you look). Players out of range
 * appear as arrows on the rim with their distance, so friends can find each
 * other in the huge world.
 */
import { CHUNK_SIZE, HEX_RADIUS, chunkCoord, chunkKey } from '@openworld/shared';
import type { WorldManager } from './WorldManager.ts';
import { formatDistance } from '../game/social.ts';

const RANGE = 170; // metres from centre to rim
const COLORS: [RegExp, string][] = [
  [/^hex_(water|river)/, '#4a9fe0'],
  [/^hex_road/, '#e2c49a'],
  [/^hex_coast/, '#e8d6a6'],
  [/^hex_grass/, '#b9cf55'],
  [/^building_bridge/, '#9a9a9a'],
  [/^building_grain/, '#e0b84a'],
  [/^building_/, '#c0563f'],
  [/^mountain_/, '#8e9196'],
  [/^hill/, '#93a34a'],
  [/^trees_/, '#2f7d4a'],
  [/^tree_single/, '#3f9a5a'],
];

export interface MinimapPlayer { name: string; x: number; z: number; me: boolean }

export class Minimap {
  private canvas = document.getElementById('minimap') as HTMLCanvasElement;
  private ctx = this.canvas.getContext('2d')!;
  private colorCache = new Map<string, string | null>();

  set visible(v: boolean) { this.canvas.classList.toggle('hidden', !v); }
  get visible(): boolean { return !this.canvas.classList.contains('hidden'); }

  private color(model: string): string | null {
    let c = this.colorCache.get(model);
    if (c === undefined) {
      c = COLORS.find(([re]) => re.test(model))?.[1] ?? null;
      this.colorCache.set(model, c);
    }
    return c;
  }

  draw(world: WorldManager, px: number, pz: number, yaw: number, facing: number, players: MinimapPlayer[]): void {
    const { ctx } = this;
    const W = this.canvas.width, R = W / 2, scale = R / RANGE;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx;
    const toScreen = (x: number, z: number): [number, number] => {
      const dx = x - px, dz = z - pz;
      return [R + (dx * rx + dz * rz) * scale, R - (dx * fx + dz * fz) * scale];
    };

    ctx.save();
    ctx.clearRect(0, 0, W, W);
    ctx.beginPath();
    ctx.arc(R, R, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#a8d8f0';
    ctx.fillRect(0, 0, W, W);

    // Terrain: ground tiles first, then objects on top.
    const r = Math.ceil(RANGE / CHUNK_SIZE) + 1;
    const cx = chunkCoord(px), cz = chunkCoord(pz);
    const tile = HEX_RADIUS * scale * 1.05;
    for (const pass of [0, 1]) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const chunk = world.getLoadedChunk(chunkKey(cx + dx, cz + dz));
        if (!chunk) continue;
        for (const p of chunk.placements) {
          const isTile = p.model.startsWith('hex_');
          if ((pass === 0) !== isTile) continue;
          const col = this.color(p.model);
          if (!col) continue;
          const [sx, sy] = toScreen(p.x, p.z);
          if (sx < -tile || sy < -tile || sx > W + tile || sy > W + tile) continue;
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(sx, sy, isTile ? tile : p.model.startsWith('tree_single') ? 1.5 : tile * 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Other players: dot in range, arrow + distance on the rim otherwise.
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const p of players) {
      if (p.me) continue;
      const [sx, sy] = toScreen(p.x, p.z);
      const vx = sx - R, vy = sy - R, d = Math.hypot(vx, vy);
      if (d < R - 8) {
        ctx.fillStyle = '#ffd23f';
        ctx.strokeStyle = '#333';
        ctx.beginPath(); ctx.arc(sx, sy, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.fillText(p.name, sx, sy - 7);
      } else {
        const ux = vx / d, uy = vy / d, ex = R + ux * (R - 10), ey = R + uy * (R - 10);
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(Math.atan2(uy, ux));
        ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#333';
        ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-5, -5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = '#fff';
        ctx.fillText(`${p.name} ${formatDistance(Math.hypot(p.x - px, p.z - pz))}`, R + ux * (R - 34), R + uy * (R - 34) + 3);
      }
    }

    // Me: arrow pointing where the character faces.
    // (model faces +Z when rotation.y = 0, i.e. direction (sin f, cos f))
    const [hx, hy] = toScreen(px + Math.sin(facing), pz + Math.cos(facing));
    ctx.translate(R, R);
    ctx.rotate(Math.atan2(hy - R, hx - R) + Math.PI / 2);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#d33';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 6); ctx.lineTo(0, 3); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();

    // North marker on the rim.
    const [nx, ny] = toScreen(px, pz - RANGE);
    const nd = Math.hypot(nx - R, ny - R);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText('N', R + ((nx - R) / nd) * (R - 9), R + ((ny - R) / nd) * (R - 9) + 4);
  }
}
