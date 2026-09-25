import * as THREE from 'three';
import { mulberry32 } from '../engine/textures';
import { WEAPONS, type WeaponId } from '../game/weapons';
import { buildVoxGeometry, voxMaterial } from './voxelModel';

// Blocky character: 8px head, 8x12x4 torso, 4x12x4 limbs, like classic voxel games.
// Model faces -Z; 1 skin pixel = PX metres.
const PX = 0.055;
const SKIN_W = 64, SKIN_H = 64;

export const TEAM_COLORS = [
  { name: 'Blaze', main: '#d4541c', dark: '#8e3210', light: '#f59a4a', css: '#ff7a33' },
  { name: 'Frost', main: '#2f6fd0', dark: '#1d4585', light: '#7fb3f5', css: '#4ea2ff' },
] as const;

const SKIN_TONES = ['#f1c7a1', '#e0ac7e', '#c68b5c', '#9c6a44', '#704a2e', '#f5d5b8'];

type Region = { u: number; v: number; w: number; h: number; d: number };
// Texture regions (pixels) for each part's box unwrap.
const R: Record<string, Region> = {
  head: { u: 0, v: 0, w: 8, h: 8, d: 8 },
  torso: { u: 0, v: 16, w: 8, h: 12, d: 4 },
  armR: { u: 32, v: 0, w: 4, h: 12, d: 4 },
  armL: { u: 48, v: 0, w: 4, h: 12, d: 4 },
  legR: { u: 32, v: 16, w: 4, h: 12, d: 4 },
  legL: { u: 48, v: 16, w: 4, h: 12, d: 4 },
};

/** Pixel rectangles of each face within a region: [x, y, w, h] in texture pixels. */
function faceRects(r: Region) {
  const { u, v, w, h, d } = r;
  return {
    top: [u + d, v, w, d],
    bottom: [u + d + w, v, w, d],
    right: [u, v + d, d, h],          // +x side
    front: [u + d, v + d, w, h],      // -z (the way the model faces)
    left: [u + d + w, v + d, d, h],   // -x side
    back: [u + 2 * d + w, v + d, w, h],
  } as const;
}

function paintSkin(team: number, seed: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = SKIN_W; cv.height = SKIN_H;
  const g = cv.getContext('2d')!;
  const r = mulberry32(seed * 131 + team * 7 + 1);
  const tc = TEAM_COLORS[team];
  const skin = SKIN_TONES[Math.floor(r() * SKIN_TONES.length)];
  const px = (x: number, y: number, c: string) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
  const jitter = (rect0: readonly number[], c: string, amt: number) => {
    const base = new THREE.Color(c);
    for (let y = rect0[1]; y < rect0[1] + rect0[3]; y++)
      for (let x = rect0[0]; x < rect0[0] + rect0[2]; x++) {
        const k = 1 + (r() - 0.5) * amt;
        px(x, y, `#${base.clone().multiplyScalar(k).getHexString()}`);
      }
  };

  // Head: skin all round, then headgear.
  const H = faceRects(R.head);
  for (const f of Object.values(H)) jitter(f, skin, 0.08);
  const [fx, fy] = H.front;
  if (team === 0) {
    // Blaze: dark hair, orange bandana.
    const hair = ['#2b1a10', '#4a2e18', '#1a1a1a'][Math.floor(r() * 3)];
    jitter(H.top, hair, 0.2);
    for (const f of [H.left, H.right, H.back]) jitter([f[0], f[1], f[2], 3], hair, 0.2);
    jitter([H.back[0], H.back[1], H.back[2], 6], hair, 0.2);
    for (const f of [H.front, H.left, H.right, H.back]) jitter([f[0], f[1] + 1, f[2], 2], tc.main, 0.15);
    jitter([fx, fy + 5, 8, 3], tc.dark, 0.12); // face mask
  } else {
    // Frost: white helmet with a visor band.
    for (const f of [H.top]) jitter(f, '#e6ebf0', 0.06);
    for (const f of [H.front, H.left, H.right, H.back]) jitter([f[0], f[1], f[2], 3], '#dde3ea', 0.06);
    jitter([H.back[0], H.back[1], H.back[2], 6], '#dde3ea', 0.06);
    for (const f of [H.left, H.right]) jitter([f[0], f[1] + 3, f[2], 1], tc.dark, 0.1);
    jitter([fx, fy + 3, 8, 2], '#1b2735', 0.1);
    px(fx + 2, fy + 3, tc.light); px(fx + 5, fy + 3, tc.light);
  }
  // Eyes (visible under the bandana for Blaze).
  if (team === 0) {
    px(fx + 1, fy + 4, '#ffffff'); px(fx + 2, fy + 4, '#2a3a60');
    px(fx + 5, fy + 4, '#2a3a60'); px(fx + 6, fy + 4, '#ffffff');
  } else {
    px(fx + 3, fy + 6, '#8a4a3a'); px(fx + 4, fy + 6, '#8a4a3a');
  }

  // Torso: jacket, tactical vest, belt.
  const T = faceRects(R.torso);
  for (const f of Object.values(T)) jitter(f, tc.main, 0.12);
  jitter([T.front[0] + 1, T.front[1] + 1, 6, 7], '#3a3d33', 0.15);
  jitter([T.back[0] + 1, T.back[1] + 1, 6, 7], '#3a3d33', 0.15);
  px(T.front[0] + 2, T.front[1] + 3, '#55594a'); px(T.front[0] + 5, T.front[1] + 3, '#55594a');
  px(T.front[0] + 2, T.front[1] + 5, '#55594a'); px(T.front[0] + 5, T.front[1] + 5, '#55594a');
  for (const f of [T.front, T.back, T.left, T.right]) jitter([f[0], f[1] + 9, f[2], 1], '#2a2420', 0.1);
  px(T.front[0] + 3, T.front[1] + 9, '#b8a060'); px(T.front[0] + 4, T.front[1] + 9, '#b8a060');
  // Team stripe on the shoulders.
  jitter([T.top[0], T.top[1], T.top[2], T.top[3]], tc.dark, 0.1);

  // Arms: sleeves with gloves.
  for (const k of ['armR', 'armL']) {
    const A = faceRects(R[k]);
    for (const f of Object.values(A)) jitter(f, tc.main, 0.12);
    for (const f of [A.front, A.back, A.left, A.right]) jitter([f[0], f[1] + 9, f[2], 3], '#2d2a26', 0.15);
    jitter(A.bottom, '#2d2a26', 0.15);
    for (const f of [A.front, A.back, A.left, A.right]) jitter([f[0], f[1] + 3, f[2], 1], tc.dark, 0.1);
  }
  // Legs: trousers and boots.
  const pants = team === 0 ? '#6e5a3e' : '#2b3446';
  for (const k of ['legR', 'legL']) {
    const L = faceRects(R[k]);
    for (const f of Object.values(L)) jitter(f, pants, 0.14);
    for (const f of [L.front, L.back, L.left, L.right]) jitter([f[0], f[1] + 9, f[2], 3], '#24201c', 0.15);
    jitter(L.bottom, '#1c1916', 0.1);
    jitter([L.front[0], L.front[1] + 5, L.front[2], 2], team === 0 ? '#5a4a32' : '#232b3a', 0.1);
  }
  return cv;
}

