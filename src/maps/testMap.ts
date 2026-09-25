import * as THREE from 'three';
import { B } from '../engine/blocks';
import { VoxelWorld } from '../engine/world';
import type { MapDef } from './types';

/** Small scene exercising every block type, used while building the engine. */
export const testMap: MapDef = {
  id: 'test',
  name: 'Test Yard',
  blurb: 'Engine test scene.',
  sizes: 'any',
  build() {
    const w = new VoxelWorld(64, 32, 64);
    w.fill(0, 0, 0, 63, 0, 63, B.bedrock);
    w.fill(0, 1, 0, 63, 3, 63, B.sandstone);
    w.fill(0, 4, 0, 63, 4, 63, B.sand);
    w.fill(0, 4, 40, 63, 4, 63, B.grass);

    // A courtyard with walls, a doorway and a window.
    w.fill(10, 5, 10, 30, 10, 10, B.cutSandstone);
    w.fill(10, 5, 30, 30, 10, 30, B.cutSandstone);
    w.fill(10, 5, 10, 10, 10, 30, B.sandstone);
    w.fill(30, 5, 10, 30, 10, 30, B.sandstone);
    w.fill(19, 5, 10, 21, 8, 10, 0);
    w.fill(19, 5, 30, 21, 8, 30, 0);
    w.fill(14, 7, 30, 16, 8, 30, B.glass);
    w.fill(10, 11, 10, 30, 11, 30, B.terracotta);
    w.fill(12, 11, 12, 28, 11, 28, 0);
    // A plank wall to test wallbangs.
    w.fill(24, 5, 22, 27, 7, 22, B.planks);

    // Stairs made of slabs and full blocks.
    for (let i = 0; i < 6; i++) {
      const x = 36 + i;
      if (i >= 2) w.fill(x, 5, 20, x, 4 + (i >> 1), 20, B.sandstone);
      w.set(x, 5 + (i >> 1), 20, i % 2 === 0 ? B.sandstoneSlab : B.sandstone);
    }

    // Crates for cover.
    w.fill(20, 5, 18, 21, 6, 19, B.crate);
    w.set(22, 5, 19, B.crate);
    w.set(16, 5, 24, B.metal);
    w.set(24, 5, 14, B.lamp);

    // A row of material samples.
    const samples = [B.stone, B.cobble, B.bricks, B.stoneBricks, B.planks, B.log, B.woolRed, B.woolBlue,
      B.gravel, B.terracottaLight, B.terracottaRed, B.snow, B.snowGrass, B.ice, B.sprucePlanks, B.spruceLog,
      B.concrete, B.concreteGray, B.concreteDark, B.dirt];
    samples.forEach((id, i) => w.fill(4 + i * 2, 5, 36, 4 + i * 2, 6, 36, id));

    // Two trees.
    for (const [tx, tz] of [[45, 50], [52, 44]]) {
      w.fill(tx - 2, 9, tz - 2, tx + 2, 10, tz + 2, B.leaves);
      w.fill(tx - 1, 11, tz - 1, tx + 1, 11, tz + 1, B.leaves);
      w.fill(tx, 5, tz, tx, 10, tz, B.log);
    }

    return {
      world: w,
      env: {
        sunDir: new THREE.Vector3(0.45, 0.8, 0.35).normalize(),
        sunColor: new THREE.Color(1.0, 0.93, 0.8),
        sunStrength: 0.55,
        skyAmbient: new THREE.Color(0.66, 0.7, 0.8),
        skyTop: new THREE.Color(0.32, 0.55, 0.92),
        skyHorizon: new THREE.Color(0.78, 0.86, 0.95),
        fogColor: new THREE.Color(0.78, 0.86, 0.95),
        fogNear: 60,
        fogFar: 160,
      },
      spawns: [
        [{ x: 20.5, y: 5, z: 26.5, yaw: 0 }, { x: 18.5, y: 5, z: 27.5, yaw: 0 }, { x: 22.5, y: 5, z: 27.5, yaw: 0 }, { x: 16.5, y: 5, z: 26.5, yaw: 0 }],
        [{ x: 20.5, y: 5, z: 4.5, yaw: Math.PI }, { x: 18.5, y: 5, z: 4.5, yaw: Math.PI }, { x: 22.5, y: 5, z: 4.5, yaw: Math.PI }, { x: 24.5, y: 5, z: 4.5, yaw: Math.PI }],
      ],
      buyZones: [
        { x0: 10, y0: 4, z0: 22, x1: 30, y1: 12, z1: 30 },
        { x0: 10, y0: 4, z0: 0, x1: 30, y1: 12, z1: 9 },
      ],
      points: [[20.5, 5, 20.5], [40.5, 5, 14.5], [5.5, 5, 20.5], [20.5, 5, 34.5]],
      overview: { p: [4, 14, 4], yaw: -2.4, pitch: -0.35 },
    };
  },
};
