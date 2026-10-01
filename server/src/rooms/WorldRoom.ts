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
  Anim, CHARACTERS, EMOTE_COUNT, MOUNTS, MOUNT_COOLDOWN, Emote, MsgType, PATCH_RATE, SPAWN_SPACING, TICK_DT, characterForSession, decodeInput,
  sanitizeChat, sanitizeName, type ChatMessage, type JoinOptions, type OwnProfile,
} from '@openworld/shared';
import { PlayerState, SummonState, WorldState } from './schema.ts';
import { SummonManager } from '../summons/SummonManager.ts';
import { CombatSystem } from '../combat/CombatSystem.ts';
import { FriendService } from '../friends/FriendService.ts';
import { ServerSimulation } from '../simulation/ServerSimulation.ts';
import { playerData, playerStore } from '../services.ts';
import { isValidPlayerId } from '../persistence/PlayerDataService.ts';
import type { PlayerData } from '../persistence/PlayerData.ts';

/** Positions are copied to the player data this often (written to disk by the store). */
const SAVE_EVERY_MS = 5000;

function parseSpawn(v: string | undefined): [number, number] {
  const [x, z] = (v ?? '').split(',').map(Number);
  return Number.isFinite(x) && Number.isFinite(z) ? [x, z] : [0, 0];
}

let rapierReady: Promise<void> | null = null;

/** Simulation cost, exposed on GET /stats (load tests, monitoring). */
export const serverStats = {
  ticks: 0, totalMs: 0, maxMs: 0, players: 0, summons: 0, sim: {} as Record<string, number>,
  reset() { this.ticks = 0; this.totalMs = 0; this.maxMs = 0; },
  get avgMs() { return this.ticks ? this.totalMs / this.ticks : 0; },
};

export class WorldRoom extends Room<{ state: WorldState }> {
  maxClients = 64;
  state = new WorldState();
  private sim!: ServerSimulation;
  private summonManager!: SummonManager;
  private combat!: CombatSystem;
  private friends!: FriendService;
  /** Test-only: DEBUG_SPAWN="x,z" moves the spawn area (e.g. to check very large coordinates). */
  private spawnCenter = parseSpawn(process.env.DEBUG_SPAWN);
  /** Anti-spam: time of the last chat message per session. */
  private lastChat = new Map<string, number>();
  /** Time of the last mount / dismount per session. */
  private lastMount = new Map<string, number>();
  private guestCount = 0;
  /** Persistent data of each connected session (guests have none). */
  private data = new Map<string, PlayerData>();
  private sessionOfPlayer = new Map<string, string>();

