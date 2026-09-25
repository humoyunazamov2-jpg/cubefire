import { BLOCKS } from '../engine/blocks';
import { rayBox, type VoxelWorld } from '../engine/world';
import type { V3 } from '../net/protocol';
import { WEAPONS, ZONE_MUL, type WeaponDef, type WeaponId, type Zone } from './weapons';

/** What we need to know about a player to test bullets against them. */
export interface Target {
  id: number;
  x: number; y: number; z: number;
  yaw: number;
  crouch: number;
}

// Hitboxes in model space (model faces -Z), standing and fully crouched.
const BOXES: { zone: Zone; s: number[]; c: number[] }[] = [
  //            x0     y0    z0     x1    y1    z1
  { zone: 'head', s: [-0.25, 1.30, -0.25, 0.25, 1.80, 0.25], c: [-0.25, 1.02, -0.36, 0.25, 1.52, 0.14] },
  { zone: 'body', s: [-0.34, 0.66, -0.2, 0.34, 1.32, 0.2], c: [-0.34, 0.38, -0.28, 0.34, 1.06, 0.16] },
  { zone: 'legs', s: [-0.25, 0.0, -0.15, 0.25, 0.66, 0.15], c: [-0.25, 0.0, -0.36, 0.25, 0.4, 0.36] },
];

/** Nearest hitbox the ray crosses, or null. Ray direction must be normalised. */
export function rayTarget(
  t: Target, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
): { zone: Zone; dist: number } | null {
  // Transform the ray into the target's local frame.
  const cos = Math.cos(t.yaw), sin = Math.sin(t.yaw);
  const rx = ox - t.x, ry = oy - t.y, rz = oz - t.z;
  const lox = rx * cos - rz * sin, loz = rx * sin + rz * cos;
  const ldx = dx * cos - dz * sin, ldz = dx * sin + dz * cos;
  let best: { zone: Zone; dist: number } | null = null;
  for (const b of BOXES) {
    const k = t.crouch;
    const lerp = (i: number) => b.s[i] + (b.c[i] - b.s[i]) * k;
    const hit = rayBox(lox, ry, loz, ldx, dy, ldz, lerp(0), lerp(1), lerp(2), lerp(3), lerp(4), lerp(5));
    if (hit && hit.tIn >= 0 && (!best || hit.tIn < best.dist)) best = { zone: b.zone, dist: hit.tIn };
  }
  return best;
}

export interface TraceResult {
  end: V3;
  /** Block surface the bullet stopped at (for impact particles and decals). */
  impact: { p: V3; n: V3; id: number } | null;
  /** First wall the bullet punched through, if any. */
  entry: { p: V3; n: V3; id: number } | null;
  hit: { id: number; zone: Zone; dist: number; pen: number } | null;
}

/**
 * Fire one bullet. Walks the voxel grid, losing power in penetrable blocks
 * (planks, glass, leaves...) and stopping at solid ones, then finds the
 * nearest player hitbox in front of wherever it stopped.
 */
export function traceBullet(
  world: VoxelWorld, w: WeaponDef,
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  targets: Target[], skipId: number,
): TraceResult {
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  dx /= len; dy /= len; dz /= len;
  let power = w.penetration;
  let stop = w.range;
  let impact: TraceResult['impact'] = null;
  let entry: TraceResult['entry'] = null;
  // Damage multiplier after each penetrated block: [distance where it applies, multiplier].
  const layers: [number, number][] = [];
  let mul = 1;

  world.traverse(ox, oy, oz, dx, dy, dz, w.range, (id, _x, _y, _z, tIn, tOut, nx, ny, nz) => {
    const def = BLOCKS[id];
    if (!def.solid) return false;
    const p: V3 = [ox + dx * tIn, oy + dy * tIn, oz + dz * tIn];
    const cost = (tOut - tIn) * def.penetration * 4;
    if (def.invisible || def.penetration >= 1 || cost > power) {
      stop = tIn;
      if (!def.invisible) impact = { p, n: [nx, ny, nz], id };
      return true;
    }
    power -= cost;
    mul *= 1 - def.penetration;
    layers.push([tIn, mul]);
    if (!entry) entry = { p, n: [nx, ny, nz], id };
    return false;
  });

  let hit: TraceResult['hit'] = null;
  for (const t of targets) {
    if (t.id === skipId) continue;
    const r = rayTarget(t, ox, oy, oz, dx, dy, dz);
    if (!r || r.dist > stop || (hit && r.dist >= hit.dist)) continue;
    let pen = 1;
    for (const [d, m] of layers) if (d < r.dist) pen = m;
    hit = { id: t.id, zone: r.zone, dist: r.dist, pen };
  }
  const endDist = hit ? hit.dist : stop;
  if (hit) impact = null;
  return { end: [ox + dx * endDist, oy + dy * endDist, oz + dz * endDist], impact, entry, hit };
}

/** Health and armour damage for one bullet or stab. */
export function computeDamage(
  weapon: WeaponId, zone: Zone, dist: number, pen: number, armor: number, helmet: boolean,
  stab?: 1 | 2, back?: boolean,
): { hp: number; armor: number } {
  const w = WEAPONS[weapon];
  let dmg: number;
  if (w.slot === 'knife') {
    dmg = stab === 2 ? (back ? 180 : 65) : back ? 90 : w.damage;
  } else {
    dmg = w.damage * ZONE_MUL[zone] * Math.pow(w.falloff, dist / 10) * pen;
  }
  let armorLoss = 0;
  const covered = armor > 0 && zone !== 'legs' && (zone !== 'head' || helmet);
  if (covered) {
    const toHealth = dmg * w.armorPen;
    armorLoss = Math.min(armor, (dmg - toHealth) * 0.5);
    dmg = toHealth;
  }
  return { hp: Math.max(1, Math.round(dmg)), armor: Math.round(armorLoss) };
}

/** Rotate `dir` by a random offset inside a cone of the given half-angle (radians). */
export function applySpread(dir: V3, spread: number, rand: () => number): V3 {
  if (spread <= 0) return dir;
  const [dx, dy, dz] = dir;
  // Build a basis perpendicular to the direction.
  let ux = -dz, uy = 0, uz = dx;
  let ul = Math.sqrt(ux * ux + uz * uz);
  if (ul < 1e-6) { ux = 1; uz = 0; ul = 1; }
  ux /= ul; uz /= ul;
  const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
  // Uniform point in a disc, biased slightly to the centre like CS spread.
  const a = rand() * Math.PI * 2;
  const r = Math.pow(rand(), 0.8) * spread;
  const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
  const nx = dx + ux * ox + vx * oy, ny = dy + uy * ox + vy * oy, nz = dz + uz * ox + vz * oy;
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return [nx / l, ny / l, nz / l];
}
