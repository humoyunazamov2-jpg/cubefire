import * as THREE from 'three';
import type { Target } from '../game/combat';
import type { WeaponId } from '../game/weapons';
import type { SnapPlayer, V3 } from '../net/protocol';
import { PlayerModel } from '../render/playerModel';

/** How far behind real time we render other players, to always have two snapshots to blend. */
export const INTERP_DELAY = 0.1;

export interface Interp {
  p: V3;
  v: V3;
  yaw: number;
  pitch: number;
  crouch: number;
  onGround: boolean;
  weapon: WeaponId;
  alive: boolean;
  hp: number;
  armor: number;
  helmet: boolean;
  money: number;
  flags: number;
}

const lerpAngle = (a: number, b: number, t: number) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

/** Another player as seen by this client. */
export class Remote {
  model: PlayerModel;
  private buf: { t: number; s: SnapPlayer }[] = [];
  state: Interp;
  /** Latest snapshot, not delayed (for HUD numbers). */
  latest: SnapPlayer | null = null;
  stride = 0;
  wasAlive = true;
  shownName = '';
  lastGround = true;

  constructor(readonly id: number, public team: number, public name: string, scene: THREE.Scene) {
    this.model = new PlayerModel(team === 1 ? 1 : 0, id);
    scene.add(this.model.root);
    this.state = { p: [0, 0, 0], v: [0, 0, 0], yaw: 0, pitch: 0, crouch: 0, onGround: true, weapon: 'pistol', alive: false, hp: 100, armor: 0, helmet: false, money: 0, flags: 0 };
  }

  /** Rebuild the model when a player changes team. */
  setTeam(team: number, scene: THREE.Scene): void {
    if (team === this.team) return;
    this.team = team;
    scene.remove(this.model.root);
    this.model.dispose();
    this.model = new PlayerModel(team === 1 ? 1 : 0, this.id);
    scene.add(this.model.root);
    this.shownName = '';
  }

  push(s: SnapPlayer, now: number): void {
    this.latest = s;
    // A respawn teleports: drop old samples so we don't slide across the map.
    const last = this.buf[this.buf.length - 1];
    if (last && (s.a && !last.s.a || Math.abs(s.p[0] - last.s.p[0]) + Math.abs(s.p[2] - last.s.p[2]) > 6)) this.buf.length = 0;
    this.buf.push({ t: now, s });
    if (this.buf.length > 12) this.buf.shift();
  }

  /** Interpolate to `now - INTERP_DELAY`. */
  sample(now: number): Interp {
    const rt = now - INTERP_DELAY;
    const b = this.buf;
    if (!b.length) return this.state;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].t > rt) i--;
    const s1 = b[i];
    const s0 = i > 0 ? b[i - 1] : s1;
    let k = 1;
    if (s1 !== s0 && s1.t > s0.t) k = Math.max(0, Math.min(1, (rt - s0.t) / (s1.t - s0.t)));
    const A = s0.s, B = s1.s;
    const st = this.state;
    if (rt > s1.t && s1 === b[b.length - 1]) {
      // Past the newest sample: extrapolate a little using velocity.
      const ex = Math.min(0.1, rt - s1.t);
      st.p = [B.p[0] + B.v[0] * ex, B.p[1] + (B.g ? 0 : B.v[1] * ex), B.p[2] + B.v[2] * ex];
    } else {
      st.p = [A.p[0] + (B.p[0] - A.p[0]) * k, A.p[1] + (B.p[1] - A.p[1]) * k, A.p[2] + (B.p[2] - A.p[2]) * k];
    }
    st.v = B.v;
    st.yaw = lerpAngle(A.yaw, B.yaw, k);
    st.pitch = A.pitch + (B.pitch - A.pitch) * k;
    st.crouch = A.c + (B.c - A.c) * k;
    st.onGround = B.g === 1;
    st.weapon = B.w;
    st.alive = B.a === 1;
    st.hp = B.hp;
    st.armor = B.ar;
    st.helmet = B.hm === 1;
    st.money = B.m;
    st.flags = B.f;
    return st;
  }

  target(): Target {
    const s = this.state;
    return { id: this.id, x: s.p[0], y: s.p[1], z: s.p[2], yaw: s.yaw, crouch: s.crouch };
  }

  eye(out = new THREE.Vector3()): THREE.Vector3 {
    const s = this.state;
    return out.set(s.p[0], s.p[1] + 1.62 - s.crouch * 0.42, s.p[2]);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.model.root);
    this.model.dispose();
  }
}
