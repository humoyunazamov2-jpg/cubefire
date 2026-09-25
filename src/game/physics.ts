import { blockHeight } from '../engine/blocks';
import type { VoxelWorld } from '../engine/world';

// Movement tuned to feel like a CS-style shooter scaled to 1 block = 1 metre.
export const PHYS = {
  gravity: 24,
  jumpSpeed: 7.9,          // peaks ~1.27 blocks: hops onto a crate with room to spare
  runSpeed: 5.2,
  walkMul: 0.52,
  crouchMul: 0.36,
  groundAccel: 9,
  airAccel: 2.2,
  airWishCap: 1.5,         // enough air control to hop onto a box, too little for bunny-hop gains
  friction: 6,
  stopSpeed: 1.6,
  stepHeight: 0.55,        // walk up slabs without jumping
  halfWidth: 0.3,
  standHeight: 1.8,
  crouchHeight: 1.35,
  standEye: 1.62,
  crouchEye: 1.2,
  crouchSpeed: 8,          // how fast the crouch transition blends (per second)
  maxFall: 40,
};

export interface MoveInput {
  forward: number;   // -1..1
  right: number;     // -1..1
  jump: boolean;
  crouch: boolean;
  walk: boolean;
  yaw: number;
}

export interface Body {
  x: number; y: number; z: number;   // feet position
  vx: number; vy: number; vz: number;
  onGround: boolean;
  crouched: boolean;
  /** 0 = standing, 1 = fully crouched; drives eye height and hitboxes. */
  crouchT: number;
  /** Seconds since the body last touched ground (for coyote-time jumps). */
  airTime: number;
  /** Set on the tick a jump starts, and the landing speed on the tick it lands. */
  jumped: boolean;
  landed: number;
}

export function newBody(x = 0, y = 0, z = 0): Body {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: false, crouched: false, crouchT: 0, airTime: 0, jumped: false, landed: 0 };
}

export const bodyHeight = (b: Body) => PHYS.standHeight + (PHYS.crouchHeight - PHYS.standHeight) * b.crouchT;
export const eyeHeight = (b: Body) => PHYS.standEye + (PHYS.crouchEye - PHYS.standEye) * b.crouchT;

const EPS = 1e-4;

/** Does the box [x-hw, x+hw] x [y, y+h] x [z-hw, z+hw] overlap any solid block? */
export function boxBlocked(world: VoxelWorld, x: number, y: number, z: number, hw: number, h: number): boolean {
  const x0 = Math.floor(x - hw + EPS), x1 = Math.floor(x + hw - EPS);
  const y0 = Math.floor(y + EPS), y1 = Math.floor(y + h - EPS);
  const z0 = Math.floor(z - hw + EPS), z1 = Math.floor(z + hw - EPS);
  for (let by = y0; by <= y1; by++)
    for (let bz = z0; bz <= z1; bz++)
      for (let bx = x0; bx <= x1; bx++) {
        const bh = blockHeight(world.get(bx, by, bz));
        if (bh > 0 && y + EPS < by + bh) return true;
      }
  return false;
}

/**
 * Move the box along one axis by d, stopping at the first solid block face.
 * Returns the distance actually moved.
 */
function sweep(world: VoxelWorld, b: Body, hw: number, h: number, axis: 0 | 1 | 2, d: number): number {
  if (d === 0) return 0;
  const min = [b.x - hw, b.y, b.z - hw];
  const max = [b.x + hw, b.y + h, b.z + hw];
  // Cells covered by the box swept along the axis.
  const lo = [min[0], min[1], min[2]], hi = [max[0], max[1], max[2]];
  if (d > 0) hi[axis] += d; else lo[axis] += d;
  let limit = d;
  const cx0 = Math.floor(lo[0] + EPS), cx1 = Math.floor(hi[0] - EPS);
  const cy0 = Math.floor(lo[1] + EPS) - 1, cy1 = Math.floor(hi[1] - EPS);
  const cz0 = Math.floor(lo[2] + EPS), cz1 = Math.floor(hi[2] - EPS);
  for (let y = cy0; y <= cy1; y++)
    for (let z = cz0; z <= cz1; z++)
      for (let x = cx0; x <= cx1; x++) {
        const bh = blockHeight(world.get(x, y, z));
        if (bh === 0) continue;
        const bmin = [x, y, z], bmax = [x + 1, y + bh, z + 1];
        // Must overlap on the other two axes.
        let overlap = true;
        for (let a = 0; a < 3; a++) {
          if (a === axis) continue;
          if (bmax[a] <= min[a] + EPS || bmin[a] >= max[a] - EPS) { overlap = false; break; }
        }
        if (!overlap) continue;
        if (d > 0 && bmin[axis] >= max[axis] - EPS) limit = Math.min(limit, bmin[axis] - max[axis]);
        else if (d < 0 && bmax[axis] <= min[axis] + EPS) limit = Math.max(limit, bmax[axis] - min[axis]);
      }
  if (axis === 0) b.x += limit; else if (axis === 1) b.y += limit; else b.z += limit;
  return limit;
}

