/**
 * Friends: add by friend code, accept / decline, remove, online status, and
 * "join a friend" (the server decides where you appear, next to your friend,
 * in the same single world). Relations are stored in PlayerData (playerIds),
 * but clients only ever see public friend codes and names.
 */
import { FRIEND_CODE_RE, JOIN_FRIEND_COOLDOWN, MAX_FRIENDS, type FriendFeedback, type FriendInfo, type FriendsInfo } from '@openworld/shared';
import type { PlayerData, PlayerDataStore } from '../persistence/PlayerData.ts';

export interface FriendHost {
  store: PlayerDataStore;
  /** Online session of a playerId, if connected. */
  sessionOf(playerId: string): string | undefined;
  /** Data of a connected session. */
  dataOf(sessionId: string): PlayerData | undefined;
  save(data: PlayerData): void;
  sendFriends(sessionId: string, info: FriendsInfo): void;
  feedback(sessionId: string, fb: FriendFeedback): void;
  /** Can this player be joined right now (alive...)? */
  joinable(sessionId: string): boolean;
  /** Teleports `sessionId` next to `targetSessionId`; false if no safe spot. */
  moveNextTo(sessionId: string, targetSessionId: string): boolean;
  now(): number;
}

export class FriendService {
  private lastJoin = new Map<string, number>();

  constructor(private host: FriendHost) {}

  handle(sessionId: string, req: unknown): void {
    const me = this.host.dataOf(sessionId);
    if (!me || !req || typeof req !== 'object') return;
    if (!me.friendCode) return this.host.feedback(sessionId, { ok: false, text: 'Les amis ne sont pas disponibles en mode invité.' });
    const r = req as { op?: unknown; code?: unknown };
    const code = typeof r.code === 'string' ? r.code.trim().toUpperCase() : '';
    switch (r.op) {
      case 'list': return this.sendList(sessionId);
      case 'add': return this.add(sessionId, me, code);
      case 'accept': return this.accept(sessionId, me, code);
      case 'decline': return this.drop(sessionId, me, code, 'Demande refusée.');
      case 'remove': return this.drop(sessionId, me, code, 'Ami retiré.');
      case 'join': return this.join(sessionId, me, code);
    }
  }

  private other(code: string): PlayerData | undefined {
    return FRIEND_CODE_RE.test(code) ? this.host.store.findByFriendCode(code) : undefined;
  }

  private add(sid: string, me: PlayerData, code: string): void {
    const other = this.other(code);
    if (!other) return this.host.feedback(sid, { ok: false, text: `Aucun joueur avec le code ${code || '(vide)'}.` });
    if (other.playerId === me.playerId) return this.host.feedback(sid, { ok: false, text: "C'est ton propre code !" });
    if (me.friends.includes(other.playerId)) return this.host.feedback(sid, { ok: false, text: `${other.displayName} est déjà ton ami.` });
    if (me.friends.length >= MAX_FRIENDS) return this.host.feedback(sid, { ok: false, text: "Liste d'amis pleine." });
    // They already asked me → accept directly.
    if (me.incomingRequests.includes(other.playerId)) return this.accept(sid, me, code);
    if (!me.outgoingRequests.includes(other.playerId)) me.outgoingRequests.push(other.playerId);
    if (!other.incomingRequests.includes(me.playerId)) other.incomingRequests.push(me.playerId);
    other.incomingRequests = other.incomingRequests.slice(-MAX_FRIENDS);
    this.host.save(me); this.host.save(other);
    this.host.feedback(sid, { ok: true, text: `Demande envoyée à ${other.displayName}.` });
    this.notify(me.playerId); this.notify(other.playerId);
    const os = this.host.sessionOf(other.playerId);
    if (os) this.host.feedback(os, { ok: true, text: `${me.displayName} veut devenir ton ami.` });
  }

