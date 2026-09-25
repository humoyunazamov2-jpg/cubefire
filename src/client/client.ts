import * as THREE from 'three';
import { sfx } from '../audio/sfx';
import { BLOCKS } from '../engine/blocks';
import type { Renderer } from '../engine/renderer';
import type { VoxelWorld } from '../engine/world';
import { Arsenal } from '../game/arsenal';
import { applySpread, traceBullet, type Target } from '../game/combat';
import { flashAmount, NADE_STEP, stepNade, throwVelocity, type Nade } from '../game/grenades';
import type { Input } from '../game/input';
import { LocalPlayer } from '../game/localPlayer';
import { WEAPONS, type GrenadeId, type ItemId, type WeaponId } from '../game/weapons';
import { MAPS } from '../maps';
import { inBox, type BuiltMap } from '../maps/types';
import type { Link } from '../net/link';
import { playerToken } from '../net/peer';
import {
  PF_BLIND, PF_RELOADING, PF_SCOPED, PF_WALKING, PROTOCOL_VERSION,
  type C2H, type DroppedItem, type H2C, type HitReport, type MatchState, type MapId,
  type PlayerStats, type RoomInfo, type V3,
} from '../net/protocol';
import { TEAM_COLORS, gunGeometry } from '../render/playerModel';
import { Effects } from '../render/effects';
import { ViewModel } from '../render/viewModel';
import { voxMaterial } from '../render/voxelModel';
import type { BuyContext, BuyMenu } from '../ui/buyMenu';
import type { Hud } from '../ui/hud';
import type { Scoreboard } from '../ui/scoreboard';
import type { Prefs } from './prefs';
import { Remote } from './remotes';

const SEND_RATE = 1 / 30;

export interface ClientUI {
  hud: Hud;
  buy: BuyMenu;
  scores: Scoreboard;
}

interface ClientItem { item: DroppedItem; mesh: THREE.Mesh; fall: number }
interface ClientNade { n: Nade; mesh: THREE.Mesh; acc: number }

/**
 * Everything one player sees and does: the world, their own movement and
 * weapons, other players, effects, sound and the HUD. The host's own view
 * is a GameClient too, talking to the host over an in-memory link.
 */
export class GameClient {
  myId = -1;
  room: RoomInfo | null = null;
  mapId: MapId | null = null;
  map: BuiltMap | null = null;
  world: VoxelWorld | null = null;
  me: LocalPlayer | null = null;
  arsenal = new Arsenal();
  remotes = new Map<number, Remote>();
  alive = false;
  hp = 100;
  armor = 0;
  helmet = false;
  money = 0;
  match: MatchState | null = null;
  private matchAt = 0;
  stats = new Map<number, PlayerStats>();
  private items = new Map<number, ClientItem>();
  private nades = new Map<number, ClientNade>();
  private effects: Effects;
  private view: ViewModel;
  time = 0;
  private sendAcc = 0;
  private blindUntil = 0;
  private blindTotal = 0;
  private blindAmount = 0;
  private deathAt = 0;
  private deathPos = new THREE.Vector3();
  spectateId = -1;
  private lastSnap = 0;
  private pingAt = 0;
  ping = -1;
  private tagged = 0;
  private shake = 0;
  private lastStride = 0;
  private reloadWas = false;
  private lastPhase = '';
  private killStreak = 0;
  sandbox = false;
  /** Set by the app to react to lobby/match events. */
  onRoom: ((room: RoomInfo) => void) | null = null;
  onStart: (() => void) | null = null;
  onEnd: (() => void) | null = null;
  onKick: ((reason: string) => void) | null = null;
  onLoading: ((mapName: string) => void) | null = null;
  onChat: ((name: string | null, text: string) => void) | null = null;
  onClosed: (() => void) | null = null;
  /** Pointer lock must be released for menus; the app decides. */
  onWantCursor: ((free: boolean) => void) | null = null;
  private tmpV = new THREE.Vector3();
  private lookDX = 0;
  private lookDY = 0;

  constructor(
    readonly renderer: Renderer,
    readonly input: Input,
    readonly ui: ClientUI,
    readonly link: Link<H2C, C2H>,
    readonly name: string,
    public prefs: Prefs,
  ) {
    this.effects = new Effects(renderer.scene);
    this.view = new ViewModel(renderer.viewCamera);
    link.onMessage = (m) => this.handle(m);
    link.onClose = () => this.onClosed?.();
    link.send({ t: 'hello', name, v: PROTOCOL_VERSION, token: playerToken() });
    ui.buy.onBuy = (item) => this.buy(item);
    ui.buy.onClose = () => this.onWantCursor?.(false);
    this.applyPrefs(prefs);
  }

  applyPrefs(p: Prefs): void {
    this.prefs = p;
    if (this.me) this.me.sensitivity = p.sensitivity;
    this.renderer.setFov(p.fov);
    sfx.setVolume(p.volume);
    const h = this.ui.hud;
    h.crosshairColor = p.crosshairColor;
    h.crosshairSize = p.crosshairSize;
    h.crosshairGap = p.crosshairGap;
    h.showFps = p.showFps;
  }

  send(m: C2H): void {
    this.link.send(m);
  }

  get inMatch(): boolean {
    return !!this.world;
  }

