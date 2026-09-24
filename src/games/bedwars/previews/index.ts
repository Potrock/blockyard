import { defineGame, Models } from '@platform';
import { buildMap } from '../map';
import { BEDWARS_ATLAS, Skin, Sprite, botSword, paintBedwarsAtlas } from '../art';

const map = buildMap();

/** Dev preview: the Bed Wars map in the void. Hang in the air; move with player.teleport + debugView (freeze again after). */
const bedwarsMap = defineGame({
  id: 'bedwars-map',
  title: 'Bed Wars map (dev preview)',
  world: { terrain: 'void', structures: map.blueprints, spawn: { x: map.center.x, y: map.center.y + 40, z: map.center.z + 60 }, time: 0.42, freezeTime: true },
  player: { build: true, fly: true, health: false, hotbar: 'blocks' },
  start: (game) => game.player.freeze(true),
});

/** Dev preview: the Bed Wars skins (standing in a row) and item sprites (in the hotbar). */
const bedwarsArt = defineGame({
  id: 'bedwars-art',
  title: 'Bed Wars art (dev preview)',
  world: { terrain: 'flat', flatHeight: 64, spawn: { x: 0.5, y: 65, z: 8.5 }, time: 0.42, freezeTime: true },
  player: { health: false, hotbar: 'items' },
  setup(game) {
    const a = paintBedwarsAtlas();
    game.items.atlas(BEDWARS_ATLAS, { width: a.width, height: a.height, pixels: a.albedo, emissive: a.emissive });
    for (const [name, skin] of Object.entries(Skin)) {
      game.entities.define(name, {
        name,
        model: Models.humanoid({ skin: [skin[0], skin[1]], atlas: BEDWARS_ATLAS, extras: name === 'shopkeeper' ? [] : [botSword(skin)] }),
        hitbox: { width: 0.6, height: 1.9 },
        health: 20,
        speed: 0,
      });
    }
    for (const [id, icon] of Object.entries(Sprite)) game.items.define(id, { kind: 'misc', name: id, icon });
  },
  start(game) {
    game.player.freeze(true);
    Object.keys(Skin).forEach((name, i) => game.entities.spawn(name, { x: -5 + i * 2.5, y: 65, z: 2.5 }, { yaw: 0 }));
    for (const id of Object.keys(Sprite).slice(0, 9)) game.player.inventory.give(id);
  },
});

export const previews = [bedwarsMap, bedwarsArt];
