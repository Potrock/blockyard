import { defineServer } from '@platform';
import { shared } from '../../src/games/blocktaceous/shared';
import { addXp, canAfford, containerContents, count, give, harvestTool, levelOf, openContainer, openStation, registerRecipes, removeContainer, roomFor, setBedSpawn, take } from '../../src/games/blocktaceous/survival/bag';
import { craft, knows, learn, recipeOf, sparksLeft } from '../../src/games/blocktaceous/survival/craft';
import { MEALS, sparksAt, xpForLevel } from '../../src/games/blocktaceous/survival/data';
import { itemKits } from '../../src/games/blocktaceous/survival/kits';
import { survival } from '../../src/games/blocktaceous/survival/rules';
import { JOURNAL, journalActions } from '../../src/games/blocktaceous/survival/screen';
import { forget, save, survivorOf } from '../../src/games/blocktaceous/survival/state';
import { check, launch } from './_harness';

/**
 * The survivor: hunger and thirst run down and starve; food restores; the pack takes what the
 * belt can't and respects stack sizes; experience levels up and recipes are learned, made (by
 * hand, and at a station only) and paid for; dying leaves a lost pack to take back and waking
 * works; and a survivor kept in the store comes back as they were.
 *
 * Only the survival part runs here (with the game's shared definition and item kits), so another
 * part's work in progress can't break it.
 */