  get myTeam(): number {
    return this.room?.roster.find((r) => r.id === this.myId)?.team ?? -1;
  }

  private nameOf(id: number): string {
    return this.room?.roster.find((r) => r.id === id)?.name ?? `#${id}`;
  }

  private teamOf(id: number): number {
    return this.room?.roster.find((r) => r.id === id)?.team ?? -1;
  }

  // ------------------------------------------------------------------ network

  private handle(m: H2C): void {
    switch (m.t) {
      case 'welcome':
        this.myId = m.you;
        this.room = m.room;
        this.onRoom?.(m.room);
        break;
      case 'room':
        this.room = m.room;
        for (const [id, r] of this.remotes) {
          const e = m.room.roster.find((x) => x.id === id);
          if (!e) { r.dispose(this.renderer.scene); this.remotes.delete(id); continue; }
          r.name = e.name;
          r.setTeam(e.team, this.renderer.scene);
        }
        this.view.setTeam(this.myTeam);
        this.onRoom?.(m.room);
        break;
      case 'start':
        // Building the map blocks for a moment; let the loading screen paint first.
        this.onLoading?.(MAPS[m.map].name);
        setTimeout(() => {
          if (!this.link.open) return;
          this.loadMap(m.map);
          this.onStart?.();
          this.send({ t: 'loaded' });
        }, 40);
        break;
      case 'end':
        this.unloadMap();
        this.onEnd?.();
        break;
      case 'kick':
        this.onKick?.(m.reason);
        break;
      case 'snap':
        this.onSnap(m.ps);
        break;
      case 'spawn':
        this.onSpawn(m.p, m.yaw);
        break;
      case 'inv':
        this.money = m.money;
        this.arsenal.setInventory(m.inv, this.time, m.give, m.reset);
        this.armor = m.inv.armor;
        this.helmet = m.inv.helmet;
        break;
      case 'shot':
        this.onRemoteShot(m.id, m.w, m.o, m.ends);
        break;
      case 'dmg':
        this.onDamage(m.v, m.a, m.n, m.hp, m.zone, m.from);
        break;
      case 'kill':
        this.onKill(m.k, m.v, m.w, m.hs, m.wb);
        break;
      case 'nade':
        this.spawnNade(m.id, m.g, m.o, m.v, m.owner);
        break;
      case 'boom':
        this.onBoom(m.id, m.g, m.p);
        break;
      case 'items':
        for (const it of this.items.values()) this.renderer.scene.remove(it.mesh);
        this.items.clear();
        for (const it of m.items) this.addItem(it, false);
        break;
      case 'item+':
        this.addItem(m.item, true);
        break;
      case 'item-': {
        const it = this.items.get(m.id);
        if (it) { this.renderer.scene.remove(it.mesh); this.items.delete(m.id); }
        break;
      }
      case 'match':
        this.onMatch(m.m);
        break;
      case 'stats':
        for (const s of m.stats) this.stats.set(s.id, s);
        break;
      case 'chat':
        this.ui.hud.chatLine(m.name, this.teamOf(m.from), m.text, m.team);
        this.onChat?.(m.name, m.text);
        sfx.ui('chat');
        break;
      case 'note':
        this.ui.hud.chatLine(null, -1, m.text);
        this.onChat?.(null, m.text);
        break;
      case 'pong':
        this.ping = Math.round(performance.now() - m.ts);
        break;
    }
  }

  private loadMap(id: MapId): void {
    this.unloadMap();
    this.mapId = id;
    const map = MAPS[id].build();
    this.map = map;
    this.world = map.world;
    this.renderer.setWorld(map.world, map.env);
    this.effects.world = map.world;
    this.me = new LocalPlayer(map.world);
    this.me.sensitivity = this.prefs.sensitivity;
    const o = map.overview;
    this.me.spawn(o.p[0], o.p[1] - 1.62, o.p[2], o.yaw);
    this.me.pitch = o.pitch;
    this.alive = false;
    this.lastSnap = performance.now();
    this.ui.hud.clearFeed();
  }

  private unloadMap(): void {
    for (const r of this.remotes.values()) r.dispose(this.renderer.scene);
    this.remotes.clear();
    for (const it of this.items.values()) this.renderer.scene.remove(it.mesh);
    this.items.clear();
    for (const n of this.nades.values()) this.renderer.scene.remove(n.mesh);
    this.nades.clear();
    this.effects.clear();
    this.world = null;
    this.map = null;
    this.me = null;
    this.alive = false;
    this.match = null;
    this.lastPhase = '';
    this.stats.clear();
    this.ui.buy.close();
  }

  private remote(id: number): Remote | null {
    if (id === this.myId) return null;
    let r = this.remotes.get(id);
    if (!r) {
      const e = this.room?.roster.find((x) => x.id === id);
      r = new Remote(id, e?.team ?? 0, e?.name ?? `#${id}`, this.renderer.scene);
      this.remotes.set(id, r);
    }
    return r;
  }

  private onSnap(ps: import('../net/protocol').SnapPlayer[]): void {
    const now = performance.now() / 1000;
    this.lastSnap = performance.now();
    const seen = new Set<number>();
    for (const s of ps) {
      seen.add(s.id);
      if (s.id === this.myId) {
        this.hp = s.hp;
        this.armor = s.ar;
        this.helmet = s.hm === 1;
        this.money = s.m;
        if (this.alive && !s.a) this.die();
        continue;
      }
      this.remote(s.id)?.push(s, now);
    }
    for (const [id, r] of this.remotes) if (!seen.has(id)) { r.dispose(this.renderer.scene); this.remotes.delete(id); }
  }

