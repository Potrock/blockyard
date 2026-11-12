import { readFileSync } from 'node:fs';
import type { Player, Vec3 } from '../../src/platform';
import { GameHost } from '../../src/platform/host/game';
import { MemoryStore } from '../../src/platform/host/store';
import type { HostEvent, PlayerInput } from '../../src/platform/net/protocol';
import { canBuild, ownerKey, ownerOf, sameTribe } from '../../src/games/blocktaceous/building/rules';
import { census, spawnAnimal } from '../../src/games/blocktaceous/creatures/population';
import { brains, loaded, newHerd, rides, tames, type Brain } from '../../src/games/blocktaceous/creatures/state';
import { addXp, containerContents, count, give, levelOf } from '../../src/games/blocktaceous/survival/bag';
import { xpForLevel } from '../../src/games/blocktaceous/survival/data';
import { survivorOf } from '../../src/games/blocktaceous/survival/state';
import { check, games } from './_harness';

/**
 * Blocktaceous with company, as a server runs it: a guest (Gus, first in) and two signed-in
 * survivors (Ann and Bob) in one room, each at their own controls.
 *
 * What's theirs stays theirs: packs, levels, journals and what their screens are told; a wall, a
 * door and a box belong to whoever placed them; a tame is seen by all and ordered by its owner
 * alone; a death and its lost pack are private. Someone leaving breaks nothing for the others:
 * a signed-in survivor's things wait for them, a guest's tame goes back to the wild and their
 * pieces become anybody's.
 *
 * Found on the way (told at the end as KNOWN, not failed, so the rest still runs): see `known`.
 */
