import * as THREE from 'three';
import type { VoxelWorld } from '../engine/world';
import { SMOKE_DURATION, SMOKE_RADIUS } from '../game/grenades';
import type { V3 } from '../net/protocol';

const MAX_PARTICLES = 700;
const MAX_DECALS = 90;
const MAX_TRACERS = 32;

interface Particle {
  p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; size: number; grav: number; color: THREE.Color; drag: number;
}

interface SmokeCloud {
  id: number;
  mesh: THREE.InstancedMesh;
  born: number;
  puffs: { o: THREE.Vector3; s: number; ph: number }[];
  center: THREE.Vector3;
}

interface Tracer { mesh: THREE.Mesh; life: number }
interface Flash { mesh: THREE.Mesh; life: number; max: number; grow: number }

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Particles, tracers, bullet holes, explosions and smoke in the world scene. */
export class Effects {
  private particles: Particle[] = [];
  private pMesh: THREE.InstancedMesh;
  private decals: THREE.Mesh[] = [];
  private decalIdx = 0;
  private tracers: Tracer[] = [];
  private flashes: Flash[] = [];
  private smokes: SmokeCloud[] = [];
  private smokeGeo = new THREE.BoxGeometry(1, 1, 1);
  private smokeMat = new THREE.MeshLambertMaterial({ color: 0xc4c8cc });
  private time = 0;
  world: VoxelWorld | null = null;