  private onSpawn(p: V3, yaw: number): void {
    if (!this.me) return;
    this.me.spawn(p[0], p[1], p[2], yaw);
    this.alive = true;
    this.hp = 100;
    this.deathAt = 0;
    this.spectateId = -1;
    this.blindUntil = 0;
    this.killStreak = 0;
    this.view.setTeam(this.myTeam);
    this.arsenal.switchTo(this.arsenal.best(), this.time);
    this.arsenal.drawEnd = this.time + 0.5;
  }

  private die(): void {
    if (!this.alive || !this.me) return;
    this.alive = false;
    this.deathAt = this.time;
    this.me.eyePosition(this.deathPos);
    this.arsenal.zoom = 0;
    this.ui.buy.close();
    sfx.death(null);
  }

  // ------------------------------------------------------------------ events

  private onMatch(m: MatchState): void {
    this.match = m;
    this.matchAt = performance.now();
    if (m.phase === this.lastPhase) return;
    this.lastPhase = m.phase;
    const hud = this.ui.hud;
    const mine = this.myTeam;
    switch (m.phase) {
      case 'freeze':
        hud.clearFeed();
        hud.message(`Round ${m.round}`, m.round === 1 ? 'Buy weapons with B, then fight!' : 'Buy phase', '', 3);
        break;
      case 'live':
        hud.message('Go!', 'Eliminate the other team', '', 1.2);
        sfx.ui('roundStart');
        break;
      case 'roundEnd': {
        const cls = m.winner === 0 ? 'blaze' : m.winner === 1 ? 'frost' : '';
        const title = m.winner === null ? 'Draw' : `${TEAM_COLORS[m.winner === 1 ? 1 : 0].name} win the round`;
        const mvp = m.mvp !== null ? `MVP: ${this.nameOf(m.mvp)}` : '';
        hud.message(title, [m.reason, mvp].filter(Boolean).join('  ·  '), cls, 4.5);
        if (m.winner !== null && mine !== -1) sfx.ui(m.winner === mine ? 'win' : 'lose');
        break;
      }
      case 'halftime':
        hud.message('Halftime', 'Teams switch sides. Money resets to $800.', '', 5);
        break;
      case 'matchEnd': {
        const cls = m.winner === 0 ? 'blaze' : m.winner === 1 ? 'frost' : '';
        hud.message(m.winner === null ? 'Match over' : `${TEAM_COLORS[m.winner === 1 ? 1 : 0].name} win the match!`, `${m.score[0]} : ${m.score[1]}`, cls, 11);
        if (m.winner !== null && mine !== -1) sfx.ui(m.winner === mine ? 'win' : 'lose');
        break;
      }
    }
  }

  /** Milliseconds left in the current phase, counted down locally. */
  private remaining(): number {
    if (!this.match) return 0;
    return Math.max(0, this.match.remaining - (performance.now() - this.matchAt));
  }

  private buyLeft(): number {
    if (!this.match) return 0;
    return Math.max(0, this.match.buyRemaining - (performance.now() - this.matchAt)) / 1000;
  }

  canBuyHere(): boolean {
    if (!this.alive || !this.map || !this.me) return false;
    if (this.sandbox) return true;
    const m = this.match;
    if (!m || (m.phase !== 'freeze' && !(m.phase === 'live' && this.buyLeft() > 0))) return false;
    const t = this.myTeam;
    if (t === -1) return false;
    const side = (m.swapped ? 1 - t : t) as 0 | 1;
    const b = this.me.body;
    return inBox(this.map.buyZones[side], b.x, b.y, b.z);
  }

  private buy(item: ItemId): void {
    if (!this.canBuyHere()) { sfx.ui('deny'); return; }
    this.send({ t: 'buy', item });
    sfx.ui('buy');
  }

  private onRemoteShot(id: number, w: WeaponId, o: V3, ends: V3[]): void {
    const r = this.remotes.get(id);
    const muzzle: V3 = r ? [r.state.p[0], r.state.p[1] + 1.25 - r.state.crouch * 0.35, r.state.p[2]] : o;
    sfx.gunshot(w, o);
    if (WEAPONS[w].slot === 'knife') return;
    // Muzzle flash just in front of the shooter.
    if (r) {
      const fx = -Math.sin(r.state.yaw) * 0.55, fz = -Math.cos(r.state.yaw) * 0.55;
      this.effects.pop([muzzle[0] + fx, muzzle[1], muzzle[2] + fz], 0xffc060, 0.14, 0.05);
    }
    for (const e of ends) {
      this.effects.tracer(muzzle, e);
      this.impactAt(o, e);
    }
  }

  /** Particles and a bullet hole where a bullet ending at `e` hit a block. */
  private impactAt(o: V3, e: V3): void {
    if (!this.world) return;
    const dx = e[0] - o[0], dy = e[1] - o[1], dz = e[2] - o[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.1) return;
    const hit = this.world.raycast(o[0], o[1], o[2], dx, dy, dz, len + 0.05, (id) => BLOCKS[id].solid && !BLOCKS[id].invisible);
    if (!hit || Math.abs(hit.dist - len) > 0.2) return;
    const def = BLOCKS[hit.id];
    this.effects.impact([hit.px, hit.py, hit.pz], [hit.nx, hit.ny, hit.nz], this.renderer.atlas.color(def.side));
  }

