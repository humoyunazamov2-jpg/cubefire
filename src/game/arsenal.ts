import type { Inventory } from '../net/protocol';
import { PHYS } from './physics';
import { GRENADES, WEAPONS, type GrenadeId, type WeaponId } from './weapons';

export const emptyInventory = (): Inventory => ({ primary: null, secondary: 'pistol', grenades: [], armor: 0, helmet: false });

const DRAW_TIME: Partial<Record<WeaponId, number>> = { knife: 0.4, pistol: 0.45, deagle: 0.6, sniper: 0.9, marksman: 0.7 };
export const drawTime = (w: WeaponId) => DRAW_TIME[w] ?? (WEAPONS[w].slot === 'grenade' ? 0.45 : 0.65);

/**
 * Runtime weapon state for one player: what they hold, ammo, reload and
 * fire timing, spray/recoil progress and scope. Owned by whoever controls
 * the player (their own client, or the host for bots).
 */
export class Arsenal {
  inv: Inventory = emptyInventory();
  ammo = new Map<WeaponId, [number, number]>();
  active: WeaponId = 'knife';
  prev: WeaponId = 'knife';
  nextFire = 0;
  reloadEnd = 0;
  drawEnd = 0;
  spray = 0;
  lastShot = -10;
  zoom = 0;
  /** Semi-automatic weapons need the trigger released between shots. */
  private needRelease = false;
  /** Knife heavy attack in progress. */
  heavy = false;

  constructor() {
    this.fillAmmo('pistol');
    this.active = 'pistol';
  }

  owns(w: WeaponId): boolean {
    const d = WEAPONS[w];
    if (d.slot === 'knife') return true;
    if (d.slot === 'primary') return this.inv.primary === w;
    if (d.slot === 'secondary') return this.inv.secondary === w;
    return this.inv.grenades.includes(w as GrenadeId);
  }

  fillAmmo(w: WeaponId): void {
    const d = WEAPONS[w];
    this.ammo.set(w, [d.magSize, d.reserve]);
  }

  get current(): [number, number] {
    return this.ammo.get(this.active) ?? [0, 0];
  }

  get def() {
    return WEAPONS[this.active];
  }

  get reloading(): boolean {
    return this.reloadEnd > 0;
  }

  /** Movement speed multiplier for the held weapon. */
  get speedMul(): number {
    return this.def.speedMul * (this.zoom > 0 ? 0.72 : 1);
  }

  /**
   * Adopt an inventory sent by the host. New guns get full ammo (or the ammo
   * that came with a picked-up weapon); if the held weapon is gone, switch.
   */
  setInventory(inv: Inventory, now: number, give?: { w: WeaponId; ammo: [number, number] }, reset = false): void {
    const before = this.inv;
    this.inv = inv;
    if (reset) this.ammo.clear();
    for (const w of [inv.primary, inv.secondary]) if (w && !this.ammo.has(w)) this.fillAmmo(w);
    if (give) this.ammo.set(give.w, [...give.ammo]);
    // Auto-equip a newly acquired primary, like CS does after buying.
    const gotPrimary = inv.primary && inv.primary !== before.primary;
    const gotSecondary = inv.secondary && inv.secondary !== before.secondary && !inv.primary;
    if (gotPrimary) this.switchTo(inv.primary!, now);
    else if (gotSecondary) this.switchTo(inv.secondary!, now);
    else if (!this.owns(this.active)) this.switchTo(this.best(), now);
    // Forget ammo for guns we no longer have.
    for (const w of [...this.ammo.keys()]) if (!this.owns(w)) this.ammo.delete(w);
  }

  best(): WeaponId {
    return this.inv.primary ?? this.inv.secondary ?? 'knife';
  }

  switchTo(w: WeaponId, now: number): boolean {
    if (!this.owns(w) || (w === this.active && this.drawEnd > 0)) return false;
    if (w !== this.active) this.prev = this.active;
    this.active = w;
    this.drawEnd = now + drawTime(w);
    this.reloadEnd = 0;
    this.zoom = 0;
    this.spray = 0;
    this.heavy = false;
    return true;
  }

  /** Number keys: 1 primary, 2 pistol, 3 knife, 4 cycles grenades. */
  selectSlot(slot: number, now: number): boolean {
    if (slot === 1 && this.inv.primary) return this.switchTo(this.inv.primary, now);
    if (slot === 2 && this.inv.secondary) return this.switchTo(this.inv.secondary, now);
    if (slot === 3) return this.switchTo('knife', now);
    if (slot === 4 && this.inv.grenades.length) {
      const owned = GRENADES.filter((g) => this.inv.grenades.includes(g));
      const i = owned.indexOf(this.active as GrenadeId);
      return this.switchTo(owned[(i + 1) % owned.length], now);
    }
    return false;
  }

  cycle(dir: number, now: number): void {
    const order: WeaponId[] = [];
    if (this.inv.primary) order.push(this.inv.primary);
    if (this.inv.secondary) order.push(this.inv.secondary);
    order.push('knife');
    for (const g of GRENADES) if (this.inv.grenades.includes(g)) order.push(g);
    const i = order.indexOf(this.active);
    this.switchTo(order[(i + dir + order.length) % order.length], now);
  }