/** Box geometry whose UVs map onto a region of the 64x64 skin. */
function skinBox(r: Region): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(r.w * PX, r.h * PX, r.d * PX);
  const F = faceRects(r);
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z. On -x the model's left.
  const order = [F.right, F.left, F.top, F.bottom, F.back, F.front];
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let f = 0; f < 6; f++) {
    const [x, y, w, h] = order[f];
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      const u0 = uv.getX(k), v0 = uv.getY(k);
      uv.setXY(k, (x + u0 * w) / SKIN_W, 1 - (y + (1 - v0) * h) / SKIN_H);
    }
  }
  return geo;
}

const geoCache = new Map<string, THREE.BoxGeometry>();
const getGeo = (k: string) => {
  let g = geoCache.get(k);
  if (!g) { g = skinBox(R[k]); geoCache.set(k, g); }
  return g;
};

const gunGeoCache = new Map<WeaponId, THREE.BufferGeometry>();
export function gunGeometry(id: WeaponId, scale: number): THREE.BufferGeometry {
  if (scale !== 0.03) return buildVoxGeometry(WEAPONS[id].model, scale);
  let g = gunGeoCache.get(id);
  if (!g) { g = buildVoxGeometry(WEAPONS[id].model, scale); gunGeoCache.set(id, g); }
  return g;
}

export interface PoseState {
  yaw: number;
  pitch: number;
  crouch: number;       // 0..1
  speed: number;        // horizontal speed, m/s
  onGround: boolean;
  alive: boolean;
  weapon: WeaponId;
}

/** Animated third-person character. */
export class PlayerModel {
  readonly root = new THREE.Group();
  private hips = new THREE.Group();
  private head = new THREE.Group();
  private armR = new THREE.Group();
  private armL = new THREE.Group();
  private legR = new THREE.Group();
  private legL = new THREE.Group();
  private gun: THREE.Mesh;
  private gunId: WeaponId | null = null;
  private material: THREE.MeshLambertMaterial;
  private walkPhase = 0;
  private deathT = 0;
  private flashT = 0;
  private nameTag: THREE.Sprite | null = null;