  private onDamage(victim: number, attacker: number, amount: number, hp: number, zone: string, from: V3): void {
    if (victim === this.myId) {
      this.hp = hp;
      sfx.hurt();
      this.tagged = 0.35;
      if (this.me) {
        const eye = this.me.eyePosition(this.tmpV);
        const ang = Math.atan2(from[0] - eye.x, from[2] - eye.z);
        // Screen angle: 0 = straight ahead.
        const rel = -(ang - (this.me.yaw + Math.PI));
        this.ui.hud.damageFrom(rel);
        this.me.punchPitch += 0.01 * Math.min(3, amount / 20);
      }
      return;
    }
    const r = this.remotes.get(victim);
    if (r) {
      r.model.flash();
      const s = r.state;
      const y = zone === 'head' ? 1.6 : zone === 'legs' ? 0.5 : 1.1;
      const d: V3 = [s.p[0] - from[0], 0, s.p[2] - from[2]];
      const l = Math.hypot(d[0], d[2]) || 1;
      this.effects.blood([s.p[0], s.p[1] + y - s.crouch * 0.3, s.p[2]], [d[0] / l, 0.3, d[2] / l]);
    }
    if (attacker === this.myId) this.ui.hud.hit(zone === 'head', false);
  }

  private onKill(k: number, v: number, w: WeaponId | 'world', hs: boolean, wb: boolean): void {
    const kt = this.teamOf(k), vt = this.teamOf(v);
    this.ui.hud.kill({
      killer: k >= 0 && k !== v ? this.nameOf(k) : null, killerTeam: kt,
      victim: this.nameOf(v), victimTeam: vt,
      weapon: w === 'world' ? 'world' : WEAPONS[w].name, hs, wb,
      mine: k === this.myId || v === this.myId,
    });
    if (v === this.myId) {
      this.die();
      if (k >= 0 && k !== v) this.ui.hud.message(`Killed by ${this.nameOf(k)}`, w === 'world' ? '' : `with ${WEAPONS[w as WeaponId].name}${hs ? ' (headshot)' : ''}`, kt === 0 ? 'blaze' : 'frost', 2.5);
    } else {
      const r = this.remotes.get(v);
      if (r) sfx.death([r.state.p[0], r.state.p[1] + 1, r.state.p[2]]);
    }
    if (k === this.myId && v !== this.myId) {
      this.killStreak++;
      this.ui.hud.hit(hs, true);
      sfx.hit(hs, true);
    }
  }

  // ------------------------------------------------------------------ items & nades

  private addItem(item: DroppedItem, animate: boolean): void {
    const mesh = new THREE.Mesh(gunGeometry(item.w, 0.03), voxMaterial);
    mesh.rotation.set(0, Math.random() * Math.PI * 2, Math.PI / 2);
    mesh.position.set(item.p[0], item.p[1] + 0.08, item.p[2]);
    this.renderer.scene.add(mesh);
    this.items.set(item.id, { item, mesh, fall: animate ? 1 : 0 });
  }

  private spawnNade(id: number, g: GrenadeId, o: V3, v: V3, owner: number): void {
    const mesh = new THREE.Mesh(gunGeometry(g, 0.03), voxMaterial);
    mesh.position.set(o[0], o[1], o[2]);
    this.renderer.scene.add(mesh);
    this.nades.set(id, { n: { id, type: g, owner, p: [...o], v: [...v], age: 0, resting: false, still: 0, bounced: false }, mesh, acc: 0 });
    if (owner !== this.myId) {
      const r = this.remotes.get(owner);
      if (r) sfx.knifeSwing([r.state.p[0], r.state.p[1] + 1.4, r.state.p[2]]);
    }
  }

  private onBoom(id: number, g: GrenadeId, p: V3): void {
    const cn = this.nades.get(id);
    if (cn) { this.renderer.scene.remove(cn.mesh); this.nades.delete(id); }
    if (g === 'he') {
      this.effects.explosion(p);
      sfx.explosion(p);
      if (this.me) {
        const d = this.me.eyePosition(this.tmpV).distanceTo(new THREE.Vector3(p[0], p[1], p[2]));
        this.shake = Math.max(this.shake, Math.max(0, 1 - d / 18));
      }
    } else if (g === 'smoke') {
      this.effects.smoke(id, p);
      sfx.smokePop(p);
    } else {
      this.effects.flashbang(p);
      sfx.flashPop(p);
      if (this.world && this.me && this.alive) {
        const eye = this.me.eyePosition(this.tmpV);
        const f = flashAmount(this.world, p, [eye.x, eye.y, eye.z], this.lookVector());
        if (f.amount > 0.05) {
          this.blindAmount = Math.max(this.blindAmount, f.amount);
          this.blindTotal = f.duration;
          this.blindUntil = Math.max(this.blindUntil, this.time + f.duration);
          sfx.ringing(f.duration, f.amount);
        }
      }
    }
  }