  constructor(private scene: THREE.Scene) {
    this.pMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), MAX_PARTICLES);
    this.pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pMesh.setColorAt(0, new THREE.Color());
    this.pMesh.count = 0;
    this.pMesh.frustumCulled = false;
    scene.add(this.pMesh);

    const decalGeo = new THREE.PlaneGeometry(0.09, 0.09);
    const decalMat = new THREE.MeshBasicMaterial({ color: 0x1a1714, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
    for (let i = 0; i < MAX_DECALS; i++) {
      const m = new THREE.Mesh(decalGeo, decalMat);
      m.visible = false;
      m.matrixAutoUpdate = false;
      scene.add(m);
      this.decals.push(m);
    }

    const tracerGeo = new THREE.BoxGeometry(0.018, 0.018, 1);
    tracerGeo.translate(0, 0, -0.5);
    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    for (let i = 0; i < MAX_TRACERS; i++) {
      const m = new THREE.Mesh(tracerGeo, tracerMat);
      m.visible = false;
      scene.add(m);
      this.tracers.push({ mesh: m, life: 0 });
    }
  }

  clear(): void {
    this.particles.length = 0;
    for (const d of this.decals) d.visible = false;
    for (const s of this.smokes) { this.scene.remove(s.mesh); s.mesh.dispose(); }
    this.smokes.length = 0;
    for (const f of this.flashes) this.scene.remove(f.mesh);
    this.flashes.length = 0;
  }

  burst(p: V3, n: V3 | null, color: THREE.Color, count: number, speed: number, size: number, life: number, grav = 18): void {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      if (n) v.addScaledVector(new THREE.Vector3(n[0], n[1], n[2]), 1.2).normalize();
      v.multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      const c = color.clone().multiplyScalar(0.8 + Math.random() * 0.4);
      this.particles.push({
        p: new THREE.Vector3(p[0], p[1], p[2]), v, life: life * (0.6 + Math.random() * 0.6), max: life,
        size: size * (0.6 + Math.random() * 0.8), grav, color: c, drag: 1.5,
      });
    }
  }

  /** Bullet hitting a block: chips of the block's colour plus a bullet hole. */
  impact(p: V3, n: V3, color: THREE.Color): void {
    this.burst(p, n, color, 6, 3.5, 0.06, 0.5);
    this.decal(p, n);
  }

  blood(p: V3, dir: V3): void {
    this.burst(p, dir, new THREE.Color(0.7, 0.05, 0.05), 8, 2.5, 0.07, 0.55);
  }

  decal(p: V3, n: V3): void {
    const m = this.decals[this.decalIdx];
    this.decalIdx = (this.decalIdx + 1) % MAX_DECALS;
    const normal = tmpV.set(n[0], n[1], n[2]);
    tmpQ.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    m.matrix.compose(new THREE.Vector3(p[0] + n[0] * 0.004, p[1] + n[1] * 0.004, p[2] + n[2] * 0.004), tmpQ, new THREE.Vector3(1, 1, 1));
    m.visible = true;
  }

  tracer(from: V3, to: V3): void {
    const t = this.tracers.find((x) => x.life <= 0) ?? this.tracers[0];
    const a = new THREE.Vector3(from[0], from[1], from[2]);
    const b = new THREE.Vector3(to[0], to[1], to[2]);
    const len = a.distanceTo(b);
    if (len < 0.5) return;
    t.mesh.position.copy(a);
    t.mesh.lookAt(b);
    t.mesh.rotateY(Math.PI);
    t.mesh.scale.set(1, 1, len);
    t.mesh.visible = true;
    t.life = 0.05;
  }

  /** A short bright pop (muzzle flash for other players, flashbang, explosion core). */
  pop(p: V3, color: number, size: number, life: number, grow = 0): void {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(size, size, size),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
    );
    m.position.set(p[0], p[1], p[2]);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    this.scene.add(m);
    this.flashes.push({ mesh: m, life, max: life, grow });
  }

  explosion(p: V3): void {
    this.pop(p, 0xffb040, 1.2, 0.3, 9);
    this.burst(p, [0, 1, 0], new THREE.Color(1, 0.55, 0.15), 40, 9, 0.25, 0.7, 6);
    this.burst(p, [0, 1, 0], new THREE.Color(0.25, 0.23, 0.22), 30, 5, 0.35, 1.3, -1);
    this.burst(p, [0, 1, 0], new THREE.Color(0.6, 0.55, 0.5), 20, 7, 0.1, 0.9);
  }

  flashbang(p: V3): void {
    this.pop(p, 0xffffff, 0.8, 0.25, 6);
    this.burst(p, null, new THREE.Color(1, 1, 0.9), 16, 6, 0.06, 0.4, 2);
  }

  /** Blocky smoke cloud; `age` lets late joiners see an existing cloud. */
  smoke(id: number, p: V3, age = 0): void {
    const puffs: SmokeCloud['puffs'] = [];
    const count = 46;
    for (let i = 0; i < count; i++) {
      // Points spread through a squashed sphere resting on the ground.
      const u = Math.random(), v = Math.random(), w = Math.cbrt(Math.random());
      const th = u * Math.PI * 2, ph = Math.acos(2 * v - 1);
      const r = w * SMOKE_RADIUS * 0.8;
      puffs.push({
        o: new THREE.Vector3(Math.sin(ph) * Math.cos(th) * r, Math.abs(Math.cos(ph)) * r * 0.75 + 0.6, Math.sin(ph) * Math.sin(th) * r),
        s: 1.4 + Math.random() * 1.1,
        ph: Math.random() * 10,
      });
    }
    const mesh = new THREE.InstancedMesh(this.smokeGeo, this.smokeMat, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) mesh.setColorAt(i, c.setScalar(0.82 + Math.random() * 0.18));
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.smokes.push({ id, mesh, born: this.time - age, puffs, center: new THREE.Vector3(p[0], p[1], p[2]) });
    this.burst(p, [0, 1, 0], new THREE.Color(0.8, 0.82, 0.85), 14, 3, 0.3, 0.8, -1);
  }

  update(dt: number): void {
    this.time += dt;
    // Particles.
    let n = 0;
    const col = new THREE.Color();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i];
      q.life -= dt;
      if (q.life <= 0) { this.particles.splice(i, 1); continue; }
      q.v.y -= q.grav * dt;
      q.v.multiplyScalar(Math.exp(-q.drag * dt));
      const nx = q.p.x + q.v.x * dt, ny = q.p.y + q.v.y * dt, nz = q.p.z + q.v.z * dt;
      if (this.world && this.world.solidAt(nx, ny, nz)) { q.v.set(0, 0, 0); } else q.p.set(nx, ny, nz);
    }
    for (const q of this.particles) {
      const k = Math.min(1, q.life / q.max * 1.6);
      const s = q.size * k;
      tmpM.compose(q.p, tmpQ.identity(), tmpS.set(s, s, s));
      this.pMesh.setMatrixAt(n, tmpM);
      this.pMesh.setColorAt(n, col.copy(q.color));
      n++;
    }
    this.pMesh.count = n;
    this.pMesh.instanceMatrix.needsUpdate = true;
    if (this.pMesh.instanceColor) this.pMesh.instanceColor.needsUpdate = true;

    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) t.mesh.visible = false;
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      const k = Math.max(0, f.life / f.max);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = k;
      f.mesh.scale.setScalar(1 + (1 - k) * f.grow);
      if (f.life <= 0) {
        this.scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        (f.mesh.material as THREE.Material).dispose();
        this.flashes.splice(i, 1);
      }
    }

    // Smoke: billow out, drift gently, then shrink away.
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      const age = this.time - s.born;
      if (age > SMOKE_DURATION + 1.5) {
        this.scene.remove(s.mesh);
        s.mesh.dispose();
        this.smokes.splice(i, 1);
        continue;
      }
      const grow = Math.min(1, age / 0.9);
      const fade = age > SMOKE_DURATION ? 1 - (age - SMOKE_DURATION) / 1.5 : 1;
      const k = (1 - (1 - grow) ** 3) * Math.max(0, fade);
      s.puffs.forEach((pf, j) => {
        const wob = Math.sin(this.time * 0.6 + pf.ph) * 0.15;
        tmpV.copy(pf.o).multiplyScalar(0.3 + 0.7 * k).add(s.center);
        tmpV.y += wob;
        const sz = pf.s * k * (1 + wob * 0.3);
        tmpQ.setFromAxisAngle(UP, pf.ph + this.time * 0.05);
        tmpM.compose(tmpV, tmpQ, tmpS.set(sz, sz, sz));
        s.mesh.setMatrixAt(j, tmpM);
      });
      s.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Is the camera inside a smoke cloud (to grey out the screen)? */
  insideSmoke(p: THREE.Vector3): number {
    let best = 0;
    for (const s of this.smokes) {
      const age = this.time - s.born;
      if (age < 0.6 || age > SMOKE_DURATION + 0.5) continue;
      const d = tmpV.copy(p).sub(s.center).setY((p.y - s.center.y - 1.2) * 1.3).length();
      best = Math.max(best, Math.max(0, Math.min(1, (SMOKE_RADIUS - d) / 1.2)));
    }
    return best;
  }
}
