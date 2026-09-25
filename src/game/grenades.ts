import { BLOCKS } from '../engine/blocks';
import type { VoxelWorld } from '../engine/world';
import type { V3 } from '../net/protocol';
import type { GrenadeId } from './weapons';

// Grenade flight is simulated identically on every machine from the throw
// position and velocity, using a fixed step and plain arithmetic, so the
// bounces match. The host still announces where each one goes off.

export const NADE_STEP = 1 / 60;
const GRAVITY = 20;
const BOUNCE = 0.42;
const FRICTION = 0.7;
const RADIUS = 0.08;

export const FUSE: Record<GrenadeId, number> = { he: 1.6, flash: 1.5, smoke: 3.0 };
export const SMOKE_DURATION = 15;
export const SMOKE_RADIUS = 3.4;
export const HE_RADIUS = 7;

export interface Nade {
  id: number;
  type: GrenadeId;
  owner: number;
  p: V3;
  v: V3;
  age: number;
  resting: boolean;
  /** Seconds spent almost still; smokes pop once they settle. */
  still: number;
  bounced: boolean;
}

export function throwVelocity(dir: V3, strength: number, carrier: V3): V3 {
  return [dir[0] * strength + carrier[0] * 0.8, dir[1] * strength + 2.2 + carrier[1] * 0.3, dir[2] * strength + carrier[2] * 0.8];
}

const solid = (id: number) => BLOCKS[id].solid;

/** Advance one fixed step. Sets n.bounced when it hit something this step. */
export function stepNade(world: VoxelWorld, n: Nade): void {
  n.bounced = false;
  n.age += NADE_STEP;
  if (n.resting) { n.still += NADE_STEP; return; }
  n.v[1] -= GRAVITY * NADE_STEP;
  let remaining = NADE_STEP;
  for (let iter = 0; iter < 3 && remaining > 1e-6; iter++) {
    const [vx, vy, vz] = n.v;
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (speed < 1e-6) break;
    const dist = speed * remaining;
    const hit = world.raycast(n.p[0], n.p[1], n.p[2], vx, vy, vz, dist + RADIUS, solid);
    if (!hit || hit.dist > dist + RADIUS) {
      n.p[0] += vx * remaining; n.p[1] += vy * remaining; n.p[2] += vz * remaining;
      break;
    }
    // Move up to the surface, then reflect off it.
    const travel = Math.max(0, hit.dist - RADIUS);
    n.p[0] += (vx / speed) * travel; n.p[1] += (vy / speed) * travel; n.p[2] += (vz / speed) * travel;
    remaining -= travel / speed;
    const dot = vx * hit.nx + vy * hit.ny + vz * hit.nz;
    let rx = vx - (1 + BOUNCE) * dot * hit.nx;
    let ry = vy - (1 + BOUNCE) * dot * hit.ny;
    let rz = vz - (1 + BOUNCE) * dot * hit.nz;
    // Friction on the tangential part.
    const tx = rx - hit.nx * (rx * hit.nx + ry * hit.ny + rz * hit.nz);
    const ty = ry - hit.ny * (rx * hit.nx + ry * hit.ny + rz * hit.nz);
    const tz = rz - hit.nz * (rx * hit.nx + ry * hit.ny + rz * hit.nz);
    rx -= tx * (1 - FRICTION); ry -= ty * (1 - FRICTION); rz -= tz * (1 - FRICTION);
    n.v = [rx, ry, rz];
    n.bounced = Math.abs(dot) > 1.2;
    if (hit.ny > 0.7 && Math.sqrt(rx * rx + ry * ry + rz * rz) < 1.0) {
      n.resting = true;
      n.v = [0, 0, 0];
      break;
    }
  }
  const s = n.v[0] * n.v[0] + n.v[1] * n.v[1] + n.v[2] * n.v[2];
  n.still = s < 0.25 ? n.still + NADE_STEP : 0;
}

/** Should the grenade go off now? */
export function nadeReady(n: Nade): boolean {
  if (n.type === 'smoke') return (n.resting && n.still > 0.25) || n.age >= FUSE.smoke;
  return n.age >= FUSE[n.type];
}

/**
 * How blinded a viewer is by a flash at `p`: 0..1 plus duration in seconds.
 * Facing it head-on is worst; facing away is only a short fade.
 */
export function flashAmount(world: VoxelWorld, p: V3, eye: V3, look: V3): { amount: number; duration: number } {
  const dx = p[0] - eye[0], dy = p[1] - eye[1], dz = p[2] - eye[2];
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist > 28 || !world.lineOfSight(eye[0], eye[1], eye[2], p[0], p[1] + 0.1, p[2])) return { amount: 0, duration: 0 };
  const facing = (dx * look[0] + dy * look[1] + dz * look[2]) / (dist || 1);
  const range = Math.max(0, 1 - dist / 28);
  let amount: number;
  if (facing > 0.5) amount = 1;
  else if (facing > 0) amount = 0.6 + facing * 0.8;
  else amount = 0.35 + facing * 0.25;
  amount = Math.max(0, Math.min(1, amount));
  const duration = (0.4 + 4.2 * amount) * (0.35 + 0.65 * range);
  return { amount: amount * Math.min(1, 0.4 + range), duration };
}

/** HE damage to a point, reduced by distance and cover. */
export function heDamage(world: VoxelWorld, p: V3, target: V3): number {
  const dx = target[0] - p[0], dy = target[1] - p[1], dz = target[2] - p[2];
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist > HE_RADIUS) return 0;
  // Check line of sight to feet, chest and head; each visible part lets damage through.
  let open = 0;
  for (const off of [0.2, 1.0, 1.6]) {
    if (world.lineOfSight(p[0], p[1] + 0.2, p[2], target[0], target[1] - 1.0 + off, target[2])) open++;
  }
  if (!open) return 0;
  const falloff = Math.pow(1 - dist / HE_RADIUS, 1.3);
  return 98 * falloff * (0.45 + 0.55 * open / 3);
}
