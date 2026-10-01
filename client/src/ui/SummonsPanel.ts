/**
 * SUMMONS panel: collection (owned / locked), inspect a creature (3D preview,
 * role, stats, abilities), choose it, call / dismiss it, and the free random
 * summon. Everything is free — no shop, no currency.
 */
import { RARITY_LABELS, SUMMON_IDS, getSummon, type CollectionInfo } from '@openworld/shared';
import type { AssetLibrary } from '../assets/AssetLibrary.ts';
import type { AudioManager } from '../audio/AudioManager.ts';
import { ModelPreview } from './ModelPreview.ts';

export interface SummonsPanelActions {
  select(id: string): void;
  call(): void;
  dismiss(): void;
  draw(): void;
  isOut(): boolean;
}

const TYPE_LABEL: Record<string, string> = { melee: 'mêlée', projectile: 'projectile', aoe: 'zone', dash: 'ruée', buff: 'bonus' };

export class SummonsPanel {
  private root = document.getElementById('summons-panel')!;
  private grid = this.root.querySelector('.sp-grid') as HTMLDivElement;
  private info = this.root.querySelector('.sp-info') as HTMLDivElement;
  private preview = new ModelPreview(this.root.querySelector('canvas.sp-preview') as HTMLCanvasElement);
  private collection: CollectionInfo = { owned: [], active: null, freeLeft: 0 };
  private selected: string | null = null;

  constructor(private assets: AssetLibrary, private audio: AudioManager, private actions: SummonsPanelActions) {
    this.root.querySelector('.sp-close')!.addEventListener('click', () => this.toggle(false));
    this.root.querySelector('.sp-draw')!.addEventListener('click', () => { this.audio.play('click'); this.actions.draw(); });
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  toggle(show = !this.visible): void {
    this.root.classList.toggle('hidden', !show);
    if (show) { if (document.pointerLockElement) document.exitPointerLock(); this.render(); this.preview.start(); }
    else this.preview.stop();
  }

  setCollection(c: CollectionInfo): void {
    this.collection = c;
    if (c.draw) this.reveal(c.draw.id, c.draw.isNew);
    if (this.visible) this.render();
  }

  get data(): CollectionInfo {
    return this.collection;
  }

  private reveal(id: string, isNew: boolean): void {
    const def = getSummon(id);
    if (!def) return;
    this.selected = id;
    this.audio.play('unlock');
    const banner = this.root.querySelector('.sp-reveal') as HTMLDivElement;
    banner.textContent = `${isNew ? 'Nouvelle créature !' : 'Déjà dans ta collection :'} ${def.name} (${RARITY_LABELS[def.rarity]})`;
    banner.className = `sp-reveal rarity-${def.rarity}`;
    if (!this.visible) this.toggle(true);
    this.render();
    setTimeout(() => this.preview.play(def.animations.cheer), 300);
  }

  render(): void {
    const c = this.collection;
    this.selected ??= c.active ?? SUMMON_IDS[0];
    (this.root.querySelector('.sp-draw') as HTMLButtonElement).textContent = `Invocation gratuite (${c.freeLeft} aujourd'hui)`;
    (this.root.querySelector('.sp-draw') as HTMLButtonElement).disabled = c.freeLeft <= 0;
    this.grid.replaceChildren(...SUMMON_IDS.map((id) => {
      const def = getSummon(id)!;
      const owned = c.owned.includes(id);
      const card = document.createElement('button');
      card.className = `sp-card rarity-${def.rarity}${owned ? '' : ' locked'}${id === this.selected ? ' selected' : ''}${id === c.active ? ' active' : ''}`;
      const name = document.createElement('span');
      name.textContent = owned ? def.name : '???';
      const r = document.createElement('small');
      r.textContent = owned ? RARITY_LABELS[def.rarity] : 'Verrouillée';
      card.append(name, r);
      card.addEventListener('click', () => { this.audio.play('click'); this.selected = id; this.render(); });
      return card;
    }));
    this.renderInfo();
  }

  private renderInfo(): void {
    const id = this.selected!;
    const def = getSummon(id)!;
    const owned = this.collection.owned.includes(id);
    const el = (tag: string, text: string, cls = '') => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e; };
    const children: HTMLElement[] = [
      el('h3', owned ? def.name : 'Créature inconnue'),
      el('div', owned ? `${RARITY_LABELS[def.rarity]} · ${def.role}` : 'Obtiens-la avec une invocation gratuite.', `sp-rarity rarity-${def.rarity}`),
    ];
    if (owned) {
      children.push(el('p', def.description));
      const s = def.stats;
      children.push(el('div', `PV ${s.maxHp} · Attaque ${s.attack} · Défense ${s.defense} · Vitesse ${s.speed}`, 'sp-stats'));
      const list = document.createElement('ul');
      for (const a of def.abilities) list.append(el('li', `[${a.key === 'M1' ? 'Clic' : a.key}] ${a.name} — ${TYPE_LABEL[a.type]}, ${a.cooldown}s`));
      children.push(list);
      const buttons = document.createElement('div');
      buttons.className = 'sp-buttons';
      const isActive = this.collection.active === id;
      const choose = el('button', isActive ? 'Choisie ✓' : 'Choisir') as HTMLButtonElement;
      choose.disabled = isActive;
      choose.addEventListener('click', () => { this.audio.play('click'); this.actions.select(id); });
      const out = this.actions.isOut();
      const callBtn = el('button', isActive && out ? 'Rappeler (X)' : 'Invoquer (X)') as HTMLButtonElement;
      callBtn.className = 'primary';
      callBtn.disabled = !isActive && !out ? false : false;
      callBtn.addEventListener('click', () => {
        this.audio.play('click');
        if (!isActive) this.actions.select(id);
        if (isActive && out) this.actions.dismiss(); else this.actions.call();
        setTimeout(() => this.render(), 300);
      });
      if (this.collection.recallIn) { callBtn.disabled = true; callBtn.textContent = `Disponible dans ${Math.ceil(this.collection.recallIn)} s`; }
      buttons.append(choose, callBtn);
      children.push(buttons);
    }
    this.info.replaceChildren(...children);
    const canvas = this.preview.canvas;
    canvas.style.filter = owned ? '' : 'brightness(0) opacity(0.55)';
    void this.assets.loadModel(def.model).then((tpl) => {
      if (this.selected === id) this.preview.show(tpl, def.scale * 1.1, def.animations.idle, 2, def.flying ? 0.6 : 0);
    });
  }
}
