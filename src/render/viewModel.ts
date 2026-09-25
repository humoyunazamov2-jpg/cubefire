import * as THREE from 'three';
import { WEAPONS, type WeaponId } from '../game/weapons';
import { TEAM_COLORS } from './playerModel';
import { buildVoxGeometry, voxMaterial } from './voxelModel';

const GUN_SCALE = 0.0115;

export interface ViewState {
  weapon: WeaponId;
  bobPhase: number;
  speed: number;
  onGround: boolean;
  /** 0..1 progress through a reload, or -1. */
  reload: number;
  /** 0..1 progress through drawing the weapon, or -1. */
  draw: number;
  scoped: boolean;
  lookDX: number;
  lookDY: number;
}

/** First-person arms and weapon, drawn in the view scene on top of the world. */
export class ViewModel {
  readonly root = new THREE.Group();
  private gunPivot = new THREE.Group();
  private gun: THREE.Mesh;
  private armR: THREE.Mesh;
  private armL: THREE.Mesh;
  private flash: THREE.Mesh;
  private weapon: WeaponId | null = null;
  private kick = 0;
  private swing = 0;
  private swingHeavy = false;
  private throwT = 0;
  private inspectT = 0;
  private swayX = 0;
  private swayY = 0;
  private flashT = 0;
  private sleeveMat: THREE.MeshLambertMaterial;
  private muzzle = new THREE.Vector3();

