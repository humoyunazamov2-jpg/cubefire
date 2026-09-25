import { blockHeight } from '../engine/blocks';
import type { VoxelWorld } from '../engine/world';
import { boxBlocked, PHYS } from '../game/physics';
import type { BuiltMap } from '../maps/types';
import type { V3 } from '../net/protocol';

// Navigation for bots: every place a player can stand becomes a node (one
// per block column and floor height), linked to its 8 neighbours when you
// can walk, step up a slab, jump onto a block or drop down. Paths come from
// A* over that graph.

export const EDGE_WALK = 0, EDGE_JUMP = 1, EDGE_DROP = 2;

export interface NavNode {
  x: number;
  z: number;
  /** Floor height (top of the block you stand on). */
  h: number;
}

interface Edge { to: number; cost: number; kind: number }

const MAX_JUMP = 1.05;
const MAX_DROP = 6;
const HEADROOM = PHYS.standHeight;
const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

const cache = new WeakMap<VoxelWorld, NavGrid>();

export class NavGrid {
  readonly nodes: NavNode[] = [];
  readonly edges: Edge[][] = [];
  /** Nodes per column, lowest first, indexed by x * sz + z. */
  private cols: number[][];
  /** Reachable from a spawn: only these are used as destinations. */
  reach: Uint8Array = new Uint8Array(0);
  /** Extra cost for standing next to a wall, so paths keep off corners. */
  private edgeCost: Float32Array = new Float32Array(0);

  /** Build once per map and reuse. */
  static for(map: BuiltMap): NavGrid {
    let g = cache.get(map.world);
    if (!g) {
      g = new NavGrid(map.world);
      g.markReachable(map.spawns.flat().map((s) => g!.nodeAt(s.x, s.y, s.z)).filter((n) => n >= 0));
      cache.set(map.world, g);
    }
    return g;
  }

  constructor(readonly world: VoxelWorld) {
    const { sx, sz, sy } = world;
    this.cols = new Array(sx * sz);
    for (let x = 0; x < sx; x++)
      for (let z = 0; z < sz; z++) {
        const list: number[] = [];
        for (let y = 0; y < sy; y++) {
          const h = this.floorAt(x, y, z);
          if (h < 0 || !this.free(x, z, h, HEADROOM)) continue;
          list.push(this.nodes.length);
          this.nodes.push({ x, z, h });
        }
        this.cols[x * sz + z] = list;
      }
    for (let i = 0; i < this.nodes.length; i++) this.edges.push(this.link(i));
    this.edgeCost = new Float32Array(this.nodes.length);
    for (let i = 0; i < this.nodes.length; i++) {
      const walk = this.edges[i].filter((e) => e.kind === EDGE_WALK).length;
      if (walk < 8) this.edgeCost[i] = 0.5;
    }
  }

  /** Height of the walkable top of the block at (x, y, z), or -1 if none. */
  private floorAt(x: number, y: number, z: number): number {
    const bh = blockHeight(this.world.get(x, y, z));
    return bh > 0 ? y + bh : -1;
  }

  /** Is there room for a player-sized box of height h at floor y in this column? */
  private free(x: number, z: number, y: number, h: number): boolean {
    return !boxBlocked(this.world, x + 0.5, y + 0.001, z + 0.5, PHYS.halfWidth, h - 0.002);
  }

  private column(x: number, z: number): number[] {
    if (x < 0 || z < 0 || x >= this.world.sx || z >= this.world.sz) return [];
    return this.cols[x * this.world.sz + z];
  }

  private link(i: number): Edge[] {
    const a = this.nodes[i];
    const out: Edge[] = [];
    for (const [dx, dz] of DIRS) {
      const diag = dx !== 0 && dz !== 0;
      for (const j of this.column(a.x + dx, a.z + dz)) {
        const b = this.nodes[j];
        const rise = b.h - a.h;
        let kind: number;
        if (Math.abs(rise) <= PHYS.stepHeight) kind = EDGE_WALK;
        else if (rise > 0 && rise <= MAX_JUMP) kind = EDGE_JUMP;
        else if (rise < 0 && -rise <= MAX_DROP) kind = EDGE_DROP;
        else continue;
        if (diag && kind !== EDGE_WALK) continue;
        const top = Math.max(a.h, b.h) + HEADROOM + (kind === EDGE_JUMP ? 0.5 : 0);
        if (!this.free(a.x, a.z, a.h, top - a.h) || !this.free(b.x, b.z, b.h, top - b.h)) continue;
        // No cutting corners: both side cells must be walkable at this height too.
        if (diag && !(this.passable(a.x + dx, a.z, a.h, b.h) && this.passable(a.x, a.z + dz, a.h, b.h))) continue;
        const flat = diag ? Math.SQRT2 : 1;
        const cost = kind === EDGE_JUMP ? flat + 2 : kind === EDGE_DROP ? flat + 0.4 * -rise : flat + Math.abs(rise);
        out.push({ to: j, cost, kind });
      }
    }
    return out;
  }

