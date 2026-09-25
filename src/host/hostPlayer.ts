import { emptyInventory } from '../game/arsenal';
import type { WeaponId } from '../game/weapons';
import type { Inventory, PlayerStats, SnapPlayer, TeamSlot, V3 } from '../net/protocol';

/** Host-side record of one player (human or bot). */
export class HostPlayer {
  // Transform, reported by the owner (or simulated by the host for bots).
  p: V3 = [0, 0, 0];
  v: V3 = [0, 0, 0];
  yaw = 0;
  pitch = 0;
  crouch = 0;
  onGround = true;
  weapon: WeaponId = 'pistol';
  flags = 0;
  // Authoritative state.
  alive = false;
  hp = 100;
  armor = 0;
  helmet = false;
  money = 800;
  inv: Inventory = emptyInventory();
  /** Last ammo count the owner reported for each weapon. */
  ammo = new Map<WeaponId, [number, number]>();
  stats: PlayerStats;
  /** Damage dealt to each victim this round, for assists. */
  damageTo = new Map<number, number>();
  roundKills = 0;
  loaded = false;
  ping = 0;
  lastState = 0;
  blindUntil = 0;
  /** Joined mid-match: waits for the next round. */
  waiting = false;
  /** Came back to the same match after dropping out: keeps their money. */
  rejoined = false;
  /** Per-tab id the player's browser sends, to recognise them if they rejoin. */
  token = '';

  constructor(readonly id: number, public name: string, public team: TeamSlot, readonly bot: boolean, readonly isHost = false) {
    this.stats = { id, kills: 0, deaths: 0, assists: 0, damage: 0, hs: 0, mvps: 0 };
  }

  snap(): SnapPlayer {
    const r = (n: number) => Math.round(n * 100) / 100;
    return {
      id: this.id,
      p: [r(this.p[0]), r(this.p[1]), r(this.p[2])],
      v: [r(this.v[0]), r(this.v[1]), r(this.v[2])],
      yaw: r(this.yaw),
      pitch: r(this.pitch),
      c: r(this.crouch),
      g: this.onGround ? 1 : 0,
      w: this.weapon,
      a: this.alive ? 1 : 0,
      hp: this.hp,
      ar: this.armor,
      hm: this.helmet ? 1 : 0,
      m: this.money,
      f: this.flags,
    };
  }

  resetStats(): void {
    this.stats = { id: this.id, kills: 0, deaths: 0, assists: 0, damage: 0, hs: 0, mvps: 0 };
  }
}