  constructor(readonly team: number, seed: number) {
    const tex = new THREE.CanvasTexture(paintSkin(team, seed));
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.MeshLambertMaterial({ map: tex });

    const part = (key: string, parent: THREE.Group, y: number) => {
      const m = new THREE.Mesh(getGeo(key), this.material);
      m.position.y = y;
      parent.add(m);
      return m;
    };
    const legH = 12 * PX, torsoH = 12 * PX;
    this.root.add(this.hips, this.legR, this.legL);
    this.hips.position.y = legH;
    part('torso', this.hips, torsoH / 2);
    this.head.position.y = torsoH;
    part('head', this.head, 4 * PX);
    this.hips.add(this.head);
    this.armR.position.set(6 * PX, torsoH - 2 * PX, 0);
    this.armL.position.set(-6 * PX, torsoH - 2 * PX, 0);
    part('armR', this.armR, -4 * PX);
    part('armL', this.armL, -4 * PX);
    this.hips.add(this.armR, this.armL);
    this.legR.position.set(2 * PX, legH, 0);
    this.legL.position.set(-2 * PX, legH, 0);
    part('legR', this.legR, -6 * PX);
    part('legL', this.legL, -6 * PX);

    this.gun = new THREE.Mesh(gunGeometry('pistol', 0.03), voxMaterial);
    this.gun.position.set(0, -10 * PX, -0.5 * PX);
    this.gun.rotation.x = -Math.PI / 2;
    this.armR.add(this.gun);

    this.root.rotation.order = 'YXZ';
    this.armR.rotation.order = 'YXZ';
    this.armL.rotation.order = 'YXZ';
  }

  setName(name: string | null, color = '#ffffff'): void {
    if (this.nameTag) { this.root.remove(this.nameTag); this.nameTag.material.map?.dispose(); this.nameTag.material.dispose(); this.nameTag = null; }
    if (!name) return;
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 48;
    const g = cv.getContext('2d')!;
    g.font = '28px Silkscreen, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(0,0,0,0.45)';
    const w = Math.min(250, g.measureText(name).width + 20);
    g.fillRect(128 - w / 2, 4, w, 40);
    g.fillStyle = color;
    g.fillText(name, 128, 25);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.nameTag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    this.nameTag.scale.set(1.2, 0.225, 1);
    this.nameTag.position.y = 2.15;
    this.nameTag.renderOrder = 5;
    this.root.add(this.nameTag);
  }

  setNameVisible(v: boolean): void {
    if (this.nameTag) this.nameTag.visible = v;
  }

  /** Brief red tint when hit. */
  flash(): void {
    this.flashT = 0.12;
  }

  update(p: PoseState, dt: number): void {
    if (this.gunId !== p.weapon) {
      this.gunId = p.weapon;
      this.gun.geometry = gunGeometry(p.weapon, 0.03);
      const nade = WEAPONS[p.weapon].slot === 'grenade';
      this.gun.position.set(0, -10 * PX, nade ? 0 : -0.5 * PX);
    }
    this.root.rotation.y = p.yaw;

    this.flashT = Math.max(0, this.flashT - dt);
    this.material.emissive.setRGB(this.flashT > 0 ? 0.6 : 0, 0, 0);

    if (!p.alive) {
      // Topple backwards and settle.
      this.deathT = Math.min(1, this.deathT + dt * 3);
      const e = 1 - (1 - this.deathT) ** 3;
      this.hips.rotation.x = 0;
      this.root.rotation.x = e * (Math.PI / 2 - 0.05);
      this.armR.rotation.set(-0.3 * e, 0, 0.4 * e);
      this.armL.rotation.set(-0.3 * e, 0, -0.4 * e);
      this.legR.rotation.set(0, 0, 0);
      this.legL.rotation.set(0, 0, 0);
      this.gun.visible = false;
      if (this.nameTag) this.nameTag.visible = false;
      return;
    }
    this.deathT = 0;
    this.root.rotation.x = 0;
    this.gun.visible = true;

    // Walk cycle driven by distance travelled.
    const moving = p.onGround ? Math.min(1, p.speed / 4) : 0;
    this.walkPhase += dt * (4 + p.speed * 1.6) * (moving > 0.05 ? 1 : 0);
    const swing = Math.sin(this.walkPhase) * 0.75 * moving;

    const c = p.crouch;
    this.hips.position.y = 12 * PX - c * 0.28;
    this.hips.rotation.x = -c * 0.35;
    this.legR.position.y = this.legL.position.y = 12 * PX - c * 0.28;
    // Crouch folds the legs: one knee forward, one back.
    this.legR.rotation.x = swing * (1 - c) - c * 1.0;
    this.legL.rotation.x = -swing * (1 - c) + c * 0.45;
    if (!p.onGround) { this.legR.rotation.x = -0.35; this.legL.rotation.x = 0.25; }

    // Head follows pitch; arms hold the gun aimed along pitch.
    const pitch = Math.max(-1.2, Math.min(1.2, p.pitch));
    this.head.rotation.x = pitch * 0.8 + c * 0.35;
    const knife = WEAPONS[p.weapon].slot === 'knife';
    const aim = Math.PI / 2 + pitch + c * 0.35;
    this.armR.rotation.set(aim - (knife ? 0.4 : 0), knife ? 0.1 : 0.08, 0);
    if (knife || WEAPONS[p.weapon].slot === 'grenade') {
      this.armL.rotation.set(swing * 0.6, 0, 0);
    } else {
      // Support hand reaches across to the barrel.
      this.armL.rotation.set(aim + 0.1, -0.6, 0);
    }
  }

  dispose(): void {
    this.material.map?.dispose();
    this.material.dispose();
    this.setName(null);
  }
}
