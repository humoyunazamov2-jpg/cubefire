import type { VoxelWorld } from '../engine/world';
import { emptyInventory } from '../game/arsenal';
import { computeDamage, traceBullet, type Target } from '../game/combat';
import { flashAmount, heDamage, nadeReady, NADE_STEP, SMOKE_DURATION, SMOKE_RADIUS, stepNade, type Nade } from '../game/grenades';
import { ARMOR, ECONOMY, GRENADE_LIMIT, WEAPONS, type GrenadeId, type ItemId, type WeaponId } from '../game/weapons';
import { MAPS } from '../maps';
import { inBox, type BuiltMap, type SpawnPoint } from '../maps/types';
import type { Link } from '../net/link';
import {
  DEFAULT_SETTINGS, PROTOCOL_VERSION,
  type C2H, type DroppedItem, type H2C, type HitReport, type Inventory, type MatchState, type Phase,
  type RoomInfo, type RoomSettings, type TeamSlot, type V3,
} from '../net/protocol';
import { HostPlayer } from './hostPlayer';

export interface BotBrain {
  update(dt: number): void;
  onRoundStart?(): void;
  /** The host changed this bot's inventory (bought, picked up, new round). */
  onInventory?(give?: { w: WeaponId; ammo: [number, number] }, reset?: boolean): void;
  onDamaged?(from: V3, attacker: number): void;
  onSound?(p: V3, loud: boolean, from: number): void;
}
export type BotFactory = (host: HostSession, player: HostPlayer) => BotBrain;

const BOT_NAMES = ['Bolt', 'Cinder', 'Gravel', 'Nimbus', 'Quartz', 'Rusty', 'Sparky', 'Tofu', 'Waffle', 'Zigzag',
  'Brick', 'Flint', 'Pebble', 'Moss', 'Sprout', 'Ash', 'Pixel', 'Nugget', 'Biscuit', 'Clay'];

export const TICK = 1 / 60;

interface Smoke { p: V3; until: number }
interface Item extends DroppedItem { droppedBy: number; droppedAt: number }

/**
 * The authority for a room: roster, settings, the round state machine,
 * damage, money and everything else players must agree on.
 */
export class HostSession {
  settings: RoomSettings;
  players = new Map<number, HostPlayer>();
  private links = new Map<number, Link<C2H, H2C>>();
  private nextId = 1;
  hostId = -1;
  world: VoxelWorld | null = null;
  map: BuiltMap | null = null;
  time = 0;
  inMatch = false;
  phase: Phase = 'warmup';
  private phaseEnd = 0;
  private buyEnd = 0;
  round = 0;
  score: [number, number] = [0, 0];
  lossStreak: [number, number] = [0, 0];
  swapped = false;
  private winner: TeamSlot | null = null;
  private reason = '';
  private mvp: number | null = null;
  nades = new Map<number, Nade>();
  private nadeSeq = 1;
  smokes: Smoke[] = [];
  items = new Map<number, Item>();
  private itemSeq = 1;
  bots = new Map<number, BotBrain>();
  botFactory: BotFactory | null = null;
  private tickCount = 0;
  private acc = 0;
  /** Sandbox: no rounds, instant respawns, free money. Used by the practice range. */
  sandbox = false;
  /** Players who dropped out of this match, by token, so they can rejoin where they were. */
  private departed = new Map<string, { team: TeamSlot; money: number; stats: HostPlayer['stats'] }>();

  constructor(readonly code: string, settings: Partial<RoomSettings> = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
  }

  // ---------------------------------------------------------------- roster

  /** Attach a new connection. The first message must be 'hello'. */
  connect(link: Link<C2H, H2C>, isHost = false): void {
    let pid = -1;
    link.onMessage = (msg) => {
      if (pid < 0) {
        if (msg.t !== 'hello') return;
        if (msg.v !== PROTOCOL_VERSION) {
          link.send({ t: 'kick', reason: 'Different game version. Refresh the page and try again.' });
          link.close();
          return;
        }
        const humans = [...this.players.values()].filter((p) => !p.bot).length;
        if (humans >= 8) {
          link.send({ t: 'kick', reason: 'Room is full.' });
          link.close();
          return;
        }
        pid = this.nextId++;
        const token = typeof msg.token === 'string' ? msg.token.slice(0, 32) : '';
        const back = this.inMatch && token ? this.departed.get(token) : undefined;
        const p = new HostPlayer(pid, cleanName(msg.name, pid), back ? back.team : this.pickTeam(), false, isHost);
        p.token = token;
        if (isHost) this.hostId = pid;
        if (this.inMatch) { p.waiting = true; if (!back) p.team = -1; }
        if (back) {
          // Rejoining the same match: same team (if there is still room), money and score.
          this.departed.delete(token);
          const onTeam = [...this.players.values()].filter((q) => q.team === back.team).length;
          if (onTeam >= this.settings.teamSize) p.team = -1;
          p.money = back.money;
          p.stats = { ...back.stats, id: pid };
          p.rejoined = true;
        }
        this.players.set(pid, p);
        this.links.set(pid, link);
        link.send({ t: 'welcome', you: pid, room: this.roomInfo() });
        this.broadcastRoom();
        if (this.inMatch) {
          link.send({ t: 'start', map: this.settings.map, settings: this.settings });
          this.note(back && p.team !== -1 ? `${p.name} is back and plays from next round` : `${p.name} joined (spectating until you pick a team)`);
          this.broadcast({ t: 'stats', stats: [...this.players.values()].map((q) => q.stats) });
        } else this.note(`${p.name} joined`);
        return;
      }
      this.handle(pid, msg);
    };
    link.onClose = () => {
      if (pid < 0) return;
      const p = this.players.get(pid);
      this.links.delete(pid);
      if (!p) return;
      if (p.alive && this.inMatch) this.dropOnDeath(p);
      if (this.inMatch && p.token && p.team !== -1 && this.departed.size < 32) {
        this.departed.set(p.token, { team: p.team, money: p.money, stats: { ...p.stats } });
      }
      this.players.delete(pid);
      this.note(`${p.name} left`);
      this.broadcastRoom();
      if (this.inMatch) this.checkElimination();
    };
  }

