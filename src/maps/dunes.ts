import * as THREE from 'three';
import { B } from '../engine/blocks';
import { mirrorPoints, newWorld } from './builder';
import type { MapDef } from './types';

/**
 * Dunes: a desert town. Each team spawns at one end; three routes lead to
 * the other side: the open Long lane (north), the Mid corridor into a central
 * courtyard, and the covered Market (south). Built for the west half, then mirrored.
 */
export const dunes: MapDef = {
  id: 'dunes',
  name: 'Dunes',
  blurb: 'Desert town. Long sniper lane, courtyard mid, tight covered market.',
  sizes: '2v2 · 4v4',
  build() {
    const W = 104, H = 32, D = 72;
    const { w, b } = newWorld(W, H, D);

    // Ground and outer walls (west half; mirrored at the end).
    b.box(0, 0, 0, W - 1, 0, D - 1, B.bedrock).box(0, 1, 0, W - 1, 3, D - 1, B.sandstone).box(0, 4, 0, W - 1, 4, D - 1, B.sand);
    b.box(0, 5, 0, 1, 16, D - 1, B.cutSandstone);
    b.box(0, 5, 0, 51, 16, 1, B.cutSandstone);
    b.box(0, 5, D - 2, 51, 16, D - 1, B.cutSandstone);
    b.box(1, 7, 30, 1, 12, 41, B.woolRed); // team banner behind spawn

    // Spawn plaza.
    b.box(2, 4, 20, 13, 4, 51, B.smoothSandstone);
    b.palm(4, 5, 22).palm(4, 5, 49);
    b.box(2, 5, 15, 9, 10, 19, B.sandstone); // north spawn wall, leaves a gap to Long
    b.box(2, 5, 52, 9, 10, 56, B.sandstone); // south spawn wall, leaves a gap to Market
    b.box(2, 11, 15, 9, 11, 19, B.terracotta).box(2, 11, 52, 9, 11, 56, B.terracotta);

    // Big building blocks between the routes.
    b.box(14, 5, 15, 39, 11, 27, B.cutSandstone).box(14, 12, 15, 39, 12, 27, B.terracottaLight); // north block
    b.box(14, 5, 44, 39, 11, 54, B.cutSandstone).box(14, 12, 44, 39, 12, 54, B.terracottaLight); // south block
    b.box(40, 5, 15, 47, 11, 19, B.sandstone).box(40, 12, 15, 47, 12, 19, B.terracotta); // courtyard corners
    b.box(40, 5, 52, 47, 11, 56, B.sandstone).box(40, 12, 52, 47, 12, 56, B.terracotta);
    // Dark "windows" and trim on the facades.
    for (let x = 16; x <= 36; x += 5) {
      for (const z of [15, 27, 44, 54]) b.box(x, 7, z, x + 1, 8, z, B.concreteDark);
      b.set(x + 3, 9, 27, B.lamp);
    }
    b.box(14, 10, 15, 39, 10, 15, B.terracotta).box(14, 10, 54, 39, 10, 54, B.terracotta);

    // Mid doors: spawn -> Mid corridor.
    b.box(14, 5, 28, 15, 10, 43, B.sandstone);
    b.clear(14, 5, 33, 15, 8, 38);
    b.box(12, 9, 33, 13, 9, 38, B.woolRed); // awning over the doors
    // Mid corridor cover.
    b.crate(22, 5, 38, 2, 2, 2);
    b.crate(30, 5, 31, 1, 1, 2).crate(31, 5, 31, 2, 1, 1);
    b.box(26, 5, 40, 27, 5, 43, B.sandstone);
    b.box(35, 5, 34, 35, 5, 37, B.planks).set(35, 6, 35, B.crate);

    // Stairs up to the north block's roof: a sniper perch over Long and the courtyard.
    b.stairs(17, 28, 1, 0, 5, 16, 2, B.sandstone, B.sandstoneSlab);
    b.parapet(14, 13, 15, 39, 27, B.cutSandstone);
    b.clear(30, 13, 27, 33, 13, 27);
    b.crate(20, 13, 18, 1, 1, 1);

    // Long: open lane along the north wall.
    b.box(22, 5, 2, 23, 11, 14, B.sandstone);
    b.clear(22, 5, 7, 23, 8, 10);
    b.box(22, 9, 6, 23, 9, 11, B.planks); // lintel over Long doors
    b.crate(28, 5, 3, 2, 2, 2);
    b.crate(34, 5, 11, 1, 1, 2);
    b.crate(17, 5, 12, 1).crate(17, 5, 13, 2);
    b.palm(7, 5, 6).palm(15, 5, 3, 5);
    // A walkable dune in the middle of Long breaks the sightline.
    b.box(45, 5, 4, 51, 5, 12, B.sand).box(44, 5, 5, 44, 5, 11, B.sandstoneSlab);
    b.box(48, 6, 5, 51, 6, 11, B.sand).box(47, 6, 5, 47, 6, 11, B.sandstoneSlab);

    // Courtyard with a raised fountain and a lamp pillar at the centre.
    b.box(40, 4, 20, 51, 4, 51, B.smoothSandstone);
    b.box(46, 5, 30, 51, 5, 41, B.sandstoneSlab);
    b.box(50, 5, 34, 51, 9, 37, B.stoneBricks).box(50, 10, 35, 51, 10, 36, B.lamp);
    b.box(42, 5, 23, 43, 5, 24, B.cutSandstone).box(42, 6, 23, 43, 6, 24, B.leaves);
    b.box(42, 5, 47, 43, 5, 48, B.cutSandstone).box(42, 6, 47, 43, 6, 48, B.leaves);
    b.crate(46, 5, 24, 2).crate(47, 5, 25, 1);
    b.crate(46, 5, 46, 1, 1, 2);

    // Market: stalls, a covered tunnel, and a house in the middle.
    b.stall(17, 5, 59, 4, 3, B.woolRed);
    b.stall(31, 5, 65, 4, 3, B.woolRed);
    b.box(22, 5, 64, 29, 11, 69, B.bricks);
    b.box(22, 9, 57, 29, 10, 63, B.planks);
    b.box(22, 5, 57, 22, 8, 57, B.log).box(29, 5, 57, 29, 8, 57, B.log);
    b.set(25, 8, 60, B.lamp);
    b.crate(38, 5, 58, 1).crate(12, 5, 63, 2).crate(13, 5, 63, 1).crate(13, 5, 64, 1);
    // Centre house: doors on the west side and towards the courtyard.
    b.walls(46, 5, 59, 51, 10, 67, B.bricks);
    b.box(46, 11, 59, 51, 11, 67, B.terracotta);
    b.clear(46, 5, 62, 46, 7, 64);
    b.clear(50, 5, 59, 51, 7, 59);
    b.box(48, 7, 67, 49, 8, 67, B.glass);
    b.crate(48, 5, 64, 2).crate(49, 5, 65, 1);
    b.set(50, 9, 63, B.lamp);

    b.mirrorX();

    const west = [26.5, 31.5, 40.5, 45.5].map((z) => ({ x: 5.5, y: 5, z, yaw: -Math.PI / 2 }));
    const east = west.map((s) => ({ x: W - s.x, y: 5, z: s.z, yaw: Math.PI / 2 }));
    return {
      world: w,
      env: {
        sunDir: new THREE.Vector3(0.35, 0.8, 0.45).normalize(),
        sunColor: new THREE.Color(1.0, 0.92, 0.78),
        sunStrength: 0.6,
        skyAmbient: new THREE.Color(0.64, 0.66, 0.74),
        skyTop: new THREE.Color(0.3, 0.52, 0.88),
        skyHorizon: new THREE.Color(0.86, 0.84, 0.8),
        fogColor: new THREE.Color(0.86, 0.84, 0.8),
        fogNear: 70,
        fogFar: 170,
      },
      spawns: [west, east],
      buyZones: [
        { x0: 2, y0: 4, z0: 15, x1: 14, y1: 12, z1: 57 },
        { x0: W - 15, y0: 4, z0: 15, x1: W - 2, y1: 12, z1: 57 },
      ],
      points: mirrorPoints([
        [23, 5, 8.5], [30, 5, 8.5], [49.5, 7, 8.5], [11.5, 5, 17.5], [16.5, 5, 35.5], [28, 5, 36],
        [41, 5, 35.5], [45, 5, 27], [45, 5, 44], [20, 5, 57.5], [26, 5, 60.5], [48.5, 5, 62.5],
        [11.5, 5, 54.5], [30, 13, 21], [38, 5, 21.5],
      ], W),
      overview: { p: [52, 30, 86], yaw: 0, pitch: -0.5 },
    };
  },
};
