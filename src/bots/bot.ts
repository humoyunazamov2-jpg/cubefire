import { Arsenal } from '../game/arsenal';
import { applySpread, rayTarget } from '../game/combat';
import { FUSE, nadeReady, stepNade, throwVelocity, type Nade } from '../game/grenades';
import { eyeHeight, newBody, stepMove, type Body, type MoveInput } from '../game/physics';
import type { GrenadeId, ItemId, WeaponId } from '../game/weapons';
import type { BotBrain, HostSession } from '../host/host';
import type { HostPlayer } from '../host/hostPlayer';
import { PF_BLIND, PF_RELOADING, PF_SCOPED, PF_WALKING, type V3 } from '../net/protocol';
import { EDGE_JUMP, EDGE_WALK, NavGrid } from './nav';

/** How good a bot is, picked by the room's bot skill (0 easy, 1 normal, 2 hard). */
interface Skill {
  /** Seconds from first seeing an enemy to the first shot. */
  react: number;
  /** Aim error (radians) when an enemy first appears, and what it settles to. */
  aimErr: number;
  aimMin: number;
  /** Seconds for the aim error to shrink by about two thirds. */
  settle: number;
  /** Fastest turn, radians per second. */
  turn: number;
  /** Chance to go for the head instead of the chest. */
  head: number;
  /** How much of the recoil climb the bot pulls down (0..1). */
  recoil: number;
  /** Half of the field of view, degrees. */
  fov: number;
  /** Shots per burst at medium range. */
  burst: [number, number];
  /** Chance to keep shooting while still moving (inaccurate). */
  runAndGun: number;
  /** Chance to side-step between bursts. */
  strafe: number;
  /** How keen the bot is on grenades. */
  nades: number;
}

const SKILLS: Skill[] = [
  { react: 0.7, aimErr: 0.16, aimMin: 0.03, settle: 0.9, turn: 3.5, head: 0.1, recoil: 0.25, fov: 55, burst: [3, 6], runAndGun: 0.45, strafe: 0.15, nades: 0.15 },
  { react: 0.42, aimErr: 0.1, aimMin: 0.016, settle: 0.55, turn: 6, head: 0.3, recoil: 0.55, fov: 62, burst: [3, 8], runAndGun: 0.2, strafe: 0.45, nades: 0.35 },
  { react: 0.25, aimErr: 0.06, aimMin: 0.007, settle: 0.32, turn: 10, head: 0.55, recoil: 0.85, fov: 70, burst: [4, 10], runAndGun: 0.05, strafe: 0.75, nades: 0.6 },
];

type GoalKind = 'push' | 'hold' | 'hunt' | 'chase' | 'wander';

const STEP = 1 / 120;
const TAU = Math.PI * 2;
const wrap = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);
/** Yaw that looks along (dx, dz); yaw 0 looks down -Z. */
const yawTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);
const dirFrom = (yaw: number, pitch: number): V3 => [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];
const dist2d = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/** Route points already taken by a teammate this round, so bots spread out. */
const claimed = new WeakMap<HostSession, { round: number; keys: Set<string> }>();

/** Path searches allowed per host tick across all bots, so they never pile up into a stutter. */
const PATHS_PER_TICK = 2;
const pathBudget = new WeakMap<HostSession, { time: number; used: number }>();
function takePathBudget(h: HostSession): boolean {
  let b = pathBudget.get(h);
  if (!b || b.time !== h.time) { b = { time: h.time, used: 0 }; pathBudget.set(h, b); }
  if (b.used >= PATHS_PER_TICK) return false;
  b.used++;
  return true;
}

export const createBot = (host: HostSession, p: HostPlayer): BotBrain => new Bot(host, p);

/**
 * One computer-controlled player, run by the host. It moves with the same
 * physics as people, only knows what it can see (or hear), and shoots
 * through the same weapon code with human-like reaction time and aim error.
 */
export class Bot implements BotBrain {
  private body: Body = newBody();
  private arsenal = new Arsenal();
  private nav: NavGrid | null = null;
  private skill: Skill = SKILLS[1];
  private yaw = 0;
  private pitch = 0;
  private punchPitch = 0;
  private punchYaw = 0;
  private tick = 0;
  private liveSince = -1;

  // Route.
  private goal: V3 | null = null;
  private goalKind: GoalKind = 'push';
  private path: V3[] = [];
  private kinds: number[] = [];
  private wp = 0;
  private arrivedAt = -1;
  private holdUntil = 0;
  private watch: V3 | null = null;
  private visited = new Set<string>();
  private repathAt = 0;
  private smoothAt = 0;
  private stuckCheckAt = 0;
  private stuckDist = Infinity;
  private stuck = 0;
  private chaseUntil = 0;
  private huntAt = 0;

