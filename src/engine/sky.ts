import * as THREE from 'three';
import { mulberry32 } from './textures';

export interface SkyOptions {
  top: THREE.Color;
  horizon: THREE.Color;
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  cloudHeight: number;
}

/** Gradient sky dome with a square sun, plus a drifting layer of blocky clouds. */
export class Sky {
  readonly group = new THREE.Group();
  private clouds: THREE.Mesh;
  private cloudTex: THREE.CanvasTexture;

  constructor(opts: SkyOptions) {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(450, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: opts.top },
          horizon: { value: opts.horizon },
          sunDir: { value: opts.sunDir.clone().normalize() },
          sunColor: { value: opts.sunColor },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float h = clamp(d.y, -0.2, 1.0);
            vec3 col = mix(horizon, top, pow(max(h, 0.0), 0.55));
            if (h < 0.0) col = mix(horizon, horizon * 0.8, -h * 5.0);
            // Square sun in the plane facing the sun direction.
            vec3 up = abs(sunDir.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
            vec3 ax = normalize(cross(up, sunDir));
            vec3 ay = cross(sunDir, ax);
            float facing = dot(d, sunDir);
            if (facing > 0.0) {
              vec2 p = vec2(dot(d, ax), dot(d, ay)) / facing;
              float s = max(abs(p.x), abs(p.y));
              if (s < 0.055) col = sunColor * 1.2;
              else col += sunColor * 0.35 * smoothstep(0.45, 0.0, s) * facing;
            }
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.group.add(dome);

    // Blocky cloud map: random rectangles on a 64x64 grid, tiled across a big plane.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const r = mulberry32(99);
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 28; i++) {
      const w = 3 + Math.floor(r() * 9), hgt = 2 + Math.floor(r() * 6);
      const x = Math.floor(r() * 64), y = Math.floor(r() * 64);
      for (const [ox, oy] of [[0, 0], [-64, 0], [0, -64], [-64, -64]]) ctx.fillRect(x + ox, y + oy, w, hgt);
    }
    this.cloudTex = new THREE.CanvasTexture(canvas);
    this.cloudTex.magFilter = THREE.NearestFilter;
    this.cloudTex.minFilter = THREE.NearestFilter;
    this.cloudTex.generateMipmaps = false;
    this.cloudTex.wrapS = this.cloudTex.wrapT = THREE.RepeatWrapping;
    this.cloudTex.repeat.set(4, 4);
    this.clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900),
      new THREE.MeshBasicMaterial({ map: this.cloudTex, transparent: true, opacity: 0.78, depthWrite: false, fog: false, side: THREE.DoubleSide }),
    );
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.position.y = opts.cloudHeight;
    this.clouds.renderOrder = -9;
    this.group.add(this.clouds);
  }

  /** Keep the dome centred on the camera and drift the clouds. */
  update(camera: THREE.Camera, dt: number): void {
    this.group.children[0].position.copy(camera.position);
    this.clouds.position.x = camera.position.x;
    this.clouds.position.z = camera.position.z;
    this.cloudDrift += dt * 0.004;
    // The plane follows the camera, so shift the texture back to keep clouds fixed in the world.
    this.cloudTex.offset.set(this.cloudDrift + camera.position.x / 900 * 4, -camera.position.z / 900 * 4);
  }

  private cloudDrift = 0;
}
