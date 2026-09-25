import * as THREE from 'three';
import { AIR, B, BLOCKS } from './blocks';
import type { Atlas } from './textures';
import type { VoxelWorld } from './world';

export const CHUNK = 16;

export interface Lighting {
  /** Unit vector pointing towards the sun. */
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  skyColor: THREE.Color;
  sunStrength: number;
}

// Each face: normal n, and in-plane axes r (texture right) and u (texture up), with r x u = n.
const FACES = [
  { n: [1, 0, 0], r: [0, 0, -1], u: [0, 1, 0], tex: 'side' },
  { n: [-1, 0, 0], r: [0, 0, 1], u: [0, 1, 0], tex: 'side' },
  { n: [0, 1, 0], r: [1, 0, 0], u: [0, 0, -1], tex: 'top' },
  { n: [0, -1, 0], r: [1, 0, 0], u: [0, 0, 1], tex: 'bottom' },
  { n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0], tex: 'side' },
  { n: [0, 0, -1], r: [-1, 0, 0], u: [0, 1, 0], tex: 'side' },
] as const;
const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]] as const;
const AO_CURVE = [0.5, 0.67, 0.84, 1.0];
// Sky light reaching each face direction, like Minecraft's fixed face shading.
const FACE_AMBIENT = [0.78, 0.78, 1.0, 0.55, 0.88, 0.88];

/** Does `id` fully hide the face of a neighbour that looks at it from direction `face`? */
function occludes(id: number, face: number): boolean {
  const d = BLOCKS[id];
  if (id === AIR || d.transparent || d.invisible || !d.solid) return false;
  if (d.shape === 'full') return true;
  // A slab covers the top face of the block below it.
  return FACES[face].n[1] === 1;
}

function aoSolid(id: number): boolean {
  const d = BLOCKS[id];
  return id !== AIR && d.solid && !d.invisible && !d.transparent;
}

function castsShadow(world: VoxelWorld, id: number, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= world.sx || z >= world.sz) return false;
  const d = BLOCKS[id];
  return id !== AIR && !d.invisible && id !== B.glass;
}

/** Build one mesh per 16^3 chunk for the whole world. */
export function buildWorldMeshes(world: VoxelWorld, atlas: Atlas, light: Lighting, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  group.name = 'world';
  for (let cy = 0; cy < world.sy; cy += CHUNK)
    for (let cz = 0; cz < world.sz; cz += CHUNK)
      for (let cx = 0; cx < world.sx; cx += CHUNK) {
        const geo = buildChunk(world, atlas, light, cx, cy, cz);
        if (!geo) continue;
        const mesh = new THREE.Mesh(geo, material);
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        group.add(mesh);
      }
  return group;
}