/** Horizontal move with automatic step-up onto slabs and half-height ledges. */
function moveHorizontal(world: VoxelWorld, b: Body, hw: number, h: number, dx: number, dz: number, canStep: boolean) {
  const sx = b.x, sy = b.y, sz = b.z;
  const mx = sweep(world, b, hw, h, 0, dx);
  const mz = sweep(world, b, hw, h, 2, dz);
  const blocked = Math.abs(mx - dx) > 1e-6 || Math.abs(mz - dz) > 1e-6;
  if (!blocked || !canStep) return;

  const flatX = b.x, flatY = b.y, flatZ = b.z;
  b.x = sx; b.y = sy; b.z = sz;
  const up = sweep(world, b, hw, h, 1, PHYS.stepHeight);
  sweep(world, b, hw, h, 0, dx);
  sweep(world, b, hw, h, 2, dz);
  sweep(world, b, hw, h, 1, -up);
  const flatDist = (flatX - sx) ** 2 + (flatZ - sz) ** 2;
  const stepDist = (b.x - sx) ** 2 + (b.z - sz) ** 2;
  if (stepDist <= flatDist + 1e-6 || b.y - sy > PHYS.stepHeight + 1e-3) {
    b.x = flatX; b.y = flatY; b.z = flatZ;
  }
}

/** Advance one body by dt with Source-style acceleration and friction. */
export function stepMove(world: VoxelWorld, b: Body, input: MoveInput, dt: number, speedMul = 1): void {
  b.jumped = false;
  b.landed = 0;

  // Crouch: stand up only when there is headroom.
  if (input.crouch) b.crouched = true;
  else if (b.crouched && !boxBlocked(world, b.x, b.y, b.z, PHYS.halfWidth, PHYS.standHeight)) b.crouched = false;
  const target = b.crouched ? 1 : 0;
  const prevH = bodyHeight(b);
  b.crouchT += Math.sign(target - b.crouchT) * Math.min(Math.abs(target - b.crouchT), PHYS.crouchSpeed * dt);
  // Crouching in the air pulls the legs up instead of lowering the head.
  if (!b.onGround && bodyHeight(b) < prevH) {
    const lift = prevH - bodyHeight(b);
    if (!boxBlocked(world, b.x, b.y + lift, b.z, PHYS.halfWidth, bodyHeight(b))) b.y += lift;
  }

  // Wish direction from yaw (forward is -Z at yaw 0).
  const sin = Math.sin(input.yaw), cos = Math.cos(input.yaw);
  let wx = -sin * input.forward + cos * input.right;
  let wz = -cos * input.forward - sin * input.right;
  const wl = Math.hypot(wx, wz);
  if (wl > 1) { wx /= wl; wz /= wl; }
  let wishSpeed = PHYS.runSpeed * speedMul * Math.min(1, wl);
  if (b.crouched || b.crouchT > 0.5) wishSpeed *= PHYS.crouchMul;
  else if (input.walk) wishSpeed *= PHYS.walkMul;
  const wn = Math.hypot(wx, wz) || 1;
  const dirX = wx / wn, dirZ = wz / wn;

  if (b.onGround) {
    const speed = Math.hypot(b.vx, b.vz);
    if (speed > 0) {
      const drop = Math.max(speed, PHYS.stopSpeed) * PHYS.friction * dt;
      const k = Math.max(0, speed - drop) / speed;
      b.vx *= k; b.vz *= k;
    }
    accelerate(b, dirX, dirZ, wishSpeed, PHYS.groundAccel, dt);
    if (input.jump) {
      b.vy = PHYS.jumpSpeed;
      b.onGround = false;
      b.jumped = true;
    }
  } else {
    accelerate(b, dirX, dirZ, Math.min(wishSpeed, PHYS.airWishCap), PHYS.airAccel * 10, dt);
  }

  b.vy = Math.max(-PHYS.maxFall, b.vy - PHYS.gravity * dt);

  const hw = PHYS.halfWidth, h = bodyHeight(b);
  const sx = b.x, sz = b.z, wantX = b.vx * dt, wantZ = b.vz * dt;
  moveHorizontal(world, b, hw, h, wantX, wantZ, b.onGround);
  // Kill velocity into walls so we slide along them instead of pushing forever.
  if (Math.abs(b.x - sx - wantX) > 1e-5) b.vx = 0;
  if (Math.abs(b.z - sz - wantZ) > 1e-5) b.vz = 0;

  const wantY = b.vy * dt;
  const movedY = sweep(world, b, hw, h, 1, wantY);
  const wasGround = b.onGround;
  if (Math.abs(movedY - wantY) > 1e-6) {
    if (wantY < 0) {
      if (!wasGround) b.landed = -b.vy;
      b.onGround = true;
    }
    b.vy = 0;
  } else {
    b.onGround = false;
  }

  // Stick to the ground when walking down slabs so we don't bounce off every step.
  if (wasGround && !b.onGround && !b.jumped && b.vy <= 0) {
    const down = sweep(world, b, hw, h, 1, -PHYS.stepHeight);
    if (down > -PHYS.stepHeight + 1e-6) { b.onGround = true; b.vy = 0; }
    else b.y -= down; // nothing below within a step: undo and fall normally
  }

  b.airTime = b.onGround ? 0 : b.airTime + dt;
}

function accelerate(b: Body, dx: number, dz: number, wishSpeed: number, accel: number, dt: number) {
  const current = b.vx * dx + b.vz * dz;
  const add = wishSpeed - current;
  if (add <= 0) return;
  const gain = Math.min(add, accel * wishSpeed * dt);
  b.vx += gain * dx;
  b.vz += gain * dz;
}

/** Find a free standing spot at or just above (x, y, z). */
export function settle(world: VoxelWorld, b: Body): void {
  for (let i = 0; i < 40 && boxBlocked(world, b.x, b.y, b.z, PHYS.halfWidth, PHYS.standHeight); i++) b.y += 0.25;
  const h = world.groundHeight(b.x, b.z, b.y + 0.01);
  if (h <= b.y && b.y - h < 3) b.y = h;
  b.onGround = true;
}
