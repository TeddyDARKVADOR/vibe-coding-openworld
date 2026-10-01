/**
 * Entry screen: choose a name and one of the free KayKit characters (with a
 * live 3D preview of the real model). The choice is remembered in the browser.
 */
import * as THREE from 'three';
import { CHARACTERS, NAME_MAX_LENGTH, sanitizeName } from '@openworld/shared';
import type { AssetLibrary } from '../assets/AssetLibrary.ts';
import { CharacterModel } from '../player/CharacterModel.ts';

export interface PlayerProfile {
  name: string;
  character: number;
}

const STORAGE_KEY = 'openworld.profile';
export const CHARACTER_LABELS = ['Chevalier', 'Barbare', 'Mage', 'Voleuse', 'Voleuse encapuchonnée'];

function loadProfile(): PlayerProfile | null {
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (p && typeof p.name === 'string' && Number.isInteger(p.character)) return p;
  } catch { /* private mode, corrupted value... */ }
  return null;
}

function saveProfile(p: PlayerProfile): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

export function showEntryScreen(assets: AssetLibrary): Promise<PlayerProfile> {
  const $ = (id: string) => document.getElementById(id)!;
  const root = $('entry');
  const canvas = $('entry-preview') as HTMLCanvasElement;
  const nameInput = $('entry-name') as HTMLInputElement;
  const charName = $('entry-char-name');
  nameInput.maxLength = NAME_MAX_LENGTH;

  const saved = loadProfile();
  let character = saved ? Math.abs(saved.character) % CHARACTERS.length : Math.floor(Math.random() * CHARACTERS.length);
  nameInput.value = saved?.name ?? '';

  // Small dedicated renderer for the preview (no shadows, tiny canvas).
  let renderer: THREE.WebGLRenderer | null = null;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { /* the game will report missing WebGL */ }
  renderer?.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer?.setSize(260, 260, false);
  if (renderer) renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa77, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 20);
  camera.position.set(0, 1.25, 4.2);
  camera.lookAt(0, 0.9, 0);

  let model: CharacterModel | null = null;
  let token = 0;
  const show = async () => {
    charName.textContent = CHARACTER_LABELS[character] ?? CHARACTERS[character];
    const my = ++token;
    try {
      const m = await CharacterModel.create(assets, character);
      if (my !== token) return;
      model?.dispose();
      model = m;
      scene.add(m.root);
    } catch (e) { console.warn(e); }
  };
  let last = performance.now();
  let running = true;
  const loop = () => {
    if (!running) return;
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    if (model) { model.root.rotation.y += dt * 0.6; model.update(dt); }
    renderer?.render(scene, camera);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const step = (d: number) => { character = (character + d + CHARACTERS.length) % CHARACTERS.length; show(); };
  root.querySelector('.char-prev')!.addEventListener('click', () => step(-1));
  root.querySelector('.char-next')!.addEventListener('click', () => step(1));
  root.classList.remove('hidden');
  show();
  nameInput.focus();

  return new Promise((resolve) => {
    $('entry-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = sanitizeName(nameInput.value);
      if (!name) { nameInput.focus(); return; }
      const profile = { name, character };
      saveProfile(profile);
      running = false;
      model?.dispose();
      renderer?.dispose();
      root.classList.add('hidden');
      resolve(profile);
    });
  });
}