function buildChunk(world: VoxelWorld, atlas: Atlas, light: Lighting, cx: number, cy: number, cz: number): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const sun = light.sunDir;
  const sky = light.skyColor, sunC = light.sunColor;

  const shadowed = (px: number, py: number, pz: number): boolean => {
    let hit = false;
    world.traverse(px, py, pz, sun.x, sun.y, sun.z, 64, (id, x, _y, z) => {
      if (castsShadow(world, id, x, z)) { hit = true; return true; }
      return false;
    });
    return hit;
  };

  for (let y = cy; y < Math.min(cy + CHUNK, world.sy); y++)
    for (let z = cz; z < Math.min(cz + CHUNK, world.sz); z++)
      for (let x = cx; x < Math.min(cx + CHUNK, world.sx); x++) {
        const id = world.get(x, y, z);
        if (id === AIR) continue;
        const def = BLOCKS[id];
        if (def.invisible) continue;
        const h = def.shape === 'slab' ? 0.5 : 1;
        const fullbright = id === B.lamp;

        for (let f = 0; f < 6; f++) {
          const F = FACES[f];
          const nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
          const nid = world.get(nx, ny, nz);
          // A slab's top face sits mid-cell, so nothing above can hide it.
          const slabTop = h < 1 && f === 2;
          if (!slabTop) {
            if (occludes(nid, f)) continue;
            if (def.transparent && nid === id) continue;
          }

          const tile = atlas.uv(def[F.tex]);
          // Box of this block inside its cell.
          const size = [1, h, 1];
          const center = [x + 0.5, y + h / 2, z + 0.5];
          const sR = Math.abs(F.r[0] * size[0] + F.r[1] * size[1] + F.r[2] * size[2]);
          const sU = Math.abs(F.u[0] * size[0] + F.u[1] * size[1] + F.u[2] * size[2]);
          const sN = Math.abs(F.n[0] * size[0] + F.n[1] * size[1] + F.n[2] * size[2]);
          const fc = [center[0] + F.n[0] * sN / 2, center[1] + F.n[1] * sN / 2, center[2] + F.n[2] * sN / 2];

          const diffuse = Math.max(0, F.n[0] * sun.x + F.n[1] * sun.y + F.n[2] * sun.z);
          const base = pos.length / 3;
          const aos: number[] = [];

          for (let c = 0; c < 4; c++) {
            const [a, b] = CORNERS[c];
            const px = fc[0] + F.r[0] * (a - 0.5) * sR + F.u[0] * (b - 0.5) * sU;
            const py = fc[1] + F.r[1] * (a - 0.5) * sR + F.u[1] * (b - 0.5) * sU;
            const pz = fc[2] + F.r[2] * (a - 0.5) * sR + F.u[2] * (b - 0.5) * sU;
            pos.push(px, py, pz);
            uv.push(
              tile[0] + (tile[2] - tile[0]) * a,
              tile[1] + (tile[3] - tile[1]) * (b * sU),
            );

            // Ambient occlusion from the three neighbours touching this corner.
            // A slab top sits mid-cell, so only full blocks beside it rise above and shade it.
            const sa = a ? 1 : -1, sb = b ? 1 : -1;
            const ly = slabTop ? y : ny;
            const occ = slabTop ? (i: number) => aoSolid(i) && BLOCKS[i].shape === 'full' : aoSolid;
            const s1 = occ(world.get(nx + F.r[0] * sa, ly + F.r[1] * sa, nz + F.r[2] * sa)) ? 1 : 0;
            const s2 = occ(world.get(nx + F.u[0] * sb, ly + F.u[1] * sb, nz + F.u[2] * sb)) ? 1 : 0;
            const cc = occ(world.get(
              nx + F.r[0] * sa + F.u[0] * sb, ly + F.r[1] * sa + F.u[1] * sb, nz + F.r[2] * sa + F.u[2] * sb)) ? 1 : 0;
            const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
            aos.push(ao);

            if (fullbright) { col.push(1.15, 1.1, 1.0); continue; }
            // Sun shadow sampled slightly inside the face so edges don't self-shadow.
            let lit = 0;
            if (diffuse > 0.01) {
              const ix = px + (fc[0] - px) * 0.12 + F.n[0] * 0.02;
              const iy = py + (fc[1] - py) * 0.12 + F.n[1] * 0.02;
              const iz = pz + (fc[2] - pz) * 0.12 + F.n[2] * 0.02;
              lit = shadowed(ix, iy, iz) ? 0 : 1;
            }
            const aoF = AO_CURVE[ao];
            const amb = FACE_AMBIENT[f];
            const s = light.sunStrength * diffuse * lit;
            col.push(
              Math.min(1.2, (sky.r * amb + sunC.r * s) * aoF),
              Math.min(1.2, (sky.g * amb + sunC.g * s) * aoF),
              Math.min(1.2, (sky.b * amb + sunC.b * s) * aoF),
            );
          }
          // Flip the quad diagonal so AO gradients don't show an obvious seam.
          if (aos[0] + aos[2] < aos[1] + aos[3]) idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
          else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }

  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}
