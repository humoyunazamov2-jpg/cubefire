import { AIR, B, BLOCKS, blockHeight } from './blocks';

export interface RayHit {
  id: number;
  /** Block cell that was hit. */
  x: number; y: number; z: number;
  dist: number;
  /** World-space hit point. */
  px: number; py: number; pz: number;
  /** Face normal of the hit surface. */
  nx: number; ny: number; nz: number;
}

export type BlockFilter = (id: number) => boolean;

/** Visited once per solid block the ray passes through, with entry/exit distances. */
export type TraverseFn = (
  id: number, x: number, y: number, z: number,
  tIn: number, tOut: number, nx: number, ny: number, nz: number,
) => boolean | void;

/**
 * Dense voxel grid. Outside the grid: below y=0 is bedrock, beyond the x/z
 * edges is an invisible barrier, and above the top is air.
 */
export class VoxelWorld {
  readonly data: Uint8Array;

  constructor(readonly sx: number, readonly sy: number, readonly sz: number) {
    this.data = new Uint8Array(sx * sy * sz);
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  get(x: number, y: number, z: number): number {
    if (y < 0) return B.bedrock;
    if (y >= this.sy) return AIR;
    if (x < 0 || z < 0 || x >= this.sx || z >= this.sz) return B.barrier;
    return this.data[(y * this.sz + z) * this.sx + x];
  }

  set(x: number, y: number, z: number, id: number): void {
    if (!this.inBounds(x, y, z)) return;
    this.data[(y * this.sz + z) * this.sx + x] = id;
  }

  /** Fill an inclusive box; corners may be given in any order. */
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number): void {
    const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0];
    const [ay, by] = y0 < y1 ? [y0, y1] : [y1, y0];
    const [az, bz] = z0 < z1 ? [z0, z1] : [z1, z0];
    for (let y = ay; y <= by; y++)
      for (let z = az; z <= bz; z++)
        for (let x = ax; x <= bx; x++) this.set(x, y, z, id);
  }

  /** Is the point inside a solid block's collision box? */
  solidAt(px: number, py: number, pz: number): boolean {
    const x = Math.floor(px), y = Math.floor(py), z = Math.floor(pz);
    const h = blockHeight(this.get(x, y, z));
    return h > 0 && py - y < h;
  }

  /** Highest walkable surface at or below `fromY` in the column containing (px, pz). */
  groundHeight(px: number, pz: number, fromY = this.sy): number {
    const x = Math.floor(px), z = Math.floor(pz);
    for (let y = Math.min(Math.floor(fromY), this.sy - 1); y >= 0; y--) {
      const h = blockHeight(this.get(x, y, z));
      if (h > 0) return y + h;
    }
    return 0;
  }

  /**
   * Walk a ray through the grid (Amanatides & Woo), calling `visit` for every
   * non-air block whose collision box the ray actually crosses. Stops when
   * `visit` returns true or the ray passes maxDist.
   */
  traverse(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    maxDist: number, visit: TraverseFn,
  ): void {
    // Plain sqrt (not Math.hypot) keeps results bit-identical across browsers.
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= len; dy /= len; dz /= len;
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tDeltaX = stepX ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = stepY ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = stepZ ? Math.abs(1 / dz) : Infinity;
    let tMaxX = stepX ? (stepX > 0 ? x + 1 - ox : ox - x) * tDeltaX : Infinity;
    let tMaxY = stepY ? (stepY > 0 ? y + 1 - oy : oy - y) * tDeltaY : Infinity;
    let tMaxZ = stepZ ? (stepZ > 0 ? z + 1 - oz : oz - z) * tDeltaZ : Infinity;

    for (let guard = 0; guard < 4096; guard++) {
      const id = this.get(x, y, z);
      if (id !== AIR) {
        const h = blockHeight(id) || 1;
        const hit = rayBox(ox, oy, oz, dx, dy, dz, x, y, z, x + 1, y + h, z + 1);
        if (hit && hit.tIn <= maxDist && visit(id, x, y, z, Math.max(0, hit.tIn), hit.tOut, hit.nx, hit.ny, hit.nz)) return;
      }
      // Leaving the world through the top or going far out of the side stops the walk.
      if (y >= this.sy && stepY >= 0) return;
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        if (tMaxX > maxDist) return;
        x += stepX; tMaxX += tDeltaX;
      } else if (tMaxY < tMaxZ) {
        if (tMaxY > maxDist) return;
        y += stepY; tMaxY += tDeltaY;
      } else {
        if (tMaxZ > maxDist) return;
        z += stepZ; tMaxZ += tDeltaZ;
      }
    }
  }

  /** First block hit that passes `accept` (default: any solid, including barriers). */
  raycast(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    maxDist: number, accept: BlockFilter = (id) => BLOCKS[id].solid,
  ): RayHit | null {
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    let result: RayHit | null = null;
    this.traverse(ox, oy, oz, ux, uy, uz, maxDist, (id, x, y, z, tIn, _tOut, nx, ny, nz) => {
      if (!accept(id)) return false;
      result = {
        id, x, y, z, dist: tIn,
        px: ox + ux * tIn, py: oy + uy * tIn, pz: oz + uz * tIn,
        nx, ny, nz,
      };
      return true;
    });
    return result;
  }

  /** Clear line of sight between two points (glass and leaves are see-through). */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-4) return true;
    return !this.raycast(ax, ay, az, dx, dy, dz, dist, (id) => {
      const d = BLOCKS[id];
      return d.solid && !d.transparent && !d.invisible;
    });
  }
}

/** Slab-method ray/AABB test. Returns entry/exit distance and the entry face normal. */
export function rayBox(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
): { tIn: number; tOut: number; nx: number; ny: number; nz: number } | null {
  let tIn = -Infinity, tOut = Infinity;
  let nx = 0, ny = 0, nz = 0;
  const axes: [number, number, number, number][] = [[ox, dx, x0, x1], [oy, dy, y0, y1], [oz, dz, z0, z1]];
  for (let a = 0; a < 3; a++) {
    const [o, d, lo, hi] = axes[a];
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t0 = (lo - o) / d, t1 = (hi - o) / d;
    let sign = -1;
    if (t0 > t1) { const t = t0; t0 = t1; t1 = t; sign = 1; }
    if (t0 > tIn) {
      tIn = t0;
      nx = a === 0 ? sign : 0; ny = a === 1 ? sign : 0; nz = a === 2 ? sign : 0;
    }
    if (t1 < tOut) tOut = t1;
    if (tIn > tOut || tOut < 0) return null;
  }
  return { tIn, tOut, nx, ny, nz };
}
