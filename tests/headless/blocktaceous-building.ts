import type { Player, Vec3 } from '../../src/platform';
import { calls } from '../../src/games/blocktaceous/building/adapters';
import { VARIANTS_USED, blocks, structureTier } from '../../src/games/blocktaceous/building/def';
import { recipes } from '../../src/games/blocktaceous/building/recipes';
import { canBuild, loadNow, ownerKey, ownerOf, regrowAll, regrowPending, sameTribe, saveNow, tribeCommand, tribeOf } from '../../src/games/blocktaceous/building/rules';
import { provoke } from '../../src/games/blocktaceous/creatures/ai';
import { spawnAnimal } from '../../src/games/blocktaceous/creatures/population';
import { ITEMS } from '../../src/games/blocktaceous/items';
import { bedOf, closeScreens, containerContents, count } from '../../src/games/blocktaceous/survival/bag';
import { container } from '../../src/games/blocktaceous/survival/pack';
import { survivorOf } from '../../src/games/blocktaceous/survival/state';
import { check, launch } from './_harness';

/**
 * Blocktaceous' gathering and building: what a tree and a rock give by hand and with tools, a
 * felled tree and its regrowth, a wall that's its builder's alone, a door only its owner opens,
 * stations calling through to the survival part, ownership kept through `game.store`, a gate, a
 * storage box that spills, a bed, tribes that share all of it, and what wild animals do to walls.
 */
