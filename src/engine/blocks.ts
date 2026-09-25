// Block registry. A block id is one byte in the voxel grid; 0 is air.

export type Shape = 'full' | 'slab';

export interface BlockDef {
  name: string;
  /** Atlas tile names for the top, side and bottom faces. */
  top: string;
  side: string;
  bottom: string;
  shape: Shape;
  /** Collides with players and grenades. */
  solid: boolean;
  /** Rendered with alpha cutout; neighbours still draw the face behind it. */
  transparent: boolean;
  /** Not drawn at all (map boundary walls). */
  invisible: boolean;
  /** Bullets lose this much damage fraction per block crossed; 1 = stops bullets. */
  penetration: number;
  /** Footstep / impact material. */
  sound: 'stone' | 'wood' | 'sand' | 'grass' | 'metal' | 'glass' | 'snow';
}

const defs: BlockDef[] = [];
const byName = new Map<string, number>();

function add(name: string, tiles: string | [string, string, string], opts: Partial<BlockDef> = {}): number {
  const [top, side, bottom] = typeof tiles === 'string' ? [tiles, tiles, tiles] : tiles;
  const id = defs.length;
  defs.push({
    name, top, side, bottom,
    shape: 'full', solid: true, transparent: false, invisible: false,
    penetration: 1, sound: 'stone',
    ...opts,
  });
  byName.set(name, id);
  return id;
}

export const AIR = add('air', 'stone', { solid: false, invisible: true, penetration: 0 });
export const B = {
  grass: add('grass', ['grass_top', 'grass_side', 'dirt'], { sound: 'grass' }),
  dirt: add('dirt', 'dirt', { sound: 'grass' }),
  stone: add('stone', 'stone'),
  cobble: add('cobble', 'cobble'),
  sand: add('sand', 'sand', { sound: 'sand' }),
  sandstone: add('sandstone', ['sandstone_top', 'sandstone_side', 'sandstone_top']),
  cutSandstone: add('cut_sandstone', ['sandstone_top', 'sandstone_cut', 'sandstone_top']),
  smoothSandstone: add('smooth_sandstone', 'sandstone_top'),
  planks: add('planks', 'planks', { sound: 'wood', penetration: 0.35 }),
  log: add('log', ['log_top', 'log_side', 'log_top'], { sound: 'wood', penetration: 0.6 }),
  leaves: add('leaves', 'leaves', { transparent: true, sound: 'grass', penetration: 0.1 }),
  bricks: add('bricks', 'bricks'),
  stoneBricks: add('stone_bricks', 'stone_bricks'),
  glass: add('glass', 'glass', { transparent: true, sound: 'glass', penetration: 0.05 }),
  terracotta: add('terracotta', 'terracotta'),
  terracottaLight: add('terracotta_light', 'terracotta_light'),
  terracottaRed: add('terracotta_red', 'terracotta_red'),
  crate: add('crate', 'crate', { sound: 'wood', penetration: 0.4 }),
  woolRed: add('wool_red', 'wool_red', { sound: 'grass', penetration: 0.3 }),
  woolBlue: add('wool_blue', 'wool_blue', { sound: 'grass', penetration: 0.3 }),
  gravel: add('gravel', 'gravel', { sound: 'sand' }),
  metal: add('metal', 'metal', { sound: 'metal', penetration: 0.8 }),
  lamp: add('lamp', 'lamp', { sound: 'glass' }),
  bedrock: add('bedrock', 'bedrock'),
  snow: add('snow', 'snow', { sound: 'snow' }),
  snowGrass: add('snow_grass', ['snow', 'snow_side', 'dirt'], { sound: 'snow' }),
  ice: add('ice', 'ice', { sound: 'glass' }),
  sprucePlanks: add('spruce_planks', 'spruce_planks', { sound: 'wood', penetration: 0.35 }),
  spruceLog: add('spruce_log', ['spruce_log_top', 'spruce_log_side', 'spruce_log_top'], { sound: 'wood', penetration: 0.6 }),
  concrete: add('concrete', 'concrete'),
  concreteGray: add('concrete_gray', 'concrete_gray'),
  concreteDark: add('concrete_dark', 'concrete_dark'),
  barrier: add('barrier', 'stone', { invisible: true }),
  // Half-height blocks used as stairs: players step up 0.5 without jumping.
  sandstoneSlab: add('sandstone_slab', ['sandstone_top', 'sandstone_side', 'sandstone_top'], { shape: 'slab' }),
  plankSlab: add('plank_slab', 'planks', { shape: 'slab', sound: 'wood', penetration: 0.35 }),
  stoneBrickSlab: add('stone_brick_slab', 'stone_bricks', { shape: 'slab' }),
  cobbleSlab: add('cobble_slab', 'cobble', { shape: 'slab' }),
  spruceSlab: add('spruce_slab', 'spruce_planks', { shape: 'slab', sound: 'wood', penetration: 0.35 }),
  concreteSlab: add('concrete_slab', 'concrete', { shape: 'slab' }),
};

export const BLOCKS: readonly BlockDef[] = defs;
export const blockId = (name: string): number => byName.get(name) ?? AIR;

/** Height of a block's collision box inside its cell (0 for non-solid). */
export function blockHeight(id: number): number {
  const d = defs[id];
  if (!d || !d.solid) return 0;
  return d.shape === 'slab' ? 0.5 : 1;
}
