import * as THREE from 'three';
import { B } from '../engine/blocks';
import { mirrorPoints, newWorld } from './builder';
import type { MapDef } from './types';

/**
 * Frostbite: a snowy outpost split by a frozen river. Two bridges cross it,
 * a lodge straddles the middle (with a tunnel underneath on the ice), a pine
 * forest covers the north and a quarry the south. Built for the west half, then mirrored.
 */
export const frostbite: MapDef = {
  id: 'frostbite',
  name: 'Frostbite',
  blurb: 'Snowy outpost. Frozen river with a tunnel under the lodge, forest and quarry flanks.',
  sizes: '2v2 · 4v4',
  build() {
    const W = 88, H = 28, D = 68;
    const { w, b } = newWorld(W, H, D);

    b.box(0, 0, 0, W - 1, 0, D - 1, B.bedrock).box(0, 1, 0, W - 1, 2, D - 1, B.stone)
      .box(0, 3, 0, W - 1, 3, D - 1, B.dirt).box(0, 4, 0, W - 1, 4, D - 1, B.snowGrass);
    b.box(0, 5, 0, 1, 14, D - 1, B.stoneBricks).box(0, 5, 0, 43, 14, 1, B.stoneBricks).box(0, 5, D - 2, 43, 14, D - 1, B.stoneBricks);
    b.box(0, 15, 0, 1, 15, D - 1, B.snow).box(0, 15, 0, 43, 15, 1, B.snow).box(0, 15, D - 2, 43, 15, D - 1, B.snow);
    b.box(1, 7, 29, 1, 11, 38, B.woolRed);

    // Frozen river down the middle, three blocks below the banks.
    b.clear(38, 2, 2, 43, 4, D - 3);
    b.box(38, 1, 2, 43, 1, D - 3, B.ice);
    // Ramps down to the ice from both banks.
    b.stairs(43, 20, -1, 0, 2, 6, 2, B.stone, B.cobbleSlab);
    b.stairs(43, 46, -1, 0, 2, 6, 2, B.stone, B.cobbleSlab);
    // Bridges (you can walk underneath them on the ice).
    for (const z0 of [9, 53]) {
      b.box(36, 4, z0, 43, 4, z0 + 5, B.sprucePlanks);
      b.box(36, 5, z0, 43, 5, z0, B.spruceSlab).box(36, 5, z0 + 5, 43, 5, z0 + 5, B.spruceSlab);
      b.box(36, 5, z0, 36, 6, z0, B.spruceLog).box(36, 5, z0 + 5, 36, 6, z0 + 5, B.spruceLog);
    }

    // Lodge over the river: a two-door hall; the river runs under its floor.
    b.box(34, 4, 27, 43, 4, 40, B.sprucePlanks);
    b.walls(34, 5, 27, 43, 9, 40, B.sprucePlanks);
    b.box(34, 5, 27, 34, 9, 27, B.spruceLog).box(34, 5, 40, 34, 9, 40, B.spruceLog);
    b.box(33, 10, 26, 43, 10, 41, B.spruceSlab);
    b.box(34, 10, 27, 43, 10, 40, B.sprucePlanks).box(34, 11, 27, 43, 11, 40, B.snow);
    b.clear(34, 5, 32, 34, 7, 35); // west door
    b.clear(42, 5, 27, 43, 7, 27); // north door (4 wide once mirrored)
    b.clear(42, 5, 40, 43, 7, 40); // south door
    for (const x of [36, 39]) b.box(x, 7, 27, x + 1, 8, 27, B.glass).box(x, 7, 40, x + 1, 8, 40, B.glass);
    b.crate(36, 5, 29, 2).crate(37, 5, 29, 1);
    b.crate(39, 5, 37, 1, 1, 2);
    b.crate(43, 5, 33, 1, 1, 2);
    b.set(38, 9, 33, B.lamp);

    // Spawn: two cabins and a campfire.
    b.box(3, 5, 12, 9, 9, 18, B.sprucePlanks).box(2, 10, 11, 10, 10, 19, B.spruceSlab);
    b.box(3, 5, 49, 9, 9, 55, B.sprucePlanks).box(2, 10, 48, 10, 10, 56, B.spruceSlab);
    for (const z of [14, 51]) b.box(10, 7, z, 10, 8, z + 1, B.concreteDark);
    b.box(6, 4, 32, 8, 4, 34, B.cobble).set(7, 4, 33, B.lamp);
    b.box(12, 5, 22, 12, 5, 24, B.sprucePlanks).box(12, 5, 43, 12, 5, 45, B.sprucePlanks);

    // Open field between spawn and the river: fences, crates and snow drifts.
    b.box(19, 5, 26, 19, 5, 31, B.sprucePlanks).box(19, 5, 36, 19, 5, 41, B.sprucePlanks);
    b.box(19, 6, 26, 19, 6, 26, B.spruceLog).box(19, 6, 41, 19, 6, 41, B.spruceLog);
    b.crate(25, 5, 31, 2).crate(26, 5, 31, 1);
    b.crate(28, 5, 38, 1, 1, 2);
    b.box(23, 5, 22, 25, 5, 23, B.snow).box(29, 5, 44, 31, 5, 45, B.snow);

    // North: pine forest with a rock ledge along the wall.
    for (const [x, z, h] of [[15, 7, 7], [22, 12, 8], [29, 5, 7], [33, 11, 6], [17, 14, 6], [27, 15, 7]]) b.spruce(x, 5, z, h);
    b.box(25, 5, 8, 26, 5, 9, B.cobble).set(25, 6, 8, B.cobble);
    b.box(31, 5, 14, 32, 6, 15, B.stone);
    b.box(12, 5, 2, 30, 6, 4, B.stone).box(12, 7, 2, 30, 7, 2, B.cobbleSlab);
    b.stairs(34, 2, -1, 0, 5, 4, 3, B.stone, B.cobbleSlab);

    // South: the quarry.
    b.box(12, 4, 50, 35, 4, 65, B.gravel);
    b.box(14, 5, 58, 20, 7, 65, B.stone).box(15, 8, 60, 19, 8, 65, B.cobble);
    b.stairs(26, 60, -1, 0, 5, 6, 2, B.stone, B.cobbleSlab);
    b.box(24, 5, 52, 26, 6, 54, B.cobble);
    b.box(30, 5, 60, 34, 5, 64, B.stone).box(29, 5, 60, 29, 5, 64, B.cobbleSlab);
    b.crate(31, 6, 61, 1).crate(32, 6, 62, 2);
    b.spruce(32, 5, 53, 6);

    b.mirrorX();

    const west = [26.5, 29.5, 37.5, 40.5].map((z) => ({ x: 6.5, y: 5, z, yaw: -Math.PI / 2 }));
    const east = west.map((s) => ({ x: W - s.x, y: 5, z: s.z, yaw: Math.PI / 2 }));
    return {
      world: w,
      env: {
        sunDir: new THREE.Vector3(-0.5, 0.55, 0.35).normalize(),
        sunColor: new THREE.Color(1.0, 0.95, 0.9),
        sunStrength: 0.45,
        skyAmbient: new THREE.Color(0.72, 0.78, 0.9),
        skyTop: new THREE.Color(0.45, 0.6, 0.85),
        skyHorizon: new THREE.Color(0.85, 0.9, 0.95),
        fogColor: new THREE.Color(0.86, 0.9, 0.95),
        fogNear: 45,
        fogFar: 125,
      },
      spawns: [west, east],
      buyZones: [
        { x0: 2, y0: 4, z0: 8, x1: 14, y1: 12, z1: 60 },
        { x0: W - 15, y0: 4, z0: 8, x1: W - 2, y1: 12, z1: 60 },
      ],
      points: mirrorPoints([
        [40.5, 5, 11.5], [40.5, 5, 55.5], [38, 5, 33.5], [32, 5, 33.5], [40.5, 2, 33.5], [38.5, 2, 20.5],
        [24, 5, 10], [20, 7, 3], [27, 5, 57], [21, 5, 34], [27, 5, 26], [17, 8, 62], [30, 5, 47],
      ], W),
      overview: { p: [44, 28, 82], yaw: 0, pitch: -0.5 },
    };
  },
};
