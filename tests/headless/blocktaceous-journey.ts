import { readFileSync } from 'node:fs';
import type { Player, Vec3 } from '../../src/platform';
import { GameHost } from '../../src/platform/host/game';
import { MemoryStore } from '../../src/platform/host/store';
import type { HostEvent, PlayerInput } from '../../src/platform/net/protocol';
import { ownerOf } from '../../src/games/blocktaceous/building/rules';
import { census, spawnAnimal } from '../../src/games/blocktaceous/creatures/population';
import { brains, loaded, newHerd, tames, type Brain } from '../../src/games/blocktaceous/creatures/state';
import { SPAWNS, biomeAt } from '../../src/games/blocktaceous/island/index';
import { count, levelOf } from '../../src/games/blocktaceous/survival/bag';
import { survivorOf } from '../../src/games/blocktaceous/survival/state';
import { check, games } from './_harness';

/**
 * One survivor's first day, start to finish, through the whole game as a server runs it (a room
 * with a store, stepped 30 times a second) and through the controls a player has: keys, the mouse
 * and the journal's buttons. Washed up on the beach with nothing, they gather by hand, make a pick
 * and a hatchet, fell a tree and break rock, put up a few walls and a campfire, cook, befriend a
 * dodo with berries, die, take their lost pack back, and after the server restarts find
 * themselves, their walls and their dodo as they were.
 *
 * What isn't done with a player's controls, because no player could do it in the time: the dodos
 * are put near the beach (the island decides where its own turn up), death is a blow dealt by the
 * test, and the way back to the lost pack from the beach they wake on is a teleport.
 *
 * Found on the way (told at the end as KNOWN, not failed, so the rest still runs): see `known`.
 */