  // Combat.
  private target: HostPlayer | null = null;
  private readyAt = 0;
  private trackStart = 0;
  private lastSeen = -99;
  private lastPos: V3 | null = null;
  private aimHead = false;
  private err: [number, number] = [0, 0];
  private errGoal: [number, number] = [0, 0];
  private errAt = 0;
  private burstLeft = 0;
  private pauseUntil = 0;
  private clickAt = 0;
  private strafeDir: V3 | null = null;
  private strafeUntil = 0;
  private crouchFight = false;
  private sprayMoving = false;
  private alertPos: V3 | null = null;
  private alertUntil = 0;

  // Buying and grenades.
  private buyAt = -1;
  private nade: { g: GrenadeId; yaw: number; pitch: number; until: number; target: V3 } | null = null;
  private nadeCheckAt = 0;
  private lookAway: V3 | null = null;
  private lookAwayUntil = 0;

  constructor(private host: HostSession, private p: HostPlayer) {}

  // ---------------------------------------------------------------- host hooks

  onRoundStart(): void {
    const h = this.host, p = this.p;
    if (!h.map) return;
    this.nav = NavGrid.for(h.map);
    this.skill = SKILLS[h.settings.botSkill] ?? SKILLS[1];
    this.body = newBody(p.p[0], p.p[1], p.p[2]);
    this.body.onGround = true;
    this.yaw = p.yaw;
    this.pitch = 0;
    this.punchPitch = this.punchYaw = 0;
    this.liveSince = h.sandbox ? h.time : -1;
    this.target = null;
    this.lastPos = null;
    this.lastSeen = -99;
    this.alertPos = null;
    this.nade = null;
    this.lookAway = null;
    this.strafeDir = null;
    this.visited.clear();
    this.arsenal.setInventory(structuredClone(p.inv), h.time);
    this.arsenal.switchTo(this.arsenal.best(), h.time);
    this.planRound();
    this.buyAt = h.sandbox ? -1 : h.time + rand(0.4, 2.5);
  }

  onInventory(give?: { w: WeaponId; ammo: [number, number] }, reset?: boolean): void {
    this.arsenal.setInventory(structuredClone(this.p.inv), this.host.time, give, reset);
  }

  onDamaged(from: V3, attacker: number): void {
    const a = this.host.players.get(attacker);
    if (!a || a.team === this.p.team) return;
    // Turn towards the shooter; if they are visible, perception picks them up.
    this.alert(from, 2.5);
    if (!this.target) {
      this.lastPos = [a.p[0], a.p[1], a.p[2]];
      this.lastSeen = this.host.time - 1;
    }
  }

  onSound(pos: V3, loud: boolean, from: number): void {
    const src = this.host.players.get(from);
    if (from === this.p.id || (src && src.team === this.p.team)) return;
    const d = dist2d(pos, this.p.p);
    if (d > (loud ? 45 : 15)) return;
    this.alert(pos, 2);
    // Hunting bots go and have a look.
    if (!this.target && (this.goalKind === 'hunt' || this.goalKind === 'push') && d < 30 && Math.random() < 0.5) {
      this.setGoal(pos, 'chase');
      this.chaseUntil = this.host.time + 8;
    }
  }

  private alert(pos: V3, seconds: number): void {
    this.alertPos = [pos[0], pos[1], pos[2]];
    this.alertUntil = this.host.time + seconds;
  }

  // ---------------------------------------------------------------- main loop

  update(dt: number): void {
    const h = this.host, p = this.p, now = h.time, a = this.arsenal;
    if (!h.world || !h.map) return;
    if (!this.nav) { this.onRoundStart(); return; }
    this.tick++;
    a.update(now);
    const frozen = h.phase === 'freeze' && !h.sandbox;
    const canFight = !h.sandbox && (h.phase === 'live' || h.phase === 'roundEnd');
    if (h.phase === 'live' && this.liveSince < 0) this.liveSince = now;

    if (this.buyAt >= 0 && now >= this.buyAt) { this.buyAt = -1; this.buy(); }
    if (canFight && (this.tick + p.id) % 3 === 0) this.perceive(now);
    if (!canFight) this.target = null;

    let move: V3 | null = null;
    let walk = false, crouch = false, jump = false;
    let look: { yaw: number; pitch: number; gain: number } | null = null;

    const t = this.target;
    const engaged = canFight && t && t.alive && now - this.lastSeen < 0.3;
    if (engaged) {
      this.nade = null;
      const r = this.engage(t!, now, dt);
      move = r.move; walk = r.walk; crouch = r.crouch; look = r.look;
    } else {
      if (t) this.lostTarget(now);
      this.pickWeapon(now);
      if (this.nade) {
        look = { yaw: this.nade.yaw, pitch: this.nade.pitch, gain: 12 };
        this.stepNade(now);
      } else {
        if (canFight && !frozen) this.considerNade(now);
        if (!frozen) {
          const r = this.navigate(now);
          move = r.move; jump = r.jump; walk = r.walk;
        }
        look = this.idleLook(now);
      }
    }

    // Flashed: freeze up until the eyes recover.
    if (now < p.blindUntil) { move = null; jump = false; }
    if (look) this.turn(look.yaw, look.pitch, look.gain, dt);
    if (now - a.lastShot > 0.12) {
      const k = Math.exp(-dt * 6);
      this.punchPitch *= k;
      this.punchYaw *= k;
    }
    this.physics(frozen ? null : move, walk, crouch, jump);
    this.writeBack(now, walk);
  }

