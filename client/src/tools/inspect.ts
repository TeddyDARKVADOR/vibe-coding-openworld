/**
 * Developer tool (not part of the game): renders a grid of KayKit models so
 * their scale, orientation and tile edge layout can be checked visually.
 *   /inspect.html?set=roads&view=top
 *   /inspect.html?models=hex_grass,building_home_A_blue&view=persp
 *   /inspect.html?set=characters
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const params = new URLSearchParams(location.search);
const L = (p: string, n: string) => n.split(',').map((x) => `${p}${x}`);
const SETS: Record<string, string[]> = {
  roads: L('hex_road_', 'A,B,C,D,E,F,G,H,I,J,K,L,M'),
  rivers: [...L('hex_river_', 'A,B,C,D,E,F,G,H,I,J,K,L'), 'hex_river_A_curvy', 'hex_river_crossing_A', 'hex_river_crossing_B'],
  coast: [...L('hex_coast_', 'A,B,C,D,E'), 'hex_water', 'hex_grass'],
  nature: ['mountain_A', 'mountain_B_grass_trees', 'hills_A_trees', 'hills_B', 'trees_A_large', 'trees_B_medium', 'tree_single_A', 'tree_single_B', 'rock_single_E', 'rock_single_C'],
  buildings: ['building_home_A_blue', 'building_home_B_red', 'building_tavern_green', 'building_church_yellow', 'building_market_blue', 'building_well_red', 'building_windmill_green', 'building_blacksmith_yellow', 'building_bridge_A', 'building_bridge_B', 'building_watermill_blue', 'building_lumbermill_red'],
  characters: ['Knight', 'Barbarian', 'Mage', 'Rogue', 'Rogue_Hooded'],
  summons: ['summons/yeti.glb', 'summons/demon.glb', 'summons/mushroom-king.glb', 'summons/dino.glb', 'summons/orc.glb', 'summons/alien.glb', 'summons/evolved-dragon.glb', 'mounts/horse.glb', 'characters/Knight.glb'],
  poi: ['poi/shrine.glb', 'poi/arch_gate.glb', 'poi/crypt.glb', 'poi/pillar_decorated.glb', 'poi/wall_arched.glb', 'poi/rubble_large.glb', 'poi/tree_dead_large.glb', 'poi/gravestone.glb', 'poi/chest_gold.glb', 'poi/banner_patternA_red.glb', 'poi/floor_tile_large.glb', 'poi/stairs_wide.glb'],
};
const set = params.get('set') ?? 'roads';
const models = params.get('models')?.split(',') ?? SETS[set];
const isChar = set === 'characters' || set === 'summons';
const view = params.get('view') ?? (isChar ? 'persp' : 'top');

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x20232a);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(3, 10, 5);
scene.add(sun);

const cols = Math.ceil(Math.sqrt(models.length * 1.4));
const rows = Math.ceil(models.length / cols);
const spacing = isChar ? 3.2 : 2.6;
const w = cols * spacing, h = rows * spacing;
let camera: THREE.Camera;
if (view === 'top') {
  const aspect = innerWidth / innerHeight;
  const half = Math.max(w / aspect, h) / 2 + 0.6;
  const cam = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.1, 100);
  cam.position.set(0, 20, 0);
  cam.up.set(0, 0, -1); // screen up = -Z ("north")
  cam.lookAt(0, 0, 0);
  camera = cam;
} else {
  const cam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 200);
  cam.position.set(0, h * 0.9 + 3, h * 1.1 + 6);
  cam.lookAt(0, isChar ? 1 : 0, 0);
  camera = cam;
}

const loader = new GLTFLoader();
const labels: { el: HTMLDivElement; pos: THREE.Vector3 }[] = [];
await Promise.all(models.map(async (name, i) => {
  const url = name.includes('/') ? `/assets/${name}` : isChar ? `/assets/characters/${name}.glb` : `/assets/environment/hexagon/${name}.gltf`;
  const scale = Number(params.get('scale') ?? 1);
  const gltf = await loader.loadAsync(url);
  const x = (i % cols - (cols - 1) / 2) * spacing;
  const z = (Math.floor(i / cols) - (rows - 1) / 2) * spacing;
  gltf.scene.position.set(x, 0, z);
  gltf.scene.scale.setScalar(name.startsWith('summons/') ? 0.55 : name.startsWith('mounts/') ? 0.45 : name.startsWith('characters/') ? 0.75 : scale);
  scene.add(gltf.scene);
  if (isChar) {
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const clip = gltf.animations.find((c) => c.name === (params.get('clip') ?? 'Idle')) ?? gltf.animations.find((c) => /Idle/.test(c.name));
    if (clip) { mixer.clipAction(clip).play(); mixer.update(0.3); }
  }
  // Edge markers: index 0..5 at the six edge midpoints of a pointy-top hex (unit flat-to-flat = 2).
  if (!isChar && name.startsWith('hex_')) {
    for (let e = 0; e < 6; e++) {
      const a = (e * Math.PI) / 3; // edge e direction angle (0 = +X / east)
      const el = document.createElement('div');
      el.className = 'lbl'; el.textContent = String(e); el.style.color = '#ff0';
      document.body.appendChild(el);
      labels.push({ el, pos: new THREE.Vector3(x + Math.cos(a) * 0.8, 0.1, z - Math.sin(a) * 0.8) });
    }
  }
  const el = document.createElement('div');
  el.className = 'lbl'; el.textContent = name;
  document.body.appendChild(el);
  labels.push({ el, pos: new THREE.Vector3(x, 0, z + spacing * 0.42) });
}));

renderer.render(scene, camera);
for (const l of labels) {
  const p = l.pos.clone().project(camera);
  l.el.style.left = `${(p.x * 0.5 + 0.5) * innerWidth}px`;
  l.el.style.top = `${(-p.y * 0.5 + 0.5) * innerHeight}px`;
}
document.title = 'ready';