  private accept(sid: string, me: PlayerData, code: string): void {
    const other = this.other(code);
    if (!other || !me.incomingRequests.includes(other.playerId)) return this.host.feedback(sid, { ok: false, text: 'Pas de demande de ce joueur.' });
    me.incomingRequests = me.incomingRequests.filter((id) => id !== other.playerId);
    other.outgoingRequests = other.outgoingRequests.filter((id) => id !== me.playerId);
    if (!me.friends.includes(other.playerId)) me.friends.push(other.playerId);
    if (!other.friends.includes(me.playerId)) other.friends.push(me.playerId);
    this.host.save(me); this.host.save(other);
    this.host.feedback(sid, { ok: true, text: `${other.displayName} est maintenant ton ami.` });
    this.notify(me.playerId); this.notify(other.playerId);
    const os = this.host.sessionOf(other.playerId);
    if (os) this.host.feedback(os, { ok: true, text: `${me.displayName} a accepté ta demande.` });
  }

  /** Decline a request, cancel mine, or remove a friend: the relation disappears on both sides. */
  private drop(sid: string, me: PlayerData, code: string, text: string): void {
    const other = this.other(code);
    if (!other) return;
    const strip = (d: PlayerData, id: string) => {
      d.friends = d.friends.filter((x) => x !== id);
      d.incomingRequests = d.incomingRequests.filter((x) => x !== id);
      d.outgoingRequests = d.outgoingRequests.filter((x) => x !== id);
    };
    strip(me, other.playerId); strip(other, me.playerId);
    this.host.save(me); this.host.save(other);
    this.host.feedback(sid, { ok: true, text });
    this.notify(me.playerId); this.notify(other.playerId);
  }

  private join(sid: string, me: PlayerData, code: string): void {
    const other = this.other(code);
    if (!other || !me.friends.includes(other.playerId) || !other.friends.includes(me.playerId)) {
      return this.host.feedback(sid, { ok: false, text: "Tu ne peux rejoindre que tes amis." });
    }
    const target = this.host.sessionOf(other.playerId);
    if (!target) return this.host.feedback(sid, { ok: false, text: `${other.displayName} n'est pas en ligne.` });
    const now = this.host.now();
    const last = this.lastJoin.get(sid) ?? -Infinity;
    if (now - last < JOIN_FRIEND_COOLDOWN) return this.host.feedback(sid, { ok: false, text: `Attends ${Math.ceil(JOIN_FRIEND_COOLDOWN - (now - last))} s.` });
    if (!this.host.joinable(sid) || !this.host.joinable(target)) return this.host.feedback(sid, { ok: false, text: 'Impossible pour le moment (K.O.).' });
    if (!this.host.moveNextTo(sid, target)) return this.host.feedback(sid, { ok: false, text: 'Aucune place sûre près de ton ami.' });
    this.lastJoin.set(sid, now);
    this.host.feedback(sid, { ok: true, text: `Tu as rejoint ${other.displayName} !` });
    this.host.feedback(target, { ok: true, text: `${me.displayName} vient de te rejoindre.` });
  }

  /** Online status changed or relations changed: refresh the lists of everyone concerned. */
  playerOnlineChanged(data: PlayerData): void {
    for (const id of [...data.friends, ...data.incomingRequests, ...data.outgoingRequests]) this.notify(id);
  }

  sendList(sid: string): void {
    const me = this.host.dataOf(sid);
    if (!me || !me.friendCode) return;
    const info = (id: string, status: FriendInfo['status']): FriendInfo | null => {
      const d = this.host.store.get(id);
      if (!d) return null;
      const online = !!this.host.sessionOf(id);
      return { code: d.friendCode, name: d.displayName, status, online, ...(status === 'friend' ? { lastSeen: d.lastSeen } : {}) };
    };
    const friends = [
      ...me.incomingRequests.map((id) => info(id, 'incoming')),
      ...me.friends.map((id) => info(id, 'friend')),
      ...me.outgoingRequests.map((id) => info(id, 'outgoing')),
    ].filter((f): f is FriendInfo => !!f);
    this.host.sendFriends(sid, { myCode: me.friendCode, friends });
  }

  private notify(playerId: string): void {
    const sid = this.host.sessionOf(playerId);
    if (sid) this.sendList(sid);
  }

  left(sid: string): void {
    this.lastJoin.delete(sid);
  }
}
