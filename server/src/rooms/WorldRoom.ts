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
  Anim, CHARACTERS, EMOTE_COUNT, Emote, MsgType, PATCH_RATE, SPAWN_SPACING, TICK_DT, characterForSession, decodeInput,
  sanitizeChat, sanitizeName, type ChatMessage, type JoinOptions,
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
  /** Anti-spam: time of the last chat message per session. */
  private lastChat = new Map<string, number>();
  private guestCount = 0;

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

    this.onMessage(MsgType.Chat, (client, payload: unknown) => {
      const text = sanitizeChat(payload);
      const ps = this.state.players.get(client.sessionId);
      if (!text || !ps) return;
      const now = Date.now();
      if (now - (this.lastChat.get(client.sessionId) ?? 0) < 600) return; // max ~1.5 msg/s
      this.lastChat.set(client.sessionId, now);
      const msg: ChatMessage = { id: client.sessionId, name: ps.name, text };
      this.broadcast(MsgType.Chat, msg);
    });

    this.onMessage(MsgType.Emote, (client, payload: unknown) => {
      const ps = this.state.players.get(client.sessionId);
      const sp = this.sim.getPlayer(client.sessionId);
      if (!ps || !sp || typeof payload !== 'number' || !Number.isInteger(payload) || payload < 0 || payload >= EMOTE_COUNT) return;
      // Only while standing still (in the air the anim is Jump).
      ps.emote = sp.state.anim === Anim.Idle ? payload : Emote.None;
    });
    console.log('[world] room created');
  }

  onJoin(client: Client, options?: JoinOptions) {
    const [sx, sz] = this.freeSpawnSlot();
    const p = this.sim.addPlayer(client.sessionId, sx, sz);
    const ps = new PlayerState();
    const c = options?.character;
    ps.character = typeof c === 'number' && Number.isInteger(c) && c >= 0 && c < CHARACTERS.length ? c : characterForSession(client.sessionId);
    ps.name = sanitizeName(options?.name) || `Voyageur ${++this.guestCount}`;
    ps.emote = Emote.None;
    this.copy(p.state, ps, -1);
    this.state.players.set(client.sessionId, ps);
    console.log(`[world] ${client.sessionId} "${ps.name}" joined as ${CHARACTERS[ps.character]} at (${sx}, ${sz}) — ${this.clients.length} online`);
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
    this.lastChat.delete(client.sessionId);
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
    if (ps.emote !== Emote.None && s.anim !== Anim.Idle) ps.emote = Emote.None; // moving cancels the emote
  }
}