export default function blocktaceousJourney() {
  const def = games.find((g) => g.id === 'blocktaceous')!;
  // The same run every time (the platform's entities and effects use `Math.random`).
  let seed = 0x9e3779b9;
  Math.random = () => ((seed = (Math.imul(seed ^ (seed >>> 15), seed | 1) + 0x6d2b79f5) | 0), ((seed ^ (seed >>> 14)) >>> 0) / 4294967296);
  const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
  const store = new MemoryStore();
  const account = { id: 'acct-ann', name: 'Ann', avatar: null };
  const OWNER = `a:${account.id}`;

  let host!: GameHost;
  let id = '';
  let events: HostEvent[] = [];
  let time = 0;
  const open = () => {
    host = new GameHost(def, { engine: wasm, seed: 7, remote: true, radius: 3, budget: Infinity, cheats: true, store, player: { id: 'p1', name: 'Player' } });
    const c = host.connect('Ann', { account });
    id = c.id;
    events = [...c.batch.events];
    host.command(id, { t: 'start' });
  };
  open();
  const game = () => host.sim.ctx;
  const me = (): Player => game().players.find((p) => p.id === id)!;
  const body = () => host.sim.players.find((p) => p.id === id)!;

  /** One server step with these controls (the view stays where it was unless they turn it). */
  const step = (input: Partial<PlayerInput> = {}) => {
    const p = body();
    host.command(id, { t: 'input', input: { active: true, down: [], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: p.yaw, pitch: p.pitch, viewSeq: p.viewSeq, ...input } });
    for (const e of host.step(1 / 30).get(id)?.events ?? []) {
      if (e.t === 'error') throw new Error(`the game threw: ${e.text}`);
      events.push(e);
    }
    time += 1 / 30;
  };
  const run = (seconds: number, pilot: () => Partial<PlayerInput> = () => ({}), until?: () => boolean): boolean => {
    for (let t = 0; t < seconds; t += 1 / 30) {
      step(pilot());
      if (until?.()) return true;
    }
    return !until;
  };
  const press = (key: string, extra: Partial<PlayerInput> = {}) => {
    step({ pressed: [key], down: [key], ...extra });
    step(extra);
  };
  /** A button of the journal, as their screen sends it. */
  const journal = (action: string, value = '') => {
    host.command(id, { t: 'message', msg: { t: 'widgetAction', player: id, widget: 'bt-journal', action, value } });
    step();
  };
  const hudCalls = (method: string) => events.flatMap((e) => (e.t === 'call' && e.call.target === 'hud' && e.call.method === method ? [e.call.args] : []));
  const said = (method: string, text: RegExp) => hudCalls(method).some((a) => a.some((x) => typeof x === 'string' && text.test(x)));

  const have = (item: string) => count(me(), item);
  const world = () => game().world;
  const nameAt = (x: number, y: number, z: number) => world().blockName(world().getBlock(x, y, z));
  const aim = (at: Vec3) => {
    const e = me().eye;
    const [dx, dy, dz] = [at.x - e.x, at.y - e.y, at.z - e.z];
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  };
  const centre = (c: Vec3): Vec3 => ({ x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5 });
  const flat = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

  /** Walk (W held, turning to face it, hopping over what's in the way) until within `near` of a spot. */
  const walkTo = (to: { x: number; z: number }, near = 1.6, seconds = 40) => {
    let last = { ...me().position };
    let stuck = 0;
    const got = run(
      seconds,
      () => {
        const p = me().position;
        stuck = flat(p, last) < 0.03 ? stuck + 1 : 0;
        last = { ...p };
        return { ...aim({ x: to.x, y: me().eye.y, z: to.z }), down: stuck > 3 ? ['KeyW', 'Space'] : ['KeyW'] };
      },
      () => flat(me().position, to) <= near,
    );
    check(got, `walked for ${seconds} s and is still ${flat(me().position, to).toFixed(1)} blocks from ${to.x}, ${to.z} (at ${JSON.stringify(me().position)})`);
    run(0.3);
  };

  /** Every block of a kind (by its name's test) within `r` of the survivor, nearest first: the test's eyes. */
  const find = (test: (name: string) => boolean, r = 44): Vec3[] => {
    const p = me().position;
    const out: Vec3[] = [];
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        const [x, z] = [Math.floor(p.x) + dx, Math.floor(p.z) + dz];
        const top = world().surfaceY(x, z);
        if (top < 0) continue;
        for (let y = top + 12; y >= top - 2 && y > 0; y--) if (test(nameAt(x, y, z))) out.push({ x, y, z });
      }
    return out.sort((a, b) => flat(a, p) - flat(b, p));
  };

  /** Hold the left button on a block until it's gone (or `until` says so). */
  const mine = (cell: Vec3, seconds: number, until?: () => boolean) => {
    const was = nameAt(cell.x, cell.y, cell.z);
    step({ ...aim(centre(cell)), buttons: 1, clicked: 1 });
    return run(seconds, () => ({ ...aim(centre(cell)), buttons: 1 }), until ?? (() => nameAt(cell.x, cell.y, cell.z) !== was));
  };
  /** Walk up to a block and take it. */
  const gather = (cell: Vec3, seconds = 6) => {
    if (flat(me().position, centre(cell)) > 2.2) walkTo(centre(cell), 2.2);
    check(mine(cell, seconds), `${nameAt(cell.x, cell.y, cell.z)} at ${cell.x},${cell.y},${cell.z} didn't come away in ${seconds} s (from ${JSON.stringify(me().position)})`);
  };
  /** Put an item they carry in their hand, as a player does: its number key if it's on the belt, else by way of the journal. */
  const hold = (item: string) => {
    let slot = me().inventory.slots.findIndex((x) => x?.item === item);
    if (slot < 0) {
      const s = survivorOf(me());
      const from = s.bag.findIndex((x) => x?.item === item);
      check(from >= 0, `no ${item} to hold`);
      const free = me().inventory.slots.findIndex((x) => !x);
      check(free >= 0, 'no free place on the belt');
      press('Tab');
      journal('tab', 'pack');
      journal('slot', `b${from}`);
      journal('slot', `h${free}`);
      journal('close');
      slot = me().inventory.slots.findIndex((x) => x?.item === item);
      check(slot >= 0, `${item} didn't move to the belt through the journal`);
    }
    press(`Digit${slot + 1}`);
    check(me().inventory.held?.item === item, `the number key didn't bring ${item} to hand (holding ${me().inventory.held?.item})`);
  };
  /** Make a recipe at the journal's making page (open already) and wait for it. */
  const make = (key: string, item: string, seconds = 8) => {
    const before = have(item);
    journal('make', key);
    check(survivorOf(me()).queue.length > 0, `${key} wasn't started: ${JSON.stringify(Object.fromEntries(['wood', 'thatch', 'stone', 'flint', 'fiber', 'raw_meat'].map((i) => [i, have(i)])))}`);
    check(run(seconds, undefined, () => have(item) > before), `${item} wasn't made in ${seconds} s`);
  };

  // ---- Washed up ----
  run(1);
  const start = { ...me().position };
  check(me().alive && me().health === me().maxHealth, 'a new survivor is alive and whole');
  check(biomeAt(start.x, start.z) === 'beach' && SPAWNS.some((s) => flat(s, start) < 6), `a new survivor stands on a landing beach (${JSON.stringify(start)}, ${biomeAt(start.x, start.z)})`);
  check(me().inventory.slots.every((x) => !x) && survivorOf(me()).bag.every((x) => !x), 'with nothing');
  check(levelOf(me()) === 1, 'at level 1');
  check(me().account?.id === account.id, 'signed in');

  // ---- By hand: plants for fibre, a dry bush, the sand for stones and flint, a palm for wood and thatch ----
  for (const plant of find((n) => n === 'fiber_plant', 16).slice(0, 4)) gather(plant);
  check(have('fiber') >= 8, `picking plants gives fibre (${have('fiber')})`);
  const bush = find((n) => n === 'dead_bush', 16)[0];
  if (bush) gather(bush);
  // The sand underfoot: each patch gives a stone (and now and then a flint), then is picked clean.
  let patch = 0;
  const sand = () => {
    const p = me().position;
    const a = (patch / 8) * Math.PI * 2;
    const r = patch++ % 16 < 8 ? 1.6 : 2.8;
    return { x: Math.floor(p.x + Math.cos(a) * r), y: Math.floor(p.y) - 1, z: Math.floor(p.z + Math.sin(a) * r) };
  };
  for (let i = 0; i < 96 && (have('stone') < 4 || have('flint') < 3); i++) {
    const cell = sand();
    if (nameAt(cell.x, cell.y, cell.z) !== 'sand') continue;
    const before = have('stone') + have('flint');
    mine(cell, 3, () => have('stone') + have('flint') > before);
    if (patch % 16 === 0) walkTo({ x: me().position.x + 6, z: me().position.z }, 0.5, 8);
  }
  check(have('stone') >= 4 && have('flint') >= 3, `the beach gives stones and flint by hand (${have('stone')}, ${have('flint')})`);
  check(nameAt(Math.floor(me().position.x), Math.floor(me().position.y) - 1, Math.floor(me().position.z)) === 'sand', 'and the sand stays where it is');

  const foot = (log: Vec3): Vec3 => {
    let y = log.y;
    while (nameAt(log.x, y - 1, log.z).endsWith('_log')) y--;
    return { x: log.x, y, z: log.z };
  };
  const trees = () => {
    const seen = new Set<string>();
    return find((n) => n.endsWith('_log'))
      .map(foot)
      .filter((f) => !seen.has(`${f.x},${f.z}`) && !!seen.add(`${f.x},${f.z}`));
  };
  const palms = trees();
  check(palms.length >= 2, `two trees within reach of the beach (${palms.length})`);
  gather(palms[0], 8);
  check(have('wood') >= 2 && have('thatch') >= 10, `a palm felled by hand gives a little wood and thatch (${have('wood')}, ${have('thatch')})`);
  check(said('pop', /Timber/), 'and comes down whole');

  // ---- A pick and a hatchet, at the journal ----
  press('Tab');
  check(survivorOf(me()).ui.open && hudCalls('widget').some((a) => a[0] === 'bt-journal'), 'Tab opens the journal');
  journal('tab', 'craft');
  make('stone_pick', 'stone_pick');
  make('stone_hatchet', 'stone_hatchet');
  journal('close');
  check(!survivorOf(me()).ui.open, 'and its close button shuts it');
  check(me().inventory.count('stone_pick') === 1 && me().inventory.count('stone_hatchet') === 1, 'the tools are on the belt');

  // ---- With tools: a tree with the hatchet, rock with the pick ----
  hold('stone_hatchet');
  const wood0 = have('wood');
  const t0 = time;
  gather(palms[1], 6);
  check(have('wood') - wood0 >= 9, `a hatchet gets real wood from a tree (${have('wood') - wood0})`);
  void t0;
  if (have('wood') < 14) for (const tree of trees().slice(0, 2)) if (have('wood') < 14) gather(tree, 6);
  const rocks = find((n) => n === 'stone', 60);
  check(rocks.length > 0, 'bare rock somewhere near the beach');
  hold('stone_pick');
  const stone0 = have('stone');
  for (const rock of rocks.slice(0, 6)) {
    if (have('stone') >= 12 && have('flint') >= 3) break;
    if (nameAt(rock.x, rock.y, rock.z) === 'stone') gather(rock, 5);
  }
  check(have('stone') - stone0 >= 6, `a pick breaks rock and gets more of it (${have('stone') - stone0})`);
  check(nameAt(rocks[0].x, rocks[0].y, rocks[0].z) !== 'stone', 'and the rock comes away');
  check(survivorOf(me()).xp > 0, 'all of it worth experience');

  // A pick on a tree strips it for thatch, which the camp wants plenty of.
  for (const tree of trees().slice(0, 3)) if (have('thatch') < 20) gather(tree, 8);
  check(have('thatch') >= 20, `thatch for the camp (${have('thatch')})`);

  // ---- A camp: three thatch walls and a campfire ----
  for (const plant of find((n) => n === 'fiber_plant', 30).slice(0, 2)) if (have('fiber') < 8) gather(plant);
  press('Tab');
  journal('tab', 'craft');
  make('bt_thatch_wall', 'bt_thatch_wall');
  make('bt_thatch_wall', 'bt_thatch_wall');
  make('bt_campfire', 'bt_campfire');
  journal('close');
  check(have('bt_thatch_wall') === 4 && have('bt_campfire') === 1, `walls and a campfire made (${have('bt_thatch_wall')}, ${have('bt_campfire')})`);

  // Level sand to build on: the nearest spot whose four cells in a row are sand at one height with air over them.
  const site = (() => {
    const p = me().position;
    for (let r = 2; r < 30; r++)
      for (let i = 0; i < 16; i++) {
        const [x, z] = [Math.floor(p.x + Math.cos((i / 16) * Math.PI * 2) * r), Math.floor(p.z + Math.sin((i / 16) * Math.PI * 2) * r)];
        const y = world().surfaceY(x, z);
        const flatRow = [0, 1, 2, 3].every((d) => [0, 1].every((s) => nameAt(x + d, y, z + s) === 'sand' && nameAt(x + d, y + 1, z + s) === 'air' && nameAt(x + d, y + 2, z + s) === 'air'));
        if (flatRow) return { x, y, z };
      }
    throw new Error('no level sand to build on');
  })();
  walkTo({ x: site.x + 1.5, z: site.z + 2.5 }, 0.4);
  /** Right-click on the ground cell with what's in hand. */
  const placeOn = (ground: Vec3) => {
    const top = { x: ground.x + 0.5, y: ground.y + 1, z: ground.z + 0.5 };
    run(0.2, () => aim(top));
    step({ ...aim(top), buttons: 4, clicked: 4 });
    run(0.2, () => aim(top));
  };
  hold('bt_thatch_wall');
  const walls = [0, 1, 2].map((d) => ({ x: site.x + d, y: site.y + 1, z: site.z }));
  for (const w of walls) placeOn({ x: w.x, y: site.y, z: w.z });
  for (const w of walls) check(nameAt(w.x, w.y, w.z) === 'bt_thatch_wall', `a wall stands at ${w.x},${w.y},${w.z} (${nameAt(w.x, w.y, w.z)})`);
  check(have('bt_thatch_wall') === 1, `three walls used (${have('bt_thatch_wall')} left)`);
  check(walls.every((w) => ownerOf(w) === OWNER), `and they are their builder's (${walls.map((w) => ownerOf(w))})`);
  hold('bt_campfire');
  const fire = { x: site.x + 3, y: site.y + 1, z: site.z };
  placeOn({ x: fire.x, y: site.y, z: fire.z });
  check(nameAt(fire.x, fire.y, fire.z) === 'bt_campfire' && ownerOf(fire) === OWNER, `the campfire is lit (${nameAt(fire.x, fire.y, fire.z)})`);

  // ---- Meat: a dodo, the hatchet, the fire ----
  const dodoNear = (d: number): Brain => {
    const p = me().position;
    for (let i = 0; i < 16; i++) {
      const [x, z] = [p.x + Math.cos((i / 16) * Math.PI * 2) * d, p.z + Math.sin((i / 16) * Math.PI * 2) * d];
      const y = world().surfaceY(x, z);
      if (y < 0 || Math.abs(y + 1 - p.y) > 2 || nameAt(Math.floor(x), y, Math.floor(z)) !== 'sand') continue;
      const b = spawnAnimal(game(), 'dodo', x, z, newHerd(x, z));
      if (b) return b;
    }
    throw new Error('nowhere to put a dodo');
  };
  const follow = (b: Brain, input: (tick: number) => Partial<PlayerInput>, seconds: number, until: () => boolean) => {
    let tick = 0;
    return run(
      seconds,
      () => {
        tick++;
        const far = flat(me().position, b.e.position) > 2.2;
        return { ...aim({ x: b.e.position.x, y: b.e.position.y + 0.45, z: b.e.position.z }), down: far ? ['KeyW'] : [], ...input(tick) };
      },
      until,
    );
  };
  const prey = dodoNear(4);
  hold('stone_hatchet');
  check(follow(prey, (t) => ({ buttons: 1, clicked: t % 20 === 0 ? 1 : 0 }), 30, () => !prey.e.alive), `the dodo wasn't killed (health ${prey.e.health})`);
  run(0.3);
  check(have('raw_meat') >= 1, `its meat goes to the hunter (${have('raw_meat')})`);
  check(said('feed', /Dodo/), 'who is told what they got');

  walkTo({ x: fire.x + 0.5, z: fire.z + 2.2 }, 0.5);
  run(0.2, () => aim(centre(fire)));
  press('KeyE', aim(centre(fire)));
  check(survivorOf(me()).ui.open && survivorOf(me()).ui.station === 'campfire', 'E on the campfire opens its cooking');
  make('cooked_meat@campfire', 'cooked_meat', 8);
  journal('close');
  check(have('raw_meat') === 0 || have('cooked_meat') >= 1, 'the meat is cooked');
  // Eaten the way a player eats: in hand, the right button held.
  const s0 = survivorOf(me());
  s0.hunger = Math.min(s0.hunger, 60);
  const hunger0 = s0.hunger;
  hold('cooked_meat');
  run(4, () => ({ buttons: 4 }), () => have('cooked_meat') === 0);
  check(have('cooked_meat') === 0 && survivorOf(me()).hunger > hunger0 + 10, `eating it fills them (${hunger0.toFixed(0)} to ${survivorOf(me()).hunger.toFixed(0)})`);

  // ---- A friend: berries from the bushes inland, offered to a dodo by hand ----
  for (const b of find((n) => n === 'berry_bush', 50).slice(0, 4)) if (have('berries') < 8) gather(b);
  check(have('berries') >= 5, `berries picked (${have('berries')})`);
  walkTo({ x: fire.x + 0.5, z: fire.z + 4 }, 1.5, 60);
  const dodo = dodoNear(5);
  hold('berries');
  check(follow(dodo, (t) => ({ pressed: t % 20 === 0 ? ['KeyE'] : [] }), 60, () => !!dodo.tame), `the dodo wasn't befriended (trust ${dodo.trust.toFixed(0)}%, ${have('berries')} berries left)`);
  const friend = dodo.tame!;
  check(friend.owner === OWNER && friend.order === 'follow', 'the dodo is theirs, and follows');
  check(said('banner', /is yours/), 'and they are told so');
  check(game().store.get(`tame:${friend.id}`) !== undefined, 'its record is kept');
  // R on it: its orders. "Stay", so it's by the fire when they come back.
  run(0.2, () => aim({ x: dodo.e.position.x, y: dodo.e.position.y + 0.45, z: dodo.e.position.z }));
  press('KeyR', aim({ x: dodo.e.position.x, y: dodo.e.position.y + 0.45, z: dodo.e.position.z }));
  type Menu = { title: string; sections: { entries: { label: string; onSelect?: { $cb: number } }[] }[] };
  const menu = hudCalls('menu').map((a) => a[1] as Menu).filter((m) => m?.title === friend.name).at(-1);
  const stay = menu?.sections.flatMap((s) => s.entries).find((e) => e.label === 'Stay');
  check(stay?.onSelect, `R on their dodo opens its orders (${menu?.title})`);
  host.command(id, { t: 'message', msg: { t: 'callback', player: id, id: stay.onSelect.$cb } });
  step();
  check((friend.order as string) === 'stay', 'and "Stay" is an order it takes');
  const friendAt = { ...dodo.e.position };

  // ---- Death, and the pack left behind ----
  const carried = Object.fromEntries(['wood', 'stone', 'thatch', 'fiber', 'stone_pick', 'stone_hatchet', 'bt_thatch_wall'].map((i) => [i, have(i)]));
  const level = levelOf(me());
  const xp = survivorOf(me()).xp;
  const fell = { ...me().position };
  me().damage(1000);
  step();
  check(!me().alive, 'dead');
  run(0.2);
  check(said('banner', /YOU DIED/), 'they are told');
  check(Object.keys(carried).every((i) => have(i) === 0), 'everything they carried is gone from them');
  check(game().store.keys('lostpack:').length === 1 && host.sim.items.frame().some((p) => p.item === 'lost_pack'), 'and lies in a pack where they fell');
  check(run(8, undefined, () => me().alive), 'they wake');
  run(0.5);
  check(SPAWNS.some((s) => flat(s, me().position) < 8), `on a beach (${JSON.stringify(me().position)})`);
  check(levelOf(me()) === level && survivorOf(me()).xp === xp, 'what they know is still theirs');
  check(hudCalls('marker').some((a) => a[0] === 'bt-lost-pack' && a[1] !== null), 'and a marker points at their pack');
  // The long walk back, in one stride.
  me().teleport(fell);
  run(1.5);
  press('KeyE');
  const s1 = survivorOf(me());
  check(s1.ui.open && s1.ui.container === `pack-${s1.cache}`, 'E by the pack opens it');
  journal('takeall');
  for (const [item, n] of Object.entries(carried)) check(have(item) === n, `${item} came back: ${have(item)} of ${n}`);
  check(game().store.keys('lostpack:').length === 0 && !host.sim.items.frame().some((p) => p.item === 'lost_pack') && survivorOf(me()).cache === null, 'and the emptied pack is gone');
  check(loaded.get(friend.id)?.e.alive && flat(loaded.get(friend.id)!.e.position, friendAt) < 4, 'the dodo stayed where it was told');
  // Tools back on the belt (the pack screen put everything in the backpack).
  journal('close');
  hold('stone_hatchet');
  hold('stone_pick');
  check(me().inventory.count('stone_pick') === 1 && me().inventory.count('stone_hatchet') === 1, 'the tools are back on the belt');

  // ---- The server restarts ----
  run(11); // what's kept is written within ten seconds of a change
  const before = {
    at: { ...me().position },
    level: levelOf(me()),
    xp: survivorOf(me()).xp,
    hunger: survivorOf(me()).hunger,
    belt: JSON.stringify(me().inventory.slots.map((x) => x && [x.item, x.count])),
    bag: JSON.stringify(survivorOf(me()).bag),
    tame: { ...friend },
  };
  host.persist();
  host.dispose();
  open();
  run(3);
  check(me().account?.id === account.id && flat(me().position, before.at) < 1.5, `back where they stood (${JSON.stringify(me().position)} for ${JSON.stringify(before.at)})`);
  check(me().alive && levelOf(me()) === before.level && survivorOf(me()).xp === before.xp, `the same survivor: level ${levelOf(me())}, ${survivorOf(me()).xp} xp`);
  check(Math.abs(survivorOf(me()).hunger - before.hunger) < 2, 'as hungry as they were');
  check(JSON.stringify(me().inventory.slots.map((x) => x && [x.item, x.count])) === before.belt, 'with their belt');
  check(JSON.stringify(survivorOf(me()).bag) === before.bag, 'and their pack');
  for (const w of walls) check(nameAt(w.x, w.y, w.z) === 'bt_thatch_wall' && ownerOf(w) === OWNER, `the wall at ${w.x},${w.y},${w.z} stands and is theirs (${nameAt(w.x, w.y, w.z)}, ${ownerOf(w)})`);
  check(nameAt(fire.x, fire.y, fire.z) === 'bt_campfire' && ownerOf(fire) === OWNER, 'so does the campfire');
  check(nameAt(palms[0].x, palms[0].y, palms[0].z) === 'air', 'the felled palm is still felled (it grows back in its own time)');
  const rec = tames.get(before.tame.id);
  check(rec && rec.owner === OWNER && rec.name === before.tame.name && rec.species === 'dodo' && rec.order === 'stay', `the dodo's record came back (${JSON.stringify(rec)})`);
  const back = loaded.get(before.tame.id);
  check(back?.e.alive && flat(back.e.position, friendAt) < 5, 'and the dodo itself, by the fire');
  // The fire still cooks for them.
  walkTo({ x: fire.x + 0.5, z: fire.z + 2.2 }, 0.5);
  run(0.2, () => aim(centre(fire)));
  press('KeyE', aim(centre(fire)));
  check(survivorOf(me()).ui.station === 'campfire', 'their campfire still opens for them');
  journal('close');

  // ---- "Restart" from the pause menu (a server with cheats on takes it): the room starts again ----
  const belt = JSON.stringify(me().inventory.slots.map((x) => x && [x.item, x.count]));
  const bag = JSON.stringify(survivorOf(me()).bag);
  host.command(id, { t: 'restart' });
  run(3);
  check(me().alive && levelOf(me()) === before.level && JSON.stringify(survivorOf(me()).bag) === bag, 'a restarted room has the same survivor, with their pack');
  for (const w of walls) check(nameAt(w.x, w.y, w.z) === 'bt_thatch_wall' && ownerOf(w) === OWNER, 'their walls');
  check(tames.get(before.tame.id)?.owner === OWNER, 'and their dodo');
  const known: string[] = [];
  check(JSON.stringify(me().inventory.slots.map((x) => x && [x.item, x.count])) === belt, `and their belt: ${belt}`);
  census.paused = false;
  void brains;
  host.dispose();
  for (const k of known) console.log(`  KNOWN: ${k}`);
}
