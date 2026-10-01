/**
 * Game orchestration: renderer, scene, main loop, and wiring between the
 * world streamer, local/remote players and the network.
 */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CHARACTERS, TICK_DT, chunkCoord, chunkKey } from '@openworld/shared';
import { AssetLibrary } from '../assets/AssetLibrary.ts';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera.ts';
import { NetworkManager, serverUrl, type NetPlayer } from '../networking/NetworkManager.ts';
import { CharacterModel } from '../player/CharacterModel.ts';
import { Input } from '../player/Input.ts';
import { PlayerController } from '../player/PlayerController.ts';
import { RemotePlayer } from '../player/RemotePlayer.ts';
import { WorldManager } from '../world/WorldManager.ts';
import { ui } from './ui.ts';

const SKY = 0xa8d8f0;
/** Floating origin: when the player is this far from the render origin, everything is re-centred. */
const REBASE_DISTANCE = 1024;
const ORIGIN_SNAP = 256;
/** Remote players further than this are not drawn (their chunks aren't loaded anyway). */
const REMOTE_VISIBLE_DISTANCE = 450;

export class Game {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.1, 480);
  private sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
  private orbit = new ThirdPersonCamera(this.camera);
  private assets = new AssetLibrary();
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
    });
  }

  async start(): Promise<void> {
    this.createRenderer();
    this.input = new Input(this.renderer.domElement);
    this.input.onToggleDebug = () => { this.debugVisible = !this.debugVisible; if (!this.debugVisible) ui.debug(null); };

    ui.loading(0.02, 'Initialisation de la physique…');
    await RAPIER.init();

    ui.loading(0.05, 'Connexion au serveur…');
    try {
      await this.net.connect();
    } catch (e) {
      throw new UserFacingError('Serveur indisponible',
        `Impossible de rejoindre le monde sur ${serverUrl()}.\nLe serveur de jeu est-il lancé ? (npm run dev)\n\n${e instanceof Error ? e.message : String(e)}`);
    }
    this.connection = 'connected';
    const me = await this.waitForSelf();

    // Render/physics origin snapped near the spawn point.
    this.originX = Math.round(me.x / ORIGIN_SNAP) * ORIGIN_SNAP;
    this.originZ = Math.round(me.z / ORIGIN_SNAP) * ORIGIN_SNAP;
    this.world = new WorldManager(RAPIER, this.assets, this.originX, this.originZ);
    this.world.onError = (e) => this.fail('Ressource introuvable', e instanceof Error ? e.message : String(e));
    this.scene.add(this.world.renderer.group);

    ui.loading(0.1, `Chargement du personnage (${CHARACTERS[me.character]})…`);
    const model = await CharacterModel.create(this.assets, me.character);
    this.scene.add(model.root);

    await this.world.preload(me.x, me.z, (p) => ui.loading(0.15 + p * 0.85, 'Chargement du monde…'));

    this.orbit.yaw = me.yaw + Math.PI; // start behind the character
    this.player = new PlayerController((x, z) => this.world.physicsAt(x, z), model, this.input, this.orbit, (i) => this.net.sendInput(i), me);
    this.onSnapshot(this.lastSnapshot, performance.now());

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
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.fail('Contexte WebGL perdu', 'Le navigateur a interrompu le rendu 3D. Recharge la page.');
    });

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 140, 400);
    this.scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x7a9a5a, 1.7));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -70; s.right = s.top = 70; s.near = 1; s.far = 260;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    const resize = () => {
      this.renderer.setSize(innerWidth, innerHeight);
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
      const remote = this.remotes.get(p.id);
      if (remote) remote.push(t, p);
      else this.addRemote(p, t);
    }
  }

  private addRemote(p: NetPlayer, t: number): void {
    if (this.loadingRemotes.has(p.id)) return;
    this.loadingRemotes.add(p.id);
    CharacterModel.create(this.assets, p.character).then(
      (model) => {
        if (!this.loadingRemotes.delete(p.id)) { model.dispose(); return; } // left meanwhile
        const r = new RemotePlayer(p.id, model);
        r.push(t, p);
        this.remotes.set(p.id, r);
        this.scene.add(model.root);
      },
      (e) => this.fail('Ressource introuvable', e instanceof Error ? e.message : String(e)),
    );
  }

  private removeRemote(id: string): void {
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
      r.model.root.visible = Math.hypot(r.world.x - pos.x, r.world.z - pos.z) < REMOTE_VISIBLE_DISTANCE;
    }

    // Sun (and its shadow box) follows the player.
    this.sun.position.set(this.renderPos.x + 60, this.renderPos.y + 110, this.renderPos.z + 40);
    this.sun.target.position.copy(this.renderPos);

    this.renderer.render(this.scene, this.camera);

    this.frames++;
    if (now - this.fpsTime > 1000) { this.fps = (this.frames * 1000) / (now - this.fpsTime); this.frames = 0; this.fpsTime = now; }
    if (this.debugVisible && now - this.debugTime > 200) { this.debugTime = now; this.updateDebug(pos); }
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
      players: this.lastSnapshot.map((s) => ({ id: s.id, x: s.x, y: s.y, z: s.z, character: s.character })),
      remotes: [...this.remotes.values()].map((r) => ({ id: r.id, ...r.world, visible: r.model.root.visible })),
      world: this.world.stats, origin: [this.originX, this.originZ], fps: this.fps,
      camera: { yaw: this.orbit.yaw, pitch: this.orbit.pitch },
    };
  }

  setCameraYaw(yaw: number): void {
    this.orbit.yaw = yaw;
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
