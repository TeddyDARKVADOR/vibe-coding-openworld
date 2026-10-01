/**
 * Social UI: name tags + chat bubbles above characters, chat box, player list.
 * Plain DOM; tags are positioned in 3D with three's CSS2DRenderer.
 */
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { CHAT_MAX_LENGTH } from '@openworld/shared';

const BUBBLE_MS = 7000;
/** Names are only shown up to this distance (bubbles a bit further). */
const NAME_DISTANCE = 70;
const BUBBLE_DISTANCE = 110;

export class NameTag {
  readonly object: CSS2DObject;
  private nameEl: HTMLDivElement;
  private bubbleEl: HTMLDivElement;
  private bubbleTimer = 0;
  private hpEl: HTMLDivElement;

  /** Health bar under the name (hidden while full). */
  setHp(hp: number, maxHp: number): void {
    const r = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
    this.hpEl.classList.toggle('hidden', r >= 0.999);
    const fill = this.hpEl.firstElementChild as HTMLElement;
    fill.style.width = `${Math.round(r * 100)}%`;
    fill.style.background = r > 0.5 ? '#5cd65c' : r > 0.25 ? '#f0c040' : '#e05050';
  }

  constructor(name: string, private showName = true) {
    const root = document.createElement('div');
    root.className = 'tag';
    this.bubbleEl = document.createElement('div');
    this.bubbleEl.className = 'tag-bubble hidden';
    this.nameEl = document.createElement('div');
    this.nameEl.className = 'tag-name';
    this.hpEl = document.createElement('div');
    this.hpEl.className = 'hpbar hidden';
    this.hpEl.append(document.createElement('div'));
    root.append(this.bubbleEl, this.nameEl, this.hpEl);
    this.object = new CSS2DObject(root);
    this.setName(name);
    this.nameEl.classList.toggle('hidden', !showName);
  }

  setName(name: string): void {
    this.nameEl.textContent = name; // textContent: player text is never interpreted as HTML
  }

  say(text: string): void {
    this.bubbleEl.textContent = text;
    this.bubbleEl.classList.remove('hidden');
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => this.bubbleEl.classList.add('hidden'), BUBBLE_MS);
  }

  /** Hide what is too far away to be readable. */
  updateDistance(d: number): void {
    this.nameEl.classList.toggle('hidden', !this.showName || d > NAME_DISTANCE);
    this.object.visible = d < BUBBLE_DISTANCE;
  }

  dispose(): void {
    clearTimeout(this.bubbleTimer);
    this.object.removeFromParent();
    this.object.element.remove();
  }
}

export class ChatBox {
  private root = document.getElementById('chat')!;
  private log = document.getElementById('chat-log')!;
  private input = document.getElementById('chat-input') as HTMLInputElement;
  isOpen = false;

  constructor(private onSend: (text: string) => void) {
    this.root.classList.remove('hidden');
    this.input.maxLength = CHAT_MAX_LENGTH;
    addEventListener('keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        if (!this.isOpen) { e.preventDefault(); this.open(); return; }
      }
    });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing never moves the character
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        const text = this.input.value.trim();
        if (text) this.onSend(text);
        this.close();
      } else if (e.code === 'Escape') {
        this.close();
      }
    });
    this.input.addEventListener('blur', () => this.close());
  }

  open(): void {
    this.isOpen = true;
    if (document.pointerLockElement) document.exitPointerLock();
    this.root.classList.add('open');
    this.input.classList.remove('hidden');
    this.input.value = '';
    this.input.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('open');
    this.input.classList.add('hidden');
    this.input.blur();
  }

  add(name: string, text: string, system = false): void {
    const line = document.createElement('div');
    line.className = 'chat-line';
    if (system) {
      line.textContent = text;
      line.style.fontStyle = 'italic';
    } else {
      const b = document.createElement('b');
      b.textContent = `${name} : `;
      line.append(b, document.createTextNode(text));
    }
    this.log.append(line);
    while (this.log.children.length > 8) this.log.firstElementChild!.remove();
    setTimeout(() => line.classList.add('fade'), 12000);
  }
}

export interface ListedPlayer {
  name: string;
  me: boolean;
  /** Distance in metres and compass direction from the local player. */
  distance: number;
  direction: string;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

/** Compass label from the local player towards (dx, dz). North = -Z. */
export function compass(dx: number, dz: number): string {
  const a = Math.atan2(dx, -dz); // 0 = north, clockwise
  return COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

export class PlayerList {
  private el = document.getElementById('players')!;

  set visible(v: boolean) {
    this.el.classList.toggle('hidden', !v);
  }

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }

  render(players: ListedPlayer[]): void {
    const h = document.createElement('h3');
    h.textContent = `Joueurs dans le monde : ${players.length}`;
    const rows = players
      .sort((a, b) => Number(b.me) - Number(a.me) || a.distance - b.distance)
      .map((p) => {
        const row = document.createElement('div');
        row.className = `row${p.me ? ' me' : ''}`;
        const n = document.createElement('span');
        n.textContent = p.me ? `${p.name} (toi)` : p.name;
        const d = document.createElement('span');
        d.textContent = p.me ? '' : `${formatDistance(p.distance)} ${p.direction}`;
        row.append(n, d);
        return row;
      });
    this.el.replaceChildren(h, ...rows);
  }
}