  // ---------------------------------------------------------------- perception

  private eye(): V3 {
    const b = this.body;
    return [b.x, b.y + eyeHeight(b), b.z];
  }

  /** Point on another player to look or shoot at. */
  private aimPoint(q: HostPlayer, head: boolean): V3 {
    const c = q.crouch;
    return [q.p[0], q.p[1] + (head ? 1.55 - c * 0.28 : 1.0 - c * 0.28), q.p[2]];
  }

  private perceive(now: number): void {
    const h = this.host, p = this.p, world = h.world!;
    if (now < p.blindUntil) return;
    const eye = this.eye();
    const look = dirFrom(this.yaw, this.pitch);
    const cosFov = Math.cos((this.skill.fov * Math.PI) / 180);
    let best: HostPlayer | null = null, bestD = Infinity;
    for (const q of h.players.values()) {
      if (!q.alive || q.team === p.team || q.team === -1) continue;
      const chest = this.aimPoint(q, false);
      const dx = chest[0] - eye[0], dy = chest[1] - eye[1], dz = chest[2] - eye[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > 110) continue;
      // Running footsteps give people away up close, even behind you.
      if (d < 14 && q.onGround && Math.hypot(q.v[0], q.v[2]) > 3.2 && !this.target) this.alert(q.p, 1.5);
      const tracking = q === this.target;
      const facing = (dx * look[0] + dy * look[1] + dz * look[2]) / (d || 1);
      if (d > 2 && facing < (tracking ? Math.cos(1.4) : cosFov)) continue;
      const seen = [chest, this.aimPoint(q, true)].some((pt) =>
        world.lineOfSight(eye[0], eye[1], eye[2], pt[0], pt[1], pt[2]) && !h.smokeBlocks(eye, pt));
      if (seen && (d < bestD || tracking && d < bestD * 1.5)) { best = q; bestD = d; }
    }
    if (!best) return;
    if (best !== this.target) {
      // Someone we already expected (turned towards a noise or hit) is spotted faster.
      const expected = this.alertPos && now < this.alertUntil;
      this.target = best;
      this.readyAt = now + this.skill.react * rand(0.8, 1.25) * (expected ? 0.6 : 1);
      this.trackStart = now;
      this.aimHead = Math.random() < this.skill.head;
      this.newErr(true);
      this.burstLeft = 0;
      this.pauseUntil = 0;
      this.crouchFight = bestD > 18 && this.skill.recoil > 0.5 && Math.random() < 0.35;
    }
    this.lastSeen = now;
    this.lastPos = [best.p[0], best.p[1], best.p[2]];
  }

  private newErr(snap: boolean): void {
    // Random direction and size, so a shaky aim still lands some of the time.
    const a = Math.random() * TAU, m = Math.random();
    this.errGoal = [Math.cos(a) * m, Math.sin(a) * m * 0.6];
    if (snap) this.err = [...this.errGoal];
    this.errAt = this.host.time + rand(0.25, 0.5);
  }

  private lostTarget(now: number): void {
    const t = this.target!;
    this.target = null;
    this.strafeDir = null;
    if (!t.alive || !this.lastPos || now < this.p.blindUntil) return;
    // Go to where they were last seen, carefully.
    if (this.host.phase === 'live') {
      this.setGoal(this.lastPos, 'chase');
      this.chaseUntil = now + rand(4, 8);
    }
  }

  // ---------------------------------------------------------------- fighting

