import * as THREE from 'three';

// Procedural 16x16 pixel-art block textures, packed into one atlas.
// All art is generated here from seeded noise, so there are no image assets.

export const TILE = 16;
const COLS = 8;
const ROWS = 8;

type RGB = [number, number, number];
type Px = (x: number, y: number, c: RGB, a?: number) => void;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
export const shade = (c: RGB, f: number): RGB => [clamp255(c[0] * f), clamp255(c[1] * f), clamp255(c[2] * f)];
const mix = (a: RGB, b: RGB, t: number): RGB => [
  clamp255(a[0] + (b[0] - a[0]) * t),
  clamp255(a[1] + (b[1] - a[1]) * t),
  clamp255(a[2] + (b[2] - a[2]) * t),
];

/** Fill every pixel with the base colour jittered in brightness. */
function noise(px: Px, r: () => number, base: RGB, amount: number) {
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) px(x, y, shade(base, 1 + (r() - 0.5) * 2 * amount));
}

function speckle(px: Px, r: () => number, color: RGB, chance: number, amount = 0.08) {
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) if (r() < chance) px(x, y, shade(color, 1 + (r() - 0.5) * 2 * amount));
}

/** Irregular stones separated by dark mortar (cobblestone, gravel). */
function voronoi(px: Px, r: () => number, cells: number, palette: RGB[], mortar: RGB, edge: number) {
  const pts: { x: number; y: number; c: RGB }[] = [];
  for (let i = 0; i < cells; i++)
    pts.push({ x: r() * TILE, y: r() * TILE, c: shade(palette[Math.floor(r() * palette.length)], 0.9 + r() * 0.2) });
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      let d1 = Infinity, d2 = Infinity, best = pts[0];
      for (const p of pts)
        for (let oy = -1; oy <= 1; oy++)
          for (let ox = -1; ox <= 1; ox++) {
            const dx = x + 0.5 - (p.x + ox * TILE), dy = y + 0.5 - (p.y + oy * TILE);
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d;
          }
      if (d2 - d1 < edge) px(x, y, shade(mortar, 0.9 + r() * 0.2));
      else {
        // Light the top-left of each stone, darken bottom-right.
        const lit = 1 + (d1 < 2 ? 0.06 : 0) - (r() * 0.1);
        px(x, y, shade(best.c, lit));
      }
    }
}

/** Horizontal boards with seams and grain. */
function planks(px: Px, r: () => number, base: RGB, seam: RGB) {
  for (let board = 0; board < 4; board++) {
    const cut = Math.floor(r() * 12) + 2;
    const tone = 0.92 + r() * 0.16;
    for (let row = 0; row < 4; row++) {
      const y = board * 4 + row;
      for (let x = 0; x < TILE; x++) {
        if (row === 3) { px(x, y, seam); continue; }
        if (x === cut && board % 2 === 1) { px(x, y, shade(seam, 1.1)); continue; }
        const grain = Math.sin((x + board * 7) * 0.9 + row * 2.1) * 0.04;
        px(x, y, shade(base, tone + grain + (r() - 0.5) * 0.08));
      }
    }
  }
}

function bricksPattern(px: Px, r: () => number, brick: RGB, mortar: RGB, bh: number, bw: number) {
  for (let y = 0; y < TILE; y++) {
    const course = Math.floor(y / bh);
    const off = course % 2 ? bw / 2 : 0;
    for (let x = 0; x < TILE; x++) {
      const bx = (x + off) % bw;
      if (y % bh === bh - 1 || bx === bw - 1) px(x, y, shade(mortar, 0.92 + r() * 0.12));
      else {
        const id = course * 7 + Math.floor((x + off) / bw) * 13;
        const tone = 0.88 + ((id * 2654435761) % 1000) / 1000 * 0.2;
        const edge = y % bh === 0 || bx === 0 ? 1.08 : 1;
        px(x, y, shade(brick, tone * edge + (r() - 0.5) * 0.08));
      }
    }
  }
}

function frame(px: Px, c: RGB, w = 1) {
  for (let i = 0; i < TILE; i++)
    for (let k = 0; k < w; k++) {
      px(i, k, c); px(i, TILE - 1 - k, c); px(k, i, c); px(TILE - 1 - k, i, c);
    }
}

function barkSide(px: Px, r: () => number, bark: RGB) {
  const cols: number[] = [];
  for (let x = 0; x < TILE; x++) cols.push(0.85 + r() * 0.25);
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const groove = (x + Math.floor(y / 5)) % 4 === 0 ? 0.75 : 1;
      px(x, y, shade(bark, cols[x] * groove + (r() - 0.5) * 0.06));
    }
}

