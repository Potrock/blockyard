import { defineShared } from '@platform';
import { BEDWARS_ATLAS, Skin } from './art';
import { buildMap } from './map';
import meta from './meta';

/** The islands (every screen builds their blocks too), and where the teams' beds, spawns and generators are. */
export const map = buildMap();
const RED = map.teams[0];

/**
 * The block items: the block each places (the server's building rules) and shows as (each
 * screen's look: in the hotbar, in hand, dropped). Each team has its wool.
 */
export const BLOCK_ITEMS: Record<string, string> = {
  wool_red: 'red_wool',
  wool_blue: 'blue_wool',
  wool_green: 'green_wool',
  wool_yellow: 'yellow_wool',
  planks: 'oak_planks',
  end_stone: 'end_stone',
  obsidian: 'obsidian',
};

/** The islands in the void and the player (a red skin until they take a team). */
export const shared = defineShared({
  ...meta,
  world: {
    terrain: 'void',
    structures: map.blueprints,
    spawn: RED.spawn,
    spawnYaw: RED.spawnYaw,
    time: 0.36,
    freezeTime: true,
    viewDistance: 8,
  },
  player: {
    hotbar: 'items',
    health: 20,
    regen: { delay: 5, perSecond: 0.5 },
    fallDamage: true,
    skin: [Skin.red[0], Skin.red[1]],
    skinAtlas: BEDWARS_ATLAS,
    // Players fight each other (swords, bows, fireballs).
    pvp: true,
  },
});
