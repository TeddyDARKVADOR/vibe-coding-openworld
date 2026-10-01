/**
 * Announces special places when the player walks into one: a banner with the
 * place's name, a sound, and "Lieu découvert" the first time. Discovered
 * places are remembered in this browser only (a convenience, not game state).
 */
import { poiAt, type Poi } from '@openworld/shared';

const KEY = 'openworld.discovered';
const BANNER_MS = 4500;

export class PoiTracker {
  private current: string | null = null;
  private discovered = new Set<string>();
  private el = document.getElementById('poi-banner')!;
  private timer = 0;

  constructor(private onEnter: (poi: Poi, firstTime: boolean) => void) {
    try { for (const id of JSON.parse(localStorage.getItem(KEY) ?? '[]')) this.discovered.add(String(id)); } catch { /* storage unavailable */ }
  }

  get count(): number { return this.discovered.size; }

  update(x: number, z: number): void {
    const poi = poiAt(x, z);
    const id = poi?.id ?? null;
    if (id === this.current) return;
    this.current = id;
    if (!poi) return;
    const first = !this.discovered.has(poi.id);
    if (first) {
      this.discovered.add(poi.id);
      try { localStorage.setItem(KEY, JSON.stringify([...this.discovered].slice(-500))); } catch { /* ignore */ }
    }
    (this.el.querySelector('.poi-name') as HTMLElement).textContent = poi.type.name;
    (this.el.querySelector('.poi-desc') as HTMLElement).textContent = first ? `Lieu découvert — ${poi.type.description}` : poi.type.description;
    this.el.classList.remove('hidden', 'fade');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.el.classList.add('fade'), BANNER_MS);
    this.onEnter(poi, first);
  }
}
