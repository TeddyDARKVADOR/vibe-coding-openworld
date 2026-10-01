/**
 * Game orchestration: renderer, scene, main loop, and wiring between the
 * world streamer, local/remote players and the network.
 */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Anim, CHARACTERS, CHUNK_SIZE, Emote, RENDER_LOAD_RADIUS, TICK_DT, chunkCoord, chunkKey, type ChatMessage } from '@openworld/shared';
import { AssetLibrary } from '../assets/AssetLibrary.ts';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera.ts';
import { NetworkManager, serverUrl, type NetPlayer } from '../networking/NetworkManager.ts';
import { CharacterModel } from '../player/CharacterModel.ts';
import { Input } from '../player/Input.ts';
import { PlayerController } from '../player/PlayerController.ts';
import { RemotePlayer } from '../player/RemotePlayer.ts';
import { WorldManager } from '../world/WorldManager.ts';
import { Minimap } from '../world/Minimap.ts';
import { ChatBox, NameTag, PlayerList, compass } from './social.ts';
import type { PlayerProfile } from './EntryScreen.ts';
import { ui } from './ui.ts';

const SKY = 0xa8d8f0;
/** Floating origin: when the player is this far from the render origin, everything is re-centred. */
const REBASE_DISTANCE = 1024;
const ORIGIN_SNAP = 256;
/** View distance in chunks; `?radius=2` for modest machines, up to 5. */
const VIEW_RADIUS = Math.min(5, Math.max(1, Number(new URLSearchParams(location.search).get('radius')) || RENDER_LOAD_RADIUS));
/** Fog ends before the edge of the loaded area, so streaming is never visible. */
const FOG_FAR = VIEW_RADIUS * CHUNK_SIZE + 16;
/** Remote players further than this are not drawn (their chunks aren't loaded anyway). */
const REMOTE_VISIBLE_DISTANCE = FOG_FAR + 40;