export default function blocktaceousBuilding() {
  check(VARIANTS_USED <= 40, `the building blocks use ${VARIANTS_USED} variants of 40`);
  check(Object.keys(blocks).every((name) => name.startsWith('bt_')), 'every building block is named bt_');
  for (const r of recipes) check(r.item in ITEMS && Object.keys(r.needs).every((n) => n in ITEMS), `${r.item}'s recipe names real items`);
  check(structureTier('bt_thatch_wall') === 0 && structureTier('bt_wood_door[facing=east]') === 1 && structureTier('bt_stone_wall') === 2 && structureTier('bt_metal_wall') === 3 && structureTier('stone') === null, 'tiers');

  const h = launch('blocktaceous', { seed: 7, radius: 2 });
  const game = h.ctx;
  const world = game.world;
  const me = game.player;
  h.run(0.5);

  // A yard to work in: a plank floor (nothing to harvest) and clear air over it, away from the terrain's surprises.
  const ox = Math.floor(me.position.x);
  const oy = Math.floor(me.position.y) + 12;
  const oz = Math.floor(me.position.z);
  for (let x = ox - 5; x <= ox + 5; x++)
    for (let z = oz - 5; z <= oz + 5; z++) {
      world.setBlock(x, oy - 1, z, 'oak_planks');
      for (let y = oy; y < oy + 9; y++) world.setBlock(x, y, z, 'air');
    }
  const stand = { x: ox + 0.5, y: oy, z: oz + 0.5 };
  const reset = (p: Player = me, at: Vec3 = stand) => {
    p.teleport(at);
    p.health = p.maxHealth;
  };
  reset();
  // Tools go in the last slot, so what's gathered (which fills from the first) never lands under them.
  me.inventory.select(8);
  h.run(0.2);

  const tool = (item: string | null) => {
    if (item && !game.items.get(item)) game.items.define(item, { kind: 'misc', name: item });
    me.inventory.set(me.inventory.selected, item ? { item, count: 1 } : null);
  };
  const aim = (at: Vec3) => {
    const e = me.eye;
    const dx = at.x + 0.5 - e.x;
    const dy = at.y + 0.5 - e.y;
    const dz = at.z + 0.5 - e.z;
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  };
  const name = (at: Vec3) => world.blockName(world.getBlock(at.x, at.y, at.z));
  /** Hold left-click on a block for up to `seconds`, stopping once it's something else. */
  const mine = (at: Vec3, seconds: number, until?: () => boolean) => {
    const was = name(at);
    h.step(1 / 60, { buttons: 1, clicked: 1, ...aim(at) });
    h.run(seconds, { pilot: () => ({ buttons: 1, ...aim(at) }), until: until ?? (() => name(at) !== was) });
  };
  const have = (item: string) => count(me, item);

  // ---- A log by hand, then one with a hatchet ----
  const log = { x: ox + 2, y: oy + 1, z: oz };
  world.setBlock(log.x, log.y, log.z, 'oak_log');
  tool(null);
  mine(log, 5);
  check(name(log) === 'air', 'a log comes away by hand');
  const handWood = have('wood');
  check(have('thatch') >= 1 && handWood >= 1, `punching a tree gives thatch and a little wood (${have('thatch')}, ${handWood})`);

  world.setBlock(log.x, log.y, log.z, 'oak_log');
  tool('stone_hatchet');
  const t0 = h.time;
  mine(log, 5);
  const hatchetWood = have('wood') - handWood;
  check(name(log) === 'air' && hatchetWood > handWood, `a hatchet gets more wood (${hatchetWood} against ${handWood})`);
  check(h.time - t0 < 2, 'and gets it faster');

  // ---- Stone: a loose one by hand (the rock stays), a real yield with a pick ----
  const rock = { x: ox + 2, y: oy + 1, z: oz };
  world.setBlock(rock.x, rock.y, rock.z, 'stone');
  tool(null);
  mine(rock, 4, () => have('stone') > 0);
  check(have('stone') === 1 && name(rock) === 'stone', `by hand a rock gives one stone and stays (${have('stone')}, ${name(rock)})`);
  mine(rock, 0.6);
  check(have('stone') === 1, 'and is picked clean for a while');
  tool('stone_pick');
  mine(rock, 4);
  check(name(rock) === 'air' && have('stone') >= 3, `a pick takes the rock and gets more (${have('stone')})`);

  // Ore wants a pick; crystal a metal one (by the island's names, if it has defined them yet, else the built-in stand-ins).
  const ore = world.blockInfo('metal_rock') ? 'metal_rock' : 'iron_ore';
  world.setBlock(rock.x, rock.y, rock.z, ore);
  tool('stone_hatchet');
  mine(rock, 0.5);
  check(name(rock) === ore && have('metal_ore') === 0, 'ore needs a pick');
  const said = (method: string) => h.calls.filter((c) => c.target === 'message' && c.method === method).map((c) => c.args[0] as { text?: string; items?: [string, number, string][] });
  check(said('bt.hint').some((m) => m.text === 'Needs a pick'), 'and their screen is told why');
  check(said('bt.yield').some((m) => m.items?.some(([item, n, label]) => item === 'wood' && n >= 3 && label === 'Wood')), 'as it was told what each harvest gave');
  tool('stone_pick');
  mine(rock, 4);
  check(name(rock) === 'air' && have('metal_ore') >= 1, 'a pick gets metal ore');
  const gem = world.blockInfo('crystal_rock') ? 'crystal_rock' : 'diamond_ore';
  world.setBlock(rock.x, rock.y, rock.z, gem);
  mine(rock, 0.5);
  check(name(rock) === gem, 'crystal needs a metal pick');
  tool('metal_pick');
  mine(rock, 4);
  check(name(rock) === 'air' && have('crystal') >= 2, 'a metal pick gets crystal');

  // ---- A whole tree, cut at the foot, comes down; later it's back ----
  regrowAll(game);
  const trunk = [1, 2, 3, 4].map((dy) => ({ x: ox + 2, y: oy + dy - 1, z: oz }));
  for (const at of trunk) world.setBlock(at.x, at.y, at.z, 'oak_log');
  const crown: Vec3[] = [];
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = 3; dy <= 4; dy++) {
        const at = { x: ox + 2 + dx, y: oy + dy, z: oz + dz };
        if (name(at) !== 'air') continue;
        world.setBlock(at.x, at.y, at.z, 'oak_leaves');
        crown.push(at);
      }
  tool('stone_hatchet');
  const before = have('wood');
  mine(trunk[0], 4);
  check(trunk.every((at) => name(at) === 'air'), 'cut at the foot, the whole trunk comes down');
  check(crown.every((at) => name(at) === 'air'), 'and its crown with it');
  check(have('wood') - before >= 12, `each log gives its wood (${have('wood') - before})`);
  check(regrowPending() >= trunk.length + crown.length, 'the tree is remembered');
  h.run(2.2);
  check(name(trunk[0]) === 'air', "nothing grows back while it's fresh, with someone standing there");
  saveNow(game);
  loadNow(game);
  check(regrowPending() >= trunk.length + crown.length, 'regrowth survives the store');
  regrowAll(game);
  check(trunk.every((at) => name(at) === 'oak_log') && crown.every((at) => name(at) === 'oak_leaves') && regrowPending() === 0, 'the tree grows back whole');
  for (const at of [...trunk, ...crown]) world.setBlock(at.x, at.y, at.z, 'air');

  // ---- A wall belongs to whoever placed it ----
  const floor = { x: ox + 2, y: oy - 1, z: oz };
  const wall = { x: ox + 2, y: oy, z: oz };
  me.inventory.set(me.inventory.selected, { item: 'bt_wood_wall', count: 3 });
  h.run(0.3, { pilot: () => ({ ...aim(floor) }) });
  h.step(1 / 60, { clicked: 4, buttons: 4, ...aim(floor) });
  h.run(0.1);
  check(name(wall) === 'bt_wood_wall', `right-click places the wall (${name(wall)})`);
  check(me.inventory.held?.count === 2, 'and takes one from the hand');
  check(ownerOf(wall) === ownerKey(me) && canBuild(me, wall), 'the wall is its placer\'s');

  const bob = game.bots.add('Bob');
  const bobAt = { x: ox + 0.5, y: oy, z: oz + 1.5 };
  reset(bob, bobAt);
  h.run(0.3);
  check(!canBuild(bob, wall) && !canBuild(bob, { x: wall.x + 2, y: wall.y, z: wall.z }), "someone else can't build on it or beside it");
  check(canBuild(bob, { x: wall.x + 6, y: wall.y, z: wall.z }), 'but may build further off');
  bob.controls.lookAt({ x: wall.x + 0.5, y: wall.y + 0.5, z: wall.z + 0.5 });
  bob.controls.button(0);
  h.run(2);
  bob.controls.button(0, false);
  check(name(wall) === 'bt_wood_wall', "and can't break it");

  // ---- A door opens for its owner only ----
  const door = { x: ox + 2, y: oy, z: oz + 1 };
  world.placeBlock(door.x, door.y, door.z, 'bt_wood_door[facing=west]', { by: me });
  world.placeBlock(door.x, door.y + 1, door.z, 'bt_wood_door[facing=west]', { by: me });
  const facing = (at: Vec3) => world.blockInfo(world.getBlock(at.x, at.y, at.z))?.state.facing;
  check(facing(door) === 'west' && ownerOf(door) === ownerKey(me), `a door placed (${facing(door)})`);
  bob.controls.lookAt({ x: door.x + 0.9, y: door.y + 0.6, z: door.z + 0.5 });
  h.run(0.2);
  bob.controls.press('KeyE');
  h.run(0.2);
  check(facing(door) === 'west', "someone else can't open it");
  const doorAim = () => {
    const e = me.eye;
    const dx = door.x + 0.92 - e.x;
    const dy = door.y + 0.6 - e.y;
    const dz = door.z + 0.5 - e.z;
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  };
  h.run(0.2, { pilot: doorAim });
  h.step(1 / 60, { pressed: ['KeyE'], ...doorAim() });
  h.run(0.1, { pilot: doorAim });
  check(facing(door) === 'south' && facing({ ...door, y: door.y + 1 }) === 'south', `its owner opens both leaves (${facing(door)})`);

  // ---- Stations call through to the survival part ----
  const opened: string[] = [];
  const real = calls.openStation;
  calls.openStation = (player, station) => {
    opened.push(`${player.name}:${station}`);
    real(player, station);
  };
  const bench = { x: ox + 2, y: oy, z: oz - 1 };
  for (const station of ['campfire', 'mortar', 'workbench', 'forge', 'smithy']) {
    world.setBlock(bench.x, bench.y, bench.z, 'air');
    world.placeBlock(bench.x, bench.y, bench.z, `bt_${station}`, { by: me });
    check(name(bench) === `bt_${station}`, `a ${station} placed`);
    h.run(0.1, { pilot: () => aim(bench) });
    h.step(1 / 60, { pressed: ['KeyE'], ...aim(bench) });
    h.run(0.05, { pilot: () => aim(bench) });
    check(opened.at(-1) === `${me.name}:${station}`, `E on the ${station} opens its crafting (${opened.join(' ')})`);
  }
  bob.controls.lookAt({ x: bench.x + 0.5, y: bench.y + 0.4, z: bench.z + 0.5 });
  h.run(0.2);
  bob.controls.press('KeyE');
  h.run(0.2);
  check(opened.length === 5, "someone else's E doesn't");
  calls.openStation = real;

  // ---- Ownership goes through the store and comes back ----
  saveNow(game);
  check(game.store.keys('bt.own:').length >= 1, 'ownership is kept by column');
  loadNow(game);
  check(ownerOf(wall) === ownerKey(me) && ownerOf(door) === ownerKey(me) && !canBuild(bob, wall), 'ownership survives a store round trip');

  // ---- A gate: every joined gate opens and shuts as one, for its owner ----
  const use = (at: Vec3) => {
    h.run(0.1, { pilot: () => aim(at) });
    h.step(1 / 60, { pressed: ['KeyE'], ...aim(at) });
    h.run(0.05, { pilot: () => aim(at) });
  };
  const bobUses = (at: Vec3) => {
    bob.controls.lookAt({ x: at.x + 0.5, y: at.y + 0.4, z: at.z + 0.5 });
    h.run(0.2);
    bob.controls.press('KeyE');
    h.run(0.2);
  };
  world.setBlock(bench.x, bench.y, bench.z, 'air');
  const gate = { x: ox + 2, y: oy, z: oz - 1 };
  const gate2 = { x: ox + 2, y: oy, z: oz - 2 };
  world.placeBlock(gate.x, gate.y, gate.z, 'bt_gate', { by: me });
  world.placeBlock(gate2.x, gate2.y, gate2.z, 'bt_gate', { by: me });
  bobUses(gate);
  check(name(gate) === 'bt_gate', "someone else can't open a gate");
  use(gate);
  check(name(gate) === 'bt_gate_open' && name(gate2) === 'bt_gate_open', `E opens a gate and the one joined to it (${name(gate)}, ${name(gate2)})`);
  check(ownerOf(gate) === ownerKey(me) && ownerOf(gate2) === ownerKey(me), 'an open gate is still its builder\'s');
  check(!world.blockInfo(world.getBlock(gate.x, gate.y, gate.z))?.solid, 'and can be walked through');
  use(gate2);
  check(name(gate) === 'bt_gate' && name(gate2) === 'bt_gate', 'E shuts them again');
  check(said('bt.aim').some((m) => (m as { key?: string }).key === 'Open or shut'), 'and their screen says what E does there');
  world.breakBlock(gate2.x, gate2.y, gate2.z);

  // ---- A storage box holds things, and spills them when it's taken down ----
  world.breakBlock(gate.x, gate.y, gate.z);
  const box = gate;
  const boxId = `box:${box.x},${box.y},${box.z}`;
  world.placeBlock(box.x, box.y, box.z, 'bt_storage', { by: me });
  use(box);
  check(survivorOf(me).ui.open && survivorOf(me).ui.container === boxId, `E opens the box (${survivorOf(me).ui.container})`);
  container(boxId, 24).slots[3] = { item: 'wood', count: 7 };
  closeScreens(me);
  bobUses(box);
  check(!survivorOf(bob).ui.open, "someone else can't look in it");
  check(containerContents(boxId, 24)[0]?.count === 7, 'what is put in stays in');
  game.items.clearPickups();
  tool(null);
  mine(box, 4);
  check(name(box) === 'air' && h.sim.items.frame().length > 0, 'taken down, the box spills what it held');
  check(containerContents(boxId, 24).length === 0, 'and holds nothing any more');
  game.items.clearPickups();

  // ---- A bed is where its sleeper wakes, until it's gone ----
  world.placeBlock(box.x, box.y, box.z, 'bt_bed', { by: me });
  use(box);
  const bed = bedOf(me);
  check(!!bed && bed.x === box.x && bed.y === box.y && bed.z === box.z, 'E on a bed makes it where they wake');
  mine(box, 4);
  check(name(box) === 'air' && bedOf(me) === null, 'a bed taken down is forgotten');

  // ---- Tribes: survivors who build as one ----
  check(tribeOf(me) === null && !sameTribe(me, bob), 'nobody starts in a tribe');
  tribeCommand(game, me, ['create', 'Ridge', 'Runners']);
  check(tribeOf(me) === 'Ridge Runners' && !sameTribe(me, bob), 'a tribe is founded');
  let refused = '';
  try {
    tribeCommand(game, bob, ['create', 'ridge runners']);
  } catch (problem) {
    refused = (problem as Error).message;
  }
  check(refused.includes('already a tribe'), `a name is taken once (${refused})`);
  bobUses(door);
  check(said('bt.aim').length > 0 && !canBuild(bob, wall), 'a stranger is still a stranger');
  tribeCommand(game, me, ['invite', 'bob']);
  tribeCommand(game, bob, ['accept']);
  check(sameTribe(me, bob) && sameTribe(bob, me) && tribeOf(bob) === 'Ridge Runners', 'asked in and accepting, Bob is in the tribe');
  check(canBuild(bob, wall) && canBuild(bob, { x: wall.x + 1, y: wall.y, z: wall.z }), 'and may build on and beside the tribe\'s walls');
  const was = facing(door);
  // (The door stands open, its leaf along the cell's south-facing edge: that's where Bob looks.)
  bob.controls.lookAt({ x: door.x + 0.5, y: door.y + 0.6, z: door.z + 0.1 });
  h.run(0.2);
  bob.controls.press('KeyE');
  h.run(0.2);
  check(facing(door) !== was, 'and open its doors');
  saveNow(game);
  check(game.store.get('bt.tribes') !== undefined, 'tribes are kept in the store');
  loadNow(game);
  check(sameTribe(me, bob) && tribeOf(me) === 'Ridge Runners', 'and come back from it');
  tribeCommand(game, bob, ['leave']);
  check(!sameTribe(me, bob) && tribeOf(bob) === null && !canBuild(bob, wall) && tribeOf(me) === 'Ridge Runners', 'leaving, Bob is a stranger again');
  tribeCommand(game, me, ['leave']);
  saveNow(game);
  check(tribeOf(me) === null && Object.keys(game.store.get<object>('bt.tribes') ?? {}).length === 0, 'a tribe nobody is in is no more');

  // ---- Only structure pieces are placed: another part's item drawn as a block is not ----
  game.items.define('test_blocky', { kind: 'misc', name: 'Blocky', icon: { block: 'stone' } });
  me.inventory.set(me.inventory.selected, { item: 'test_blocky', count: 2 });
  const spot = { x: ox + 2, y: oy - 1, z: oz - 1 };
  h.run(0.2, { pilot: () => aim(spot) });
  h.step(1 / 60, { clicked: 4, buttons: 4, ...aim(spot) });
  h.run(0.1);
  check(name({ ...spot, y: oy }) === 'air' && me.inventory.held?.count === 2, 'an item that only looks like a block places nothing');

  // ---- Its owner takes the wall down and gets something back ----
  const behind = { x: wall.x + 1, y: wall.y, z: wall.z };
  world.placeBlock(behind.x, behind.y, behind.z, 'bt_wood_wall', { by: me });
  const woodBefore = have('wood');
  tool(null);
  mine(wall, 4);
  check(name(wall) === 'air' && ownerOf(wall) === null, 'the owner takes the wall down');
  // (Still holding: the wall behind it wants a click of its own.)
  h.run(3, { pilot: () => ({ buttons: 1, ...aim(wall) }) });
  check(name(behind) === 'bt_wood_wall', 'holding on does not take down the wall behind');
  check(have('wood') > woodBefore, 'and gets some of its wood back');

  // A creature (or anything else) breaking a piece frees its cell.
  world.breakBlock(door.x, door.y, door.z);
  check(ownerOf(door) === null, 'a piece broken by the world is nobody\'s');

  // ---- Wild animals at the walls: thatch gives to a raptor, stone stands against a tyrannosaur ----
  game.bots.remove(bob);
  const hut = [[1, 0], [-1, 0], [0, 1], [0, -1]].flatMap(([dx, dz]) => [0, 1].map((dy) => ({ x: ox + dx, y: oy + dy, z: oz + dz })));
  const raise = (block: string) => {
    for (const at of hut) {
      world.setBlock(at.x, at.y, at.z, 'air');
      world.placeBlock(at.x, at.y, at.z, block, { by: me });
    }
  };
  reset();
  me.protect(120);
  raise('bt_thatch_wall');
  check(hut.every((at) => name(at) === 'bt_thatch_wall' && ownerOf(at) === ownerKey(me)), 'a thatch hut stands');
  const raptor = spawnAnimal(game, 'utahraptor', ox - 3.5, oz + 0.5, 0, oy);
  check(!!raptor, 'a raptor arrives');
  if (raptor) {
    provoke(raptor, me, game);
    h.run(9, { until: () => hut.some((at) => name(at) === 'air') });
    const holes = hut.filter((at) => name(at) === 'air');
    check(holes.length >= 1, 'a hunting raptor bites through thatch');
    check(holes.every((at) => ownerOf(at) === null), 'and what it broke is nobody\'s');
    raptor.e.remove();
  }
  raise('bt_stone_wall');
  const rex = spawnAnimal(game, 'tyrannosaurus', ox - 3.5, oz + 0.5, 0, oy);
  if (rex) {
    provoke(rex, me, game);
    h.run(3.5);
    check(hut.every((at) => name(at) === 'bt_stone_wall'), 'stone stands against a tyrannosaur');
    raise('bt_thatch_wall');
    h.run(4, { until: () => hut.some((at) => name(at) === 'air') });
    check(hut.some((at) => name(at) === 'air'), 'which goes through thatch at a bite');
    rex.e.remove();
  }
}