  private lookVector(): V3 {
    const me = this.me!;
    return [-Math.sin(me.yaw) * Math.cos(me.pitch), Math.sin(me.pitch), -Math.cos(me.yaw) * Math.cos(me.pitch)];
  }

  // ------------------------------------------------------------------ local weapons

  private targets(): Target[] {
    const out: Target[] = [];
    for (const r of this.remotes.values()) if (r.state.alive) out.push(r.target());
    return out;
  }

  private weaponInput(dt: number): void {
    const a = this.arsenal, input = this.input, now = this.time;
    a.update(now);
    const frozen = this.match?.phase === 'freeze' && !this.sandbox;

    if (input.pressed('slot1')) a.selectSlot(1, now);
    if (input.pressed('slot2')) a.selectSlot(2, now);
    if (input.pressed('slot3')) a.selectSlot(3, now);
    if (input.pressed('slot4')) a.selectSlot(4, now);
    if (input.pressed('lastWeapon')) a.switchTo(a.owns(a.prev) ? a.prev : a.best(), now);
    const wheel = input.takeWheel();
    if (wheel && !input.bindings.jump.includes('WheelDown')) a.cycle(wheel > 0 ? 1 : -1, now);
    if (input.pressed('reload') && a.reload(now)) sfx.reload(a.active, 0);
    if (input.pressed('inspect')) this.view.inspect();
    if (input.pressed('drop')) {
      const w = a.active;
      const slot = WEAPONS[w].slot;
      if (slot === 'primary' || slot === 'secondary') this.send({ t: 'drop', w, ammo: a.current });
    }

    if (a.reloading !== this.reloadWas) {
      if (!a.reloading) sfx.reload(a.active, 1);
      this.reloadWas = a.reloading;
    }

    const def = a.def;
    if (input.pressed('alt')) {
      if (def.zoom.length) { a.toggleZoom(); sfx.ui('tick'); }
      else if (def.slot === 'knife' && !frozen && a.tryHeavy(now, true)) this.melee(true);
      else if (def.slot === 'grenade' && !frozen && a.tryFire(now, true, true)) this.throwNade(false);
    }

    if (frozen) return;
    if (a.tryFire(now, input.pressed('fire'), input.down('fire'))) {
      if (def.slot === 'grenade') this.throwNade(true);
      else if (def.slot === 'knife') this.melee(false);
      else this.shoot();
    } else if (input.pressed('fire') && def.magSize > 0 && a.current[0] === 0 && !a.reloading) {
      sfx.dryFire();
    }
    void dt;
  }

  private shoot(): void {
    const me = this.me!, a = this.arsenal, def = a.def;
    const eye = me.eyePosition();
    const dir = me.aimDirection();
    const walking = this.input.down('walk');
    const spread = a.spread(me.speed, me.body.onGround, me.body.crouchT, walking);
    const targets = this.targets();
    const ends: V3[] = [];
    const hits: HitReport[] = [];
    const camMuzzle = this.muzzleInWorld(new THREE.Vector3());
    let headHit = false, anyHit = false;
    for (let i = 0; i < def.pellets; i++) {
      const cone = def.pellets > 1 ? def.spreadStand + (spread - def.spreadStand) : spread;
      const d = applySpread([dir.x, dir.y, dir.z], cone, Math.random);
      const r = traceBullet(this.world!, def, eye.x, eye.y, eye.z, d[0], d[1], d[2], targets, this.myId);
      ends.push(r.end);
      this.effects.tracer([camMuzzle.x, camMuzzle.y, camMuzzle.z], r.end);
      if (r.entry) this.effects.impact(r.entry.p, r.entry.n, this.renderer.atlas.color(BLOCKS[r.entry.id].side));
      if (r.impact) this.effects.impact(r.impact.p, r.impact.n, this.renderer.atlas.color(BLOCKS[r.impact.id].side));
      if (r.hit) {
        hits.push({ id: r.hit.id, zone: r.hit.zone, dist: r.hit.dist, pen: r.hit.pen });
        anyHit = true;
        if (r.hit.zone === 'head') headHit = true;
      }
    }
    this.send({ t: 'fire', w: a.active, o: [eye.x, eye.y, eye.z], ends, hits });
    if (anyHit) { sfx.hit(headHit, false); this.ui.hud.hit(headHit, false); }
    sfx.gunshot(a.active, null);
    this.view.fire();
    const [up, side] = a.recoil();
    me.punchPitch += up;
    me.punchYaw += side;
  }

  /**
   * The world point that lines up on screen with the gun's muzzle. The gun
   * is drawn by its own camera with a different field of view, so map it
   * through screen space rather than copying its position.
   */
  private muzzleInWorld(out: THREE.Vector3): THREE.Vector3 {
    const vc = this.renderer.viewCamera, cam = this.renderer.camera;
    this.view.muzzleWorld(out);
    const dist = out.distanceTo(vc.getWorldPosition(this.tmpV));
    out.project(vc);
    out.z = 0.5;
    out.unproject(cam);
    const eye = cam.getWorldPosition(this.tmpV);
    return out.sub(eye).normalize().multiplyScalar(dist).add(eye);
  }

