import { defineShared } from '@platform';
import meta from './meta';
import * as island from './island/def';
import * as creatures from './creatures/def';
import * as survival from './survival/def';
import * as building from './building/def';

/**
 * What the server and every screen agree on, put together from the game's parts: the island's
 * world and blocks, the builders' blocks, how survivors move, and the mounts (vehicles).
 */
export const shared = defineShared({
  ...meta,
  world: island.world,
  blocks: { ...island.blocks, ...building.blocks },
  player: { health: 20, hotbar: 'items', fallDamage: true, pvp: false, movement: survival.movement },
  vehicles: creatures.vehicles,
});