  private engage(t: HostPlayer, now: number, dt: number): { move: V3 | null; walk: boolean; crouch: boolean; look: { yaw: number; pitch: number; gain: number } } {
    const a = this.arsenal, sk = this.skill, b = this.body;
    const eye = this.eye();
    const pt = this.aimPoint(t, this.aimHead);
    const dx = pt[0] - eye[0], dy = pt[1] - eye[1], dz = pt[2] - eye[2];
    const flat = Math.hypot(dx, dz), d = Math.hypot(flat, dy);

    // Aim error shrinks while tracking and wobbles around a little.
    if (now >= this.errAt) this.newErr(false);
    const kErr = Math.min(1, dt * 4);
    this.err[0] += (this.errGoal[0] - this.err[0]) * kErr;
    this.err[1] += (this.errGoal[1] - this.err[1]) * kErr;
    const size = sk.aimMin + (sk.aimErr - sk.aimMin) * Math.exp(-(now - this.trackStart) / sk.settle);
    const wantYaw = yawTo(dx, dz) + this.err[0] * size;
    const wantPitch = Math.atan2(dy, flat) + this.err[1] * size;
    const look = { yaw: wantYaw, pitch: wantPitch, gain: 16 };

    this.pickFightWeapon(d, now);
    const def = a.def;
    const speed = Math.hypot(b.vx, b.vz);
    let move: V3 | null = null;
    let crouch = this.crouchFight;

    // Knife or shotgun out of range: close the distance.
    const tooFar = (def.slot === 'knife' && d > 1.6) || (def.id === 'shotgun' && d > 14);
    if (tooFar) {
      this.setGoal(t.p, 'chase');
      move = this.navigate(now).move;
      crouch = false;
    } else if (now < this.strafeUntil && this.strafeDir) {
      move = this.strafeDir;
      crouch = false;
    } else if (speed > 1.2 && !this.sprayMoving) {
      // Counter-strafe: push against our own motion to stop quickly.
      move = [-b.vx / speed, 0, -b.vz / speed];
    }

    // Scoped weapons need the scope up.
    if (def.zoom.length && a.zoom === 0 && !a.reloading && now >= a.drawEnd) { a.toggleZoom(); this.clickAt = now + 0.15; }

    // Out of bullets: reload, or pull the pistol if they are close.
    if (def.magSize > 0 && a.current[0] === 0 && !a.reloading) {
      const pistol = a.inv.secondary;
      if (a.active === a.inv.primary && pistol && (a.ammo.get(pistol)?.[0] ?? 0) > 0 && d < 20) a.switchTo(pistol, now);
      else if (a.current[1] > 0) a.reload(now);
    }

    const aimed = Math.abs(wrap(this.yaw - wantYaw)) < Math.max(0.015, 0.3 / d) && Math.abs(this.pitch - wantPitch) < Math.max(0.015, 0.4 / d);
    const steady = speed <= 1.4 || this.sprayMoving || def.slot === 'knife';
    if (now >= this.readyAt && aimed && steady && now >= this.pauseUntil && !this.friendInWay(eye, d)) this.fire(now, d);
    return { move, walk: false, crouch, look };
  }

  /** Switch guns in a fight: best weapon that still has bullets. */
  private pickFightWeapon(d: number, now: number): void {
    const a = this.arsenal;
    if (now < a.drawEnd || a.reloading) return;
    const has = (w: WeaponId | null) => !!w && ((a.ammo.get(w)?.[0] ?? 0) + (a.ammo.get(w)?.[1] ?? 0)) > 0;
    if (a.def.slot === 'grenade' || (a.def.slot === 'knife' && d > 1.6)) {
      const w = has(a.inv.primary) ? a.inv.primary : has(a.inv.secondary) ? a.inv.secondary : null;
      if (w) a.switchTo(w, now);
    } else if (a.def.magSize > 0 && !has(a.active)) {
      const w = has(a.inv.primary) ? a.inv.primary : has(a.inv.secondary) ? a.inv.secondary : 'knife';
      a.switchTo(w!, now);
    }
  }

  /** Don't shoot through a teammate. */
  private friendInWay(eye: V3, d: number): boolean {
    const dir = dirFrom(this.yaw, this.pitch);
    for (const q of this.host.players.values()) {
      if (q === this.p || !q.alive || q.team !== this.p.team) continue;
      const hit = rayTarget({ id: q.id, x: q.p[0], y: q.p[1], z: q.p[2], yaw: q.yaw, crouch: q.crouch }, eye[0], eye[1], eye[2], dir[0], dir[1], dir[2]);
      if (hit && hit.dist < d) return true;
    }
    return false;
  }

  private fire(now: number, d: number): void {
    const a = this.arsenal, def = a.def, sk = this.skill, b = this.body;
    if (def.slot === 'grenade') return;
    let shot: boolean;
    if (def.slot === 'knife') shot = d < 1.8 && a.tryFire(now, true, true);
    else if (def.auto) shot = a.tryFire(now, true, true);
    else {
      // Semi-automatic: let go of the trigger, then click again once the gun is ready.
      a.tryFire(now, false, false);
      shot = now >= this.clickAt && a.tryFire(now, true, true);
      if (shot) this.clickAt = now + def.fireInterval + rand(0.03, 0.12) + (d > 25 ? 0.12 : 0);
    }
    if (!shot) return;

    const eye = this.eye();
    const yaw = this.yaw + this.punchYaw * (1 - sk.recoil);
    const pitch = this.pitch + this.punchPitch * (1 - sk.recoil);
    const dir = dirFrom(yaw, pitch);
    const speed = Math.hypot(b.vx, b.vz);
    const spread = def.slot === 'knife' ? 0 : a.spread(speed, b.onGround, b.crouchT, false);
    const dirs: V3[] = [];
    for (let i = 0; i < Math.max(1, def.pellets); i++) dirs.push(applySpread(dir, spread, Math.random));
    this.host.botFire(this.p, a.active, eye, dirs);
    if (def.slot !== 'knife') {
      const [up, side] = a.recoil();
      this.punchPitch += up;
      this.punchYaw += side;
    }

    // Bursts: tap at range, spray up close, then pause (and maybe side-step).
    if (def.auto && def.slot !== 'knife') {
      if (this.burstLeft <= 0) {
        this.burstLeft = d > 28 ? Math.ceil(rand(1, 3)) : d > 10 ? Math.round(rand(sk.burst[0], sk.burst[1])) : sk.burst[1] * 2;
        this.sprayMoving = Math.random() < sk.runAndGun;
      }
      if (--this.burstLeft <= 0) {
        this.pauseUntil = now + (d > 28 ? rand(0.3, 0.5) : rand(0.15, 0.35));
        this.maybeStrafe(now);
      }
    } else if (Math.random() < sk.strafe * 0.5) this.maybeStrafe(now);
  }

