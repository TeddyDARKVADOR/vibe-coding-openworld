/**
 * [Clic] [Q] [E] [R] bar of the active summon: icon (Kenney particle texture
 * by ability type), key, cooldown sweep. Cooldowns start when the server
 * confirms the ability (AbilityEvent), so the display never lies.
 */
import type { SummonDefinition } from '@openworld/shared';

const ICON: Record<string, string> = { melee: 'slash_03', projectile: 'magic_05', aoe: 'circle_05', dash: 'dirt_02', buff: 'light_01' };
const CODES = ['Mouse', 'KeyQ', 'KeyE', 'KeyR'];

export class AbilityBar {
  private root = document.getElementById('ability-bar')!;
  private slots: { el: HTMLDivElement; cd: HTMLDivElement; readyAt: number; cooldown: number }[] = [];
  private defId = '';

  constructor(private onClick: (index: number) => void) {
    void this.localizeKeys();
  }

  /** Shows the abilities of `def` (or hides the bar when no summon is out). */
  setSummon(def: SummonDefinition | null): void {
    this.root.classList.toggle('hidden', !def);
    if (!def || def.id === this.defId) return;
    this.defId = def.id;
    this.slots = def.abilities.map((a, i) => {
      const el = document.createElement('div');
      el.className = 'ab-slot';
      el.title = `${a.name} (${a.cooldown} s)`;
      el.style.backgroundImage = `url(/assets/vfx/${ICON[a.type] ?? 'star_07'}.png)`;
      const key = document.createElement('span');
      key.className = 'ab-key';
      key.textContent = i === 0 ? 'Clic' : this.labels[i] ?? a.key;
      const name = document.createElement('span');
      name.className = 'ab-name';
      name.textContent = a.name;
      const cd = document.createElement('div');
      cd.className = 'ab-cd';
      el.append(cd, key, name);
      el.addEventListener('click', () => this.onClick(i));
      return { el, cd, readyAt: 0, cooldown: a.cooldown };
    });
    this.root.replaceChildren(...this.slots.map((s) => s.el));
  }

  startCooldown(index: number, seconds: number): void {
    const s = this.slots[index];
    if (!s) return;
    s.cooldown = seconds;
    s.readyAt = performance.now() + seconds * 1000;
  }

  update(): void {
    const now = performance.now();
    for (const s of this.slots) {
      const left = Math.max(0, s.readyAt - now) / 1000;
      s.cd.style.height = `${(left / Math.max(0.01, s.cooldown)) * 100}%`;
      s.cd.textContent = left > 0.05 ? (left >= 1 ? Math.ceil(left).toString() : left.toFixed(1)) : '';
    }
  }

  private labels: string[] = ['Clic', 'Q', 'E', 'R'];

  /** Show the real key labels of the user's layout (Q is "A" on AZERTY). */
  private async localizeKeys(): Promise<void> {
    try {
      const kb = (navigator as unknown as { keyboard?: { getLayoutMap(): Promise<Map<string, string>> } }).keyboard;
      const map = await kb?.getLayoutMap();
      if (map) this.labels = CODES.map((c, i) => (i === 0 ? 'Clic' : (map.get(c) ?? this.labels[i]).toUpperCase()));
    } catch { /* default labels */ }
  }
}
