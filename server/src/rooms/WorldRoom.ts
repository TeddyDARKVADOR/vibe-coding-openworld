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

let rapierReady: Promise<void> | null = null;

export class WorldRoom extends Room<{ state: WorldState }> {
  maxClients = 64;
  state = new WorldState();
  private sim!: ServerSimulation;
  private joinCount = 0;

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
    // Spawn slots around the origin: 0, +3, -3, +6, -6 ... metres on X.
    const slot = this.joinCount++ % 16;
    const offset = Math.ceil(slot / 2) * SPAWN_SPACING * (slot % 2 ? 1 : -1);
    const p = this.sim.addPlayer(client.sessionId, offset, 0);
    const ps = new PlayerState();
    ps.character = characterForSession(client.sessionId);
    this.copy(p.state, ps, -1);
    this.state.players.set(client.sessionId, ps);
    console.log(`[world] ${client.sessionId} joined as ${CHARACTERS[ps.character]} at (${offset}, 0) — ${this.clients.length} online`);
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

  private copy(s: { x: number; y: number; z: number; yaw: number; vy: number; anim: number }, ps: PlayerState, ack: number) {
    ps.x = s.x; ps.y = s.y; ps.z = s.z; ps.yaw = s.yaw; ps.vy = s.vy; ps.anim = s.anim;
    ps.ack = Math.max(0, ack);
  }
}