  /** Side-step a little between bursts, if the floor there is safe. */
  private maybeStrafe(now: number): void {
    if (Math.random() > this.skill.strafe || !this.target || !this.nav) return;
    const t = this.target, b = this.body;
    const dx = t.p[0] - b.x, dz = t.p[2] - b.z, l = Math.hypot(dx, dz) || 1;
    const side = Math.random() < 0.5 ? 1 : -1;
    const dir: V3 = [(-dz / l) * side, 0, (dx / l) * side];
    const probe: V3 = [b.x + dir[0] * 1.5, b.y, b.z + dir[2] * 1.5];
    if (!this.nav.straight([b.x, b.y, b.z], probe)) return;
    this.strafeDir = dir;
    this.strafeUntil = now + rand(0.25, 0.5);
  }

  // ---------------------------------------------------------------- weapons out of combat

  private pickWeapon(now: number): void {
    const a = this.arsenal;
    if (this.nade || now < a.drawEnd) return;
    if (a.zoom > 0 && now - this.lastSeen > 1) a.zoom = 0;
    const best = a.best();
    if (a.active !== best && (a.def.slot === 'knife' || a.def.slot === 'grenade' || a.active === a.inv.secondary && best === a.inv.primary)) a.switchTo(best, now);
    // Top up the magazine when things are quiet.
    const [mag, reserve] = a.current;
    if (a.def.magSize > 0 && !a.reloading && reserve > 0 && mag < a.def.magSize * 0.6 && now - this.lastSeen > 1.5) a.reload(now);
  }

  // ---------------------------------------------------------------- planning and movement

  /** Choose what to do this round: hold a spot on our side for a bit, or push. */
  private planRound(): void {
    const h = this.host, map = h.map!, half = h.world!.sx / 2;
    const side = h.sideOf(this.p.team);
    const mineSide = (pt: V3) => (pt[0] < half) === (side === 0);
    const mine = map.points.filter(mineSide);
    const theirs = map.points.filter((pt) => !mineSide(pt));
    const enemySpawn = map.spawns[1 - side][0];
    this.watch = [enemySpawn.x, enemySpawn.y, enemySpawn.z];
    if (h.sandbox) {
      this.setGoal(this.claim(mine), 'wander');
      return;
    }
    if (Math.random() < 0.4 && mine.length) {
      // Hold: prefer spots towards the middle.
      const mid = [...mine].sort((a, b) => Math.abs(a[0] - half) - Math.abs(b[0] - half)).slice(0, Math.max(2, Math.ceil(mine.length / 2)));
      this.setGoal(this.claim(mid), 'hold');
      this.holdUntil = Infinity; // set once the round goes live
    } else {
      const near = [...theirs].sort((a, b) => Math.abs(a[0] - half) - Math.abs(b[0] - half)).slice(0, Math.max(2, Math.ceil(theirs.length / 2)));
      this.setGoal(this.claim(near.length ? near : theirs), 'push');
    }
  }

  /** Pick a point, avoiding ones teammates already chose. */
  private claim(list: V3[]): V3 {
    const h = this.host;
    let c = claimed.get(h);
    if (!c || c.round !== h.round) { c = { round: h.round, keys: new Set() }; claimed.set(h, c); }
    const key = (pt: V3) => `${this.p.team}:${pt.join(',')}`;
    const free = list.filter((pt) => !c!.keys.has(key(pt)));
    const pt = pick(free.length ? free : list);
    c.keys.add(key(pt));
    return pt;
  }

  private setGoal(pt: V3, kind: GoalKind): void {
    // Same kind of goal, barely moved: keep the current path.
    if (this.goal && kind === this.goalKind && this.path.length && dist2d(pt, this.goal) < 2 && Math.abs(pt[1] - this.goal[1]) < 1) return;
    this.goal = [pt[0], pt[1], pt[2]];
    this.goalKind = kind;
    this.path = [];
    this.arrivedAt = -1;
    this.stuck = 0;
  }

  /** After reaching a goal (or giving up on one), decide where to go next. */
  private nextGoal(now: number): void {
    const h = this.host, map = h.map!, half = h.world!.sx / 2;
    const side = h.sideOf(this.p.team);
    if (this.goalKind === 'wander' || h.sandbox) {
      const mine = map.points.filter((pt) => (pt[0] < half) === (side === 0));
      this.setGoal(pick(mine), 'wander');
      return;
    }
    // Late in the round, go looking for whoever is left.
    if (this.liveSince >= 0 && now - this.liveSince > 50) {
      this.hunt(now);
      return;
    }
    const theirs = map.points.filter((pt) => (pt[0] < half) !== (side === 0) && !this.visited.has(pt.join(',')));
    if (theirs.length) {
      const b = this.body;
      // Next unvisited enemy-side point, preferring nearby ones.
      const sorted = theirs.sort((a, c) => dist2d(a, [b.x, b.y, b.z]) - dist2d(c, [b.x, b.y, b.z])).slice(0, 3);
      this.setGoal(pick(sorted), 'hunt');
    } else {
      const s = pick(map.spawns[1 - side]);
      this.visited.clear();
      this.setGoal([s.x, s.y, s.z], 'hunt');
    }
  }