function logTop(px: Px, r: () => number, wood: RGB, bark: RGB) {
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const dx = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (dx > 6.6) { px(x, y, shade(bark, 0.9 + r() * 0.2)); continue; }
      const ring = Math.floor(dx) % 2 === 0 ? 1.0 : 0.86;
      px(x, y, shade(wood, ring + (r() - 0.5) * 0.06));
    }
}

/** Side texture: dirt with a coloured cap that drips down a few pixels. */
function cappedSide(px: Px, r: () => number, cap: RGB, capAmount: number) {
  noise(px, r, [134, 96, 67], 0.1);
  speckle(px, r, [100, 70, 48], 0.12);
  for (let x = 0; x < TILE; x++) {
    const depth = 2 + Math.floor(r() * 2.2) + (r() < 0.2 ? 1 : 0);
    for (let y = 0; y < depth; y++) px(x, y, shade(cap, 1 + (r() - 0.5) * 2 * capAmount));
  }
}

const TILES: Record<string, (px: Px, r: () => number) => void> = {
  grass_top: (px, r) => { noise(px, r, [96, 158, 54], 0.13); speckle(px, r, [74, 128, 40], 0.18); speckle(px, r, [124, 184, 70], 0.08); },
  grass_side: (px, r) => cappedSide(px, r, [96, 158, 54], 0.12),
  dirt: (px, r) => { noise(px, r, [134, 96, 67], 0.1); speckle(px, r, [100, 70, 48], 0.14); speckle(px, r, [160, 122, 88], 0.06); },
  stone: (px, r) => { noise(px, r, [126, 126, 128], 0.07); speckle(px, r, [104, 104, 106], 0.16); speckle(px, r, [146, 146, 148], 0.07); },
  cobble: (px, r) => voronoi(px, r, 8, [[130, 130, 130], [112, 112, 112], [150, 150, 150]], [66, 66, 68], 1.1),
  sand: (px, r) => { noise(px, r, [222, 210, 164], 0.05); speckle(px, r, [200, 186, 140], 0.14); },
  sandstone_top: (px, r) => { noise(px, r, [218, 205, 156], 0.035); speckle(px, r, [204, 190, 142], 0.08, 0.03); },
  sandstone_side: (px, r) => {
    noise(px, r, [216, 203, 154], 0.04);
    for (let x = 0; x < TILE; x++) {
      px(x, 0, [230, 219, 172]); px(x, 1, [226, 214, 166]); px(x, 2, [206, 192, 144]);
      if (r() < 0.6) px(x, 7, [204, 190, 142]);
      px(x, 12, [206, 192, 144]); px(x, 13, [198, 184, 136]);
      px(x, 14, [192, 178, 130]); px(x, 15, [186, 172, 126]);
    }
  },
  sandstone_cut: (px, r) => { noise(px, r, [218, 205, 156], 0.035); frame(px, [198, 184, 136]); },
  planks: (px, r) => planks(px, r, [168, 134, 82], [110, 84, 50]),
  log_side: (px, r) => barkSide(px, r, [104, 82, 52]),
  log_top: (px, r) => logTop(px, r, [178, 144, 92], [104, 82, 52]),
  leaves: (px, r) => {
    for (let y = 0; y < TILE; y++)
      for (let x = 0; x < TILE; x++) {
        if (r() < 0.16) px(x, y, [0, 0, 0], 0);
        else px(x, y, shade([62, 128, 40], 0.7 + r() * 0.5));
      }
  },
  bricks: (px, r) => bricksPattern(px, r, [152, 76, 58], [178, 168, 156], 4, 8),
  stone_bricks: (px, r) => bricksPattern(px, r, [124, 124, 126], [84, 84, 86], 8, 16),
  glass: (px, r) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(x, y, [0, 0, 0], 0);
    frame(px, [214, 232, 238]);
    for (let i = 0; i < 4; i++) { px(3 + i, 6 - i, [240, 250, 255]); px(9 + i, 12 - i, [240, 250, 255]); }
    void r;
  },
  terracotta: (px, r) => noise(px, r, [162, 86, 40], 0.05),
  terracotta_light: (px, r) => noise(px, r, [210, 180, 160], 0.04),
  terracotta_red: (px, r) => noise(px, r, [146, 62, 46], 0.05),
  crate: (px, r) => {
    planks(px, r, [186, 150, 96], [132, 100, 60]);
    frame(px, [110, 80, 44], 2);
    for (let i = 2; i < TILE - 2; i++) { px(i, i, [120, 88, 50]); px(i, TILE - 1 - i, [120, 88, 50]); }
    px(2, 2, [70, 70, 74]); px(13, 2, [70, 70, 74]); px(2, 13, [70, 70, 74]); px(13, 13, [70, 70, 74]);
  },
  wool_red: (px, r) => { noise(px, r, [166, 42, 36], 0.08); speckle(px, r, [138, 30, 26], 0.2); },
  wool_blue: (px, r) => { noise(px, r, [52, 62, 168], 0.08); speckle(px, r, [40, 46, 136], 0.2); },
  gravel: (px, r) => voronoi(px, r, 14, [[132, 126, 124], [104, 98, 96], [150, 140, 134], [118, 104, 96]], [88, 82, 80], 0.7),
  metal: (px, r) => {
    for (let y = 0; y < TILE; y++) {
      const band = 1 + Math.sin(y * 1.3) * 0.025;
      for (let x = 0; x < TILE; x++) px(x, y, shade([198, 200, 206], band + (r() - 0.5) * 0.04));
    }
    frame(px, [150, 152, 158]);
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) { px(x, y, [120, 122, 128]); px(x + 1, y + 1, [226, 228, 232]); }
  },
  lamp: (px, r) => {
    voronoi(px, r, 9, [[252, 214, 112], [246, 196, 92], [255, 232, 150]], [196, 138, 58], 0.9);
  },
  bedrock: (px, r) => { noise(px, r, [74, 74, 74], 0.25); speckle(px, r, [30, 30, 30], 0.25); },
  snow: (px, r) => { noise(px, r, [242, 248, 252], 0.025); speckle(px, r, [222, 234, 244], 0.1, 0.02); },
  snow_side: (px, r) => cappedSide(px, r, [242, 248, 252], 0.02),
  ice: (px, r) => {
    noise(px, r, [150, 186, 250], 0.04);
    for (let i = 0; i < 5; i++) { px(2 + i, 9 - i, [200, 222, 255]); px(8 + i, 14 - i, [196, 218, 255]); }
  },
  spruce_planks: (px, r) => planks(px, r, [112, 82, 50], [70, 50, 28]),
  spruce_log_side: (px, r) => barkSide(px, r, [62, 42, 22]),
  spruce_log_top: (px, r) => logTop(px, r, [118, 88, 54], [62, 42, 22]),
  concrete: (px, r) => noise(px, r, [206, 212, 214], 0.02),
  concrete_gray: (px, r) => noise(px, r, [120, 122, 118], 0.03),
  concrete_dark: (px, r) => noise(px, r, [46, 48, 54], 0.05),
};