  async onCreate() {
    rapierReady ??= RAPIER.init();
    await rapierReady;
    this.autoDispose = false; // the world persists even when empty
    this.sim = new ServerSimulation(RAPIER);
    this.summonManager = new SummonManager({
      sim: this.sim,
      now: () => this.clock.currentTime / 1000,
      data: (id) => this.data.get(id),
      saveData: (d) => playerData.save(d),
      sendCollection: (id, info) => this.clients.find((c) => c.sessionId === id)?.send(MsgType.Collection, info),
    });
    this.setPatchRate(1000 / PATCH_RATE);
    this.setSimulationInterval(() => this.update(), TICK_DT * 1000);

    this.onMessage(MsgType.Input, (client, payload: unknown) => {
      const input = decodeInput(payload);
      if (input) this.sim.queueInput(client.sessionId, input);
    });

    this.combat = new CombatSystem({
      sim: this.sim,
      now: () => this.clock.currentTime / 1000,
      nameOf: (id) => this.state.players.get(id)?.name ?? '?',
      broadcastFx: (e) => this.broadcast(MsgType.AbilityFx, e),
      broadcastDamage: (e) => this.broadcast(MsgType.Damage, e),
      broadcastDeath: (e) => this.broadcast(MsgType.Death, e),
      respawn: (id) => this.respawn(id),
    }, this.summonManager);
    this.friends = new FriendService({
      store: playerStore,
      sessionOf: (pid) => this.sessionOfPlayer.get(pid),
      dataOf: (sid) => this.data.get(sid),
      save: (d) => playerData.save(d),
      sendFriends: (sid, info) => this.clients.find((c) => c.sessionId === sid)?.send(MsgType.Friends, info),
      feedback: (sid, fb) => this.clients.find((c) => c.sessionId === sid)?.send(MsgType.FriendFeedback, fb),
      joinable: (sid) => !!this.combat.players.get(sid) && !this.combat.players.get(sid)!.dead,
      moveNextTo: (sid, target) => this.moveNextTo(sid, target),
      now: () => this.clock.currentTime / 1000,
    });
    this.onMessage(MsgType.Friend, (client, req: unknown) => this.friends.handle(client.sessionId, req));
    this.onMessage(MsgType.Target, (client, ref: unknown) => this.combat.setTarget(client.sessionId, ref));
    this.onMessage(MsgType.Ability, (client, index: unknown) => this.combat.useAbility(client.sessionId, index));

    this.onMessage(MsgType.Summon, (client, req: unknown) => {
      if (!req || typeof req !== 'object') return;
      const r = req as { op?: unknown; id?: unknown };
      const sm = this.summonManager, id = client.sessionId;
      if (r.op === 'call') sm.call(id);
      else if (r.op === 'dismiss') sm.dismiss(id);
      else if (r.op === 'select' && typeof r.id === 'string') sm.select(id, r.id);
      else if (r.op === 'draw') sm.draw(id);
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

    this.onMessage(MsgType.Mount, (client, want: unknown) => this.setMount(client.sessionId, want));

    this.onMessage(MsgType.Emote, (client, payload: unknown) => {
      const ps = this.state.players.get(client.sessionId);
      const sp = this.sim.getPlayer(client.sessionId);
      if (!ps || !sp || typeof payload !== 'number' || !Number.isInteger(payload) || payload < 0 || payload >= EMOTE_COUNT) return;
      // Only while standing still (in the air the anim is Jump).
      ps.emote = sp.state.anim === Anim.Idle && !sp.state.mount ? payload : Emote.None;
    });
    this.clock.setInterval(() => this.saveAll(), SAVE_EVERY_MS);
    console.log('[world] room created');
  }

  onJoin(client: Client, options?: JoinOptions) {
    // Identity: stable playerId from the browser → saved data. Without one: guest (nothing saved).
    let data: PlayerData;
    if (isValidPlayerId(options?.playerId)) {
      const previous = this.sessionOfPlayer.get(options.playerId);
      if (previous) this.replaceSession(previous); // same player reconnecting (reload after a network cut, 2nd device)
      data = playerData.loadOrCreate(options.playerId).data;
      this.sessionOfPlayer.set(data.playerId, client.sessionId);
    } else {
      data = playerData.ephemeral(`guest_${client.sessionId}`);
    }
    this.data.set(client.sessionId, data);
    const persisted = !!data.friendCode;

    const saved = persisted ? playerData.restorablePosition(data) : null;
    const [sx, sz] = saved ? [saved.x, saved.z] : this.freeSpawnSlot();
    const p = this.sim.addPlayer(client.sessionId, sx, sz, saved ? saved.y + 0.05 : undefined);
    if (saved) p.state.yaw = data.lastRotation;
    const ps = new PlayerState();
    const c = options?.character;
    const validChar = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < CHARACTERS.length;
    ps.character = validChar(c) ? c : validChar(data.character) ? data.character : characterForSession(client.sessionId);
    ps.name = sanitizeName(options?.name) || (persisted ? data.displayName : '') || `Voyageur ${++this.guestCount}`;
    if (persisted) {
      data.displayName = ps.name;
      data.character = ps.character;
      playerData.save(data);
      const profile: OwnProfile = { friendCode: data.friendCode, displayName: data.displayName, restored: !!saved };
      client.send(MsgType.Profile, profile);
    }
    ps.emote = Emote.None;
    this.copy(p.state, ps, -1);
    this.state.players.set(client.sessionId, ps);
    this.combat.addPlayer(client.sessionId);
    if (persisted) { this.friends.sendList(client.sessionId); this.friends.playerOnlineChanged(data); }
    this.summonManager.sendCollection(client.sessionId);
    console.log(`[world] ${client.sessionId} "${ps.name}" joined as ${CHARACTERS[ps.character]} at (${p.state.x.toFixed(1)}, ${p.state.z.toFixed(1)})${saved ? ' (restored)' : ''} — ${this.clients.length} online`);
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
    if (!this.state.players.has(client.sessionId)) return; // already replaced by a newer session
    this.savePlayer(client.sessionId);
    this.summonManager.ownerLeft(client.sessionId);
    this.combat.removePlayer(client.sessionId);
    this.friends.left(client.sessionId);
    const leaving = this.data.get(client.sessionId);
    this.forget(client.sessionId);
    if (leaving?.friendCode) this.friends.playerOnlineChanged(leaving);
    this.sim.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.lastChat.delete(client.sessionId);
    this.lastMount.delete(client.sessionId);
    console.log(`[world] ${client.sessionId} left — ${this.clients.length} online`);
  }

  /** "Join a friend": the server picks a free spot a few metres from the friend. */
  private moveNextTo(sid: string, targetSid: string): boolean {
    const me = this.sim.getPlayer(sid), t = this.sim.getPlayer(targetSid);
    if (!me || !t) return false;
    const a = t.state.yaw + Math.PI * 0.75; // behind-left of the friend
    this.sim.teleport(me, t.state.x + Math.sin(a) * 3, t.state.z + Math.cos(a) * 3, t.state.y + 0.05);
    me.state.yaw = t.state.yaw;
    me.queue.length = 0; // inputs predicted at the old place are meaningless now
    return Math.hypot(me.state.x - t.state.x, me.state.z - t.state.z) < 15;
  }

  /**
   * Get on / off the mount. Everybody owns a horse; the server only checks the
   * request makes sense: alive, on the ground, not spamming.
   */
  private setMount(sid: string, want: unknown): void {
    const sp = this.sim.getPlayer(sid), ps = this.state.players.get(sid), pc = this.combat.players.get(sid);
    if (!sp || !ps || typeof want !== 'boolean') return;
    const now = this.clock.currentTime / 1000;
    if (now - (this.lastMount.get(sid) ?? -Infinity) < MOUNT_COOLDOWN) return;
    if (want === !!sp.state.mount) return;
    if (want && (!pc || pc.dead || (!sp.state.grounded && sp.state.vy !== 0))) return; // not mid-jump
    this.lastMount.set(sid, now);
    sp.state.mount = want ? MOUNTS.findIndex((m) => m.id === 'horse') + 1 : 0;
    ps.mount = sp.state.mount;
    ps.emote = Emote.None;
  }

  /** Back to the start area after being knocked out. */
  private respawn(id: string): void {
    const sp = this.sim.getPlayer(id);
    if (!sp) return;
    const [x, z] = this.freeSpawnSlot();
    this.sim.teleport(sp, x, z);
    sp.state.frozen = false;
    sp.state.vy = 0;
  }

  /** Copies the current position of a player into its persistent data. */
  private savePlayer(sessionId: string): void {
    const data = this.data.get(sessionId);
    const sp = this.sim.getPlayer(sessionId);
    if (data && sp) playerData.savePosition(data, sp.state.x, sp.state.y, sp.state.z, sp.state.yaw);
  }

  private saveAll(): void {
    for (const id of this.data.keys()) this.savePlayer(id);
  }

  private forget(sessionId: string): void {
    const data = this.data.get(sessionId);
    if (data && this.sessionOfPlayer.get(data.playerId) === sessionId) this.sessionOfPlayer.delete(data.playerId);
    this.data.delete(sessionId);
  }

  /** A player connected again while its previous session was still in the world: drop the old one. */
  private replaceSession(oldSessionId: string): void {
    this.savePlayer(oldSessionId);
    this.summonManager.ownerLeft(oldSessionId);
    this.combat.removePlayer(oldSessionId);
    this.forget(oldSessionId);
    this.sim.removePlayer(oldSessionId);
    this.state.players.delete(oldSessionId);
    this.lastChat.delete(oldSessionId);
    this.clients.find((c) => c.sessionId === oldSessionId)?.leave(4100, 'connected elsewhere');
  }

  private update() {
    const t0 = performance.now();
    this.tick();
    const ms = performance.now() - t0;
    serverStats.ticks++; serverStats.totalMs += ms; serverStats.maxMs = Math.max(serverStats.maxMs, ms);
    serverStats.players = this.state.players.size; serverStats.summons = this.state.summons.size; serverStats.sim = this.sim.stats;
  }

  private tick() {
    for (const [id, pc] of this.combat.players) {
      const sp = this.sim.getPlayer(id);
      if (!sp) continue;
      sp.state.frozen = pc.dead;
      if (pc.dead && sp.state.mount) sp.state.mount = 0; // knocked off the horse
    }
    this.sim.tick();
    this.summonManager.update(TICK_DT);
    this.combat.update(TICK_DT);
    for (const [id, ps] of this.state.players) {
      const sp = this.sim.getPlayer(id);
      if (sp) this.copy(sp.state, ps, sp.lastSeq);
      const pc = this.combat.players.get(id);
      if (pc) { ps.hp = Math.ceil(pc.hp); ps.dead = pc.dead; ps.hitSeq = pc.hitSeq; }
      if (sp) ps.mount = sp.state.mount ?? 0;
    }
    this.syncSummons();
  }

  /** Mirrors the live summons into the synchronised state. */
  private syncSummons() {
    const live = this.summonManager.summons;
    for (const id of [...this.state.summons.keys()]) if (!live.has(id)) this.state.summons.delete(id);
    for (const [id, e] of live) {
      let ss = this.state.summons.get(id);
      if (!ss) {
        ss = new SummonState();
        ss.ownerId = id;
        this.state.summons.set(id, ss);
      }
      if (ss.kind !== e.def.id) { ss.kind = e.def.id; ss.maxHp = e.def.stats.maxHp; }
      const b = e.body.state;
      ss.x = b.x; ss.y = b.y; ss.z = b.z; ss.yaw = b.yaw;
      ss.hp = Math.max(0, Math.ceil(e.hp));
      ss.mode = e.mode;
      ss.action = SummonManager.actionIndex(e.action);
      ss.actionSeq = e.actionSeq;
      ss.target = e.target;
    }
  }

  private copy(s: { x: number; y: number; z: number; yaw: number; vy: number; anim: number; grounded: boolean }, ps: PlayerState, ack: number) {
    ps.grounded = s.grounded;
    ps.x = s.x; ps.y = s.y; ps.z = s.z; ps.yaw = s.yaw; ps.vy = s.vy; ps.anim = s.anim;
    ps.ack = Math.max(0, ack);
    if (ps.emote !== Emote.None && s.anim !== Anim.Idle) ps.emote = Emote.None; // moving cancels the emote
  }
}