  /** Head towards a rough guess of where a living enemy is. */
  private hunt(now: number): void {
    const enemies = [...this.host.players.values()].filter((q) => q.alive && q.team !== this.p.team && q.team !== -1);
    if (!enemies.length) return;
    const b = this.body;
    const q = enemies.sort((a, c) => dist2d(a.p, [b.x, b.y, b.z]) - dist2d(c.p, [b.x, b.y, b.z]))[0];
    this.setGoal([q.p[0] + rand(-5, 5), q.p[1], q.p[2] + rand(-5, 5)], 'hunt');
    this.huntAt = now + 7;
  }

  private computePath(): void {
    const nav = this.nav!, b = this.body, g = this.goal!;
    const from = nav.nearest(b.x, b.y, b.z), to = nav.nearest(g[0], g[1], g[2]);
    const nodes = nav.path(from, to);
    this.wp = 0;
    this.path = [];
    this.kinds = [];
    if (!nodes) return;
    for (let i = 0; i < nodes.length; i++) {
      this.path.push(nav.pos(nodes[i]));
      this.kinds.push(i ? nav.edgeKind(nodes[i - 1], nodes[i]) : EDGE_WALK);
    }
    // The first node is where we stand already.
    if (this.path.length > 1) this.wp = 1;
  }

  private navigate(now: number): { move: V3 | null; jump: boolean; walk: boolean } {
    const b = this.body;
    const none = { move: null, jump: false, walk: false };
    if (this.goalKind === 'chase' && now > this.chaseUntil) this.nextGoal(now);
    if (this.goalKind === 'hunt' && this.liveSince >= 0 && now - this.liveSince > 50 && now > this.huntAt) this.hunt(now);
    if (!this.goal) { this.nextGoal(now); if (!this.goal) return none; }

    // Waiting at a hold spot or after arriving somewhere.
    if (this.arrivedAt >= 0) {
      if (this.goalKind === 'hold') {
        if (this.holdUntil === Infinity && this.liveSince >= 0) this.holdUntil = this.liveSince + rand(12, 30);
        if (now < this.holdUntil) return none;
      } else if (now - this.arrivedAt < (this.goalKind === 'chase' ? 1.2 : this.goalKind === 'wander' ? rand(1, 3) : 0.3)) return none;
      this.visited.add(this.goal.join(','));
      if (this.goalKind === 'hold') this.goalKind = 'push';
      this.nextGoal(now);
      return none;
    }

    if (!this.path.length) {
      if (now < this.repathAt || !takePathBudget(this.host)) return none;
      this.repathAt = now + 0.5;
      this.computePath();
      if (!this.path.length) { this.nextGoal(now); return none; }
    }

    // Advance past waypoints we have reached.
    const pos: V3 = [b.x, b.y, b.z];
    while (this.wp < this.path.length) {
      const w = this.path[this.wp];
      if (dist2d(w, pos) < 0.4 && Math.abs(w[1] - b.y) < 1.1) { this.wp++; this.stuckDist = Infinity; }
      else break;
    }
    if (this.wp >= this.path.length) {
      this.arrivedAt = now;
      this.path = [];
      return none;
    }
    // Skip zig-zags: aim for the furthest waypoint we can walk straight to.
    if (now >= this.smoothAt && b.onGround) {
      this.smoothAt = now + 0.2;
      let k = 0;
      while (k < 6 && this.wp + 1 < this.path.length && this.kinds[this.wp] === EDGE_WALK && this.kinds[this.wp + 1] === EDGE_WALK
        && this.nav!.straight(pos, this.path[this.wp + 1])) { this.wp++; k++; }
    }

    const w = this.path[this.wp];
    const dx = w[0] - b.x, dz = w[2] - b.z, dd = Math.hypot(dx, dz);
    let jump = this.kinds[this.wp] === EDGE_JUMP && dd < 1.3 && b.onGround;

    // Stuck on something: hop, then find a new way.
    if (now >= this.stuckCheckAt) {
      this.stuckCheckAt = now + 0.5;
      if (dd > this.stuckDist - 0.2) this.stuck += 0.5; else this.stuck = 0;
      this.stuckDist = dd;
      if (this.stuck >= 1 && b.onGround) jump = true;
      if (this.stuck >= 2.5) { this.path = []; this.repathAt = now; }
      if (this.stuck >= 5) { this.stuck = 0; this.nextGoal(now); }
    }
    // Sneak when closing in on where an enemy was.
    const walk = this.goalKind === 'chase' && !!this.lastPos && dist2d(this.lastPos, pos) < 12 || this.goalKind === 'wander';
    return { move: dd > 0.01 ? [dx / dd, 0, dz / dd] : null, jump, walk };
  }

