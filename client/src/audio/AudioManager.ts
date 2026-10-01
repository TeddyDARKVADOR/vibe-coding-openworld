/**
 * CC0 sound effects (Kenney / OpenGameArt, see ASSETS.md) with Web Audio.
 * Sounds load on first use; volume fades with distance to the listener.
 * Browsers only allow audio after a user gesture, so it unlocks on the first click/key.
 */
const FILES: Record<string, string> = {
  summon: 'summon.wav', unlock: 'unlock.wav', hit: 'hit.ogg', hit_heavy: 'hit_heavy.ogg', swing: 'swing.wav',
  dash: 'dash.wav', projectile: 'projectile.wav', buff: 'buff.wav', aoe: 'aoe.ogg', death: 'death.wav',
  hurt: 'hurt.ogg', click: 'click.ogg', notify: 'notify.ogg', mount: 'mount.ogg', dismount: 'dismount.ogg',
};
const HEARING_DISTANCE = 45;

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private listener = { x: 0, z: 0 };
  private ambience: AudioBufferSourceNode | null = null;
  muted = false;

  constructor() {
    try { this.muted = localStorage.getItem('openworld.muted') === '1'; } catch { /* ignore */ }
    const unlock = () => {
      if (!this.ctx) {
        try {
          this.ctx = new AudioContext();
          this.master = this.ctx.createGain();
          this.master.gain.value = this.muted ? 0 : 0.7;
          this.master.connect(this.ctx.destination);
          this.startAmbience();
        } catch { /* no audio */ }
      }
      void this.ctx?.resume();
    };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
  }

  setListener(x: number, z: number): void {
    this.listener.x = x;
    this.listener.z = z;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.7;
    try { localStorage.setItem('openworld.muted', this.muted ? '1' : '0'); } catch { /* ignore */ }
    return this.muted;
  }

  private load(file: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(file);
    if (!p) {
      p = fetch(`/assets/audio/${file}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
        .then((b) => this.ctx!.decodeAudioData(b))
        .catch((e) => { console.warn('[audio]', file, e); return null; });
      this.buffers.set(file, p);
    }
    return p;
  }

  /** Plays a named sound, optionally at a world position (quieter when far). */
  play(name: string, at?: { x: number; z: number }, volume = 1): void {
    const file = FILES[name];
    if (!file || !this.ctx || !this.master || this.muted) return;
    let gain = volume;
    if (at) {
      const d = Math.hypot(at.x - this.listener.x, at.z - this.listener.z);
      if (d > HEARING_DISTANCE) return;
      gain *= 1 - d / HEARING_DISTANCE;
    }
    const ctx = this.ctx, master = this.master;
    void this.load(file).then((buf) => {
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(g).connect(master);
      src.start();
    });
  }

  private startAmbience(): void {
    void this.load('ambience_birds.ogg').then((buf) => {
      if (!buf || !this.ctx || !this.master || this.ambience) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = 0.18;
      src.connect(g).connect(this.master);
      src.start();
      this.ambience = src;
    });
  }
}