export default function blocktaceousSurvival() {
  const h = launch(
    defineServer(shared, {
      items: itemKits,
      setup: (game) => survival.setup?.(game),
      start: (game) => survival.start?.(game),
      update: (game, dt) => survival.update?.(game, dt),
    }),
    { seed: 11, radius: 2 },
  );
  const game = h.ctx;
  const player = game.player;
  const s = survivorOf(player);
  h.run(0.5);

  // ---- The pack ----
  check(give(player, 'stone_pick', 11) === 11, 'eleven picks are kept');
  check(player.inventory.slots.filter((x) => x?.item === 'stone_pick').length === 9, `tools fill the belt first: ${player.inventory.slots.map((x) => x?.item)}`);
  check(s.bag.filter((x) => x?.item === 'stone_pick').length === 2, 'the picks the belt has no room for go to the pack');
  check(count(player, 'stone_pick') === 11, 'count sees belt and pack together');
  check(give(player, 'wood', 250) === 250, 'wood is kept');
  const wood = s.bag.filter((x) => x?.item === 'wood').map((x) => x!.count);
  check(wood.join() === '100,100,50', `wood stacks to a hundred a slot: ${wood}`);
  check(take(player, 'wood', 120) && count(player, 'wood') === 130, `take across stacks: ${count(player, 'wood')}`);
  check(!take(player, 'wood', 131) && count(player, 'wood') === 130, 'take refuses more than there is, and takes nothing');
  check(take(player, 'stone_pick', 10) && count(player, 'stone_pick') === 1, 'take across the pack and the belt');
  check(player.inventory.count('stone_pick') === 1, 'the pack is emptied before the belt');
  check(canAfford(player, { wood: 130, stone_pick: 1 }) && !canAfford(player, { wood: 131 }), 'canAfford');
  check(roomFor(player, 'wood') > 3000, `room for more wood: ${roomFor(player, 'wood')}`);
  check(harvestTool('metal_pick').kind === 'pick' && harvestTool('metal_pick').tier === 2 && harvestTool('wood').kind === 'hand' && harvestTool(null).tier === 0, 'harvestTool');
  // A full inventory spills at their feet.
  const before = h.sim.items.frame().length;
  const kept = give(player, 'stone_hatchet', 60);
  check(kept === 8 + 38 && h.sim.items.frame().length > before, `what doesn't fit drops: kept ${kept}`);
  take(player, 'stone_hatchet', kept);
  game.items.clearPickups();
  // Too much to carry slows them, through the stamina ability.
  give(player, 'metal_ingot', 300);
  check(player.abilities.stamina.load < 1, `overloaded: ${s.weight} of ${s.limit}`);
  take(player, 'metal_ingot', 300);
  check(player.abilities.stamina.load === 1, 'unloaded again');

  // ---- Hunger and thirst ----
  const hunger0 = s.hunger;
  h.run(5);
  check(s.hunger < hunger0 && s.thirst < 100, `hunger and thirst fall: ${s.hunger}, ${s.thirst}`);
  s.hunger = 0.01;
  s.thirst = 0.01;
  const health0 = player.health;
  h.run(10);
  check(s.hunger === 0 && player.health < health0, `starving hurts: ${player.health} of ${health0}`);
  check(player.abilities.stamina.cap < 100, 'and leaves less breath');
  // Eating, the way a player does: the food in hand, the right button held.
  give(player, 'cooked_meat', 2);
  const slot = player.inventory.slots.findIndex((x) => x?.item === 'cooked_meat');
  check(slot >= 0, 'food goes to the belt');
  player.inventory.select(slot);
  h.run(MEALS.cooked_meat.time + 0.5, { pilot: () => ({ buttons: 4 }) });
  check(s.hunger >= 29 && count(player, 'cooked_meat') === 1, `eating restores hunger and uses one up: ${s.hunger}, ${count(player, 'cooked_meat')} left`);
  s.thirst = 80;
  s.hunger = 80;

  // ---- Experience, sparks, recipes ----
  check(levelOf(player) === 1 && sparksLeft(s) === 0, 'a new survivor is level 1');
  addXp(player, xpForLevel(6) + 1);
  check(levelOf(player) === 6 && sparksLeft(s) === sparksAt(6) && sparksAt(6) === 12, `experience levels up and brings sparks: level ${levelOf(player)}, ${sparksLeft(s)} sparks`);
  h.run(0.1);
  check(h.find('hud', 'banner').some((c) => c.args[0] === 'LEVEL 6'), `a level is announced: ${h.find('hud', 'banner').map((c) => c.args[0])}`);
  // A free recipe is known; one with a price is learned; one above their level can't be.
  check(knows(s, recipeOf('stone_pick')!), 'the first recipes are known');
  check(!knows(s, recipeOf('spear')!) && learn(player, 'spear') && knows(s, recipeOf('spear')!) && sparksLeft(s) === 11, 'a recipe is learned with a spark');
  check(!learn(player, 'metal_pick@smithy'), 'a recipe above their level is not');
  // Making takes the materials at once and the thing comes after its time.
  give(player, 'flint', 2);
  give(player, 'cordage', 1);
  check(craft(player, 'spear') && count(player, 'flint') === 0 && count(player, 'wood') === 126 && count(player, 'spear') === 0, 'crafting takes the materials');
  const xp0 = s.xp;
  h.run(2.5);
  check(count(player, 'spear') === 1 && s.xp > xp0, 'the spear is made, and it was worth experience');
  check(!craft(player, 'spear'), 'no materials, no spear');
  // Another part's recipes join the book.
  registerRecipes([{ item: 'saddle_small', needs: { hide: 5 }, level: 3, station: 'smithy' }]);
  check(recipeOf('saddle_small@smithy')?.cost === 1, 'registerRecipes fills in a cost');
  // A station's recipe only at the station.
  give(player, 'raw_meat', 2);
  check(!craft(player, 'cooked_meat@campfire'), 'no cooking without a campfire');
  openStation(player, 'campfire');
  h.run(0.1);
  check(s.ui.open && s.ui.station === 'campfire' && h.find('hud', 'widget').some((c) => c.args[0] === JOURNAL), 'the station opens the journal');
  check(craft(player, 'cooked_meat@campfire', 2), 'cooking at the campfire');
  h.run(9);
  check(count(player, 'cooked_meat') === 3 && count(player, 'raw_meat') === 0, `two cooked: ${count(player, 'cooked_meat')}`);
  journalActions.close(player, '');
  check(!s.ui.open && s.ui.station === null, 'closed');

  // ---- The journal's clicks ----
  journalActions.tab(player, 'pack');
  openContainer(player, 'box:test', 12);
  const from = `b${s.bag.findIndex((x) => x?.item === 'wood')}`;
  journalActions.slot(player, from);
  check(s.ui.sel === from, 'a click picks a slot up');
  journalActions.slot(player, 'c3');
  check(containerContents('box:test')[0]?.item === 'wood' && s.ui.sel === null, 'and the next puts it down, in the box');
  check(game.store.get('box:box:test') !== undefined, 'a container is kept in the game store');
  journalActions.takeall(player, '');
  check(containerContents('box:test').length === 0 && count(player, 'wood') === 126, 'take all');
  give(player, 'cloth_tunic', 1);
  journalActions.slot(player, `b${s.bag.findIndex((x) => x?.item === 'cloth_tunic')}`);
  journalActions.use(player, '');
  check(s.worn.body === 'cloth_tunic' && player.armor === 2 && count(player, 'cloth_tunic') === 0, `armour is worn: ${player.armor}`);
  journalActions.stowall(player, '');
  removeContainer('box:test', player.position);
  check(!s.ui.open && h.sim.items.frame().length > 0 && game.store.get('box:box:test') === undefined, 'a broken box spills what it held and is forgotten');
  game.items.clearPickups();
  give(player, 'wood', 40);

  // ---- The store ----
  s.hunger = 42;
  setBedSpawn(player, { x: 3, y: 70, z: 5 });
  const belt = player.inventory.slots.map((x) => (x ? `${x.item}:${x.count}` : '')).join();
  save(player, s);
  forget(player);
  player.inventory.clear();
  const back = survivorOf(player);
  check(back !== s && back.hunger === 42 && back.level === 6 && back.learned.has('spear') && back.worn.body === 'cloth_tunic', 'a survivor comes back from the store as they were');
  check(count(player, 'wood') === 40 && player.inventory.slots.map((x) => (x ? `${x.item}:${x.count}` : '')).join() === belt, 'with their pack and their belt');
  check(back.bed?.x === 3 && back.bed.y === 70, 'and their bed');
  setBedSpawn(player, null);

  // ---- Dying ----
  h.run(1.2);
  const carried = count(player, 'wood');
  const at = { ...player.position };
  player.damage(1000);
  check(!player.alive, 'dead');
  h.run(0.1);
  check(count(player, 'wood') === 0 && back.worn.body === null && back.cache !== null, 'everything is left in a lost pack');
  check(game.store.keys('lostpack:').length === 1 && h.sim.items.frame().some((p) => p.item === 'lost_pack'), 'which lies in the world and is kept');
  h.run(6);
  check(player.alive && Math.round(back.hunger as number) === 60, 'they wake');
  // Back at the pack: E opens it beside their own, and taking everything clears it away.
  player.teleport(at);
  h.step(1 / 60, { pressed: ['KeyE'], down: ['KeyE'] });
  check(back.ui.open && back.ui.container === `pack-${back.cache}`, 'E opens the lost pack');
  journalActions.takeall(player, '');
  check(count(player, 'wood') === carried && count(player, 'cloth_tunic') === 1, `everything comes back: ${count(player, 'wood')} wood`);
  check(back.cache === null && game.store.keys('lostpack:').length === 0 && !h.sim.items.frame().some((p) => p.item === 'lost_pack'), 'and the empty pack is gone');
}
