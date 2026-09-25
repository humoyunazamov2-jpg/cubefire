import type { MapId } from '../net/protocol';
import { testMap } from './testMap';
import type { MapDef } from './types';

// Real maps arrive in Part 4; until then every id builds the test scene.
export const MAPS: Record<MapId, MapDef> = {
  dunes: { ...testMap, id: 'dunes' },
  frostbite: { ...testMap, id: 'frostbite' },
  arena: { ...testMap, id: 'arena' },
};

export const MAP_LIST: MapId[] = ['dunes', 'frostbite', 'arena'];