  private passable(x: number, z: number, h0: number, h1: number): boolean {
    const lo = Math.min(h0, h1), hi = Math.max(h0, h1);
    return this.column(x, z).some((k) => {
      const c = this.nodes[k];
      return c.h >= lo - PHYS.stepHeight && c.h <= hi + 0.01 && this.free(x, z, c.h, hi + HEADROOM - c.h);
    });
  }

  private markReachable(starts: number[]): void {
    this.reach = new Uint8Array(this.nodes.length);
    const queue = [...starts];
    for (const s of starts) this.reach[s] = 1;
    while (queue.length) {
      const n = queue.pop()!;
      for (const e of this.edges[n]) if (!this.reach[e.to]) { this.reach[e.to] = 1; queue.push(e.to); }
    }
  }

  /** Node you are standing on at feet position (x, y, z), or -1. */
  nodeAt(x: number, y: number, z: number): number {
    let best = -1, bestD = Infinity;
    for (const k of this.column(Math.floor(x), Math.floor(z))) {
      const d = y - this.nodes[k].h;
      if (d > -0.6 && Math.abs(d) < bestD) { best = k; bestD = Math.abs(d); }
    }
    return best;
  }

  /** Closest reachable node to a point (searching outwards a few cells). */
  nearest(x: number, y: number, z: number): number {
    const here = this.nodeAt(x, y, z);
    if (here >= 0 && this.reach[here]) return here;
    const cx = Math.floor(x), cz = Math.floor(z);
    let best = -1, bestD = Infinity;
    for (let r = 1; r <= 6 && best < 0; r++)
      for (let ix = cx - r; ix <= cx + r; ix++)
        for (let iz = cz - r; iz <= cz + r; iz++) {
          if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== r) continue;
          for (const k of this.column(ix, iz)) {
            if (!this.reach[k]) continue;
            const n = this.nodes[k];
            const d = (n.x + 0.5 - x) ** 2 + (n.z + 0.5 - z) ** 2 + ((n.h - y) * 2) ** 2;
            if (d < bestD) { bestD = d; best = k; }
          }
        }
    return best;
  }

  /** Centre of a node's floor, where a player stands. */
  pos(n: number): V3 {
    const node = this.nodes[n];
    return [node.x + 0.5, node.h, node.z + 0.5];
  }

  edgeKind(from: number, to: number): number {
    return this.edges[from].find((e) => e.to === to)?.kind ?? EDGE_WALK;
  }

  /** A* shortest path as a list of node indices (start included), or null. */
  path(from: number, to: number, maxExpand = 20000): number[] | null {
    if (from < 0 || to < 0) return null;
    if (from === to) return [from];
    const n = this.nodes.length;
    const g = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const goal = this.nodes[to];
    const hCost = (k: number) => {
      const a = this.nodes[k];
      return Math.hypot(a.x - goal.x, a.z - goal.z) + Math.abs(a.h - goal.h);
    };
    const heap = new MinHeap();
    g[from] = 0;
    heap.push(from, hCost(from));
    let expanded = 0;
    while (heap.size) {
      const cur = heap.pop();
      if (cur === to) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (++expanded > maxExpand) return null;
      for (const e of this.edges[cur]) {
        if (closed[e.to]) continue;
        const ng = g[cur] + e.cost + this.edgeCost[e.to];
        if (ng < g[e.to]) {
          g[e.to] = ng;
          came[e.to] = cur;
          heap.push(e.to, ng + hCost(e.to));
        }
      }
    }
    if (came[to] < 0) return null;
    const out = [to];
    for (let k = came[to]; k >= 0; k = came[k]) out.push(k);
    return out.reverse();
  }

  /**
   * Can you walk straight from a to b without stepping more than a slab,
   * jumping or dropping? Used to skip zig-zag waypoints.
   */
  straight(a: V3, b: V3): boolean {
    const dx = b[0] - a[0], dz = b[2] - a[2];
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return true;
    const steps = Math.ceil(len / 0.25);
    const px = -dz / len * PHYS.halfWidth, pz = dx / len * PHYS.halfWidth;
    for (const side of [-1, 0, 1]) {
      let h = a[1];
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const n = this.nodeAt(a[0] + dx * t + px * side, h + 0.3, a[2] + dz * t + pz * side);
        if (n < 0) return false;
        const nh = this.nodes[n].h;
        if (Math.abs(nh - h) > PHYS.stepHeight) return false;
        h = nh;
      }
    }
    return true;
  }
}

/** Binary min-heap of node ids keyed by priority. */
class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, key: number): void {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p]; keys[i] = keys[p];
      i = p;
    }
    ids[i] = id; keys[i] = key;
  }

  pop(): number {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!, lastKey = keys.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i, mk = lastKey;
        if (l < n && keys[l] < mk) { m = l; mk = keys[l]; }
        if (r < n && keys[r] < mk) { m = r; mk = keys[r]; }
        if (m === i) break;
        ids[i] = ids[m]; keys[i] = keys[m];
        i = m;
      }
      ids[i] = lastId; keys[i] = lastKey;
    }
    return top;
  }
}