  /** Where to look when not fighting. */
  private idleLook(now: number): { yaw: number; pitch: number; gain: number } {
    const b = this.body, eye = this.eye();
    const at = (pt: V3, gain: number) => {
      const dx = pt[0] - eye[0], dz = pt[2] - eye[2];
      return { yaw: yawTo(dx, dz), pitch: Math.atan2(pt[1] + 1.4 - eye[1], Math.hypot(dx, dz)) * 0.6, gain };
    };
    if (this.lookAway && now < this.lookAwayUntil) {
      const l = at(this.lookAway, 14);
      return { yaw: l.yaw + Math.PI, pitch: 0, gain: 14 };
    }
    if (this.alertPos && now < this.alertUntil) return at(this.alertPos, 9);
    if (this.arrivedAt >= 0 || !this.path.length) {
      // Standing still: watch towards the enemy (or where they were), with a slow sweep.
      const focus = this.goalKind === 'chase' && this.lastPos ? this.lastPos : this.watch;
      if (!focus) return { yaw: this.yaw, pitch: 0, gain: 3 };
      const l = at(focus, 4);
      return { yaw: l.yaw + Math.sin(now * 0.7 + this.p.id) * 0.5, pitch: 0, gain: 4 };
    }
    // Moving: look a few steps ahead along the route.
    const ahead = this.path[Math.min(this.path.length - 1, this.wp + 3)];
    if (dist2d(ahead, [b.x, b.y, b.z]) < 1) return { yaw: this.yaw, pitch: this.pitch * 0.9, gain: 3 };
    const l = at(ahead, 6);
    return { yaw: l.yaw + Math.sin(now * 1.3 + this.p.id) * 0.25, pitch: 0, gain: 6 };
  }

