// Weapon and equipment data. Names are original; roles mirror a CS-style arsenal.

export type Slot = 'primary' | 'secondary' | 'knife' | 'grenade';
export type WeaponId =
  | 'knife' | 'pistol' | 'deagle'
  | 'smg' | 'shotgun' | 'rifle' | 'carbine' | 'marksman' | 'sniper'
  | 'he' | 'flash' | 'smoke';
export type GrenadeId = 'he' | 'flash' | 'smoke';
export type ItemId = WeaponId | 'kevlar' | 'helmet';

/** A coloured box in gun-pixel units; the muzzle points towards -z. */
export type VoxBox = [x: number, y: number, z: number, w: number, h: number, d: number, color: number];

export interface WeaponDef {
  id: WeaponId;
  name: string;
  slot: Slot;
  price: number;
  killReward: number;
  /** Damage per bullet/pellet before hit-zone, range and armour modifiers. */
  damage: number;
  pellets: number;
  /** Seconds between shots. */
  fireInterval: number;
  auto: boolean;
  magSize: number;
  reserve: number;
  reloadTime: number;
  /** Fraction of damage that goes through armour. */
  armorPen: number;
  /** Damage multiplier per 10 m travelled. */
  falloff: number;
  range: number;
  /** Multiplier on run speed while this weapon is held. */
  speedMul: number;
  /** Spread cone (radians) when standing still, moving at full speed, and in the air. */
  spreadStand: number;
  spreadMove: number;
  spreadAir: number;
  /** Camera kick per shot (radians) and sideways sway amplitude. */
  recoilUp: number;
  recoilSide: number;
  /** Max vertical climb before the spray levels out. */
  recoilMax: number;
  /** Scope zoom levels (FOV multipliers); empty = no scope. */
  zoom: number[];
  /** Wall penetration power: how many "block units" a bullet can punch through. */
  penetration: number;
  model: VoxBox[];
  /** Short text for the buy menu. */
  blurb: string;
}

const G = 0x3b3e44, D = 0x24262a, L = 0x5a5e66, W = 0x8a5a32, T = 0xb49a6c, O = 0x6b7f3a, S = 0xc9ccd2;

