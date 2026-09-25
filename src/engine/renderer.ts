import * as THREE from 'three';
import { buildWorldMeshes } from './mesher';
import { Sky } from './sky';
import { createAtlas, type Atlas } from './textures';
import type { VoxelWorld } from './world';

export interface Environment {
  /** Unit vector towards the sun. */
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunStrength: number;
  /** Ambient sky light colour baked into block faces. */
  skyAmbient: THREE.Color;
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
}

/**
 * Owns the WebGL renderer, the world scene and a second scene for the
 * first-person weapon, which is drawn on top with its own camera.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly viewScene = new THREE.Scene();
  readonly viewCamera: THREE.PerspectiveCamera;
  readonly atlas: Atlas;
  readonly worldMaterial: THREE.MeshBasicMaterial;
  private sky: Sky | null = null;
  private worldGroup: THREE.Group | null = null;
  private hemi = new THREE.HemisphereLight(0xdde8ff, 0x6b5a45, 1.4);
  private sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
  private renderScale = 1;

  constructor(private container: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.autoClear = false;
    this.gl.domElement.id = 'game-canvas';
    container.appendChild(this.gl.domElement);

    this.camera = new THREE.PerspectiveCamera(74, 1, 0.05, 600);
    this.camera.rotation.order = 'YXZ';
    this.viewCamera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);

    this.atlas = createAtlas();
    this.worldMaterial = new THREE.MeshBasicMaterial({
      map: this.atlas.texture,
      vertexColors: true,
      alphaTest: 0.5,
    });

    this.scene.add(this.hemi, this.sun, this.sun.target);
    const vh = new THREE.HemisphereLight(0xdde8ff, 0x6b5a45, 1.6);
    const vs = new THREE.DirectionalLight(0xfff2dd, 1.4);
    vs.position.set(0.4, 1, 0.6);
    this.viewScene.add(vh, vs);
    this.viewScene.add(this.viewCamera);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Replace the world geometry, sky and lighting. */
  setWorld(world: VoxelWorld, env: Environment): void {
    if (this.worldGroup) {
      this.scene.remove(this.worldGroup);
      this.worldGroup.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    if (this.sky) this.scene.remove(this.sky.group);

    this.worldGroup = buildWorldMeshes(world, this.atlas, {
      sunDir: env.sunDir, sunColor: env.sunColor, skyColor: env.skyAmbient, sunStrength: env.sunStrength,
    }, this.worldMaterial);
    this.scene.add(this.worldGroup);

    this.sky = new Sky({ top: env.skyTop, horizon: env.skyHorizon, sunDir: env.sunDir, sunColor: env.sunColor, cloudHeight: world.sy + 30 });
    this.scene.add(this.sky.group);
    this.scene.fog = new THREE.Fog(env.fogColor, env.fogNear, env.fogFar);
    this.scene.background = env.fogColor;

    this.sun.position.copy(env.sunDir).multiplyScalar(100);
    this.sun.color.copy(env.sunColor);
  }

  get canvas(): HTMLCanvasElement {
    return this.gl.domElement;
  }

  /** 1 = native resolution; lower values render fewer pixels for weak GPUs. */
  setRenderScale(scale: number): void {
    this.renderScale = scale;
    this.resize();
  }

  setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 1) * this.renderScale);
    this.gl.setSize(w, h, false);
    this.gl.domElement.style.width = '100%';
    this.gl.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = w / h;
    this.viewCamera.updateProjectionMatrix();
  }

  render(dt: number, drawViewModel = true): void {
    this.sky?.update(this.camera, dt);
    this.gl.clear();
    this.gl.render(this.scene, this.camera);
    if (drawViewModel) {
      this.gl.clearDepth();
      this.gl.render(this.viewScene, this.viewCamera);
    }
  }
}