  private turn(wantYaw: number, wantPitch: number, gain: number, dt: number): void {
    const max = this.skill.turn * dt;
    const dy = wrap(wantYaw - this.yaw);
    this.yaw = wrap(this.yaw + Math.max(-max, Math.min(max, dy * Math.min(1, gain * dt))));
    const dp = wantPitch - this.pitch;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + Math.max(-max, Math.min(max, dp * Math.min(1, gain * dt)))));
  }

  private physics(move: V3 | null, walk: boolean, crouch: boolean, jump: boolean): void {
    const world = this.host.world!;
    const input: MoveInput = { forward: move ? 1 : 0, right: 0, jump, crouch, walk, yaw: move ? yawTo(move[0], move[2]) : this.yaw };
    for (let i = 0; i < 2; i++) {
      stepMove(world, this.body, input, STEP, this.arsenal.speedMul);
      input.jump = false;
    }
  }

  private writeBack(now: number, walk: boolean): void {
    const p = this.p, b = this.body, a = this.arsenal;
    p.p = [b.x, b.y, b.z];
    p.v = [b.vx, b.vy, b.vz];
    p.crouch = b.crouchT;
    p.onGround = b.onGround;
    p.yaw = ((this.yaw % TAU) + TAU) % TAU;
    p.pitch = this.pitch + this.punchPitch;
    p.weapon = a.active;
    for (const [w, ammo] of a.ammo) p.ammo.set(w, [ammo[0], ammo[1]]);
    let f = 0;
    if (a.reloading) f |= PF_RELOADING;
    if (a.zoom > 0) f |= PF_SCOPED;
    if (walk) f |= PF_WALKING;
    if (now < p.blindUntil) f |= PF_BLIND;
    p.flags = f;
  }

  // ---------------------------------------------------------------- buying

  private buy(): void {
    const h = this.host, p = this.p;
    const buy = (item: ItemId) => h.botBuy(p, item);
    const money = () => p.money;
    const armour = () => {
      if (p.armor < 100 && money() >= 1000 && money() >= 2500) buy('helmet');
      else if (p.armor < 100 && money() >= 650) buy('kevlar');
    };
    if (!p.inv.primary) {
      const m = money();
      const pistolRound = m <= 1000;
      if (pistolRound) {
        const r = Math.random();
        if (r < 0.5) buy('kevlar');
        else if (r < 0.8) buy('deagle');
        else { buy('flash'); buy('he'); }
        return;
      }
      if (m >= 4750 + 1000 && this.skill.recoil > 0.5 && Math.random() < 0.12) buy('sniper');
      else if (m >= 2900 + 650) buy(Math.random() < 0.5 ? 'rifle' : 'carbine');
      else if (m >= 2700 + 650) buy('rifle');
      else if (m >= 2100 && Math.random() < 0.6) buy(Math.random() < 0.7 ? 'smg' : 'shotgun');
      else if (m >= 1700 + 650 && Math.random() < 0.3) buy('marksman');
      else {
        // Save money this round; maybe a better pistol.
        if (m >= 1200 && Math.random() < 0.4) buy('deagle');
        return;
      }
    }
    armour();
    // Grenades with what is left, keeping enough for next round's rifle.
    const spare = () => money() - (p.inv.primary ? 0 : 3350);
    const wanted: GrenadeId[] = ['smoke', 'flash', 'he', 'flash'];
    for (const g of wanted) {
      if (spare() < 400 || Math.random() < 0.3) continue;
      buy(g);
    }
  }

  // ---------------------------------------------------------------- grenades

  private considerNade(now: number): void {
    if (now < this.nadeCheckAt) return;
    this.nadeCheckAt = now + 0.6;
    const a = this.arsenal, has = (g: GrenadeId) => a.inv.grenades.includes(g);
    if (!a.inv.grenades.length || Math.random() > this.skill.nades) return;
    const b = this.body, pos: V3 = [b.x, b.y, b.z];
    const since = now - this.lastSeen;
    if (this.lastPos && since > 0.5 && since < 5) {
      const d = dist2d(this.lastPos, pos);
      if (has('he') && d > 6 && d < 26) return this.startNade('he', this.lastPos, now);
      if (has('flash') && this.goalKind === 'chase' && d > 5 && d < 20) return this.startNade('flash', this.lastPos, now);
    }
    // Early in a push, smoke off the spot we are heading to.
    if (has('smoke') && this.goalKind === 'push' && this.goal && this.liveSince >= 0 && now - this.liveSince < 20) {
      const d = dist2d(this.goal, pos);
      if (d > 12 && d < 30 && Math.random() < 0.4) this.startNade('smoke', this.goal, now);
    }
  }

  private startNade(g: GrenadeId, target: V3, now: number): void {
    const sol = this.solveThrow(g, target);
    this.nadeCheckAt = now + 4;
    if (!sol) return;
    this.arsenal.switchTo(g, now);
    this.nade = { g, yaw: sol.yaw, pitch: sol.pitch, until: now + 2.5, target: [target[0], target[1], target[2]] };
  }

  /** Throw once the grenade is out and we are looking the right way. */
  private stepNade(now: number): void {
    const n = this.nade!, a = this.arsenal, b = this.body;
    if (now > n.until || !a.owns(n.g)) { this.nade = null; return; }
    if (a.active !== n.g) a.switchTo(n.g, now);
    const lined = Math.abs(wrap(this.yaw - n.yaw)) < 0.03 && Math.abs(this.pitch - n.pitch) < 0.03;
    if (now < a.drawEnd || !lined || Math.hypot(b.vx, b.vz) > 0.5) return;
    const eye = this.eye();
    const dir = dirFrom(this.yaw, this.pitch);
    const v = throwVelocity(dir, 15, [b.vx, b.vy, b.vz]);
    const o: V3 = [eye[0] + dir[0] * 0.3, eye[1] - 0.05 + dir[1] * 0.3, eye[2] + dir[2] * 0.3];
    this.host.botThrow(this.p, n.g, o, v);
    a.consumeGrenade(n.g, now);
    if (n.g === 'flash') { this.lookAway = n.target; this.lookAwayUntil = now + 1.7; }
    this.nade = null;
  }

  /** Find the throw angle that lands the grenade closest to `target` (by simulating it). */
  private solveThrow(g: GrenadeId, target: V3): { yaw: number; pitch: number } | null {
    const world = this.host.world!, eye = this.eye();
    const yaw = yawTo(target[0] - eye[0], target[2] - eye[2]);
    const aim: V3 = g === 'flash' ? [target[0], target[1] + 2, target[2]] : [target[0], target[1] + 0.2, target[2]];
    const miss = (pitch: number) => {
      const dir = dirFrom(yaw, pitch);
      const v = throwVelocity(dir, 15, [0, 0, 0]);
      const n: Nade = { id: 0, type: g, owner: this.p.id, p: [eye[0] + dir[0] * 0.3, eye[1] - 0.05 + dir[1] * 0.3, eye[2] + dir[2] * 0.3], v, age: 0, resting: false, still: 0, bounced: false };
      const limit = g === 'smoke' ? FUSE.smoke : FUSE[g];
      while (n.age < limit && !(g === 'smoke' && nadeReady(n))) stepNade(world, n);
      return Math.hypot(n.p[0] - aim[0], (n.p[1] - aim[1]) * 0.5, n.p[2] - aim[2]);
    };
    // Coarse sweep of angles, then refine around the best one.
    let bestPitch = 0, bestErr = Infinity;
    for (let pitch = -0.3; pitch <= 1.0; pitch += 0.1) {
      const e = miss(pitch);
      if (e < bestErr) { bestErr = e; bestPitch = pitch; }
    }
    const coarse = bestPitch;
    for (let pitch = coarse - 0.08; pitch <= coarse + 0.08; pitch += 0.02) {
      const e = miss(pitch);
      if (e < bestErr) { bestErr = e; bestPitch = pitch; }
    }
    return bestErr < 4 ? { yaw, pitch: bestPitch } : null;
  }
}
