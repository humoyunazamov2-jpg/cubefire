import type { GrenadeId, ItemId, WeaponId, Zone } from '../game/weapons';

// Messages between the host (who runs the match) and every client, including
// the host's own client. Everything is plain JSON.

/** Bump whenever messages change; mismatched players are turned away with a clear message. */
export const PROTOCOL_VERSION = 2;

export type V3 = [number, number, number];
export type TeamSlot = 0 | 1 | -1; // -1 = spectator

export type MapId = 'dunes' | 'frostbite' | 'arena';

export interface RoomSettings {
  map: MapId;
  /** Players per team: 1v1, 2v2 or 4v4. */
  teamSize: 1 | 2 | 4;
  /** Rounds needed to win the match. */
  winRounds: number;
  fillBots: boolean;
  botSkill: 0 | 1 | 2;
  friendlyFire: boolean;
  roundTime: number;
  buyTime: number;
  freezeTime: number;
}

export interface RosterEntry {
  id: number;
  name: string;
  team: TeamSlot;
  bot: boolean;
  host: boolean;
  ping: number;
}

export interface RoomInfo {
  code: string;
  settings: RoomSettings;
  roster: RosterEntry[];
  inMatch: boolean;
}

export interface Inventory {
  primary: WeaponId | null;
  secondary: WeaponId | null;
  grenades: GrenadeId[];
  armor: number;
  helmet: boolean;
}

/** One player's replicated state inside a snapshot. */
export interface SnapPlayer {
  id: number;
  p: V3;
  v: V3;
  yaw: number;
  pitch: number;
  c: number;       // crouch 0..1
  g: 0 | 1;        // on ground
  w: WeaponId;
  a: 0 | 1;        // alive
  hp: number;
  ar: number;      // armour
  hm: 0 | 1;       // helmet
  m: number;       // money
  f: number;       // flags (PF_*)
}

export const PF_RELOADING = 1;
export const PF_SCOPED = 2;
export const PF_WALKING = 4;
export const PF_FIRING = 8;
export const PF_BLIND = 16;

export interface PlayerStats {
  id: number;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  hs: number;
  mvps: number;
}

export type Phase = 'warmup' | 'freeze' | 'live' | 'roundEnd' | 'halftime' | 'matchEnd';

export interface MatchState {
  phase: Phase;
  round: number;          // 1-based
  score: [number, number];
  /** Milliseconds left in the current phase when this message was sent. */
  remaining: number;
  /** Buy allowed for this many more ms. */
  buyRemaining: number;
  winner: TeamSlot | null;
  reason: string;
  /** Teams swapped sides (spawns) this half. */
  swapped: boolean;
  mvp: number | null;
  lossStreak: [number, number];
}

export interface HitReport {
  id: number;
  zone: Zone;
  dist: number;
  /** Damage multiplier left after penetrating walls (1 = clear shot). */
  pen: number;
  /** Knife: 1 = slash, 2 = heavy stab. */
  stab?: 1 | 2;
  back?: boolean;
}

export interface DroppedItem {
  id: number;
  w: WeaponId;
  p: V3;
  ammo: [number, number];
}

// ---- Client -> Host ----
export type C2H =
  | { t: 'hello'; name: string; v: number; token?: string }
  | { t: 'state'; p: V3; v: V3; yaw: number; pitch: number; c: number; g: 0 | 1; w: WeaponId; ammo: [number, number]; f: number }
  | { t: 'fire'; w: WeaponId; o: V3; ends: V3[]; hits: HitReport[]; alt?: boolean }
  | { t: 'throw'; g: GrenadeId; o: V3; v: V3 }
  | { t: 'buy'; item: ItemId }
  | { t: 'drop'; w: WeaponId; ammo: [number, number] }
  | { t: 'chat'; text: string; team: boolean }
  | { t: 'team'; team: TeamSlot }
  | { t: 'settings'; settings: Partial<RoomSettings> }
  | { t: 'startMatch' }
  | { t: 'addBot'; team: 0 | 1 }
  | { t: 'kickBot'; id: number }
  | { t: 'ping'; ts: number; rtt?: number }
  | { t: 'loaded' };

// ---- Host -> Client ----
export type H2C =
  | { t: 'welcome'; you: number; room: RoomInfo }
  | { t: 'room'; room: RoomInfo }
  | { t: 'start'; map: MapId; settings: RoomSettings }
  | { t: 'snap'; ps: SnapPlayer[] }
  | { t: 'spawn'; p: V3; yaw: number }
  | { t: 'inv'; inv: Inventory; money: number; give?: { w: WeaponId; ammo: [number, number] }; reset?: boolean }
  | { t: 'shot'; id: number; w: WeaponId; o: V3; ends: V3[] }
  | { t: 'dmg'; v: number; a: number; n: number; hp: number; zone: Zone; from: V3 }
  | { t: 'kill'; k: number; v: number; w: WeaponId | 'world'; hs: boolean; wb: boolean; as: number | null }
  | { t: 'nade'; id: number; g: GrenadeId; o: V3; v: V3; owner: number }
  | { t: 'boom'; id: number; g: GrenadeId; p: V3 }
  | { t: 'items'; items: DroppedItem[] }
  | { t: 'item+'; item: DroppedItem; v: V3 }
  | { t: 'item-'; id: number }
  | { t: 'match'; m: MatchState }
  | { t: 'stats'; stats: PlayerStats[] }
  | { t: 'chat'; from: number; name: string; text: string; team: boolean }
  | { t: 'note'; text: string }
  | { t: 'pong'; ts: number }
  | { t: 'end' }
  | { t: 'kick'; reason: string };

export const DEFAULT_SETTINGS: RoomSettings = {
  map: 'dunes',
  teamSize: 2,
  winRounds: 7,
  fillBots: true,
  botSkill: 1,
  friendlyFire: false,
  roundTime: 105,
  buyTime: 25,
  freezeTime: 10,
};
