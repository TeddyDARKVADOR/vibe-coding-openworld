/**
 * The single shared world room. Every player joins this room, so everybody
 * shares the same seed, the same global coordinates and sees each other.
 *
 * Authoritative loop: clients send inputs (direction / run / jump) only; the
 * server simulates movement with Rapier and synchronises the result.
 *
 * Interest management: for now every client receives every player (target:
 * 10–20 players). A spatial filter (Colyseus StateView + a grid of chunks)
 * can later restrict each client to nearby players without touching the
 * simulation.
 */
import { Room, type Client } from 'colyseus';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  CHARACTERS, MsgType, PATCH_RATE, SPAWN_SPACING, TICK_DT, characterForSession, decodeInput,
} from '@openworld/shared';
import { PlayerState, WorldState } from './schema.ts';
import { ServerSimulation } from '../simulation/ServerSimulation.ts';

function parseSpawn(v: string | undefined): [number, number] {
  const [x, z] = (v ?? '').split(',').map(Number);
  return Number.isFinite(x) && Number.isFinite(z) ? [x, z] : [0, 0];
}

let rapierReady: Promise<void> | null = null;

export class WorldRoom extends Room<{ state: WorldState }> {
  maxClients = 64;
  state = new WorldState();
  private sim!: ServerSimulation;
  /** Test-only: DEBUG_SPAWN="x,z" moves the spawn area (e.g. to check very large coordinates). */
  private spawnCenter = parseSpawn(process.env.DEBUG_SPAWN);

  async onCreate() {
    rapierReady ??= RAPIER.init();
    await rapierReady;
    this.autoDispose = false; // the world persists even when empty
    this.sim = new ServerSimulation(RAPIER);
    this.setPatchRate(1000 / PATCH_RATE);
    this.setSimulationInterval(() => this.update(), TICK_DT * 1000);

    this.onMessage(MsgType.Input, (client, payload: unknown) => {
      const input = decodeInput(payload);
      if (input) this.sim.queueInput(client.sessionId, input);
    });
    console.log('[world] room created');
  }

  onJoin(client: Client) {
    const [sx, sz] = this.freeSpawnSlot();
    const p = this.sim.addPlayer(client.sessionId, sx, sz);
    const ps = new PlayerState();
    ps.character = characterForSession(client.sessionId);
    this.copy(p.state, ps, -1);
    this.state.players.set(client.sessionId, ps);
    console.log(`[world] ${client.sessionId} joined as ${CHARACTERS[ps.character]} at (${sx}, ${sz}) — ${this.clients.length} online`);
  }

  /** Spawn slots side by side around the origin: 0, +3, -3, +6, -6 ... m on X; first one nobody stands on. */
  private freeSpawnSlot(): [number, number] {
    const [cx, cz] = this.spawnCenter;
    for (let slot = 0; ; slot++) {
      const x = cx + Math.ceil(slot / 2) * SPAWN_SPACING * (slot % 2 ? 1 : -1);
      let free = true;
      this.state.players.forEach((p) => { if (Math.hypot(p.x - x, p.z - cz) < SPAWN_SPACING / 2) free = false; });
      if (free || slot > 32) return [x, cz];
    }
  }

  /** Unexpected disconnection: keep the character in the world for a few seconds so the client can reconnect. */
  onDrop(client: Client) {
    console.log(`[world] ${client.sessionId} dropped, waiting for reconnection`);
    this.allowReconnection(client, 20);
  }

  onReconnect(client: Client) {
    console.log(`[world] ${client.sessionId} reconnected`);
  }

  onLeave(client: Client) {
    this.sim.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);
    console.log(`[world] ${client.sessionId} left — ${this.clients.length} online`);
  }

  private update() {
    this.sim.tick();
    for (const [id, ps] of this.state.players) {
      const sp = this.sim.getPlayer(id);
      if (sp) this.copy(sp.state, ps, sp.lastSeq);
    }
  }

  private copy(s: { x: number; y: number; z: number; yaw: number; vy: number; anim: number; grounded: boolean }, ps: PlayerState, ack: number) {
    ps.grounded = s.grounded;
    ps.x = s.x; ps.y = s.y; ps.z = s.z; ps.yaw = s.yaw; ps.vy = s.vy; ps.anim = s.anim;
    ps.ack = Math.max(0, ack);
  }
}