export class Game {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.1, FOG_FAR + 80);
  private sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
  private orbit = new ThirdPersonCamera(this.camera);
  readonly assets = new AssetLibrary();
  private labels!: CSS2DRenderer;
  private chat!: ChatBox;
  private minimap = new Minimap();
  private playerList = new PlayerList();
  private tags = new Map<string, NameTag>();
  private myTag: NameTag | null = null;
  /** Players already announced in the chat ("X a rejoint le monde"). */
  private announced = new Map<string, string>();
  private hudTime = 0;
  private input!: Input;
  private net: NetworkManager;
  private world!: WorldManager;
  private player: PlayerController | null = null;
  private remotes = new Map<string, RemotePlayer>();
  private loadingRemotes = new Set<string>();
  private originX = 0;
  private originZ = 0;
  private accumulator = 0;
  private lastFrame = 0;
  private renderPos = new THREE.Vector3();
  private debugVisible = new URLSearchParams(location.search).has('debug');
  private connection: 'connecting' | 'connected' | 'reconnecting' | 'lost' = 'connecting';
  private lastSnapshot: NetPlayer[] = [];
  private fps = 0;
  private frames = 0;
  private fpsTime = 0;
  private debugTime = 0;
  private fatal = false;

  constructor(private container: HTMLElement) {
    this.net = new NetworkManager({
      onSnapshot: (players, t) => this.onSnapshot(players, t),
      onPlayerLeft: (id) => this.removeRemote(id),
      onConnectionChange: (s) => this.onConnectionChange(s),
      onChat: (m) => this.onChat(m),
    });
  }

  async start(profile: PlayerProfile): Promise<void> {
    this.createRenderer();
    this.input = new Input(this.renderer.domElement);
    this.input.onToggleDebug = () => { this.debugVisible = !this.debugVisible; if (!this.debugVisible) ui.debug(null); };
    this.input.onEmote = (n) => this.emote(n as Emote);
    this.input.onToggleMap = () => { if (!this.chat?.isOpen) this.minimap.visible = !this.minimap.visible; };
    this.input.onPlayerList = (show) => { this.playerList.visible = show; if (show) this.updateHud(true); };

    ui.loading(0.02, 'Initialisation de la physique…');
    await RAPIER.init();

    ui.loading(0.05, 'Connexion au serveur…');
    try {
      await this.net.connect(profile);
    } catch (e) {
      throw new UserFacingError('Serveur indisponible',
        `Impossible de rejoindre le monde sur ${serverUrl()}.\nLe serveur de jeu est-il lancé ? (npm run dev)\n\n${e instanceof Error ? e.message : String(e)}`);
    }
    this.connection = 'connected';
    const me = await this.waitForSelf();

    // Render/physics origin snapped near the spawn point.
    this.originX = Math.round(me.x / ORIGIN_SNAP) * ORIGIN_SNAP;
    this.originZ = Math.round(me.z / ORIGIN_SNAP) * ORIGIN_SNAP;
    this.world = new WorldManager(RAPIER, this.assets, this.originX, this.originZ, VIEW_RADIUS);
    this.world.onError = (e) => this.fail('Ressource introuvable', e instanceof Error ? e.message : String(e));
    this.scene.add(this.world.renderer.group);

    ui.loading(0.1, `Chargement du personnage (${CHARACTERS[me.character]})…`);
    const model = await CharacterModel.create(this.assets, me.character);
    this.scene.add(model.root);

    await this.world.preload(me.x, me.z, (p) => ui.loading(0.15 + p * 0.85, 'Chargement du monde…'));

    this.orbit.yaw = me.yaw + Math.PI; // start behind the character
    this.player = new PlayerController((x, z) => this.world.physicsAt(x, z), model, this.input, this.orbit, (i) => this.net.sendInput(i), me);
    this.myTag = new NameTag(me.name, false); // own name hidden, only chat bubbles
    model.head.add(this.myTag.object);
    this.chat = new ChatBox((text) => this.net.sendChat(text));
    const openChat = this.chat.open.bind(this.chat);
    this.chat.open = () => { this.input.clear(); openChat(); };
    for (const p of this.lastSnapshot) this.announced.set(p.id, p.name); // already here: no "joined" message
    this.onSnapshot(this.lastSnapshot, performance.now());
    this.chat.add('', `Bienvenue ${me.name} ! ${this.lastSnapshot.length - 1} autre(s) joueur(s) dans le monde.`, true);
    this.minimap.visible = true;

    ui.hideLoading();
    ui.status('Connecté', true);
    ui.showHint();
    this.lastFrame = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
    (window as any).__game = this; // handy for debugging from the console / automated tests
  }

  // ---------------------------------------------------------------- setup

  private createRenderer(): void {
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      throw new UserFacingError('WebGL indisponible',
        "Ce navigateur ou cette machine ne permet pas d'afficher de la 3D (WebGL).\nActive l'accélération matérielle ou essaie un navigateur récent (Chrome, Firefox, Edge, Safari).");
    }
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Soft filmic response: keeps KayKit's bright palette without oversaturating the grass.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.container.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer({ element: document.getElementById('labels')! });
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.fail('Contexte WebGL perdu', 'Le navigateur a interrompu le rendu 3D. Recharge la page.');
    });

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, FOG_FAR * 0.35, FOG_FAR);
    this.scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x7a9a5a, 1.5));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -70; s.right = s.top = 70; s.near = 1; s.far = 260;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    const resize = () => {
      this.renderer.setSize(innerWidth, innerHeight);
      this.labels.setSize(innerWidth, innerHeight);
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
    };
    addEventListener('resize', resize);
    resize();
  }

  private waitForSelf(): Promise<NetPlayer> {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const check = () => {
        const me = this.lastSnapshot.find((p) => p.id === this.net.sessionId);
        if (me) resolve(me);
        else if (performance.now() - t0 > 10000) reject(new UserFacingError('Serveur muet', "Connecté, mais le serveur n'a envoyé aucun état."));
        else setTimeout(check, 30);
      };
      check();
    });
  }

  // ---------------------------------------------------------------- network

  private onSnapshot(players: NetPlayer[], t: number): void {
    this.lastSnapshot = players;
    if (!this.player) return;
    for (const p of players) {
      if (p.id === this.net.sessionId) {
        this.player.reconcile(p);
        continue;
      }
      if (!this.announced.has(p.id)) {
        this.announced.set(p.id, p.name);
        this.chat.add('', `${p.name} a rejoint le monde.`, true);
      }
      const remote = this.remotes.get(p.id);
      if (remote) {
        remote.push(t, p);
        if (remote.name !== p.name) { remote.name = p.name; this.tags.get(p.id)?.setName(p.name); }
      } else this.addRemote(p, t);
    }
  }

  private onChat(m: ChatMessage): void {
    this.chat.add(m.name, m.text);
    if (m.id === this.net.sessionId) this.myTag?.say(m.text);
    else this.tags.get(m.id)?.say(m.text);
  }

  private emote(e: Emote): void {
    const p = this.player;
    if (!p || this.chat.isOpen || p.state.anim !== Anim.Idle) return;
    p.emote = p.emote === e ? Emote.None : e; // same key again = stop
    this.net.sendEmote(p.emote);
  }

  private addRemote(p: NetPlayer, t: number): void {
    if (this.loadingRemotes.has(p.id)) return;
    this.loadingRemotes.add(p.id);
    CharacterModel.create(this.assets, p.character).then(
      (model) => {
        if (!this.loadingRemotes.delete(p.id)) { model.dispose(); return; } // left meanwhile
        const r = new RemotePlayer(p.id, model);
        r.name = p.name;
        r.push(t, p);
        this.remotes.set(p.id, r);
        this.scene.add(model.root);
        const tag = new NameTag(p.name);
        model.head.add(tag.object);
        this.tags.set(p.id, tag);
      },
      (e) => this.fail('Ressource introuvable', e instanceof Error ? e.message : String(e)),
    );
  }

  private removeRemote(id: string): void {
    const name = this.announced.get(id);
    if (name !== undefined) { this.announced.delete(id); this.chat?.add('', `${name} a quitté le monde.`, true); }
    this.tags.get(id)?.dispose();
    this.tags.delete(id);
    this.loadingRemotes.delete(id);
    this.remotes.get(id)?.dispose();
    this.remotes.delete(id);
  }

  private onConnectionChange(s: 'connected' | 'reconnecting' | 'lost'): void {
    this.connection = s;
    if (s === 'reconnecting') ui.status('Connexion perdue — reconnexion…');
    else if (s === 'connected') { ui.status('Connecté', true); ui.hideError(); }
    else this.fail('Connexion perdue', 'La connexion au serveur a été interrompue et la reconnexion a échoué.');
  }

  // ---------------------------------------------------------------- loop

  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    try {
      this.step(now, dt);
    } catch (e) {
      console.error(e);
      this.fail('Erreur inattendue', e instanceof Error ? e.message : String(e));
    }
  }

  private step(now: number, dt: number): void {
    const player = this.player!;
    const mouse = this.input.consumeMouse();
    this.orbit.rotate(mouse.dx, mouse.dy, mouse.wheel);

    // Fixed-rate simulation (same 30 Hz as the server).
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= TICK_DT && steps++ < 5) {
      if (this.connection === 'connected') player.fixedUpdate();
      this.accumulator -= TICK_DT;
    }
    if (steps >= 5) this.accumulator = 0;
    const alpha = this.accumulator / TICK_DT;
    const pos = player.worldPosition(alpha);

    // Floating origin: keep rendering coordinates small. Network coordinates are untouched
    // (physics uses its own fixed region grid shared with the server).
    if (Math.abs(pos.x - this.originX) > REBASE_DISTANCE || Math.abs(pos.z - this.originZ) > REBASE_DISTANCE) {
      this.originX = Math.round(pos.x / ORIGIN_SNAP) * ORIGIN_SNAP;
      this.originZ = Math.round(pos.z / ORIGIN_SNAP) * ORIGIN_SNAP;
      this.world.setRenderOrigin(this.originX, this.originZ);
    }

    this.world.updateAroundPlayer(pos.x, pos.z);
    player.render(dt, alpha, this.originX, this.originZ, this.renderPos);
    this.orbit.update(dt, this.renderPos, pos, this.world.physics);

    for (const r of this.remotes.values()) {
      r.update(now, dt, this.originX, this.originZ);
      const d = Math.hypot(r.world.x - pos.x, r.world.z - pos.z);
      r.model.root.visible = d < REMOTE_VISIBLE_DISTANCE;
      this.tags.get(r.id)?.updateDistance(d);
    }

    // Sun (and its shadow box) follows the player.
    this.sun.position.set(this.renderPos.x + 60, this.renderPos.y + 110, this.renderPos.z + 40);
    this.sun.target.position.copy(this.renderPos);

    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
    if (now - this.hudTime > 100) { this.hudTime = now; this.updateHud(false); }

    this.frames++;
    if (now - this.fpsTime > 1000) { this.fps = (this.frames * 1000) / (now - this.fpsTime); this.frames = 0; this.fpsTime = now; }
    if (this.debugVisible && now - this.debugTime > 200) { this.debugTime = now; this.updateDebug(pos); }
  }

  /** Minimap (10 Hz) and player list (while Tab is held). */
  private updateHud(force: boolean): void {
    const p = this.player;
    if (!p) return;
    const me = p.state;
    const others = [...this.remotes.values()];
    if (this.minimap.visible) {
      this.minimap.draw(this.world, me.x, me.z, this.orbit.yaw, p.model.root.rotation.y, [
        ...others.map((r) => ({ name: r.name, x: r.world.x, z: r.world.z, me: false })),
      ]);
    }
    if (this.playerList.visible && (force || Math.floor(performance.now() / 500) !== Math.floor((performance.now() - 100) / 500))) {
      const myName = this.announced.get(this.net.sessionId) ?? this.lastSnapshot.find((s) => s.id === this.net.sessionId)?.name ?? '';
      this.playerList.render([
        { name: myName, me: true, distance: 0, direction: '' },
        ...this.lastSnapshot.filter((s) => s.id !== this.net.sessionId).map((s) => ({
          name: s.name, me: false, distance: Math.hypot(s.x - me.x, s.z - me.z), direction: compass(s.x - me.x, s.z - me.z),
        })),
      ]);
    }
  }

  private updateDebug(pos: { x: number; y: number; z: number }): void {
    const w = this.world.stats;
    const info = this.renderer.info.render;
    ui.debug([
      `serveur   ${this.connection} (${serverUrl()}) ping ${this.net.ping} ms`,
      `joueurs   ${this.lastSnapshot.length} (session ${this.net.sessionId})`,
      `position  x ${pos.x.toFixed(1)}  y ${pos.y.toFixed(2)}  z ${pos.z.toFixed(1)}`,
      `chunk     ${chunkKey(chunkCoord(pos.x), chunkCoord(pos.z))}   origine ${this.originX},${this.originZ}`,
      `chunks    ${w.shown}/${w.chunks} affichés, ${w.queued} en file, ${w.physicsChunks} physiques`,
      `rendu     ${this.fps.toFixed(0)} fps, ${info.calls} draw calls, ${(info.triangles / 1000).toFixed(0)}k tris, ${w.instances} instances`,
      `réseau    ${this.player!.pendingCount} inputs en attente, ${this.player!.corrections} corrections (dernière ${(this.player!.lastCorrection * 100).toFixed(1)} cm)`,
    ].join('\n'));
  }

  /** Debug/test helpers. */
  get debugState() {
    const p = this.player!;
    return {
      sessionId: this.net.sessionId, connection: this.connection, corrections: p.corrections, lastCorrection: p.lastCorrection,
      x: p.state.x, y: p.state.y, z: p.state.z, anim: p.state.anim,
      emote: p.emote,
      players: this.lastSnapshot.map((s) => ({ id: s.id, name: s.name, x: s.x, y: s.y, z: s.z, character: s.character, emote: s.emote })),
      remotes: [...this.remotes.values()].map((r) => ({ id: r.id, name: r.name, ...r.world, visible: r.model.root.visible })),
      world: this.world.stats, origin: [this.originX, this.originZ], fps: this.fps,
      camera: { yaw: this.orbit.yaw, pitch: this.orbit.pitch },
    };
  }

  setCameraYaw(yaw: number): void {
    this.orbit.yaw = yaw;
  }

  /**
   * Debug/tests: nearest model of a kind that is in direct line of sight (the
   * first collider hit by a ray towards its centre is its own), with the
   * camera yaw that faces it.
   */
  nearestVisible(prefix: string, maxDist = 120) {
    const p = this.player!.state;
    for (const n of this.world.placementsNear(prefix, p.x, p.z, maxDist)) {
      const dx = (n.x - p.x) / n.d, dz = (n.z - p.z) / n.d;
      const hit = this.world.physicsAt(p.x, p.z).raycast(p.x, p.y + 0.5, p.z, dx, 0, dz, n.d);
      if (hit > n.d - 4 && hit < n.d - 0.3) return { ...n, firstHit: hit, yaw: Math.atan2(-dx, -dz) };
    }
    return null;
  }

  private fail(title: string, text: string): void {
    if (this.fatal) return;
    this.fatal = true;
    ui.error(title, text);
  }
}

export class UserFacingError extends Error {
  constructor(readonly title: string, message: string) {
    super(message);
  }
}
