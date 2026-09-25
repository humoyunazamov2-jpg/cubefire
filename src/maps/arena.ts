import * as THREE from 'three';
import { B } from '../engine/blocks';
import { mirrorPoints, newWorld } from './builder';
import type { MapDef } from './types';

/**
 * Arena: a compact training hall at sunset for 1v1 and 2v2. A pillar splits
 * the middle, side corridors with windows flank it, and a low platform near
 * each spawn gives a little high ground.
 */
export const arena: MapDef = {
  id: 'arena',
  name: 'Arena',
  blurb: 'Small and fast. Central pillar, windowed side corridors. Best for 1v1.',
  sizes: '1v1 · 2v2',
  build() {
    const W = 56, H = 24, D = 40;
    const { w, b } = newWorld(W, H, D);

    b.box(0, 0, 0, W - 1, 0, D - 1, B.bedrock).box(0, 1, 0, W - 1, 3, D - 1, B.stone).box(0, 4, 0, W - 1, 4, D - 1, B.concreteGray);
    b.box(0, 5, 0, 1, 13, D - 1, B.stoneBricks).box(0, 5, 0, 27, 13, 1, B.stoneBricks).box(0, 5, D - 2, 27, 13, D - 1, B.stoneBricks);
    b.box(0, 14, 0, 1, 14, D - 1, B.stoneBrickSlab).box(0, 14, 0, 27, 14, 1, B.stoneBrickSlab).box(0, 14, D - 2, 27, 14, D - 1, B.stoneBrickSlab);
    // Floor markings.
    b.box(2, 4, 2, 27, 4, 37, B.concreteGray);
    b.box(14, 4, 2, 14, 4, 37, B.concrete).box(2, 4, 19, 27, 4, 20, B.concrete);
    b.box(2, 4, 12, 8, 4, 27, B.woolRed);
    b.box(1, 7, 15, 1, 10, 24, B.woolRed);
    for (const z of [6, 33]) b.set(1, 9, z, B.lamp);
    for (const x of [8, 20]) { b.set(x, 9, 1, B.lamp); b.set(x, 9, D - 2, B.lamp); }

    // Spawn cover.
    b.box(7, 5, 8, 8, 7, 11, B.stoneBricks).box(7, 5, 28, 8, 7, 31, B.stoneBricks);

    // Low platform with half-step edges.
    b.box(10, 5, 16, 13, 5, 23, B.concrete);
    b.box(9, 5, 16, 9, 5, 23, B.concreteSlab).box(14, 5, 16, 14, 5, 23, B.concreteSlab);

    // Side corridors separated by windowed walls.
    for (const z of [8, 31]) {
      b.box(12, 5, z, 24, 8, z, B.stoneBricks);
      b.box(17, 6, z, 19, 7, z, B.glass);
      b.clear(12, 5, z, 12, 7, z);
    }
    b.crate(16, 5, 4, 1).crate(22, 5, 5, 2).crate(23, 5, 5, 1);
    b.crate(16, 5, 35, 1).crate(22, 5, 33, 2).crate(23, 5, 34, 1);

    // Middle: metal crouch-cover and the central pillar.
    b.box(19, 5, 12, 21, 6, 13, B.metal).box(19, 5, 26, 21, 6, 27, B.metal);
    b.box(26, 5, 17, 27, 9, 22, B.stoneBricks).box(26, 10, 19, 27, 10, 20, B.lamp);
    b.box(25, 5, 17, 25, 5, 22, B.stoneBrickSlab);

    b.mirrorX();

    const west = [16.5, 19.5, 20.5, 23.5].map((z, i) => ({ x: i % 2 ? 5.5 : 3.5, y: 5, z, yaw: -Math.PI / 2 }));
    const east = west.map((s) => ({ x: W - s.x, y: 5, z: s.z, yaw: Math.PI / 2 }));
    return {
      world: w,
      env: {
        sunDir: new THREE.Vector3(0.8, 0.32, 0.3).normalize(),
        sunColor: new THREE.Color(1.0, 0.72, 0.48),
        sunStrength: 0.7,
        skyAmbient: new THREE.Color(0.62, 0.58, 0.68),
        skyTop: new THREE.Color(0.32, 0.33, 0.6),
        skyHorizon: new THREE.Color(0.98, 0.66, 0.45),
        fogColor: new THREE.Color(0.9, 0.64, 0.5),
        fogNear: 50,
        fogFar: 115,
      },
      spawns: [west, east],
      buyZones: [
        { x0: 2, y0: 4, z0: 9, x1: 9, y1: 10, z1: 30 },
        { x0: W - 10, y0: 4, z0: 9, x1: W - 2, y1: 10, z1: 30 },
      ],
      points: mirrorPoints([
        [20, 5, 11], [20, 5, 28.5], [24.5, 5, 19.5], [12, 6, 19.5], [18, 5, 5], [18, 5, 34], [10.5, 5, 9.5], [10.5, 5, 30.5],
      ], W),
      overview: { p: [28, 22, 52], yaw: 0, pitch: -0.55 },
    };
  },
};
