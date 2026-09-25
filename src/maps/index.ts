import type { MapId } from '../net/protocol';
import { arena } from './arena';
import { dunes } from './dunes';
import { frostbite } from './frostbite';
import type { MapDef } from './types';

export const MAPS: Record<MapId, MapDef> = { dunes, frostbite, arena };

export const MAP_LIST: MapId[] = ['dunes', 'frostbite', 'arena'];