  private pickTeam(): TeamSlot {
    const size = this.settings.teamSize;
    const count = (t: number) => [...this.players.values()].filter((p) => p.team === t).length;
    const a = count(0), b = count(1);
    if (a <= b && a < size) return 0;
    if (b < size) return 1;
    // Make room by removing a bot from the smaller side.
    for (const t of [0, 1] as const) {
      const bot = [...this.players.values()].find((p) => p.bot && p.team === t);
      if (bot && !this.inMatch) { this.removePlayer(bot.id); return t; }
    }
    return -1;
  }

  addBot(team: 0 | 1): HostPlayer | null {
    const onTeam = [...this.players.values()].filter((p) => p.team === team).length;
    if (onTeam >= this.settings.teamSize) return null;
    const used = new Set([...this.players.values()].map((p) => p.name));
    const name = BOT_NAMES.map((n) => `BOT ${n}`).find((n) => !used.has(n)) ?? `BOT ${this.nextId}`;
    const p = new HostPlayer(this.nextId++, name, team, true);
    this.players.set(p.id, p);
    p.loaded = true;
    if (this.botFactory) this.bots.set(p.id, this.botFactory(this, p));
    if (this.inMatch) p.waiting = true;
    this.broadcastRoom();
    return p;
  }

  removePlayer(id: number): void {
    const p = this.players.get(id);
    if (!p) return;
    if (p.alive && this.inMatch) this.dropOnDeath(p);
    this.players.delete(id);
    this.bots.delete(id);
    this.links.get(id)?.close();
    this.links.delete(id);
    this.broadcastRoom();
    if (this.inMatch) this.checkElimination();
  }

  /** After the team size shrinks: drop extra bots, then move extra humans elsewhere. */
  private fitTeams(): void {
    const size = this.settings.teamSize;
    const members = (t: number) => [...this.players.values()].filter((p) => p.team === t);
    for (const t of [0, 1] as const) {
      let list = members(t);
      for (const bot of list.filter((p) => p.bot).reverse()) {
        if (list.length <= size) break;
        this.removePlayer(bot.id);
        list = list.filter((p) => p !== bot);
      }
      // Newest humans move first; the host keeps their seat.
      for (const p of list.filter((q) => !q.isHost).reverse()) {
        if (list.length <= size) break;
        const other = (1 - t) as 0 | 1;
        p.team = members(other).length < size ? other : -1;
        list = list.filter((q) => q !== p);
      }
    }
  }

  /** Top up both teams with bots (or remove extra bots) to match the team size. */
  private fillBots(): void {
    for (const t of [0, 1] as const) {
      let members = [...this.players.values()].filter((p) => p.team === t);
      while (members.length > this.settings.teamSize) {
        const bot = members.find((p) => p.bot);
        if (!bot) break;
        this.removePlayer(bot.id);
        members = members.filter((p) => p !== bot);
      }
      if (this.settings.fillBots) while (members.length < this.settings.teamSize) {
        const b = this.addBot(t);
        if (!b) break;
        members.push(b);
      }
    }
  }