const defs: WeaponDef[] = [
  {
    id: 'knife', name: 'Shiv', slot: 'knife', price: 0, killReward: 1500,
    damage: 34, pellets: 1, fireInterval: 0.42, auto: true, magSize: 0, reserve: 0, reloadTime: 0,
    armorPen: 0.85, falloff: 1, range: 1.9, speedMul: 1.0,
    spreadStand: 0, spreadMove: 0, spreadAir: 0, recoilUp: 0, recoilSide: 0, recoilMax: 0, zoom: [], penetration: 0,
    model: [[-0.5, -1, 0, 1, 2, 5, D], [-0.8, -1.4, -1, 1.6, 2.8, 1, L], [-0.25, -0.7, -10, 0.5, 2, 9, S], [-0.25, 0, -11, 0.5, 1.1, 1, S]],
    blurb: 'Left: quick slash. Right: heavy stab. Hits from behind deal double.',
  },
  {
    id: 'pistol', name: 'Pip-9', slot: 'secondary', price: 200, killReward: 300,
    damage: 30, pellets: 1, fireInterval: 0.15, auto: false, magSize: 20, reserve: 100, reloadTime: 2.1,
    armorPen: 0.5, falloff: 0.88, range: 120, speedMul: 0.96,
    spreadStand: 0.004, spreadMove: 0.03, spreadAir: 0.09, recoilUp: 0.014, recoilSide: 0.004, recoilMax: 0.08, zoom: [], penetration: 1,
    model: [[-1, 0, -6, 2, 2, 9, G], [-0.9, -5, 0, 1.8, 5, 2.2, D], [-0.6, -2, -2, 1.2, 1, 2, D]],
    blurb: 'Free starter pistol. Accurate first shot, weak into armour.',
  },
  {
    id: 'deagle', name: 'Thumper', slot: 'secondary', price: 700, killReward: 300,
    damage: 55, pellets: 1, fireInterval: 0.36, auto: false, magSize: 7, reserve: 35, reloadTime: 2.2,
    armorPen: 0.93, falloff: 0.94, range: 150, speedMul: 0.95,
    spreadStand: 0.003, spreadMove: 0.07, spreadAir: 0.15, recoilUp: 0.06, recoilSide: 0.01, recoilMax: 0.2, zoom: [], penetration: 2,
    model: [[-1.2, 0, -8, 2.4, 2.6, 11, S], [-1, -6, 0, 2, 6, 2.4, D], [-0.7, 2.6, -7, 1.4, 0.6, 1, D], [-0.6, -2.2, -2.2, 1.2, 1, 2.2, D]],
    blurb: 'Heavy pistol. One headshot kills, even through a helmet.',
  },
  {
    id: 'smg', name: 'Wasp', slot: 'primary', price: 1200, killReward: 600,
    damage: 26, pellets: 1, fireInterval: 0.07, auto: true, magSize: 30, reserve: 120, reloadTime: 2.3,
    armorPen: 0.6, falloff: 0.84, range: 100, speedMul: 0.95,
    spreadStand: 0.008, spreadMove: 0.025, spreadAir: 0.08, recoilUp: 0.011, recoilSide: 0.009, recoilMax: 0.12, zoom: [], penetration: 1,
    model: [[-1.2, 0, -8, 2.4, 2.8, 12, G], [-0.5, 0.8, -12, 1, 1, 4, D], [-0.9, -5, 0, 1.8, 5, 2, D], [-0.8, -6, -6, 1.6, 6, 1.8, D], [-0.8, 0.4, 4, 1.6, 1.6, 5, L]],
    blurb: 'Fast-firing and mobile. Big kill reward ($600).',
  },
  {
    id: 'shotgun', name: 'Mauler', slot: 'primary', price: 1100, killReward: 900,
    damage: 21, pellets: 9, fireInterval: 0.88, auto: false, magSize: 7, reserve: 32, reloadTime: 3.0,
    armorPen: 0.75, falloff: 0.55, range: 40, speedMul: 0.9,
    spreadStand: 0.06, spreadMove: 0.07, spreadAir: 0.1, recoilUp: 0.07, recoilSide: 0.01, recoilMax: 0.1, zoom: [], penetration: 0,
    model: [[-1, 1, -20, 2, 2, 22, G], [-1.1, -0.8, -15, 2.2, 1.8, 6, W], [-1.1, -4.5, 0, 2.2, 4.5, 2, W], [-1, -1.5, 2, 2, 3, 8, W]],
    blurb: 'Devastating up close, useless at range. $900 per kill.',
  },
  {
    id: 'rifle', name: 'Hellcat', slot: 'primary', price: 2700, killReward: 300,
    damage: 36, pellets: 1, fireInterval: 0.1, auto: true, magSize: 30, reserve: 90, reloadTime: 2.4,
    armorPen: 0.775, falloff: 0.98, range: 250, speedMul: 0.86,
    spreadStand: 0.003, spreadMove: 0.09, spreadAir: 0.16, recoilUp: 0.022, recoilSide: 0.012, recoilMax: 0.24, zoom: [], penetration: 2.2,
    model: [[-1, 0, -12, 2, 2.4, 17, W], [-0.5, 0.7, -18, 1, 1, 6, D], [-1.1, -0.4, -4, 2.2, 3, 9, G], [-0.9, -6, -6, 1.8, 6, 2, D], [-0.8, -4.5, 0, 1.6, 4.5, 2, W], [-1, -1.5, 5, 2, 3.4, 8, W]],
    blurb: 'Hard-hitting rifle. A headshot kills in one bullet at any range.',
  },
  {
    id: 'carbine', name: 'Sentinel', slot: 'primary', price: 2900, killReward: 300,
    damage: 32, pellets: 1, fireInterval: 0.09, auto: true, magSize: 30, reserve: 90, reloadTime: 2.2,
    armorPen: 0.7, falloff: 0.97, range: 250, speedMul: 0.88,
    spreadStand: 0.0025, spreadMove: 0.08, spreadAir: 0.15, recoilUp: 0.017, recoilSide: 0.008, recoilMax: 0.19, zoom: [], penetration: 2,
    model: [[-1, 0, -12, 2, 2.4, 17, T], [-0.5, 0.7, -18, 1, 1, 6, D], [-1.2, 2.4, -6, 2.4, 1.2, 8, D], [-0.9, -5.5, -5, 1.8, 5.5, 2, D], [-0.8, -4.5, 0, 1.6, 4.5, 2, D], [-1, -1.4, 5, 2, 3, 8, T]],
    blurb: 'Steadier spray than the Hellcat, slightly less damage.',
  },
  {
    id: 'marksman', name: 'Kestrel', slot: 'primary', price: 1700, killReward: 300,
    damage: 80, pellets: 1, fireInterval: 1.25, auto: false, magSize: 10, reserve: 90, reloadTime: 2.0,
    armorPen: 0.85, falloff: 0.99, range: 300, speedMul: 0.96,
    spreadStand: 0.0015, spreadMove: 0.07, spreadAir: 0.2, recoilUp: 0.04, recoilSide: 0, recoilMax: 0.05, zoom: [0.4], penetration: 2.2,
    model: [[-1, 0, -18, 2, 2, 24, O], [-0.4, 0.6, -23, 0.8, 0.8, 5, D], [-0.9, 2, -8, 1.8, 1.8, 9, D], [-0.8, -4, 0, 1.6, 4, 2, O], [-1, -1.6, 6, 2, 3, 6, O]],
    blurb: 'Light scoped rifle. Stay mobile, headshot to finish.',
  },
  {
    id: 'sniper', name: 'Longbow', slot: 'primary', price: 4750, killReward: 100,
    damage: 115, pellets: 1, fireInterval: 1.45, auto: false, magSize: 5, reserve: 30, reloadTime: 3.4,
    armorPen: 0.97, falloff: 0.99, range: 400, speedMul: 0.8,
    spreadStand: 0.0008, spreadMove: 0.12, spreadAir: 0.3, recoilUp: 0.09, recoilSide: 0, recoilMax: 0.09, zoom: [0.42, 0.14], penetration: 3,
    model: [[-1.2, 0, -20, 2.4, 2.4, 26, 0x2f4a3a], [-0.5, 0.7, -27, 1, 1, 7, D], [-1.2, 2.4, -9, 2.4, 2.4, 11, D], [-1, -4.5, 0, 2, 4.5, 2.2, 0x2f4a3a], [-1.2, -2, 6, 2.4, 4, 7, 0x2f4a3a], [-0.9, -3, -5, 1.8, 3, 2, D]],
    blurb: 'One body shot kills. Painfully slow and heavy.',
  },
  {
    id: 'he', name: 'Frag', slot: 'grenade', price: 300, killReward: 300,
    damage: 98, pellets: 0, fireInterval: 1, auto: false, magSize: 0, reserve: 0, reloadTime: 0,
    armorPen: 0.5, falloff: 1, range: 0, speedMul: 0.98,
    spreadStand: 0, spreadMove: 0, spreadAir: 0, recoilUp: 0, recoilSide: 0, recoilMax: 0, zoom: [], penetration: 0,
    model: [[-1.5, -1.5, -1.5, 3, 3, 3, O], [-0.5, 1.5, -0.5, 1, 1, 1, L]],
    blurb: 'Explodes after 1.6 s. Heavy damage in a small radius.',
  },
  {
    id: 'flash', name: 'Blinder', slot: 'grenade', price: 200, killReward: 300,
    damage: 0, pellets: 0, fireInterval: 1, auto: false, magSize: 0, reserve: 0, reloadTime: 0,
    armorPen: 1, falloff: 1, range: 0, speedMul: 0.98,
    spreadStand: 0, spreadMove: 0, spreadAir: 0, recoilUp: 0, recoilSide: 0, recoilMax: 0, zoom: [], penetration: 0,
    model: [[-1.2, -2, -1.2, 2.4, 4, 2.4, S], [-0.5, 2, -0.5, 1, 1, 1, L]],
    blurb: 'Blinds everyone looking at it. Turn away!',
  },
  {
    id: 'smoke', name: 'Fog', slot: 'grenade', price: 300, killReward: 300,
    damage: 0, pellets: 0, fireInterval: 1, auto: false, magSize: 0, reserve: 0, reloadTime: 0,
    armorPen: 1, falloff: 1, range: 0, speedMul: 0.98,
    spreadStand: 0, spreadMove: 0, spreadAir: 0, recoilUp: 0, recoilSide: 0, recoilMax: 0, zoom: [], penetration: 0,
    model: [[-1.2, -2, -1.2, 2.4, 4, 2.4, 0x7d8a90], [-0.5, 2, -0.5, 1, 1, 1, L]],
    blurb: 'A wall of smoke for 15 s. Blocks vision.',
  },
];

export const WEAPONS = Object.fromEntries(defs.map((d) => [d.id, d])) as Record<WeaponId, WeaponDef>;
export const WEAPON_LIST: readonly WeaponDef[] = defs;
export const GRENADES: GrenadeId[] = ['he', 'flash', 'smoke'];
export const GRENADE_LIMIT: Record<GrenadeId, number> = { he: 1, flash: 2, smoke: 1 };

export const ARMOR = {
  kevlar: { price: 650, name: 'Kevlar' },
  helmet: { price: 1000, name: 'Kevlar + Helmet' },
};

/** Hit-zone damage multipliers. */
export const ZONE_MUL = { head: 4, body: 1, legs: 0.75 } as const;
export type Zone = keyof typeof ZONE_MUL;

export const ECONOMY = {
  startMoney: 800,
  maxMoney: 16000,
  winReward: 3250,
  lossBase: 1400,
  lossStep: 500,
  lossMax: 3400,
  halftimeMoney: 800,
};