  private melee(heavy: boolean): void {
    const me = this.me!;
    const eye = me.eyePosition();
    const dir = me.aimDirection();
    const r = traceBullet(this.world!, WEAPONS.knife, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, this.targets(), this.myId);
    const hits: HitReport[] = [];
    if (r.hit) {
      const vic = this.remotes.get(r.hit.id);
      let back = false;
      if (vic) {
        const fx = -Math.sin(vic.state.yaw), fz = -Math.cos(vic.state.yaw);
        const dx = vic.state.p[0] - me.body.x, dz = vic.state.p[2] - me.body.z;
        const l = Math.hypot(dx, dz) || 1;
        back = (dx / l) * fx + (dz / l) * fz > 0.55;
      }
      hits.push({ id: r.hit.id, zone: 'body', dist: r.hit.dist, pen: 1, stab: heavy ? 2 : 1, back });
      sfx.hit(false, false);
      this.ui.hud.hit(false, false);
    } else if (r.impact) {
      this.effects.impact(r.impact.p, r.impact.n, this.renderer.atlas.color(BLOCKS[r.impact.id].side));
    }
    this.send({ t: 'fire', w: 'knife', o: [eye.x, eye.y, eye.z], ends: [], hits, alt: heavy });
    sfx.knifeSwing(null);
    if (heavy) this.view.heavy(); else this.view.fire();
  }

  private throwNade(overhand: boolean): void {
    const me = this.me!, a = this.arsenal;
    const g = a.active as GrenadeId;
    const eye = me.eyePosition();
    const dir = me.aimDirection();
    const v = throwVelocity([dir.x, dir.y, dir.z], overhand ? 15 : 6.5, [me.body.vx, me.body.vy, me.body.vz]);
    const o: V3 = [eye.x + dir.x * 0.3, eye.y - (overhand ? 0.05 : 0.4) + dir.y * 0.3, eye.z + dir.z * 0.3];
    this.send({ t: 'throw', g, o, v });
    this.view.fire();
    a.consumeGrenade(g, this.time);
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    this.time += dt;
    const me = this.me;
    const input = this.input;
    const hud = this.ui.hud;
    hud.tick(dt);

    // Ping every 2 s.
    if (performance.now() - this.pingAt > 2000) {
      this.pingAt = performance.now();
      this.send({ t: 'ping', ts: this.pingAt, rtt: this.ping >= 0 ? this.ping : undefined });
    }

    if (!me || !this.world) return;

    // Chat and menus.
    const menuOpen = this.ui.buy.isOpen || hud.chatOpen;
    input.enabled = !menuOpen;
    if (!menuOpen && this.active) {
      if (input.pressed('buy')) {
        if (this.canBuyHere()) { this.openBuy(); }
        else hud.toast(this.alive ? 'You can only buy in your spawn area during buy time' : 'You are dead', 2);
      }
      if (input.pressed('chat') || input.pressed('teamChat')) {
        const team = input.pressed('teamChat');
        input.clear();
        void hud.openChat(team).then((text) => { if (text) this.send({ t: 'chat', text, team }); });
      }
    }
    this.ui.scores.visible = input.rawDown('Tab') && !menuOpen;
    if (this.ui.buy.isOpen) {
      if (!this.canBuyHere()) this.ui.buy.close();
      else this.ui.buy.update(this.buyContext());
    }

    // Movement and aiming.
    const frozen = this.match?.phase === 'freeze' && !this.sandbox;
    if (this.alive) {
      me.frozen = frozen || menuOpen;
      me.zoomSens = this.arsenal.fovMul;
      if (this.active && !this.ui.buy.isOpen) {
        const before = [me.yaw, me.pitch];
        me.look(input);
        this.lookDX = (me.yaw - before[0]) * 400;
        this.lookDY = (me.pitch - before[1]) * 400;
      }
      this.tagged = Math.max(0, this.tagged - dt);
      const speedMul = this.arsenal.speedMul * (this.tagged > 0 ? 0.55 : 1);
      const wasGround = me.body.onGround;
      me.update(dt, this.active ? input : null, speedMul);
      if (!wasGround && me.body.onGround) sfx.land(this.surfaceUnder(me.body.x, me.body.y, me.body.z), null);
      // Footsteps: running is loud, walking and crouching are silent.
      if (me.stride - this.lastStride > 2.1) {
        this.lastStride = me.stride;
        if (me.speed > 3.2 && me.body.crouchT < 0.5) sfx.footstep(this.surfaceUnder(me.body.x, me.body.y, me.body.z), null, 0.8);
      }
      if (this.active && !menuOpen) this.weaponInput(dt);
      else this.arsenal.update(this.time);
      const since = this.time - this.arsenal.lastShot;
      if (since > 0.12) me.recoverPunch(dt, this.arsenal.def.auto ? 7 : 5);
    }

    // Send our state.
    this.sendAcc += dt;
    if (this.sendAcc >= SEND_RATE) {
      this.sendAcc = 0;
      const b = me.body;
      let f = 0;
      if (this.arsenal.reloading) f |= PF_RELOADING;
      if (this.arsenal.zoom > 0) f |= PF_SCOPED;
      if (input.down('walk')) f |= PF_WALKING;
      if (this.time < this.blindUntil) f |= PF_BLIND;
      const r = (n: number) => Math.round(n * 1000) / 1000;
      this.send({
        t: 'state', p: [r(b.x), r(b.y), r(b.z)], v: [r(b.vx), r(b.vy), r(b.vz)],
        yaw: r(me.yaw), pitch: r(me.pitch), c: r(b.crouchT), g: b.onGround ? 1 : 0,
        w: this.arsenal.active, ammo: this.arsenal.current, f,
      });
    }

    this.updateRemotes(dt);
    this.updateNades(dt);
    this.updateItems(dt);
    this.effects.update(dt);
    this.updateCamera(dt);
    this.updateHud(dt);
    sfx.setListener(this.renderer.camera);
  }