  reload(now: number): boolean {
    const d = this.def;
    const [mag, reserve] = this.current;
    if (d.magSize === 0 || this.reloading || mag >= d.magSize || reserve <= 0 || now < this.drawEnd) return false;
    this.reloadEnd = now + d.reloadTime;
    this.zoom = 0;
    return true;
  }

  /** Scoped weapons cycle zoom levels; returns the FOV multiplier (1 = none). */
  toggleZoom(): number {
    const z = this.def.zoom;
    if (!z.length || this.reloading) return 1;
    this.zoom = (this.zoom + 1) % (z.length + 1);
    return this.fovMul;
  }

  get fovMul(): number {
    return this.zoom > 0 ? this.def.zoom[this.zoom - 1] : 1;
  }

  private lastUpdate = 0;

  /** Call every tick; completes reloads. */
  update(now: number): void {
    const dt = Math.max(0, Math.min(0.1, now - this.lastUpdate));
    this.lastUpdate = now;
    if (this.drawEnd && now >= this.drawEnd) this.drawEnd = 0;
    if (this.reloadEnd && now >= this.reloadEnd) {
      this.reloadEnd = 0;
      const d = this.def;
      const [mag, reserve] = this.current;
      const take = Math.min(d.magSize - mag, reserve);
      this.ammo.set(this.active, [mag + take, reserve - take]);
    }
    // Spray pattern resets gradually after you stop shooting.
    if (now - this.lastShot > this.def.fireInterval + 0.08) this.spray = Math.max(0, this.spray - dt * 12);
  }

  /**
   * Try to shoot. `pressed` is this frame's click, `held` whether the button
   * is down. Returns true if a shot (or throw/stab) happens now.
   */
  tryFire(now: number, pressed: boolean, held: boolean): boolean {
    if (!held) this.needRelease = false;
    if (!held && !pressed) return false;
    const d = this.def;
    if (now < this.drawEnd || now < this.nextFire) return false;
    if (d.slot === 'grenade') {
      if (!pressed) return false;
      return true;
    }
    if (d.slot === 'knife') {
      this.nextFire = now + d.fireInterval;
      this.heavy = false;
      return true;
    }
    if (!d.auto && this.needRelease) return false;
    if (this.reloading) return false;
    const [mag, reserve] = this.current;
    if (mag <= 0) {
      if (pressed) this.reload(now);
      return false;
    }
    this.ammo.set(this.active, [mag - 1, reserve]);
    this.nextFire = now + d.fireInterval;
    if (!d.auto) this.needRelease = true;
    this.spray += 1;
    this.lastShot = now;
    // Bolt-action snipers drop out of scope after each shot.
    if (d.zoom.length && d.fireInterval > 1) this.zoom = 0;
    return true;
  }

  /** Knife heavy stab (right click). */
  tryHeavy(now: number, pressed: boolean): boolean {
    if (!pressed || this.active !== 'knife' || now < this.drawEnd || now < this.nextFire) return false;
    this.nextFire = now + 1.0;
    this.heavy = true;
    return true;
  }

  /** Remove a thrown grenade from the local inventory. */
  consumeGrenade(g: GrenadeId, now: number): void {
    const i = this.inv.grenades.indexOf(g);
    if (i >= 0) this.inv.grenades.splice(i, 1);
    // Holding another of the same type: just draw it again.
    if (this.owns(g)) { this.drawEnd = now + 0.6; return; }
    this.switchTo(this.prev !== g && this.owns(this.prev) ? this.prev : this.best(), now);
  }

  /**
   * Current inaccuracy cone for the held weapon given how the player moves.
   * Standing still is precise; running and jumping are not.
   */
  spread(speed: number, onGround: boolean, crouch: number, walking: boolean): number {
    const d = this.def;
    let s = d.spreadStand;
    const full = PHYS.runSpeed * d.speedMul;
    const frac = speed / full;
    if (!onGround) s = d.spreadAir;
    else if (frac > 0.34) s += d.spreadMove * Math.min(1, (frac - 0.34) / 0.66);
    else if (walking && frac > 0.2) s += d.spreadMove * 0.08;
    if (onGround && crouch > 0.5) s *= 0.75;
    // Sustained fire blooms the cone.
    s += Math.max(0, this.spray - 3) * d.spreadStand * 0.9 + Math.max(0, this.spray - 1) * d.spreadMove * 0.02;
    // Scoped weapons are wildly inaccurate unscoped.
    if (d.zoom.length && this.zoom === 0) s = Math.max(s, 0.07);
    return s;
  }

  /** Recoil kick for the shot that just happened: [pitch up, yaw]. */
  recoil(): [number, number] {
    const d = this.def;
    const n = this.spray;
    const climb = n <= d.recoilMax / Math.max(1e-6, d.recoilUp) ? d.recoilUp : d.recoilUp * 0.15;
    // First few bullets go straight up, then the spray wanders side to side.
    const side = n < 4 ? (n % 2 ? 0.2 : -0.2) * d.recoilSide : Math.sin(n * 0.55) * d.recoilSide * 1.4;
    return [climb, side];
  }
}
