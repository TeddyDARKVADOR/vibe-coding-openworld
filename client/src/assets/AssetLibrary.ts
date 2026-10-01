/**
 * Loads and caches KayKit glTF models. Nothing is loaded up front: models are
 * requested by the world streamer / players when first needed, then reused.
 *
 * Environment models all use the same KayKit gradient atlas, so they share a
 * single material; their geometry (with node transforms baked in) is used
 * for GPU instancing by EnvironmentRenderer.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

const ENV_PATH = '/assets/environment/hexagon/';
const CHAR_PATH = '/assets/characters/';

export class AssetLoadError extends Error {
  constructor(readonly url: string, cause: unknown) {
    super(`Impossible de charger ${url}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

export interface EnvModel {
  name: string;
  /** One entry per mesh of the model, geometry in model space (node transforms applied). */
  geometries: THREE.BufferGeometry[];
  /** Material of each geometry (the shared KayKit atlas material for hexagon models). */
  materials: THREE.Material[];
}

export interface CharacterTemplate {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

export class AssetLibrary {
  private loader = new GLTFLoader();
  private env = new Map<string, Promise<EnvModel>>();
  private envReady = new Map<string, EnvModel>();
  private characters = new Map<string, Promise<CharacterTemplate>>();
  /** Shared material of all environment models (KayKit atlas texture). */
  readonly envMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
  private atlasSet = false;

  constructor() {
    THREE.Cache.enabled = true; // the shared atlas PNG is downloaded once
  }

  private async load(url: string): Promise<GLTF> {
    try {
      return await this.loader.loadAsync(url);
    } catch (e) {
      throw new AssetLoadError(url, e);
    }
  }

  /** Environment model if already loaded (synchronous). */
  getEnv(name: string): EnvModel | undefined {
    return this.envReady.get(name);
  }

  loadEnv(name: string): Promise<EnvModel> {
    let p = this.env.get(name);
    if (!p) {
      // "poi/shrine" → /assets/poi/shrine.glb ; plain names are Medieval Hexagon models.
      const url = name.includes('/') ? `/assets/${name}.glb` : `${ENV_PATH}${name}.gltf`;
      p = this.load(url).then((gltf) => {
        const geometries: THREE.BufferGeometry[] = [];
        const materials: THREE.Material[] = [];
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const g = mesh.geometry.clone();
          g.applyMatrix4(mesh.matrixWorld);
          geometries.push(g);
          const mat = mesh.material as THREE.MeshStandardMaterial;
          if (name.includes('/')) {
            materials.push(this.lambertFor(mat));
          } else {
            if (!this.atlasSet && mat.map) {
              this.envMaterial.map = mat.map;
              this.envMaterial.needsUpdate = true;
              this.atlasSet = true;
            }
            materials.push(this.envMaterial);
          }
        });
        const model = { name, geometries, materials };
        this.envReady.set(name, model);
        return model;
      });
      p.catch(() => this.env.delete(name)); // allow retry later
      this.env.set(name, p);
    }
    return p;
  }

  private models = new Map<string, Promise<CharacterTemplate>>();

  /** Any animated GLB under /assets/ (summons, mounts...), cached; clone with cloneCharacter(). */
  loadModel(assetPath: string): Promise<CharacterTemplate> {
    let p = this.models.get(assetPath);
    if (!p) {
      p = this.load(`/assets/${assetPath}`).then((gltf) => ({ scene: gltf.scene, clips: gltf.animations }));
      p.catch(() => this.models.delete(assetPath));
      this.models.set(assetPath, p);
    }
    return p;
  }

  loadCharacter(name: string): Promise<CharacterTemplate> {
    let p = this.characters.get(name);
    if (!p) {
      p = this.load(`${CHAR_PATH}${name}.glb`).then((gltf) => ({ scene: gltf.scene, clips: gltf.animations }));
      p.catch(() => this.characters.delete(name));
      this.characters.set(name, p);
    }
    return p;
  }

  private lambertCache = new Map<string, THREE.MeshLambertMaterial>();
  /** One Lambert material per texture (all KayKit packs use a single atlas each). */
  private lambertFor(m: THREE.MeshStandardMaterial): THREE.Material {
    const key = (m.map?.image as { src?: string } | undefined)?.src ?? m.map?.uuid ?? m.color?.getHexString?.() ?? m.uuid;
    let l = this.lambertCache.get(key);
    if (!l) {
      l = new THREE.MeshLambertMaterial({ map: m.map ?? null, color: m.map ? 0xffffff : m.color });
      this.lambertCache.set(key, l);
    }
    return l;
  }

  /** A new independent instance of a character (own skeleton, shared geometry/materials). */
  static cloneCharacter(t: CharacterTemplate): THREE.Object3D {
    return SkeletonUtils.clone(t.scene);
  }
}