  private openBuy(): void {
    this.onWantCursor?.(true);
    this.ui.buy.open(this.buyContext());
  }

  /** Armour comes from snapshots too, so it is current even after taking damage. */
  private buyContext(): BuyContext {
    const inv = { ...this.arsenal.inv, armor: this.armor, helmet: this.helmet };
    return { money: this.money, inv, canBuy: true, buyLeft: this.buyLeft(), sandbox: this.sandbox };
  }

  private surfaceUnder(x: number, y: number, z: number) {
    const id = this.world!.get(Math.floor(x), Math.floor(y - 0.05), Math.floor(z));
    return BLOCKS[id]?.sound ?? 'stone';
  }

  private updateRemotes(dt: number): void {
    const now = performance.now() / 1000;
    const myTeam = this.myTeam;
    for (const r of this.remotes.values()) {
      const s = r.sample(now);
      r.model.root.position.set(s.p[0], s.p[1], s.p[2]);
      const speed = Math.hypot(s.v[0], s.v[2]);
      r.model.update({ yaw: s.yaw, pitch: s.pitch, crouch: s.crouch, speed, onGround: s.onGround, alive: s.alive, weapon: s.weapon }, dt);
      r.model.root.visible = r.id !== this.spectateId || this.alive;
      if (r.shownName !== r.name) {
        r.shownName = r.name;
        r.model.setName(r.name, TEAM_COLORS[r.team === 1 ? 1 : 0].light);
      }
      r.model.setNameVisible(r.team === myTeam && s.alive);
      // Remote footsteps.
      if (s.alive && s.onGround && speed > 3.2 && s.crouch < 0.5) {
        r.stride += speed * dt;
        if (r.stride > 2.1) {
          r.stride = 0;
          sfx.footstep(this.surfaceUnder(s.p[0], s.p[1], s.p[2]), [s.p[0], s.p[1] + 0.1, s.p[2]]);
        }
      }
      if (s.alive && s.onGround && !r.lastGround) sfx.land(this.surfaceUnder(s.p[0], s.p[1], s.p[2]), [s.p[0], s.p[1], s.p[2]]);
      r.lastGround = s.onGround;
    }
  }

  private updateNades(dt: number): void {
    for (const cn of this.nades.values()) {
      cn.acc += dt;
      while (cn.acc >= NADE_STEP) {
        cn.acc -= NADE_STEP;
        stepNade(this.world!, cn.n);
        if (cn.n.bounced) sfx.bounce(cn.n.p);
      }
      cn.mesh.position.set(cn.n.p[0], cn.n.p[1], cn.n.p[2]);
      if (!cn.n.resting) { cn.mesh.rotation.x += dt * 8; cn.mesh.rotation.z += dt * 5; }
    }
  }

  private updateItems(dt: number): void {
    for (const it of this.items.values()) {
      if (it.fall > 0) {
        it.fall = Math.max(0, it.fall - dt * 3);
        it.mesh.position.y = it.item.p[1] + 0.08 + it.fall * it.fall * 1.2;
      }
    }
  }

  private updateCamera(dt: number): void {
    const me = this.me!, cam = this.renderer.camera;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    let showView = false;
    if (this.alive) {
      me.applyCamera(cam, dt, this.prefs.viewBob);
      showView = true;
    } else {
      // Death cam for 2 s, then watch a living teammate.
      const since = this.time - this.deathAt;
      const mates = [...this.remotes.values()].filter((r) => r.state.alive && r.team === this.myTeam);
      if (this.input.pressed('fire') && mates.length) {
        const i = mates.findIndex((r) => r.id === this.spectateId);
        this.spectateId = mates[(i + 1) % mates.length].id;
      }
      let target = this.remotes.get(this.spectateId);
      if ((!target || !target.state.alive) && since > 2) {
        target = mates[0];
        this.spectateId = target?.id ?? -1;
      }
      if (target && target.state.alive && since > 2) {
        target.eye(cam.position);
        cam.rotation.set(target.state.pitch, target.state.yaw, 0, 'YXZ');
        this.ui.hud.spectating(`Watching ${target.name}`, `${target.state.hp} HP · click to switch`);
      } else if (this.deathAt > 0) {
        // Float up and look down at where we died.
        const k = Math.min(1, since / 1.2);
        cam.position.set(this.deathPos.x, this.deathPos.y + k * 2.2, this.deathPos.z);
        cam.rotation.set(-0.3 - k * 0.9, me.yaw, 0, 'YXZ');
        this.ui.hud.spectating(null);
      } else {
        // Not spawned yet (between rounds, or spectator): overview camera.
        const o = this.map!.overview;
        if (this.active) me.look(this.input);
        cam.position.set(o.p[0], o.p[1], o.p[2]);
        cam.rotation.set(me.pitch, me.yaw, 0, 'YXZ');
        this.ui.hud.spectating(this.myTeam === -1 ? 'Spectating' : null, this.myTeam === -1 ? 'Pick a team from the menu (Esc)' : '');
      }
    }
    if (this.alive) this.ui.hud.spectating(null);
    if (this.shake > 0) {
      cam.rotation.x += (Math.random() - 0.5) * this.shake * 0.04;
      cam.rotation.y += (Math.random() - 0.5) * this.shake * 0.04;
    }
    // Scope zoom.
    const fov = this.prefs.fov * (this.alive ? this.arsenal.fovMul : 1);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }

    const a = this.arsenal;
    const rt = a.reloading ? 1 - (a.reloadEnd - this.time) / a.def.reloadTime : -1;
    const dr = a.drawEnd > 0 ? 1 - Math.max(0, a.drawEnd - this.time) / 0.5 : -1;
    this.view.update({
      weapon: a.active, bobPhase: me.bobPhaseValue, speed: me.speed, onGround: me.body.onGround,
      reload: rt, draw: Math.min(1, dr), scoped: a.zoom > 0, lookDX: this.lookDX, lookDY: this.lookDY,
    }, dt);
    this.lookDX *= 0.5; this.lookDY *= 0.5;
    this.showViewModel = showView;
  }

  showViewModel = true;
  /** Automated tests drive input without pointer lock. */
  testMode = false;

  /** Is the game taking keyboard and mouse input? */
  get active(): boolean {
    return this.input.locked || this.testMode;
  }

  private updateHud(dt: number): void {
    const hud = this.ui.hud, m = this.match, a = this.arsenal;
    // Round clock.
    let clock = '', label = '', urgent = false;
    if (this.sandbox) { clock = '∞'; label = 'practice'; }
    else if (m) {
      const s = Math.ceil(this.remaining() / 1000);
      clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      label = m.phase === 'freeze' ? 'buy phase' : m.phase === 'live' ? `round ${m.round}` : m.phase === 'roundEnd' ? 'round over' : m.phase === 'halftime' ? 'halftime' : m.phase === 'matchEnd' ? 'match over' : 'loading';
      urgent = m.phase === 'live' && s <= 10;
    }
    const alive: [boolean[], boolean[]] = [[], []];
    for (const e of this.room?.roster ?? []) {
      if (e.team === -1) continue;
      const isMe = e.id === this.myId;
      const al = isMe ? this.alive : this.remotes.get(e.id)?.state.alive ?? false;
      alive[e.team].push(al);
    }
    hud.top({ score: m?.score ?? [0, 0], alive, clock, label, urgent });
    hud.vitals(this.alive, this.hp, this.armor, this.helmet, this.money);
    const [mag, reserve] = a.current;
    hud.weapon(this.alive, a.active, mag, reserve, a.reloading, a.inv);
    hud.buyAvailable(this.canBuyHere() && !this.ui.buy.isOpen);

    // Crosshair gap follows inaccuracy; hidden while scoped.
    const me = this.me!;
    const spread = a.spread(me.speed, me.body.onGround, me.body.crouchT, this.input.down('walk'));
    const px = Math.min(60, spread / Math.tan((this.renderer.camera.fov * Math.PI) / 360) * (innerHeight / 2));
    const sniper = a.def.zoom.length > 0;
    // Like CS, scoped weapons have no crosshair outside the scope.
    hud.setCrosshair(px * 0.8, !this.alive || sniper);
    hud.scope(this.alive && a.zoom > 0);

    // Flash blindness fades out over its duration.
    const blindLeft = this.blindUntil - this.time;
    const fl = blindLeft > 0 ? this.blindAmount * Math.min(1, blindLeft / Math.max(0.5, this.blindTotal * 0.6)) : 0;
    if (blindLeft <= 0) this.blindAmount = 0;
    hud.flash(fl);
    hud.smoke(this.effects.insideSmoke(this.renderer.camera.position));
    hud.lagging(this.inMatch && performance.now() - this.lastSnap > 1500);
    void dt;

    // Scoreboard.
    if (this.ui.scores.root.classList.contains('on') || (m?.phase === 'matchEnd')) {
      if (m?.phase === 'matchEnd') this.ui.scores.visible = true;
      const rows = (this.room?.roster ?? []).map((e) => {
        const isMe = e.id === this.myId;
        const r = this.remotes.get(e.id);
        return {
          id: e.id, name: e.name, team: e.team, bot: e.bot, ping: e.ping,
          alive: isMe ? this.alive : r?.state.alive ?? false,
          money: e.team === this.myTeam ? (isMe ? this.money : r?.state.money ?? 0) : null,
          stats: this.stats.get(e.id),
        };
      });
      const over = m?.phase === 'roundEnd' || m?.phase === 'halftime' || m?.phase === 'matchEnd';
      const played = m ? (over ? m.round : m.round - 1) : 0;
      this.ui.scores.render(rows, m?.score ?? [0, 0], m?.round ?? 1, played, this.map ? MAPS[this.mapId!].name : '', this.myId);
    }
  }

  render(dt: number): void {
    this.renderer.render(dt, this.inMatch && this.alive && this.showViewModel);
  }

  dispose(): void {
    this.unloadMap();
    this.link.close();
    this.renderer.viewCamera.remove(this.view.root);
  }
}