  constructor(camera: THREE.Camera) {
    camera.add(this.root);
    this.root.add(this.gunPivot);
    this.gun = new THREE.Mesh(buildVoxGeometry(WEAPONS.pistol.model, GUN_SCALE), voxMaterial);
    this.gunPivot.add(this.gun);

    this.sleeveMat = new THREE.MeshLambertMaterial({ color: TEAM_COLORS[0].main });
    const gloveMat = new THREE.MeshLambertMaterial({ color: 0x2d2a26 });
    const armGeo = new THREE.BoxGeometry(0.075, 0.075, 0.55);
    armGeo.translate(0, 0, 0.275);
    const makeArm = () => {
      const g = new THREE.Mesh(armGeo, this.sleeveMat);
      const glove = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.1), gloveMat);
      glove.position.z = 0.02;
      g.add(glove);
      return g;
    };
    this.armR = makeArm();
    this.armL = makeArm();
    this.gunPivot.add(this.armR, this.armL);

    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
    this.flash = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.1), flashMat);
    this.flash.visible = false;
    this.gunPivot.add(this.flash);
  }

  setTeam(team: number): void {
    this.sleeveMat.color.set(TEAM_COLORS[team === 1 ? 1 : 0].main);
  }

  private setWeapon(w: WeaponId): void {
    this.weapon = w;
    this.gun.geometry.dispose();
    const def = WEAPONS[w];
    this.gun.geometry = buildVoxGeometry(def.model, GUN_SCALE);
    // Muzzle: the front face of the frontmost box.
    let minZ = Infinity, my = 0, mx = 0;
    for (const [x, y, z, bw, h] of def.model) if (z < minZ) { minZ = z; my = y + h / 2; mx = x + bw / 2; }
    this.muzzle.set(mx * GUN_SCALE, my * GUN_SCALE, minZ * GUN_SCALE - 0.04);
    this.flash.position.copy(this.muzzle);

    // Each arm runs from its hand down towards a bottom corner of the screen.
    const aim = (arm: THREE.Mesh, hand: [number, number, number], towards: [number, number, number]) => {
      arm.position.set(...hand);
      const d = new THREE.Vector3(towards[0] - hand[0], towards[1] - hand[1], towards[2] - hand[2]).normalize();
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
    };
    aim(this.armR, [0.005, -0.035, 0.012], [0.2, -0.42, 0.22]);
    const twoHanded = def.slot === 'primary';
    this.armL.visible = twoHanded || def.slot === 'secondary';
    if (twoHanded) aim(this.armL, [0, -0.012, minZ * GUN_SCALE * 0.5], [-0.3, -0.42, 0.08]);
    else aim(this.armL, [-0.02, -0.05, 0.02], [-0.22, -0.45, 0.22]);
  }

  /** Fire animation: kick back, muzzle flash. */
  fire(): void {
    const def = this.weapon ? WEAPONS[this.weapon] : null;
    if (!def) return;
    if (def.slot === 'knife') { this.swing = 1; this.swingHeavy = false; return; }
    if (def.slot === 'grenade') { this.throwT = 1; return; }
    this.kick = Math.min(1.4, this.kick + (def.fireInterval > 0.5 ? 1.4 : 0.8));
    this.flashT = 0.045;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.inspectT = 0;
  }

  heavy(): void {
    this.swing = 1;
    this.swingHeavy = true;
  }

  inspect(): void {
    if (this.inspectT <= 0) this.inspectT = 2.2;
  }

  /** World-space muzzle position (approximate, for tracers). */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    this.gunPivot.updateWorldMatrix(true, false);
    return out.copy(this.muzzle).applyMatrix4(this.gunPivot.matrixWorld);
  }

  update(s: ViewState, dt: number): void {
    if (s.weapon !== this.weapon) this.setWeapon(s.weapon);
    const def = WEAPONS[s.weapon];
    this.root.visible = !s.scoped;

    // Weapon sways against the turn direction and settles back.
    this.swayX += (-s.lookDX * 0.0006 - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (s.lookDY * 0.0006 - this.swayY) * Math.min(1, dt * 10);
    this.swayX = Math.max(-0.04, Math.min(0.04, this.swayX));
    this.swayY = Math.max(-0.04, Math.min(0.04, this.swayY));

    const run = s.onGround ? Math.min(1, s.speed / 5) : 0;
    const bobX = Math.sin(s.bobPhase) * 0.011 * run;
    const bobY = -Math.abs(Math.cos(s.bobPhase)) * 0.009 * run;

    const pistol = def.slot === 'secondary';
    const base = def.slot === 'knife' ? [0.2, -0.2, -0.3] : pistol ? [0.17, -0.17, -0.34] : def.slot === 'grenade' ? [0.2, -0.2, -0.32] : [0.17, -0.19, -0.3];
    let px = base[0] + bobX + this.swayX, py = base[1] + bobY + this.swayY, pz = base[2];
    let rx = 0, ry = 0, rz = 0;

    this.kick *= Math.exp(-dt * 16);
    pz += this.kick * 0.035;
    rx += this.kick * 0.09;

    if (s.draw >= 0) {
      const e = 1 - (1 - s.draw) ** 3;
      py -= (1 - e) * 0.25;
      rx -= (1 - e) * 0.9;
    }
    if (s.reload >= 0) {
      // Dip and tilt the gun, hold, then bring it back.
      const r = s.reload;
      const k = r < 0.2 ? r / 0.2 : r > 0.82 ? (1 - r) / 0.18 : 1;
      const e = Math.sin(k * Math.PI / 2);
      py -= e * 0.08;
      rx -= e * 0.5;
      rz += e * 0.6;
    }
    if (this.swing > 0) {
      this.swing = Math.max(0, this.swing - dt * (this.swingHeavy ? 2.4 : 3.6));
      const a = Math.sin((1 - this.swing) * Math.PI);
      if (this.swingHeavy) { pz -= a * 0.14; rx -= a * 0.4; }
      else { px -= a * 0.12; ry += a * 1.1; rz -= a * 0.6; }
    }
    if (this.throwT > 0) {
      this.throwT = Math.max(0, this.throwT - dt * 3);
      const a = Math.sin((1 - this.throwT) * Math.PI);
      py += a * 0.1; pz -= a * 0.15; rx += a * 0.9;
    }
    if (this.inspectT > 0) {
      this.inspectT = Math.max(0, this.inspectT - dt);
      const t = 2.2 - this.inspectT;
      const k = Math.sin(Math.min(1, t / 0.4, this.inspectT / 0.4) * Math.PI / 2);
      ry += k * (0.9 + Math.sin(t * 2) * 0.2);
      rz += k * 0.5;
      px -= k * 0.06;
    }

    this.gunPivot.position.set(px, py, pz);
    this.gunPivot.rotation.set(rx, ry, rz);

    this.flashT -= dt;
    this.flash.visible = this.flashT > 0 && def.slot !== 'knife';
  }
}