  roomInfo(): RoomInfo {
    return {
      code: this.code,
      settings: this.settings,
      inMatch: this.inMatch,
      roster: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, team: p.team, bot: p.bot, host: p.isHost, ping: p.ping })),
    };
  }

  private broadcastRoom(): void {
    this.broadcast({ t: 'room', room: this.roomInfo() });
  }

  // ------------------------------------------------------------- messaging

  send(pid: number, msg: H2C): void {
    this.links.get(pid)?.send(msg);
  }

  broadcast(msg: H2C, except = -1): void {
    for (const [id, l] of this.links) if (id !== except) l.send(msg);
  }

  private teamcast(team: TeamSlot, msg: H2C): void {
    for (const [id, l] of this.links) if (this.players.get(id)?.team === team) l.send(msg);
  }

  note(text: string): void {
    this.broadcast({ t: 'note', text });
  }

  private handle(pid: number, msg: C2H): void {
    const p = this.players.get(pid);
    if (!p) return;
    const isHost = pid === this.hostId;
    switch (msg.t) {
      case 'state': {
        p.lastState = this.time;
        if (!p.alive) return;
        p.yaw = msg.yaw; p.pitch = msg.pitch;
        p.weapon = msg.w; p.flags = msg.f;
        p.ammo.set(msg.w, msg.ammo);
        if (this.phase === 'freeze' && !this.sandbox) return; // frozen at spawn
        p.p = msg.p; p.v = msg.v; p.crouch = msg.c; p.onGround = msg.g === 1;
        return;
      }
      case 'fire': return this.onFire(p, msg.w, msg.o, msg.ends, msg.hits, msg.alt);
      case 'throw': return this.onThrow(p, msg.g, msg.o, msg.v);
      case 'buy': this.buy(p, msg.item); return;
      case 'drop': return this.onDrop(p, msg.w, msg.ammo);
      case 'chat': {
        const text = msg.text.slice(0, 160).trim();
        if (!text) return;
        const out: H2C = { t: 'chat', from: pid, name: p.name, text, team: msg.team };
        if (msg.team) this.teamcast(p.team, out); else this.broadcast(out);
        return;
      }
      case 'team': {
        if (this.inMatch && !p.waiting && p.team !== -1) return;
        if (msg.team !== -1) {
          const members = [...this.players.values()].filter((q) => q.team === msg.team && q !== p);
          if (members.length >= this.settings.teamSize) {
            const bot = members.find((q) => q.bot);
            if (!bot) return;
            this.removePlayer(bot.id);
          }
        }
        p.team = msg.team;
        if (this.inMatch && msg.team !== -1) this.note(`${p.name} will join ${msg.team === 0 ? 'Blaze' : 'Frost'} next round`);
        this.broadcastRoom();
        return;
      }
      case 'settings':
        if (!isHost || this.inMatch) return;
        this.settings = { ...this.settings, ...msg.settings };
        this.fitTeams();
        this.broadcastRoom();
        return;
      case 'startMatch':
        if (isHost && !this.inMatch) this.startMatch();
        return;
      case 'addBot':
        if (isHost && !this.inMatch) this.addBot(msg.team);
        return;
      case 'kickBot':
        if (isHost && !this.inMatch && this.players.get(msg.id)?.bot) this.removePlayer(msg.id);
        return;
      case 'ping':
        if (msg.rtt !== undefined) p.ping = Math.round(msg.rtt);
        this.send(pid, { t: 'pong', ts: msg.ts });
        return;
      case 'loaded':
        p.loaded = true;
        this.sendFullState(p);
        return;
    }
  }

  /** Bring a (re)joining client up to date. */
  private sendFullState(p: HostPlayer): void {
    this.send(p.id, { t: 'match', m: this.matchState() });
    this.send(p.id, { t: 'items', items: [...this.items.values()].map(stripItem) });
    this.send(p.id, { t: 'inv', inv: invOf(p), money: p.money, reset: true });
    this.send(p.id, { t: 'stats', stats: [...this.players.values()].map((q) => q.stats) });
    if (p.alive) this.send(p.id, { t: 'spawn', p: p.p, yaw: p.yaw });
  }

  // ------------------------------------------------------------- combat

  targets(): Target[] {
    const out: Target[] = [];
    for (const q of this.players.values())
      if (q.alive) out.push({ id: q.id, x: q.p[0], y: q.p[1], z: q.p[2], yaw: q.yaw, crouch: q.crouch });
    return out;
  }

  private onFire(p: HostPlayer, w: WeaponId, o: V3, ends: V3[], hits: HitReport[], alt?: boolean): void {
    if (!p.alive || (this.phase === 'freeze' && !this.sandbox)) return;
    this.broadcast({ t: 'shot', id: p.id, w, o, ends }, p.id);
    const def = WEAPONS[w];
    for (const bot of this.bots.values()) bot.onSound?.(o, def.slot !== 'knife', p.id);
    // Sum pellets per victim so shotguns show one damage number.
    for (const h of hits.slice(0, 12)) {
      const v = this.players.get(h.id);
      if (!v || !v.alive || h.dist > def.range + 2) continue;
      this.applyDamage(p, v, w, h, alt);
    }
  }

  /** Damage from a bullet or stab; handles armour, kills, assists and money. */
  applyDamage(att: HostPlayer, vic: HostPlayer, w: WeaponId, h: HitReport, _alt?: boolean): void {
    if (att.team === vic.team && att !== vic && !this.settings.friendlyFire) return;
    const d = computeDamage(w, h.zone, h.dist, h.pen, vic.armor, vic.helmet, h.stab, h.back);
    this.hurt(vic, att, d.hp, d.armor, w, h.zone, h.zone === 'head', h.pen < 0.999);
  }

  private hurt(vic: HostPlayer, att: HostPlayer | null, hp: number, armorLoss: number, w: WeaponId, zone: HitReport['zone'], hs: boolean, wb: boolean): void {
    if (!vic.alive) return;
    const dealt = Math.min(vic.hp, hp);
    vic.hp -= dealt;
    vic.armor = Math.max(0, vic.armor - armorLoss);
    if (vic.armor === 0) vic.helmet = false;
    if (att && att.team !== vic.team) {
      att.stats.damage += dealt;
      att.damageTo.set(vic.id, (att.damageTo.get(vic.id) ?? 0) + dealt);
    }
    const from: V3 = att ? [att.p[0], att.p[1] + 1.5, att.p[2]] : vic.p;
    this.broadcast({ t: 'dmg', v: vic.id, a: att?.id ?? -1, n: dealt, hp: vic.hp, zone, from });
    if (att) this.bots.get(vic.id)?.onDamaged?.(from, att.id);
    if (vic.hp <= 0) this.kill(vic, att, w, hs, wb);
  }

  private kill(vic: HostPlayer, att: HostPlayer | null, w: WeaponId | 'world', hs: boolean, wb: boolean): void {
    vic.alive = false;
    vic.hp = 0;
    vic.stats.deaths++;
    let assist: number | null = null;
    // Best assist: someone else on the killer's team who did 40+ damage.
    for (const q of this.players.values()) {
      if (q === att || q === vic || q.team === vic.team) continue;
      if ((q.damageTo.get(vic.id) ?? 0) >= 40) { assist = q.id; q.stats.assists++; break; }
    }
    if (att && att !== vic) {
      if (att.team === vic.team) {
        att.stats.kills = Math.max(0, att.stats.kills - 1);
        att.money = Math.max(0, att.money - 300);
      } else {
        att.stats.kills++;
        att.roundKills++;
        if (hs) att.stats.hs++;
        const reward = w === 'world' ? 300 : WEAPONS[w].killReward;
        att.money = Math.min(ECONOMY.maxMoney, att.money + reward);
        this.sendInv(att);
      }
    }
    this.dropOnDeath(vic);
    vic.inv = emptyInventory();
    vic.inv.secondary = null;
    vic.armor = 0;
    vic.helmet = false;
    this.broadcast({ t: 'kill', k: att?.id ?? -1, v: vic.id, w, hs, wb, as: assist });
    this.broadcast({ t: 'stats', stats: [...this.players.values()].map((q) => q.stats) });
    if (this.sandbox) {
      const pid = vic.id;
      setTimeout(() => { const q = this.players.get(pid); if (q && !q.alive && this.inMatch) this.spawnPlayer(q, true); }, 2500);
      return;
    }
    this.checkElimination();
  }

  private dropOnDeath(p: HostPlayer): void {
    const w = p.inv.primary ?? p.inv.secondary;
    if (!w) return;
    const ammo = p.ammo.get(w) ?? [WEAPONS[w].magSize, WEAPONS[w].reserve];
    this.spawnItem(w, [p.p[0], p.p[1] + 1, p.p[2]], ammo, p.id, [0, 1.5, 0]);
  }

  // ------------------------------------------------------------- items

  private spawnItem(w: WeaponId, p: V3, ammo: [number, number], by: number, v: V3): void {
    const id = this.itemSeq++;
    // Items fall straight to the ground below the drop point.
    const ground = this.world ? this.world.groundHeight(p[0], p[2], p[1]) : p[1];
    const item: Item = { id, w, p: [p[0], ground + 0.05, p[2]], ammo, droppedBy: by, droppedAt: this.time };
    this.items.set(id, item);
    this.broadcast({ t: 'item+', item: stripItem(item), v });
  }

  private onDrop(p: HostPlayer, w: WeaponId, ammo: [number, number]): void {
    if (!p.alive) return;
    const slot = WEAPONS[w].slot;
    if (slot === 'primary' && p.inv.primary === w) p.inv.primary = null;
    else if (slot === 'secondary' && p.inv.secondary === w) p.inv.secondary = null;
    else return;
    const fwd: V3 = [-Math.sin(p.yaw), 0, -Math.cos(p.yaw)];
    this.spawnItem(w, [p.p[0] + fwd[0] * 1.2, p.p[1] + 1.2, p.p[2] + fwd[2] * 1.2], ammo, p.id, [fwd[0] * 4, 2, fwd[2] * 4]);
    this.sendInv(p);
  }

  private pickups(): void {
    for (const it of this.items.values()) {
      const slot = WEAPONS[it.w].slot;
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (it.droppedBy === p.id && this.time - it.droppedAt < 1.5) continue;
        if (slot === 'primary' ? p.inv.primary : p.inv.secondary) continue;
        const dx = p.p[0] - it.p[0], dz = p.p[2] - it.p[2], dy = it.p[1] - p.p[1];
        if (dx * dx + dz * dz > 1.3 || dy < -0.6 || dy > 1.6) continue;
        if (slot === 'primary') p.inv.primary = it.w; else p.inv.secondary = it.w;
        this.items.delete(it.id);
        this.broadcast({ t: 'item-', id: it.id });
        p.ammo.set(it.w, it.ammo);
        this.sendInv(p, { w: it.w, ammo: it.ammo });
        break;
      }
    }
  }

  // ------------------------------------------------------------- grenades

  private onThrow(p: HostPlayer, g: GrenadeId, o: V3, v: V3): void {
    if (!p.alive || (this.phase === 'freeze' && !this.sandbox)) return;
    const i = p.inv.grenades.indexOf(g);
    if (i < 0) return;
    p.inv.grenades.splice(i, 1);
    const id = this.nadeSeq++;
    this.nades.set(id, { id, type: g, owner: p.id, p: [...o], v: [...v], age: 0, resting: false, still: 0, bounced: false });
    this.broadcast({ t: 'nade', id, g, o, v, owner: p.id });
  }

  private stepNades(): void {
    if (!this.world) return;
    for (const n of this.nades.values()) {
      stepNade(this.world, n);
      if (!nadeReady(n)) continue;
      this.nades.delete(n.id);
      const p: V3 = [n.p[0], n.p[1], n.p[2]];
      this.broadcast({ t: 'boom', id: n.id, g: n.type, p });
      const owner = this.players.get(n.owner) ?? null;
      if (n.type === 'he') {
        for (const q of this.players.values()) {
          if (!q.alive) continue;
          if (owner && q !== owner && q.team === owner.team && !this.settings.friendlyFire) continue;
          const dmg = heDamage(this.world, p, [q.p[0], q.p[1] + 1.0, q.p[2]]);
          if (dmg < 1) continue;
          const toHealth = q.armor > 0 ? dmg * 0.5 : dmg;
          const armorLoss = q.armor > 0 ? Math.min(q.armor, dmg * 0.25) : 0;
          this.hurt(q, owner, Math.round(toHealth), Math.round(armorLoss), 'he', 'body', false, false);
        }
      } else if (n.type === 'smoke') {
        this.smokes.push({ p, until: this.time + SMOKE_DURATION });
      } else if (n.type === 'flash') {
        // Humans work out their own blindness; the host does it for bots.
        for (const q of this.players.values()) {
          if (!q.bot || !q.alive) continue;
          const eye: V3 = [q.p[0], q.p[1] + 1.6, q.p[2]];
          const look: V3 = [-Math.sin(q.yaw) * Math.cos(q.pitch), Math.sin(q.pitch), -Math.cos(q.yaw) * Math.cos(q.pitch)];
          const f = flashAmount(this.world, p, eye, look);
          if (f.amount > 0.3) q.blindUntil = Math.max(q.blindUntil, this.time + f.duration * f.amount);
        }
      }
      for (const bot of this.bots.values()) bot.onSound?.(p, true, n.owner);
    }
    this.smokes = this.smokes.filter((s) => s.until > this.time);
  }

  /** Does a smoke cloud block the line from a to b? */
  smokeBlocks(a: V3, b: V3): boolean {
    for (const s of this.smokes) {
      if (s.until - this.time > SMOKE_DURATION - 0.8) continue; // still billowing out
      const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
      const len2 = abx * abx + aby * aby + abz * abz || 1;
      let t = ((s.p[0] - a[0]) * abx + (s.p[1] + 1 - a[1]) * aby + (s.p[2] - a[2]) * abz) / len2;
      t = Math.max(0, Math.min(1, t));
      const cx = a[0] + abx * t - s.p[0], cy = a[1] + aby * t - s.p[1] - 1, cz = a[2] + abz * t - s.p[2];
      if (cx * cx + cy * cy * 1.6 + cz * cz < SMOKE_RADIUS * SMOKE_RADIUS * 0.85) return true;
    }
    return false;
  }

  // ------------------------------------------------------------- bots API

  /** Fire a bot's weapon along the given directions (one per pellet). */
  botFire(p: HostPlayer, w: WeaponId, eye: V3, dirs: V3[], alt?: boolean): void {
    if (!this.world) return;
    const def = WEAPONS[w];
    const targets = this.targets();
    const ends: V3[] = [];
    const hits: HitReport[] = [];
    for (const d of dirs) {
      const r = traceBullet(this.world, def, eye[0], eye[1], eye[2], d[0], d[1], d[2], targets, p.id);
      ends.push(r.end);
      if (r.hit) {
        const back = def.slot === 'knife' ? isBehind(p, this.players.get(r.hit.id)) : undefined;
        hits.push({ id: r.hit.id, zone: r.hit.zone, dist: r.hit.dist, pen: r.hit.pen, stab: def.slot === 'knife' ? (alt ? 2 : 1) : undefined, back });
      }
    }
    this.onFire(p, w, eye, ends, hits, alt);
  }

  botThrow(p: HostPlayer, g: GrenadeId, o: V3, v: V3): void {
    this.onThrow(p, g, o, v);
  }

  botBuy(p: HostPlayer, item: ItemId): boolean {
    return this.buy(p, item);
  }

  // ------------------------------------------------------------- economy

  canBuy(p: HostPlayer): boolean {
    if (this.sandbox) return p.alive;
    if (!this.inMatch || !p.alive || !this.map || p.team === -1) return false;
    if (this.phase !== 'freeze' && !(this.phase === 'live' && this.time < this.buyEnd)) return false;
    const side = this.sideOf(p.team);
    return inBox(this.map.buyZones[side], p.p[0], p.p[1], p.p[2]);
  }

  private buy(p: HostPlayer, item: ItemId): boolean {
    if (!this.canBuy(p)) return false;
    let price: number;
    if (item === 'kevlar') {
      if (p.armor >= 100) return false;
      price = ARMOR.kevlar.price;
    } else if (item === 'helmet') {
      if (p.armor >= 100 && p.helmet) return false;
      price = p.armor >= 100 ? 350 : ARMOR.helmet.price;
    } else {
      const d = WEAPONS[item];
      price = d.price;
      if (d.slot === 'knife') return false;
      if (d.slot === 'grenade') {
        const g = item as GrenadeId;
        const have = p.inv.grenades.filter((x) => x === g).length;
        if (have >= GRENADE_LIMIT[g] || p.inv.grenades.length >= 4) return false;
      } else if ((d.slot === 'primary' ? p.inv.primary : p.inv.secondary) === item) return false;
    }
    if (!this.sandbox && p.money < price) return false;
    if (!this.sandbox) p.money -= price;
    if (item === 'kevlar') p.armor = 100;
    else if (item === 'helmet') { p.armor = 100; p.helmet = true; }
    else {
      const d = WEAPONS[item];
      if (d.slot === 'grenade') p.inv.grenades.push(item as GrenadeId);
      else {
        const old = d.slot === 'primary' ? p.inv.primary : p.inv.secondary;
        if (old) {
          const ammo = p.ammo.get(old) ?? [WEAPONS[old].magSize, WEAPONS[old].reserve];
          this.spawnItem(old, [p.p[0], p.p[1] + 1, p.p[2]], ammo, p.id, [0, 1, 0]);
        }
        if (d.slot === 'primary') p.inv.primary = item; else p.inv.secondary = item;
        p.ammo.set(item, [d.magSize, d.reserve]);
        this.sendInv(p, { w: item, ammo: [d.magSize, d.reserve] });
        return true;
      }
    }
    this.sendInv(p);
    return true;
  }

  private sendInv(p: HostPlayer, give?: { w: WeaponId; ammo: [number, number] }, reset = false): void {
    if (p.bot) this.bots.get(p.id)?.onInventory?.(give, reset);
    else this.send(p.id, { t: 'inv', inv: invOf(p), money: p.money, give, reset });
  }

  // ------------------------------------------------------------- match flow

  sideOf(team: TeamSlot): 0 | 1 {
    const t = team === 1 ? 1 : 0;
    return (this.swapped ? 1 - t : t) as 0 | 1;
  }

  startMatch(mapOverride?: BuiltMap): void {
    this.departed.clear();
    this.fillBots();
    const map = mapOverride ?? MAPS[this.settings.map].build();
    this.map = map;
    this.world = map.world;
    this.inMatch = true;
    this.round = 0;
    this.score = [0, 0];
    this.lossStreak = [0, 0];
    this.swapped = false;
    this.items.clear();
    this.nades.clear();
    this.smokes = [];
    for (const p of this.players.values()) {
      p.resetStats();
      p.money = this.sandbox ? 16000 : ECONOMY.startMoney;
      p.inv = emptyInventory();
      p.armor = 0; p.helmet = false;
      p.alive = false;
      p.waiting = false;
      p.loaded = p.bot;
    }
    this.phase = 'warmup';
    this.phaseEnd = this.time + 20;
    this.broadcast({ t: 'start', map: this.settings.map, settings: this.settings });
    this.broadcastRoom();
  }

  endMatch(): void {
    this.inMatch = false;
    this.departed.clear();
    this.map = null;
    this.world = null;
    this.items.clear();
    this.nades.clear();
    this.smokes = [];
    for (const p of this.players.values()) { p.alive = false; if (p.team === -1 && p.waiting) p.waiting = false; }
    this.broadcast({ t: 'end' });
    this.broadcastRoom();
  }

  private matchState(): MatchState {
    return {
      phase: this.phase,
      round: this.round,
      score: [...this.score] as [number, number],
      remaining: Math.max(0, (this.phaseEnd - this.time) * 1000),
      buyRemaining: Math.max(0, (this.buyEnd - this.time) * 1000),
      winner: this.winner,
      reason: this.reason,
      swapped: this.swapped,
      mvp: this.mvp,
      lossStreak: [...this.lossStreak] as [number, number],
    };
  }

  private broadcastMatch(): void {
    this.broadcast({ t: 'match', m: this.matchState() });
  }

  private startRound(): void {
    if (!this.map) return;
    this.round++;
    this.winner = null;
    this.reason = '';
    this.mvp = null;
    for (const it of this.items.values()) this.broadcast({ t: 'item-', id: it.id });
    this.items.clear();
    this.nades.clear();
    this.smokes = [];
    // Players who joined mid-match and picked a team come in now (rejoiners keep their money).
    for (const p of this.players.values()) if (p.waiting && p.team !== -1) {
      p.waiting = false;
      if (!p.rejoined) p.money = ECONOMY.startMoney;
      p.rejoined = false;
    }
    const used: [number, number] = [0, 0];
    for (const p of this.players.values()) {
      p.damageTo.clear();
      p.roundKills = 0;
      if (p.team === -1 || p.waiting) { p.alive = false; continue; }
      const keep = p.alive;
      if (!keep) {
        p.inv = emptyInventory();
        p.armor = 0;
        p.helmet = false;
        p.ammo.clear();
      }
      const side = this.sideOf(p.team);
      const spots = this.map.spawns[side];
      const s = spots[used[side]++ % spots.length];
      this.placeAt(p, s);
      this.sendInv(p, undefined, !keep);
    }
    this.phase = 'freeze';
    this.phaseEnd = this.time + this.settings.freezeTime;
    this.buyEnd = this.phaseEnd + this.settings.buyTime;
    for (const bot of this.bots.values()) bot.onRoundStart?.();
    this.broadcastMatch();
  }

  private placeAt(p: HostPlayer, s: SpawnPoint): void {
    p.alive = true;
    p.hp = 100;
    p.p = [s.x, s.y, s.z];
    p.v = [0, 0, 0];
    p.yaw = s.yaw;
    p.pitch = 0;
    p.crouch = 0;
    p.blindUntil = 0;
    p.weapon = p.inv.primary ?? p.inv.secondary ?? 'knife';
    this.send(p.id, { t: 'spawn', p: [...p.p], yaw: s.yaw });
  }

  /** Sandbox respawn at a random spawn of the player's side. */
  spawnPlayer(p: HostPlayer, fresh: boolean): void {
    if (!this.map || p.team === -1) return;
    if (fresh) { p.inv = emptyInventory(); p.armor = 0; p.helmet = false; p.ammo.clear(); }
    const spots = this.map.spawns[this.sideOf(p.team)];
    this.placeAt(p, spots[Math.floor(Math.random() * spots.length)]);
    this.sendInv(p, undefined, fresh);
    this.bots.get(p.id)?.onRoundStart?.();
  }

  private alive(team: 0 | 1): HostPlayer[] {
    return [...this.players.values()].filter((p) => p.team === team && p.alive);
  }

  private checkElimination(): void {
    if (!this.inMatch || this.sandbox || this.phase !== 'live') return;
    const a = this.alive(0).length, b = this.alive(1).length;
    if (a === 0 && b === 0) this.endRound(null, 'Both teams eliminated');
    else if (a === 0) this.endRound(1, 'Blaze eliminated');
    else if (b === 0) this.endRound(0, 'Frost eliminated');
  }

  private endRound(winner: 0 | 1 | null, reason: string): void {
    this.phase = 'roundEnd';
    this.phaseEnd = this.time + 5;
    this.winner = winner;
    this.reason = reason;
    if (winner !== null) {
      this.score[winner]++;
      const loser = (1 - winner) as 0 | 1;
      const bonus = Math.min(ECONOMY.lossMax, ECONOMY.lossBase + ECONOMY.lossStep * this.lossStreak[loser]);
      for (const p of this.players.values()) {
        if (p.team === winner) p.money = Math.min(ECONOMY.maxMoney, p.money + ECONOMY.winReward);
        else if (p.team === loser) p.money = Math.min(ECONOMY.maxMoney, p.money + bonus);
      }
      this.lossStreak[loser] = Math.min(4, this.lossStreak[loser] + 1);
      this.lossStreak[winner] = Math.max(0, this.lossStreak[winner] - 1);
      // Round MVP: most kills on the winning side, damage breaks ties.
      const best = [...this.players.values()].filter((p) => p.team === winner)
        .sort((x, y) => y.roundKills - x.roundKills || y.stats.damage - x.stats.damage)[0];
      if (best) { this.mvp = best.id; best.stats.mvps++; }
    } else {
      for (const p of this.players.values()) if (p.team !== -1) p.money = Math.min(ECONOMY.maxMoney, p.money + ECONOMY.lossBase);
    }
    for (const p of this.players.values()) if (p.team !== -1) this.sendInv(p);
    this.broadcast({ t: 'stats', stats: [...this.players.values()].map((q) => q.stats) });
    this.broadcastMatch();
  }

  /** Round timer ran out: more survivors wins, then more total health. */
  private timeout(): void {
    const a = this.alive(0), b = this.alive(1);
    const hp = (l: HostPlayer[]) => l.reduce((s, p) => s + p.hp, 0);
    if (a.length !== b.length) this.endRound(a.length > b.length ? 0 : 1, 'Time up: more players alive');
    else if (hp(a) !== hp(b)) this.endRound(hp(a) > hp(b) ? 0 : 1, 'Time up: more health left');
    else this.endRound(null, 'Time up: draw');
  }

  private matchOver(): boolean {
    return this.score[0] >= this.settings.winRounds || this.score[1] >= this.settings.winRounds;
  }

  private tickMatch(): void {
    if (!this.inMatch || this.sandbox) return;
    const t = this.time;
    // A side with no players at all ends the match.
    if (this.phase !== 'warmup' && this.phase !== 'matchEnd') {
      const has = (team: number) => [...this.players.values()].some((p) => p.team === team && !p.waiting);
      if (!has(0) || !has(1)) {
        this.phase = 'matchEnd';
        this.phaseEnd = t + 8;
        this.winner = has(0) ? 0 : has(1) ? 1 : null;
        this.reason = 'The other team left';
        this.broadcastMatch();
      }
    }
    switch (this.phase) {
      case 'warmup': {
        const ready = [...this.players.values()].every((p) => p.loaded || p.team === -1);
        if (ready || t >= this.phaseEnd) this.startRound();
        break;
      }
      case 'freeze':
        if (t >= this.phaseEnd) {
          this.phase = 'live';
          this.phaseEnd = t + this.settings.roundTime;
          this.broadcastMatch();
          this.checkElimination();
        }
        break;
      case 'live':
        if (t >= this.phaseEnd) this.timeout();
        break;
      case 'roundEnd':
        if (t < this.phaseEnd) break;
        if (this.matchOver()) {
          this.phase = 'matchEnd';
          this.phaseEnd = t + 12;
          this.winner = this.score[0] > this.score[1] ? 0 : 1;
          this.reason = `${this.winner === 0 ? 'Blaze' : 'Frost'} wins the match`;
          this.broadcastMatch();
        } else if (this.round === this.settings.winRounds - 1 && !this.swapped) {
          this.phase = 'halftime';
          this.phaseEnd = t + 6;
          this.broadcastMatch();
        } else this.startRound();
        break;
      case 'halftime':
        if (t < this.phaseEnd) break;
        this.swapped = true;
        this.lossStreak = [0, 0];
        for (const p of this.players.values()) {
          p.money = ECONOMY.halftimeMoney;
          p.alive = false; // everyone starts the half fresh
        }
        this.startRound();
        break;
      case 'matchEnd':
        if (t >= this.phaseEnd) this.endMatch();
        break;
    }
  }

  // ------------------------------------------------------------- main loop

  /** Advance the simulation; call with real elapsed time. Runs fixed 60 Hz ticks. */
  update(dt: number): void {
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.tick();
    }
  }

  private tick(): void {
    this.time += TICK;
    this.tickCount++;
    if (this.inMatch && this.world) {
      if (this.phase !== 'warmup' || this.sandbox) for (const [id, bot] of this.bots) if (this.players.get(id)?.alive) bot.update(TICK);
      this.stepNades();
      this.pickups();
    }
    this.tickMatch();
    // Snapshots at 20 Hz.
    if (this.inMatch && this.tickCount % 3 === 0) {
      const ps = [...this.players.values()].filter((p) => p.team !== -1 && !p.waiting).map((p) => p.snap());
      this.broadcast({ t: 'snap', ps });
    }
    if (this.tickCount % 120 === 0) this.broadcastRoomPings();
  }

  private lastPingSig = '';
  private broadcastRoomPings(): void {
    const sig = [...this.players.values()].map((p) => p.ping).join(',');
    if (sig !== this.lastPingSig) { this.lastPingSig = sig; this.broadcastRoom(); }
  }
}

/** A player's inventory as sent to them; armour lives on the player itself. */
function invOf(p: HostPlayer): Inventory {
  return { ...structuredClone(p.inv), armor: p.armor, helmet: p.helmet };
}

function stripItem(i: DroppedItem): DroppedItem {
  return { id: i.id, w: i.w, p: i.p, ammo: i.ammo };
}

function cleanName(n: string, id: number): string {
  const s = (n || '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16);
  return s || `Player ${id}`;
}

/** Is the attacker behind the victim (for knife backstabs)? */
export function isBehind(att: HostPlayer | { p: V3 }, vic: HostPlayer | undefined): boolean {
  if (!vic) return false;
  const fx = -Math.sin(vic.yaw), fz = -Math.cos(vic.yaw);
  const dx = vic.p[0] - att.p[0], dz = vic.p[2] - att.p[2];
  const l = Math.hypot(dx, dz) || 1;
  return (dx / l) * fx + (dz / l) * fz > 0.55;
}

export { NADE_STEP };
