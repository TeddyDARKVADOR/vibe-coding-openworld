/**
 * Everything Colyseus-specific lives here. The rest of the game only sees
 * plain callbacks and plain objects.
 */
import { Client, type Room } from '@colyseus/sdk';
import type { NetSummon } from '../summons/SummonView.ts';
import { DEFAULT_SERVER_PORT, Emote, MsgType, ROOM_NAME, encodeInput, type AbilityEvent, type ChatMessage, type CollectionInfo, type DamageEvent, type DeathEvent, type FriendFeedback, type FriendRequest, type FriendsInfo, type JoinOptions, type OwnProfile, type PlayerInput, type SummonRequest } from '@openworld/shared';

export interface NetPlayer {
  id: string;
  x: number; y: number; z: number;
  yaw: number; anim: number; character: number; vy: number; ack: number; grounded: boolean;
  name: string; emote: Emote; hp: number; maxHp: number; dead: boolean; hitSeq: number;
}

export interface NetworkEvents {
  /** Called on every state patch with all players (receive time in ms). */
  onSnapshot(players: NetPlayer[], t: number, summons: NetSummon[]): void;
  onPlayerLeft(id: string): void;
  onConnectionChange(state: 'connected' | 'reconnecting' | 'lost' | 'replaced'): void;
  onChat(msg: ChatMessage): void;
  onProfile(p: OwnProfile): void;
  onCollection(c: CollectionInfo): void;
  onAbility(e: AbilityEvent): void;
  onDamage(e: DamageEvent): void;
  onDeath(e: DeathEvent): void;
  onFriends(f: FriendsInfo): void;
  onFriendFeedback(f: FriendFeedback): void;
}

export function serverUrl(): string {
  const param = new URLSearchParams(location.search).get('server');
  if (param) return param;
  if (import.meta.env.VITE_SERVER_URL) return import.meta.env.VITE_SERVER_URL as string;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // Dev: Vite on :5173, Colyseus on :2567. Production: the server also serves the page.
  return import.meta.env.DEV ? `${proto}://${location.hostname}:${DEFAULT_SERVER_PORT}` : `${proto}://${location.host}`;
}

export class NetworkManager {
  private room: Room | null = null;
  private known = new Set<string>();
  sessionId = '';
  /** Private profile (friend code...) received after joining. */
  profile: OwnProfile | null = null;
  ping = 0;

  constructor(private events: NetworkEvents) {}

  async connect(options: JoinOptions): Promise<void> {
    const client = new Client(serverUrl());
    const room = await client.joinOrCreate(ROOM_NAME, options);
    this.room = room;
    this.sessionId = room.sessionId;

    room.onStateChange((state: any) => {
      const t = performance.now();
      const list: NetPlayer[] = [];
      const seen = new Set<string>();
      state.players.forEach((p: any, id: string) => {
        seen.add(id);
        list.push({ id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, anim: p.anim, character: p.character, vy: p.vy, ack: p.ack, grounded: p.grounded, name: p.name ?? '', emote: p.emote ?? Emote.None, hp: p.hp ?? 100, maxHp: p.maxHp ?? 100, dead: !!p.dead, hitSeq: p.hitSeq ?? 0 });
      });
      for (const id of this.known) if (!seen.has(id)) this.events.onPlayerLeft(id);
      this.known = seen;
      const summons: NetSummon[] = [];
      state.summons?.forEach((s: any, id: string) => {
        summons.push({ ownerId: id, kind: s.kind, x: s.x, y: s.y, z: s.z, yaw: s.yaw, hp: s.hp, maxHp: s.maxHp, mode: s.mode, action: s.action, actionSeq: s.actionSeq, target: s.target ?? '' });
      });
      this.events.onSnapshot(list, t, summons);
    });
    room.onMessage(MsgType.Chat, (m: ChatMessage) => this.events.onChat(m));
    room.onMessage(MsgType.AbilityFx, (e: AbilityEvent) => this.events.onAbility(e));
    room.onMessage(MsgType.Damage, (e: DamageEvent) => this.events.onDamage(e));
    room.onMessage(MsgType.Death, (e: DeathEvent) => this.events.onDeath(e));
    room.onMessage(MsgType.Friends, (f: FriendsInfo) => this.events.onFriends(f));
    room.onMessage(MsgType.FriendFeedback, (f: FriendFeedback) => this.events.onFriendFeedback(f));
    room.onMessage(MsgType.Collection, (c: CollectionInfo) => this.events.onCollection(c));
    room.onMessage(MsgType.Profile, (p: OwnProfile) => { this.profile = p; this.events.onProfile(p); });
    room.onDrop(() => this.events.onConnectionChange('reconnecting'));
    room.onReconnect(() => this.events.onConnectionChange('connected'));
    room.onLeave((code) => this.events.onConnectionChange(code === 4100 ? 'replaced' : 'lost'));
    room.onError((code, message) => console.warn('[net] room error', code, message));

    // Closing the tab is a real departure: leave immediately instead of
    // waiting for the server-side reconnection window to expire.
    addEventListener('pagehide', () => { room.leave(true).catch(() => {}); });

    const measure = () => room.ping((ms) => { this.ping = ms; });
    measure();
    setInterval(measure, 2000);
  }

  sendInput(input: PlayerInput): void {
    this.room?.send(MsgType.Input, encodeInput(input));
  }

  sendChat(text: string): void {
    this.room?.send(MsgType.Chat, text);
  }

  sendSummon(req: SummonRequest): void {
    this.room?.send(MsgType.Summon, req);
  }

  sendFriend(r: FriendRequest): void {
    this.room?.send(MsgType.Friend, r);
  }

  sendTarget(ref: string): void {
    this.room?.send(MsgType.Target, ref);
  }

  sendAbility(index: number): void {
    this.room?.send(MsgType.Ability, index);
  }

  sendEmote(emote: Emote): void {
    this.room?.send(MsgType.Emote, emote);
  }
}