export const TILE_NAMES = Object.keys(TILES);

export interface Atlas {
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  /** [u0, v0, u1, v1] with v0 at the bottom of the tile. */
  uv(tile: string): [number, number, number, number];
  /** Average colour of a tile, for particles. */
  color(tile: string): THREE.Color;
}

export function createAtlas(): Atlas {
  const canvas = document.createElement('canvas');
  canvas.width = COLS * TILE;
  canvas.height = ROWS * TILE;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(canvas.width, canvas.height);
  const index = new Map<string, number>();
  const avg = new Map<string, THREE.Color>();

  TILE_NAMES.forEach((name, i) => {
    index.set(name, i);
    const ox = (i % COLS) * TILE, oy = Math.floor(i / COLS) * TILE;
    let sr = 0, sg = 0, sb = 0, n = 0;
    const px: Px = (x, y, c, a = 255) => {
      const o = ((oy + y) * canvas.width + ox + x) * 4;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = a;
    };
    TILES[name](px, mulberry32(i * 7919 + 17));
    for (let y = 0; y < TILE; y++)
      for (let x = 0; x < TILE; x++) {
        const o = ((oy + y) * canvas.width + ox + x) * 4;
        if (img.data[o + 3] > 0) { sr += img.data[o]; sg += img.data[o + 1]; sb += img.data[o + 2]; n++; }
      }
    avg.set(name, new THREE.Color(sr / n / 255, sg / n / 255, sb / n / 255).convertSRGBToLinear());
  });
  ctx.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;

  const eps = 0.02 / canvas.width;
  return {
    texture,
    canvas,
    uv(tile) {
      const i = index.get(tile) ?? 0;
      const c = i % COLS, r = Math.floor(i / COLS);
      return [c / COLS + eps, 1 - (r + 1) / ROWS + eps, (c + 1) / COLS - eps, 1 - r / ROWS - eps];
    },
    color(tile) {
      return avg.get(tile) ?? new THREE.Color(0.5, 0.5, 0.5);
    },
  };
}

export { mix };
