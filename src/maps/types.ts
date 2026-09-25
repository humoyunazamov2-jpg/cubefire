import type { Environment } from '../engine/renderer';
import type { VoxelWorld } from '../engine/world';
import type { MapId, V3 } from '../net/protocol';

export interface SpawnPoint {
  x: number; y: number; z: number;
  yaw: number;
}

export interface Box3 {
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
}

export const inBox = (b: Box3, x: number, y: number, z: number) =>
  x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && z >= b.z0 && z <= b.z1;

export interface BuiltMap {
  world: VoxelWorld;
  env: Environment;
  /** Spawn points for each side. Team 0 starts on side 0, and teams swap at halftime. */
  spawns: [SpawnPoint[], SpawnPoint[]];
  buyZones: [Box3, Box3];
  /** Key spots bots move between (chokepoints, cover, sightlines). */
  points: V3[];
  /** Where the camera floats in the menu / between matches. */
  overview: { p: V3; yaw: number; pitch: number };
}

export interface MapDef {
  id: MapId | 'test';
  name: string;
  blurb: string;
  /** Recommended team sizes. */
  sizes: string;
  build(): BuiltMap;
}
