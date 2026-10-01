/**
 * FRIENDS panel: my friend code, add a friend by code, pending requests
 * (accept / decline), friends with ONLINE / OFFLINE and JOIN.
 */
import type { FriendInfo, FriendRequest, FriendsInfo } from '@openworld/shared';
import type { AudioManager } from '../audio/AudioManager.ts';

export class FriendsPanel {
  private root = document.getElementById('friends-panel')!;
  private info: FriendsInfo = { myCode: '', friends: [] };

  constructor(private send: (r: FriendRequest) => void, private audio: AudioManager) {
    this.root.querySelector('.fp-close')!.addEventListener('click', () => this.toggle(false));
    const input = this.root.querySelector('.fp-input') as HTMLInputElement;
    const add = () => { const code = input.value.trim(); if (code) { this.audio.play('click'); this.send({ op: 'add', code }); input.value = ''; } };
    this.root.querySelector('.fp-add')!.addEventListener('click', add);
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') add(); if (e.key === 'Escape') this.toggle(false); });
    this.root.querySelector('.fp-copy')!.addEventListener('click', () => {
      void navigator.clipboard?.writeText(this.info.myCode).then(() => this.flash('Code copié !'), () => {});
    });
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  toggle(show = !this.visible): void {
    this.root.classList.toggle('hidden', !show);
    if (show) { if (document.pointerLockElement) document.exitPointerLock(); this.send({ op: 'list' }); this.render(); }
  }

  set(info: FriendsInfo): void {
    this.info = info;
    const pending = info.friends.filter((f) => f.status === 'incoming').length;
    const badge = document.querySelector('#btn-friends .badge') as HTMLElement | null;
    const btn = document.getElementById('btn-friends')!;
    if (pending && !badge) { const b = document.createElement('span'); b.className = 'badge'; btn.append(b); }
    const b2 = document.querySelector('#btn-friends .badge') as HTMLElement | null;
    if (b2) { if (pending) b2.textContent = String(pending); else b2.remove(); }
    if (this.visible) this.render();
  }

  flash(text: string, ok = true): void {
    const el = this.root.querySelector('.fp-feedback') as HTMLElement;
    el.textContent = text;
    el.className = `fp-feedback ${ok ? 'ok' : 'ko'}`;
  }

  private render(): void {
    (this.root.querySelector('.fp-code') as HTMLElement).textContent = this.info.myCode || '— (mode invité)';
    const list = this.root.querySelector('.fp-list') as HTMLElement;
    const rows = this.info.friends.map((f) => this.row(f));
    if (!rows.length) { const p = document.createElement('p'); p.className = 'fp-empty'; p.textContent = 'Partage ton code pour ajouter des amis.'; rows.push(p); }
    list.replaceChildren(...rows);
  }

  private row(f: FriendInfo): HTMLElement {
    const row = document.createElement('div');
    row.className = 'fp-row';
    const name = document.createElement('span');
    name.className = 'fp-name';
    name.textContent = f.name;
    const status = document.createElement('span');
    status.className = `fp-status ${f.status === 'friend' ? (f.online ? 'online' : 'offline') : 'pending'}`;
    status.textContent = f.status === 'incoming' ? 'veut être ton ami' : f.status === 'outgoing' ? 'demande envoyée' : f.online ? 'EN LIGNE' : 'HORS LIGNE';
    const btns = document.createElement('span');
    btns.className = 'fp-btns';
    const button = (label: string, op: FriendRequest['op'], cls = '') => {
      const b = document.createElement('button');
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener('click', () => { this.audio.play('click'); this.send({ op, code: f.code } as FriendRequest); if (op === 'join') this.toggle(false); });
      btns.append(b);
    };
    if (f.status === 'incoming') { button('Accepter', 'accept', 'primary'); button('Refuser', 'decline'); }
    else if (f.status === 'outgoing') button('Annuler', 'remove');
    else { if (f.online) button('REJOINDRE', 'join', 'primary'); button('✕', 'remove'); }
    row.append(name, status, btns);
    return row;
  }
}
