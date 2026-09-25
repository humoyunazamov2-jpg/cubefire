import * as THREE from 'three';
import type { VoxBox } from '../game/weapons';

const FACE_DIRS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
] as const;

/** Merge coloured boxes into one geometry (one draw call per model). */
export function buildVoxGeometry(boxes: VoxBox[], scale: number): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  for (const [x, y, z, w, h, d, color] of boxes) {
    c.setHex(color, THREE.SRGBColorSpace);
    const x0 = x * scale, y0 = y * scale, z0 = z * scale;
    const x1 = (x + w) * scale, y1 = (y + h) * scale, z1 = (z + d) * scale;
    const corners = [
      // +x, -x, +y, -y, +z, -z faces, counter-clockwise from outside.
      [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
      [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
      [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]],
      [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
      [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
    ];
    for (let f = 0; f < 6; f++) {
      const base = pos.length / 3;
      for (const v of corners[f]) {
        pos.push(v[0], v[1], v[2]);
        nor.push(FACE_DIRS[f][0], FACE_DIRS[f][1], FACE_DIRS[f][2]);
        col.push(c.r, c.g, c.b);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export const voxMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