export default function blocktaceousMultiplayer() {
  const def = games.find((g) => g.id === 'blocktaceous')!;
  // The same run every time (the platform's entities and effects use `Math.random`).
  let seed = 0x9e3779b9;
  Math.random = () => ((seed = (Math.imul(seed ^ (seed >>> 15), seed | 1) + 0x6d2b79f5) | 0), ((seed ^ (seed >>> 14)) >>> 0) / 4294967296);
  const store = new MemoryStore();
  const host = new GameHost(def, { engine: readFileSync('engine/pkg/voxel_engine_bg.wasm'), seed: 7, remote: true, radius: 3, budget: Infinity, cheats: true, store, player: { id: 'p1', name: 'Player' } });
  const game = host.sim.ctx;
  const world = game.world;

  const events = new Map<string, HostEvent[]>();
  const controls = new Map<string, Partial<PlayerInput>>();
  const known: string[] = [];
  /** Something wrong that's been reported: said, not failed. */
  const expected = (ok: unknown, message: string) => {
    if (!ok) known.push(message);
  };

  void expected;

  const join = (name: string, account?: { id: string; name: string; avatar: null }): string => {
    const c = host.connect(name, account ? { account } : undefined);
    events.set(c.id, [...c.batch.events]);
    host.command(c.id, { t: 'start' });
    return c.id;
  };
  const player = (id: string): Player => game.players.find((p) => p.id === id)!;
  const body = (id: string) => host.sim.players.find((p) => p.id === id)!;

  /** One server step: everyone connected sends their controls (idle unless set for this step). */
  const step = () => {
    for (const id of events.keys()) {
      const p = body(id);
      if (!p || !host.sim.ctx.players.includes(p.api)) continue;
      host.command(id, { t: 'input', input: { active: true, down: [], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: p.yaw, pitch: p.pitch, viewSeq: p.viewSeq, ...controls.get(id) } });
    }
    controls.clear();
    for (const [id, b] of host.step(1 / 30)) {
      for (const e of b.events) {
        if (e.t === 'error') throw new Error(`the game threw: ${e.text}`);
        events.get(id)?.push(e);
      }
    }
  };
  /** Run for a while; `pilots` gives each player's controls for each step. */
  const run = (seconds: number, pilots: Record<string, () => Partial<PlayerInput>> = {}, until?: () => boolean): boolean => {
    for (let t = 0; t < seconds; t += 1 / 30) {
      for (const [id, pilot] of Object.entries(pilots)) controls.set(id, pilot());
      step();
      if (until?.()) return true;
    }
    return !until;
  };
  const act = (id: string, input: Partial<PlayerInput>) => {
    controls.set(id, input);
    step();
  };
  const press = (id: string, key: string, extra: Partial<PlayerInput> = {}) => {
    act(id, { pressed: [key], down: [key], ...extra });
    act(id, extra);
  };
  const journal = (id: string, action: string, value = '') => {
    host.command(id, { t: 'message', msg: { t: 'widgetAction', player: id, widget: 'bt-journal', action, value } });
    step();
  };
  let commandId = 1;
  /** A chat command, as they type it. */
  const say = (id: string, line: string): unknown => {
    const n = commandId++;
    host.command(id, { t: 'exec', id: n, line });
    step();
    const reply = events.get(id)!.find((e) => e.t === 'reply' && e.id === n);
    return reply?.t === 'reply' ? reply.value : undefined;
  };

  // ---- What each screen was told ----
  const calls = (id: string, target: string, method: string, from = 0) => (events.get(id) ?? []).slice(from).flatMap((e) => (e.t === 'call' && e.call.target === target && e.call.method === method ? [e.call.args] : []));
  const mark = (id: string) => events.get(id)!.length;
  const heard = (id: string, target: string, method: string, text: RegExp, from = 0) => calls(id, target, method, from).some((a) => text.test(JSON.stringify(a)));
  const widget = (id: string, name: string) => calls(id, 'hud', 'widget').filter((a) => a[0] === name);
  /** A widget's data on a screen now: what it was put up with, and every change since. */
  const widgetNow = (id: string, name: string): Record<string, unknown> | null => {
    let data: Record<string, unknown> | null = null;
    for (const e of events.get(id) ?? []) {
      if (e.t !== 'call' || e.call.target !== 'hud' || e.call.args[0] !== name) continue;
      if (e.call.method === 'widget') data = { ...(e.call.args[1] as Record<string, unknown>) };
      else if (e.call.method === 'widgetSet' && data) Object.assign(data, e.call.args[1]);
      else if (e.call.method === 'widgetRemove') data = null;
    }
    return data;
  };

  // ---- Looking and doing ----
  const nameAt = (c: Vec3) => world.blockName(world.getBlock(c.x, c.y, c.z));
  const centre = (c: Vec3): Vec3 => ({ x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5 });
  const aim = (id: string, at: Vec3) => {
    const e = player(id).eye;
    const [dx, dy, dz] = [at.x - e.x, at.y - e.y, at.z - e.z];
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  };
  const flat = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
  const put = (id: string, at: Vec3) => {
    player(id).teleport(at);
    run(0.3);
  };
  /** Hold the left button on a block for a while (or until it's gone). */
  const mine = (id: string, cell: Vec3, seconds: number) => {
    const was = nameAt(cell);
    act(id, { ...aim(id, centre(cell)), buttons: 1, clicked: 1 });
    return run(seconds, { [id]: () => ({ ...aim(id, centre(cell)), buttons: 1 }) }, () => nameAt(cell) !== was);
  };
  /** An item in hand: given if they've none, then its number key. */
  const hold = (id: string, item: string, n = 1) => {
    const p = player(id);
    if (count(p, item) < n) give(p, item, n - count(p, item));
    let slot = p.inventory.slots.findIndex((x) => x?.item === item);
    if (slot < 0) {
      // (Materials go to the pack: onto the belt by way of the journal's slots.)
      const from = survivorOf(p).bag.findIndex((x) => x?.item === item);
      const free = p.inventory.slots.findIndex((x) => !x);
      check(from >= 0 && free >= 0, `${p.name} can't bring ${item} to the belt`);
      press(id, 'Tab');
      journal(id, 'slot', `b${from}`);
      journal(id, 'slot', `h${free}`);
      journal(id, 'close');
      slot = p.inventory.slots.findIndex((x) => x?.item === item);
    }
    press(id, `Digit${slot + 1}`);
    check(p.inventory.held?.item === item, `${p.name} holds ${item} (${p.inventory.held?.item})`);
  };
  /** Right-click with what's in hand on top of a ground cell. */
  const placeOn = (id: string, ground: Vec3) => {
    const top = { x: ground.x + 0.5, y: ground.y + 1, z: ground.z + 0.5 };
    run(0.15, { [id]: () => aim(id, top) });
    act(id, { ...aim(id, top), buttons: 4, clicked: 4 });
    run(0.15, { [id]: () => aim(id, top) });
  };
  /** Where a door's leaf is in its cell, by the way it faces (it's a thin board at one side). */
  const LEAF: Record<string, [number, number]> = { north: [0.5, 0.92], south: [0.5, 0.08], east: [0.08, 0.5], west: [0.92, 0.5] };
  const useAt = (id: string, cell: Vec3, key = 'KeyE') => {
    const leaf = LEAF[String(world.blockInfo(world.getBlock(cell.x, cell.y, cell.z))?.state.facing)];
    const at = nameAt(cell).includes('door') && leaf ? { x: cell.x + leaf[0], y: cell.y + 0.45, z: cell.z + leaf[1] } : { x: cell.x + 0.5, y: cell.y + 0.45, z: cell.z + 0.5 };
    run(0.15, { [id]: () => aim(id, at) });
    press(id, key, aim(id, at));
  };

  // ---- Three arrive ----
  const gus = join('Gus');
  const ann = join('Ann', { id: 'acct-ann', name: 'Ann', avatar: null });
  const bob = join('Bob', { id: 'acct-bob', name: 'Bob', avatar: null });
  run(1);
  const [Gus, Ann, Bob] = [player(gus), player(ann), player(bob)];
  check(game.players.length === 3 && new Set([gus, ann, bob]).size === 3, 'three survivors, each their own');
  check(Ann.account?.id === 'acct-ann' && Bob.account?.id === 'acct-bob' && !Gus.account, 'two signed in, one a guest');
  check([gus, ann, bob].every((id) => player(id).alive && widget(id, 'bt-vitals').length > 0), 'each alive, with their own meters on their screen');
  check(ownerKey(Ann) !== ownerKey(Bob) && ownerKey(Gus) !== ownerKey(Ann), 'and their own owner key');
  // No wild animals but the ones the scenes bring: a herd wandering through would be in the way.
  census.paused = true;
  for (const b of [...brains.values()]) {
    brains.delete(b.e.id);
    b.e.remove();
  }

  // Level sand to stand and build on: a 9 x 7 patch at one height with air above, nearest the landing.
  const site = (() => {
    const p = Ann.position;
    for (let r = 0; r < 40; r++)
      for (let i = 0; i < 24; i++) {
        const [x, z] = [Math.floor(p.x + Math.cos((i / 24) * Math.PI * 2) * r), Math.floor(p.z + Math.sin((i / 24) * Math.PI * 2) * r)];
        const y = world.surfaceY(x, z);
        let ok = true;
        for (let dx = 0; dx < 9 && ok; dx++)
          for (let dz = 0; dz < 7 && ok; dz++) ok = nameAt({ x: x + dx, y, z: z + dz }) === 'sand' && nameAt({ x: x + dx, y: y + 1, z: z + dz }) === 'air' && nameAt({ x: x + dx, y: y + 2, z: z + dz }) === 'air';
        if (ok) return { x, y, z };
      }
    throw new Error('no level sand near the landing beach');
  })();
  const ground = (dx: number, dz: number): Vec3 => ({ x: site.x + dx, y: site.y, z: site.z + dz });
  const over = (dx: number, dz: number): Vec3 => ({ x: site.x + dx, y: site.y + 1, z: site.z + dz });
  const standAt = (dx: number, dz: number): Vec3 => ({ x: site.x + dx + 0.5, y: site.y + 1.05, z: site.z + dz + 0.5 });

  // ---- Packs and levels are each survivor's own ----
  put(ann, standAt(1, 5));
  put(bob, standAt(3, 5));
  put(gus, standAt(7, 5));
  const m0 = { ann: mark(ann), bob: mark(bob), gus: mark(gus) };
  const sand = ground(1, 4);
  check(run(6, { [ann]: () => ({ ...aim(ann, { x: sand.x + 0.5, y: sand.y + 1, z: sand.z + 0.5 }), buttons: 1 }) }, () => count(Ann, 'stone') + count(Ann, 'flint') > 0), 'Ann forages the sand by hand');
  check(count(Bob, 'stone') + count(Bob, 'flint') + count(Gus, 'stone') + count(Gus, 'flint') === 0, 'and only Ann has what she found');
  check(calls(ann, 'message', 'bt.yield', m0.ann).length > 0 && calls(bob, 'message', 'bt.yield', m0.bob).length === 0 && calls(gus, 'message', 'bt.yield', m0.gus).length === 0, 'only her screen is told what she got');
  check(survivorOf(Ann).xp > 0 && survivorOf(Bob).xp === 0, 'only she earned experience');

  addXp(Ann, xpForLevel(4) + 1);
  run(0.3);
  check(levelOf(Ann) === 4 && levelOf(Bob) === 1 && levelOf(Gus) === 1, `Ann's level is hers alone (${levelOf(Ann)}, ${levelOf(Bob)}, ${levelOf(Gus)})`);
  check(heard(ann, 'hud', 'banner', /LEVEL 4/) && !heard(bob, 'hud', 'banner', /LEVEL/) && !heard(gus, 'hud', 'banner', /LEVEL/), 'and announced to her alone');
  check(widgetNow(ann, 'bt-vitals')?.lvl === 4 && widgetNow(bob, 'bt-vitals')?.lvl === 1, `each screen's meters show its own survivor (${widgetNow(ann, 'bt-vitals')?.lvl}, ${widgetNow(bob, 'bt-vitals')?.lvl})`);
  survivorOf(Bob).hunger = 12;
  run(1.2);
  check(widgetNow(bob, 'bt-vitals')?.food === 12 && (widgetNow(ann, 'bt-vitals')?.food as number) > 90, "Bob's hunger shows on Bob's screen, not Ann's");
  survivorOf(Bob).hunger = 90;

  // The journal: one's own, and no pressing another's buttons.
  give(Ann, 'wood', 2);
  give(Ann, 'thatch', 8);
  give(Ann, 'stone', 4);
  give(Bob, 'wood', 1);
  give(Bob, 'stone', 2);
  give(Bob, 'thatch', 4);
  press(ann, 'Tab');
  check(survivorOf(Ann).ui.open && !survivorOf(Bob).ui.open, "Tab opens Ann's journal, not Bob's");
  check(widgetNow(ann, 'bt-journal') !== null && widget(bob, 'bt-journal').length === 0 && widget(gus, 'bt-journal').length === 0, 'and it is on her screen alone');
  journal(bob, 'make', 'stone_pick');
  check(survivorOf(Bob).queue.length === 0 && count(Bob, 'stone') === 2, 'a button of a journal that is not open on his screen does nothing for Bob');
  journal(ann, 'tab', 'craft');
  journal(ann, 'make', 'stone_pick');
  check(survivorOf(Ann).queue.length === 1 && survivorOf(Bob).queue.length === 0, 'Ann starts a pick: her queue, not his');
  press(bob, 'Tab');
  journal(bob, 'tab', 'craft');
  journal(bob, 'make', 'stone_pick');
  run(3);
  check(count(Ann, 'stone_pick') === 1 && count(Bob, 'stone_pick') === 1 && count(Gus, 'stone_pick') === 0, 'each makes their own pick from their own materials');
  check(count(Ann, 'thatch') === 4 && count(Bob, 'thatch') === 0, `and pays for it alone (${count(Ann, 'thatch')}, ${count(Bob, 'thatch')})`);
  journal(ann, 'close');
  journal(bob, 'close');

  // ---- A wall, a door and a box are their builder's ----
  const wall = over(1, 2);
  hold(ann, 'bt_wood_wall', 3);
  placeOn(ann, ground(1, 2));
  check(nameAt(wall) === 'bt_wood_wall' && ownerOf(wall) === ownerKey(Ann), `Ann's wall stands and is hers (${nameAt(wall)}, ${ownerOf(wall)})`);
  check(canBuild(Ann, wall) && !canBuild(Bob, wall) && !canBuild(Gus, wall), 'only she may touch it');
  // Bob tries to take it down, pick in hand.
  hold(bob, 'stone_pick');
  put(bob, standAt(1, 4));
  let m = mark(bob);
  const mAnn = mark(ann);
  mine(bob, wall, 4);
  check(nameAt(wall) === 'bt_wood_wall', "Bob can't break Ann's wall");
  check(heard(bob, 'message', 'bt.hint', /Not yours|Ann/, m), `and is told whose it is (${JSON.stringify(calls(bob, 'message', 'bt.hint', m))})`);
  check(calls(ann, 'message', 'bt.hint', mAnn).length === 0, "which Ann's screen doesn't hear");
  // Nor build right beside it; further off he may.
  hold(bob, 'bt_wood_wall', 2);
  m = mark(bob);
  placeOn(bob, ground(2, 3));
  check(nameAt(over(2, 3)) === 'air' && heard(bob, 'message', 'bt.hint', /Too close/, m), `Bob can't build against Ann's wall (${nameAt(over(2, 3))})`);
  put(bob, standAt(7, 4));
  placeOn(bob, ground(7, 2));
  const bobWall = over(7, 2);
  check(nameAt(bobWall) === 'bt_wood_wall' && ownerOf(bobWall) === ownerKey(Bob), `six blocks off, Bob builds his own (${nameAt(bobWall)}, ${ownerOf(bobWall)})`);
  check(!canBuild(Ann, bobWall), "which Ann can't touch either");

  // A door: E opens it for its owner only.
  const door = over(2, 2);
  put(ann, standAt(2, 4));
  hold(ann, 'bt_wood_door');
  placeOn(ann, ground(2, 2));
  const facing = () => world.blockInfo(world.getBlock(door.x, door.y, door.z))?.state.facing;
  check(nameAt(door) === 'bt_wood_door' && ownerOf(door) === ownerKey(Ann), `Ann hangs a door (${nameAt(door)})`);
  const shut = facing();
  put(ann, standAt(0, 5));
  put(bob, standAt(2, 4));
  m = mark(bob);
  useAt(bob, door);
  check(facing() === shut, "Bob's E doesn't open Ann's door");
  check(heard(bob, 'message', 'bt.hint', /Not yours|Ann/, m), 'and he is told why');
  put(bob, standAt(7, 5));
  put(ann, standAt(2, 4));
  useAt(ann, door);
  check(facing() !== shut, `Ann's E opens it (${shut} to ${facing()})`);
  useAt(ann, door);
  check(facing() === shut, 'and shuts it again');

  // A box: its owner's alone, through E and through any journal.
  const box = over(0, 2);
  put(ann, standAt(0, 4));
  hold(ann, 'bt_storage');
  placeOn(ann, ground(0, 2));
  check(nameAt(box).startsWith('bt_storage') && ownerOf(box) === ownerKey(Ann), `Ann sets down a box (${nameAt(box)})`);
  give(Ann, 'wood', 30);
  useAt(ann, box);
  const boxId = survivorOf(Ann).ui.container;
  check(survivorOf(Ann).ui.open && boxId, 'E opens it for her');
  journal(ann, 'stowall');
  journal(ann, 'close');
  const inBox = () => containerContents(boxId!).reduce((n, s) => n + (s.item === 'wood' ? s.count : 0), 0);
  check(inBox() >= 30 && count(Ann, 'wood') === 0, `her wood is in the box (${inBox()})`);
  put(ann, standAt(4, 5));
  put(bob, standAt(0, 4));
  m = mark(bob);
  useAt(bob, box);
  check(!survivorOf(Bob).ui.open && survivorOf(Bob).ui.container === null, "Bob's E doesn't open Ann's box");
  check(heard(bob, 'message', 'bt.hint', /Not yours|Ann/, m), 'and he is told why');
  // His own journal has no way into it.
  press(bob, 'Tab');
  journal(bob, 'takeall');
  journal(bob, 'slot', 'c0');
  journal(bob, 'send');
  journal(bob, 'close');
  check(inBox() >= 30 && count(Bob, 'wood') === 0, "nor do his own journal's buttons reach into it");
  mine(bob, box, 3);
  check(nameAt(box).startsWith('bt_storage') && inBox() >= 30, "and he can't break it open");

  // ---- A tribe shares: asked in, Bob opens Ann's door and box; out again, he doesn't ----
  say(ann, 'tribe create Reds');
  say(ann, 'tribe invite Bob');
  check(!sameTribe(Ann, Bob) && !canBuild(Bob, door), 'an invitation alone shares nothing');
  check(heard(bob, 'hud', 'toast', /Reds/) && !heard(gus, 'hud', 'toast', /Reds/), 'the invitation reaches Bob, and only Bob');
  say(bob, 'tribe accept');
  check(sameTribe(Ann, Bob) && canBuild(Bob, wall) && canBuild(Bob, door) && canBuild(Ann, bobWall), 'in one tribe, each may touch the other\'s pieces');
  check(!canBuild(Gus, wall) && !sameTribe(Ann, Gus), 'which lets nobody else in');
  useAt(bob, box);
  check(survivorOf(Bob).ui.open && survivorOf(Bob).ui.container === boxId, "Bob opens his tribe mate's box");
  journal(bob, 'close');
  put(bob, standAt(2, 4));
  useAt(bob, door);
  check(facing() !== shut, 'and her door');
  useAt(bob, door);
  check(facing() === shut, 'and shuts it');
  say(bob, 'tribe leave');
  check(!sameTribe(Ann, Bob) && !canBuild(Bob, door) && !canBuild(Bob, box) && !canBuild(Ann, bobWall), 'out of the tribe, it is as it was');
  m = mark(bob);
  useAt(bob, door);
  check(facing() === shut && heard(bob, 'message', 'bt.hint', /Not yours|Ann/, m), "Ann's door is shut to him again");
  put(bob, standAt(7, 5));

  // A guest builds too, and while they're here it's theirs.
  hold(gus, 'bt_thatch_wall');
  put(gus, standAt(4, 4));
  placeOn(gus, ground(4, 6));
  const gusWall = over(4, 6);
  check(nameAt(gusWall) === 'bt_thatch_wall' && ownerOf(gusWall) === ownerKey(Gus) && ownerKey(Gus).startsWith('g:'), `the guest's wall is the guest's (${ownerOf(gusWall)})`);
  check(!canBuild(Ann, gusWall) && !canBuild(Bob, gusWall), 'and nobody else may touch it while they are here');

  // ---- A tame: seen by all, ordered by its owner ----
  const dodoBy = (id: string, dx: number, dz: number): Brain => {
    const at = standAt(dx, dz);
    const b = spawnAnimal(game, 'dodo', at.x, at.z, newHerd(at.x, at.z), site.y + 1);
    check(b, 'a dodo on the sand');
    void id;
    return b;
  };
  const middle = (b: Brain): Vec3 => ({ x: b.e.position.x, y: b.e.position.y + 0.45, z: b.e.position.z });
  put(ann, standAt(4, 5));
  put(bob, standAt(6, 5));
  const dodo = dodoBy(ann, 5, 3);
  hold(ann, 'berries', 12);
  hold(bob, 'berries', 5);
  let tick = 0;
  /** Looking at an animal, walking up to it, E every so often. */
  const tend = (id: string, b: Brain, every = 20) => () => ({ ...aim(id, middle(b)), down: flat(player(id).position, b.e.position) > 2.2 ? ['KeyW'] : [], pressed: tick++ % every === 0 ? ['KeyE'] : [] });
  check(run(20, { [ann]: tend(ann, dodo) }, () => dodo.trust > 0), 'the dodo takes a berry from Ann');
  // Bob can't cut in while she's at it.
  m = mark(bob);
  const bobBerries = count(Bob, 'berries');
  run(1.5, { [bob]: tend(bob, dodo, 10), [ann]: () => aim(ann, middle(dodo)) });
  check(count(Bob, 'berries') === bobBerries && heard(bob, 'hud', 'toast', /Someone else is taming it/, m), `Bob can't feed the dodo Ann is taming (${JSON.stringify(calls(bob, 'hud', 'toast', m))})`);
  const feedMark = { ann: mark(ann), bob: mark(bob), gus: mark(gus) };
  check(run(40, { [ann]: tend(ann, dodo) }, () => !!dodo.tame), `Ann befriends the dodo (trust ${dodo.trust.toFixed(0)}%)`);
  const rec = dodo.tame!;
  run(1);
  check(rec.owner === ownerKey(Ann) && rec.ownerName === 'Ann', 'it is hers');
  check(heard(ann, 'hud', 'banner', /is yours/, feedMark.ann) && !heard(bob, 'hud', 'banner', /is yours/) && !heard(gus, 'hud', 'banner', /is yours/), 'only she is told it is hers');
  check([ann, bob, gus].every((id) => heard(id, 'hud', 'feed', /Ann tamed a Dodo/)), 'and everyone hears the news');
  // Everyone near sees its name tag: green for its owner, and whose it is for the rest.
  const tag = (id: string) => calls(id, 'hud', 'marker').filter((a) => a[0] === `bt_tame:${rec.id}` && a[1] !== null).at(-1)?.[2] as { color?: string; label?: string; sub?: string } | undefined;
  check(tag(ann)?.label?.startsWith(rec.name) && tag(bob)?.label?.startsWith(rec.name), `both see the same tame (${JSON.stringify(tag(ann))}, ${JSON.stringify(tag(bob))})`);
  check(tag(ann)?.sub === undefined && tag(bob)?.sub === "Ann's Dodo" && tag(ann)?.color !== tag(bob)?.color, "marked as Ann's on Bob's screen");

  // Orders: R is the owner's.
  type Menu = { title: string; sections: { entries: { label: string; onSelect?: { $cb: number } }[] }[] };
  const menus = (id: string, from = 0) => calls(id, 'hud', 'menu', from).map((a) => a[1] as Menu);
  put(bob, { x: dodo.e.position.x + 1.6, y: site.y + 1.05, z: dodo.e.position.z });
  m = mark(bob);
  run(0.2, { [bob]: () => aim(bob, middle(dodo)) });
  press(bob, 'KeyR', aim(bob, middle(dodo)));
  check(menus(bob, m).length === 0 && heard(bob, 'hud', 'toast', /Ann's Dodo/, m), `R on Ann's dodo gives Bob no orders, and says whose it is (${JSON.stringify(calls(bob, 'hud', 'toast', m))})`);
  press(bob, 'KeyE', aim(bob, middle(dodo)));
  check(menus(bob, m).length === 0 && rec.owner === ownerKey(Ann), 'nor does E');
  put(ann, { x: dodo.e.position.x, y: site.y + 1.05, z: dodo.e.position.z + 1.8 });
  m = mark(ann);
  run(0.2, { [ann]: () => aim(ann, middle(dodo)) });
  press(ann, 'KeyR', aim(ann, middle(dodo)));
  const orders = menus(ann, m).find((x) => x.title === rec.name);
  check(orders, `R gives Ann her dodo's orders (${JSON.stringify(menus(ann, m).map((x) => x.title))})`);
  check(menus(bob).every((x) => x.title !== rec.name), "which Bob's screen never shows");
  const entry = (label: string) => orders.sections.flatMap((s) => s.entries).find((e) => e.label === label);
  // Bob presses the buttons of Ann's menu by their numbers: nothing.
  host.command(bob, { t: 'message', msg: { t: 'callback', player: bob, id: entry('Set it free')!.onSelect!.$cb } });
  host.command(bob, { t: 'message', msg: { t: 'callback', player: bob, id: entry('Stay')!.onSelect!.$cb } });
  step();
  check(dodo.tame === rec && rec.order === 'follow' && tames.has(rec.id), "Bob can't press Ann's menu");
  host.command(ann, { t: 'message', msg: { t: 'callback', player: ann, id: entry('Stay')!.onSelect!.$cb } });
  step();
  check((rec.order as string) === 'stay', 'Ann tells it to stay, and it is told');
  // Nor can Bob hurt it.
  hold(bob, 'stone_pick');
  const hp = dodo.e.health;
  run(2.5, { [bob]: () => ({ ...aim(bob, middle(dodo)), buttons: 1, clicked: tick++ % 15 === 0 ? 1 : 0 }) });
  check(dodo.e.alive && dodo.e.health === hp && dodo.tame === rec, `Bob's pick does nothing to Ann's dodo (${dodo.e.health} of ${hp})`);

  // The guest has a tame of their own (the developer's shortcut: this is about what happens to it).
  const guestDodo = dodoBy(gus, 7, 1);
  put(gus, standAt(7, 3));
  run(0.3, { [gus]: () => aim(gus, middle(guestDodo)) });
  controls.set(gus, aim(gus, middle(guestDodo)));
  const tamed = say(gus, 'tameit');
  check(guestDodo.tame?.owner === ownerKey(Gus), `the guest tames a dodo (${JSON.stringify(tamed)})`);
  const guestRec = guestDodo.tame!;
  check(game.store.get(`tame:${guestRec.id}`) !== undefined, 'kept while they are here');

  // ---- A death is private, and so is the pack it leaves ----
  put(ann, standAt(4, 6));
  put(bob, standAt(8, 6));
  give(Ann, 'fiber', 20);
  const annHad = { fiber: count(Ann, 'fiber'), pick: count(Ann, 'stone_pick') };
  const bobHad = count(Bob, 'stone_pick');
  const fell = { ...Ann.position };
  const mDeath = { bob: mark(bob), gus: mark(gus) };
  Ann.damage(1000);
  run(0.3);
  check(!Ann.alive && Bob.alive && Gus.alive, 'Ann dies; the others do not');
  check(heard(ann, 'hud', 'banner', /YOU DIED/) && !heard(bob, 'hud', 'banner', /YOU DIED/, mDeath.bob) && !heard(gus, 'hud', 'banner', /YOU DIED/, mDeath.gus), 'only her screen says so');
  check(count(Ann, 'fiber') === 0 && count(Bob, 'stone_pick') === bobHad, 'she drops what she carried; Bob keeps his');
  check(calls(bob, 'hud', 'marker', mDeath.bob).every((a) => a[0] !== 'bt-lost-pack') , "her pack's marker is on her screen alone");
  // Bob stands on her pack and presses E.
  put(bob, fell);
  press(bob, 'KeyE');
  check(!survivorOf(Bob).ui.open && count(Bob, 'fiber') === 0, "Bob can't open Ann's lost pack");
  check(run(8, {}, () => Ann.alive), 'Ann wakes');
  put(bob, standAt(8, 6));
  put(ann, fell);
  run(1);
  press(ann, 'KeyE');
  check(survivorOf(Ann).ui.open && survivorOf(Ann).ui.container?.startsWith('pack-'), 'and opens her own pack');
  journal(ann, 'takeall');
  check(count(Ann, 'fiber') === annHad.fiber && count(Ann, 'stone_pick') === annHad.pick, 'everything comes back to her');
  check(loaded.get(rec.id)?.e.alive && rec.owner === ownerKey(Ann), 'her dodo is still hers');

  // ---- Bob leaves in the middle of things; nothing breaks for the others ----
  addXp(Bob, xpForLevel(3) + 1);
  give(Bob, 'wood', 7);
  give(Bob, 'thatch', 4);
  give(Bob, 'stone', 2);
  press(bob, 'Tab');
  journal(bob, 'tab', 'craft');
  journal(bob, 'make', 'stone_pick');
  // He has a dodo at his heels and is in the saddle of a parasaur when his connection drops.
  put(bob, standAt(7, 5));
  const heel = dodoBy(bob, 8, 3);
  run(0.3, { [bob]: () => aim(bob, middle(heel)) });
  controls.set(bob, aim(bob, middle(heel)));
  say(bob, 'tameit');
  const mountAt = standAt(4, 1);
  const para = spawnAnimal(game, 'parasaurolophus', mountAt.x, mountAt.z - 6, newHerd(mountAt.x, mountAt.z - 6));
  check(para && heel.tame?.owner === ownerKey(Bob), `Bob has a dodo (${heel.tame?.owner}) and a parasaur stands by`);
  const paraMiddle = (): Vec3 => ({ x: para.e.position.x, y: para.e.position.y + 1.6, z: para.e.position.z });
  run(0.3, { [bob]: () => aim(bob, paraMiddle()) });
  controls.set(bob, aim(bob, paraMiddle()));
  say(bob, 'tameit');
  check(para.tame?.owner === ownerKey(Bob) && para.tame.saddled, 'the parasaur is his, and saddled');
  const mount = para.tame!;
  const heelRec = heel.tame!;
  // Ann can't ride it.
  put(ann, { x: para.e.position.x + 2.5, y: site.y + 1.05, z: para.e.position.z });
  m = mark(ann);
  run(0.2, { [ann]: () => aim(ann, paraMiddle()) });
  press(ann, 'KeyE', aim(ann, paraMiddle()));
  check(!Ann.vehicle && !rides.has(ann) && heard(ann, 'hud', 'toast', /Bob's/, m), "Ann can't mount Bob's parasaur");
  put(ann, standAt(0, 6));
  run(0.2, { [bob]: () => aim(bob, paraMiddle()) });
  for (let i = 0; i < 40 && !Bob.vehicle; i++) {
    put(bob, { x: para.e.position.x + 2.5, y: site.y + 1.05, z: para.e.position.z });
    run(0.2, { [bob]: () => aim(bob, paraMiddle()) });
    press(bob, 'KeyE', aim(bob, paraMiddle()));
  }
  check(Bob.vehicle && rides.has(bob) && !loaded.has(mount.id), 'E puts Bob in the saddle');
  run(1, { [bob]: () => ({ down: ['KeyW'] }) });
  const bobLeft = { level: levelOf(Bob), wood: count(Bob, 'wood'), at: { ...Bob.position }, belt: JSON.stringify(Bob.inventory.slots.map((x) => x && [x.item, x.count])) };
  host.disconnect(bob);
  events.delete(bob);
  run(3);
  check((game.players.length as number) === 2 && !game.players.some((p) => p.name === 'Bob'), 'Bob is gone');
  check(Ann.alive && Gus.alive, 'the others carry on');
  check(nameAt(bobWall) === 'bt_wood_wall' && ownerOf(bobWall) === 'a:acct-bob' && !canBuild(Ann, bobWall), "Bob's wall waits for him: still his, still out of Ann's reach");
  check(rides.size === 0 && loaded.get(mount.id)?.e.alive && tames.get(mount.id)?.owner === 'a:acct-bob', 'his mount stands where he vanished from its back, still his');
  check(loaded.get(heelRec.id)?.e.alive && tames.get(heelRec.id)?.owner === 'a:acct-bob', 'and his dodo waits, ownerless for now but not wild');
  check(game.store.get(`tame:${mount.id}`) !== undefined && game.store.get(`tame:${heelRec.id}`) !== undefined, 'both kept');
  // Ann's things work as before.
  put(ann, standAt(2, 4));
  useAt(ann, door);
  check(facing() !== shut, 'Ann still opens her door');
  useAt(ann, door);
  put(ann, standAt(0, 4));
  useAt(ann, box);
  check(survivorOf(Ann).ui.container === boxId, 'and her box');
  journal(ann, 'takeall');
  journal(ann, 'close');
  check(count(Ann, 'wood') >= 30, 'with her wood in it');
  give(Ann, 'flint', 2);
  give(Ann, 'thatch', 6);
  press(ann, 'Tab');
  journal(ann, 'tab', 'craft');
  journal(ann, 'make', 'stone_hatchet');
  journal(ann, 'close');
  check(survivorOf(Ann).queue.length === 1, 'and she starts on a hatchet');

  // ---- The guest leaves: their tame goes wild, their wall is anybody's ----
  const gusKey = ownerKey(Gus);
  host.disconnect(gus);
  events.delete(gus);
  run(2);
  check((game.players.length as number) === 1 && game.players[0] === Ann, 'only Ann is left');
  check(!tames.has(guestRec.id) && game.store.get(`tame:${guestRec.id}`) === undefined, "the guest's tame is nobody's now, and no record of it is kept");
  check(guestDodo.e.alive && guestDodo.tame === null && brains.get(guestDodo.e.id) === guestDodo, 'the dodo itself is wild again');
  check(tames.has(rec.id) && loaded.get(rec.id)?.e.alive, "Ann's dodo is unmoved");
  check(nameAt(gusWall) === 'bt_thatch_wall' && ownerOf(gusWall) === null && canBuild(Ann, gusWall), "the guest's wall stands, and is anybody's");
  check(run(4, {}, () => count(Ann, 'stone_hatchet') === 1), 'and what Ann was making through all this is made');

  // A new guest takes the first player's place. They are nobody the island has met.
  const hal = join('Hal');
  run(1);
  const Hal = player(hal);
  check(Hal && !Hal.account && (game.players.length as number) === 2, 'a new guest arrives');
  check(Hal.inventory.slots.every((x) => !x) && survivorOf(Hal).bag.every((x) => !x) && levelOf(Hal) === 1, 'with nothing, at level 1');
  check(widget(hal, 'bt-vitals').length > 0 && widget(hal, 'bt-journal').length === 0, 'and a screen of their own');
  check(!canBuild(Hal, wall) && !canBuild(Hal, bobWall), "Ann's and Bob's pieces are not theirs");
  // (A guest's key is their player id, which the next guest is handed: the departed guest's pieces were let go when they left.)
  check(ownerOf(gusWall) === null && canBuild(Ann, gusWall) && canBuild(Hal, gusWall), `a new guest under a departed guest's key (${ownerKey(Hal)}, ${gusKey}) doesn't inherit their wall: it stays anybody's (owner ${ownerOf(gusWall)})`);

  // ---- Bob comes back ----
  run(8); // (What's kept of a survivor is written within ten seconds of a change; his was at leaving.)
  const bob2 = join('Bob', { id: 'acct-bob', name: 'Bob', avatar: null });
  run(1);
  const Bob2 = player(bob2);
  check(Bob2.account?.id === 'acct-bob' && (game.players.length as number) === 3, 'Bob is back');
  check(levelOf(Bob2) === bobLeft.level && count(Bob2, 'wood') === bobLeft.wood, `as he left: level ${levelOf(Bob2)}, ${count(Bob2, 'wood')} wood (was ${bobLeft.level}, ${bobLeft.wood})`);
  check(JSON.stringify(Bob2.inventory.slots.map((x) => x && [x.item, x.count])) === bobLeft.belt, 'with his belt');
  check(flat(Bob2.position, bobLeft.at) < 1.5, `where he stood (${JSON.stringify(Bob2.position)})`);
  check(survivorOf(Bob2).queue.length === 1 || count(Bob2, 'stone_pick') === 2, 'the pick he was making still his to finish');
  check(canBuild(Bob2, bobWall) && !canBuild(Bob2, wall), 'his wall is his, Ann\'s is not');
  check(levelOf(Ann) === 4 && rec.owner === ownerKey(Ann), 'and Ann is who she was');
  // His animals know him.
  const mountNow = loaded.get(mount.id);
  check(mountNow?.e.alive, 'his parasaur is in the world');
  put(bob2, { x: mountNow.e.position.x + 2.5, y: mountNow.e.position.y + 0.1, z: mountNow.e.position.z });
  const at = (): Vec3 => ({ x: mountNow.e.position.x, y: mountNow.e.position.y + 1.6, z: mountNow.e.position.z });
  m = mark(bob2);
  run(0.2, { [bob2]: () => aim(bob2, at()) });
  press(bob2, 'KeyR', aim(bob2, at()));
  check(menus(bob2, m).some((x) => x.title === mount.name), `R gives Bob his parasaur's orders again (${JSON.stringify(calls(bob2, 'hud', 'toast', m))})`);

  // One account, twice at once (a second tab): "Bob" and "Bob 2". What one carries is one survivor's.
  const twin = join('Bob', { id: 'acct-bob', name: 'Bob', avatar: null });
  run(1);
  const Twin = player(twin);
  check(Twin && Twin.name !== Bob2.name && Twin.account?.id === 'acct-bob', `a second Bob arrives (${Twin?.name})`);
  check(count(Twin, 'wood') === 0 && Twin.inventory.slots.every((x) => !x) && count(Bob2, 'wood') > 0, `one account connected twice is still one survivor: the second window starts with nothing (${Twin.name}: ${count(Twin, 'wood')} wood)`);
  host.disconnect(twin);
  events.delete(twin);
  run(1);

  census.paused = false;
  host.dispose();
  for (const k of known) console.log(`  KNOWN: ${k}`);
}
