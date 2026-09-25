import { B } from '../engine/blocks';
import { VoxelWorld } from '../engine/world';
import type { V3 } from '../net/protocol';

/** Helpers for describing maps as a list of simple building operations. */
export class Builder {
  constructor(readonly w: VoxelWorld) {}

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number): this {
    this.w.fill(x0, y0, z0, x1, y1, z1, id);
    return this;
  }

  clear(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): this {
    return this.box(x0, y0, z0, x1, y1, z1, 0);
  }

  set(x: number, y: number, z: number, id: number): this {
    this.w.set(x, y, z, id);
    return this;
  }

  /** Four walls (no floor or roof) of an axis-aligned box. */
  walls(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number): this {
    this.box(x0, y0, z0, x1, y1, z0, id);
    this.box(x0, y0, z1, x1, y1, z1, id);
    this.box(x0, y0, z0, x0, y1, z1, id);
    this.box(x1, y0, z0, x1, y1, z1, id);
    return this;
  }

  /** Ring of blocks around the top edge of a roof (parapet). */
  parapet(x0: number, y: number, z0: number, x1: number, z1: number, id: number): this {
    return this.walls(x0, y, z0, x1, y, z1, id);
  }

  /**
   * Walkable stairs from half-blocks: each step rises 0.5, so players walk
   * up without jumping. Runs `steps` cells from (x, z) in direction (dx, dz),
   * `width` cells wide sideways, starting at floor level y0.
   */
  stairs(x: number, z: number, dx: number, dz: number, y0: number, steps: number, width: number, full: number, slab: number): this {
    for (let i = 0; i < steps; i++) {
      const h = (i + 1) * 0.5;
      const fullCount = Math.floor(h);
      for (let k = 0; k < width; k++) {
        const cx = x + dx * i + (dz !== 0 ? k : 0);
        const cz = z + dz * i + (dx !== 0 ? k : 0);
        for (let y = 0; y < fullCount; y++) this.w.set(cx, y0 + y, cz, full);
        if (h % 1 !== 0) this.w.set(cx, y0 + fullCount, cz, slab);
      }
    }
    return this;
  }

  crate(x: number, y: number, z: number, h = 1, w = 1, d = 1): this {
    return this.box(x, y, z, x + w - 1, y + h - 1, z + d - 1, B.crate);
  }

  palm(x: number, y: number, z: number, h = 6): this {
    this.box(x, y, z, x, y + h - 1, z, B.log);
    const t = y + h;
    this.box(x - 1, t, z - 1, x + 1, t, z + 1, B.leaves);
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
      this.set(x + dx, t, z + dz, B.leaves);
      this.set(x + dx * 1.5, t - 1, z + dz * 1.5, B.leaves);
    }
    this.set(x, t + 1, z, B.leaves);
    return this;
  }

  spruce(x: number, y: number, z: number, h = 7): this {
    this.box(x, y, z, x, y + h - 1, z, B.spruceLog);
    // Stacked shrinking squares of leaves with a snow cap.
    let r = 2;
    for (let yy = y + 2; yy < y + h; yy++) {
      const rr = Math.max(0, r - Math.floor((yy - y - 2) / 2));
      if (rr > 0) {
        this.box(x - rr, yy, z - rr, x + rr, yy, z + rr, B.leaves);
        this.set(x, yy, z, B.spruceLog);
      }
    }
    this.set(x, y + h, z, B.leaves);
    this.set(x, y + h + 1, z, B.snow);
    void r; r = 0;
    return this;
  }

  /** Market stall: counter, corner posts and a wool awning. */
  stall(x: number, y: number, z: number, w: number, d: number, awning: number): this {
    this.box(x, y, z + d - 1, x + w - 1, y, z + d - 1, B.planks);
    for (const [px, pz] of [[x, z], [x + w - 1, z], [x, z + d - 1], [x + w - 1, z + d - 1]]) this.box(px, y, pz, px, y + 2, pz, B.log);
    this.box(x, y + 3, z, x + w - 1, y + 3, z + d - 1, awning);
    return this;
  }

  /**
   * Copy the west half (x < width/2) onto the east half mirrored, so both
   * teams get the same layout. Team-coloured wool swaps colour on the copy.
   */
  mirrorX(): this {
    const { sx, sy, sz } = this.w;
    const half = Math.floor(sx / 2);
    for (let y = 0; y < sy; y++)
      for (let z = 0; z < sz; z++)
        for (let x = 0; x < half; x++) {
          let id = this.w.get(x, y, z);
          if (id === B.woolRed) id = B.woolBlue;
          this.w.set(sx - 1 - x, y, z, id);
        }
    return this;
  }
}

export function newWorld(sx: number, sy: number, sz: number): { w: VoxelWorld; b: Builder } {
  const w = new VoxelWorld(sx, sy, sz);
  return { w, b: new Builder(w) };
}

/** Mirror points of interest across the map's centre line. */
export function mirrorPoints(points: V3[], sx: number): V3[] {
  return [...points, ...points.map(([x, y, z]) => [sx - x, y, z] as V3)];
}
