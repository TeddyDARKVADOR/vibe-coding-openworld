/** Small turntable preview of a real animated model (summons panel, reveal). */
import * as THREE from 'three';
import type { CharacterTemplate } from '../assets/AssetLibrary.ts';
import { AnimatedModel } from '../game/AnimatedModel.ts';

export class ModelPreview {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  private model: AnimatedModel | null = null;
  private running = false;
  private last = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.renderer.setSize(canvas.width, canvas.height, false);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    } catch { /* no WebGL: the game reports it */ }
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa77, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(2, 4, 3);
    this.scene.add(sun);
  }

  show(template: CharacterTemplate, scale: number, idleClip: string, height = 1.8, lift = 0): void {
    this.model?.dispose();
    this.model = new AnimatedModel(template, scale);
    this.model.model.position.y = lift;
    this.model.loop(idleClip);
    this.scene.add(this.model.root);
    this.camera.position.set(0, height * 0.65, height * 2.4);
    this.camera.lookAt(0, height * 0.45, 0);
    this.start();
  }

  play(clip: string): void {
    this.model?.once(clip);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = () => {
      if (!this.running) return;
      const now = performance.now(), dt = (now - this.last) / 1000;
      this.last = now;
      if (this.model) { this.model.root.rotation.y += dt * 0.7; this.model.update(dt); }
      this.renderer?.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
  }
}
