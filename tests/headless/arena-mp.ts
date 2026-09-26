import { readFileSync } from 'node:fs';
import type { EntityDefinition, ItemLook, SynthVoice } from '../../src/platform';
import type { Client } from '../../src/platform/api/client';
import { soundOf } from '../../src/platform/client/present';
import { sounds } from '../../src/platform/client-kits';
import { Content } from '../../src/platform/content';
import { GameHost } from '../../src/platform/host/game';
import { PLACEHOLDER_ICON } from '../../src/platform/looks';
import type { HostEvent } from '../../src/platform/net/protocol';
import arenaClient from '../../src/games/arena/client';
import { check, games } from './_harness';

/** The fields of an item that are its look (`ItemLook`): the Arena's server gives none. */
const LOOK_FIELDS = ['icon', 'hold', 'sounds', 'tracer', 'trail', 'drawIcon'] as const;
/** The engine's own sounds (`audio/sfx.ts`): every screen has them without a definition. */
const ENGINE_SOUNDS = ['hit', 'hurt', 'pickup', 'heal', 'wave', 'victory', 'defeat', 'spawn', 'click', 'countdown', 'lock', 'alarm'];

/**
 * Arena together: everyone's armed (at the start, in the countdown, mid-fight), waves grow with
 * the party, a fallen player sits the wave out and comes back, rewards for each, the fight is lost
 * only when everyone's down, and the last one out leaves it ready for the next.
 */
export default function arenaMultiplayer() {
  const def = games.find((g) => g.id === 'arena')!;
  const host = new GameHost(def, { engine: readFileSync('engine/pkg/voxel_engine_bg.wasm'), seed: 5, remote: true, radius: 6, budget: Infinity, player: { id: 'p1', name: 'Player' } });
  const game = host.sim.ctx;
  const events = new Map<string, HostEvent[]>();
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) for (const [id, b] of host.step(1 / 30)) events.set(id, [...(events.get(id) ?? []), ...b.events]);
  };
  const calls = (id: string, method: string) => (events.get(id) ?? []).flatMap((e) => (e.t === 'call' && e.call.method === method ? [e.call.args.map(String)] : []));
  const player = (name: string) => game.players.find((p) => p.name === name)!;
  const pickups = () => (host.sim as unknown as { items: { pickups: unknown[] } }).items.pickups.length;
  const join = (name: string) => {
    const c = host.connect(name);
    // (What the screen got on joining too: the game's definitions.)
    events.set(c.id, [...c.batch.events]);
    host.command(c.id, { t: 'start' });
    return c.id;
  };

  const ann = join('Ann');
  const bob = join('Bob');
  step(15);
  check(player('Ann').inventory.count('wooden_sword') === 1 && player('Bob').inventory.count('wooden_sword') === 1, 'both start with a sword');
  // Cat arrives during the countdown.
  const cat = join('Cat');
  step(5);
  check(player('Cat').inventory.count('wooden_sword') === 1, 'joined in the countdown: armed');

  // Wave 1 with three: 5 zombies, half as many again for each extra fighter.
  let zombies = 0;
  let cleared = -1;
  for (let i = 0; i < 30 * 40 && cleared < 0; i++) {
    step(1);
    for (const e of game.entities.all()) {
      if (e.type === 'zombie') zombies++;
      e.remove();
    }
    // Bob falls partway through.
    if (zombies >= 3 && player('Bob').alive) player('Bob').damage(1000);
    if (calls(ann, 'banner').some((a) => a[0] === 'Wave cleared!')) cleared = pickups();
  }
  check(zombies === 10, `wave 1 for three: ${zombies} zombies`);
  check(calls(bob, 'banner').some((a) => a[0] === 'YOU FELL') && calls(ann, 'feed').some((a) => a[0] === 'Bob is down'), 'Bob fell; the others hear');
  check(!calls(ann, 'screen').length, 'one down is not the end');
  check(player('Bob').alive && Math.hypot(player('Bob').position.x, player('Bob').position.z) < 3, `Bob back on the floor when the wave is won: ${JSON.stringify(player('Bob').position)}`);
  check(cleared === 6, `a reward set each: ${cleared} pickups`);
  // Each takes only their own: standing on the dais, Ann gets one bow, not three.
  for (const n of ['Bob', 'Cat']) player(n).teleport({ x: 20, y: 72, z: 0 });
  player('Ann').teleport({ x: 0.5, y: 72, z: 0.5 });
  step(60);
  check(player('Ann').inventory.count('bow') === 1 && player('Ann').inventory.count('arrow') === 18 && pickups() === 4, `Ann took her own reward only: ${player('Ann').inventory.count('bow')} bow, ${pickups()} left`);
  for (const n of ['Bob', 'Cat']) player(n).teleport({ x: 0.5, y: 72, z: 0.5 });
  step(60);
  check(pickups() === 0 && player('Bob').inventory.count('bow') === 1 && player('Cat').inventory.count('bow') === 1, 'and the others theirs');

  // Dan joins mid-fight in wave 2: a sword and the bow and arrows wave 1 gave out.
  step(30 * 14);
  const dan = join('Dan');
  step(5);
  const d = player('Dan').inventory;
  check(d.count('wooden_sword') === 1 && d.count('bow') === 1 && d.count('arrow') === 18, `late arrival caught up: ${d.slots.filter(Boolean).map((s) => `${s!.item}x${s!.count}`).join(' ')}`);
  check(calls(ann, 'feed').some((a) => a[0] === 'Dan joins the fight'), 'the others hear Dan joined');

  const looked = looks(events.get(ann) ?? []);

  // Everyone down: the fight's lost. Leavers count: Dan goes first, then the rest fall.
  host.disconnect(dan);
  for (const n of ['Ann', 'Bob']) player(n).damage(1000);
  step(10);
  check(!calls(ann, 'screen').length, 'Cat still standing');
  player('Cat').damage(1000);
  step(60);
  const screen = (events.get(ann) ?? []).flatMap((e) => (e.t === 'call' && e.call.method === 'screen' ? [e.call.args[1] as { title: string; subtitle: string }] : [])).at(-1);
  check(screen?.title === 'Defeated' && screen.subtitle.startsWith('Your party fell on wave 2'), `lost with everyone down: ${JSON.stringify(screen)?.slice(0, 120)}`);

  // Everyone leaves; the next person begins a fresh fight.
  for (const id of [ann, bob, cat]) host.disconnect(id);
  step(5);
  const eve = join('Eve');
  step(30 * 2);
  check(player('Eve').alive && player('Eve').inventory.count('wooden_sword') === 1 && player('Eve').inventory.count('bow') === 0, 'a fresh start for the next arrival');
  check(calls(eve, 'objective').some((a) => a[0].startsWith('First wave in')), 'the countdown begins again');
  host.dispose();
  return `3 armed (1 in the countdown) · wave 1 for three: ${zombies} zombies · Bob fell and came back · ${cleared} rewards, one set each · Dan caught up · lost when all were down · fresh for Eve · ${looked}`;
}

/**
 * How Ann's screen draws and plays the Arena (its client code: `client/looks.ts`, `client/sounds.ts`):
 * the server sent no voices and no item looks; every item has its look, the pike and the axe held as
 * their models, and every sound the server asked for, and every monster's, is one the screen has.
 */
function looks(seen: HostEvent[]): string {
  const content = seen.flatMap((e) => (e.t === 'content' ? [e.def] : []));
  check(!content.some((d) => d.kind === 'sound'), `the server defines no voices: ${content.flatMap((d) => (d.kind === 'sound' ? [d.name] : []))}`);
  const served = [...new Map(content.flatMap((d) => (d.kind === 'item' ? [[d.name, d] as const] : []))).values()];
  const lookish = served.filter((d) => LOOK_FIELDS.some((k) => k in d.def));
  check(served.length >= 10 && !lookish.length, `nor any item's look (${served.length} items): ${lookish.map((d) => `${d.name}: ${Object.keys(d.def)}`).join('; ')}`);
  check((served.find((d) => d.name === 'bow')?.def as { projectile?: string } | undefined)?.projectile === 'arrow', 'the bow shoots arrows the server draws');

  // The screen: the server's definitions, then the game's client code (after the standard voices, as its kits run first).
  const screen = new Content();
  for (const d of content) screen.apply(d);
  const voices = new Map<string, SynthVoice>();
  const client = {
    audio: { play() {}, define: (n: string, v: SynthVoice) => voices.set(n, v) },
    items: { look: (id: string, l: ItemLook) => screen.lookItem(id, l), get: (id: string) => screen.items.get(id) },
  } as unknown as Client;
  for (const k of sounds.standard()) k.setup?.(client);
  arenaClient.client.setup!(client);
  const item = (id: string) => screen.items.get(id);
  const bare = served.filter((d) => item(d.name)?.icon === PLACEHOLDER_ICON);
  check(!bare.length, `items with no look on the screen: ${bare.map((d) => d.name).join(', ')}`);
  check(item('pike')?.hold?.style === 'polearm' && item('pike')?.hold?.model?.atlas === 'arena' && item('battle_axe')?.hold?.style === 'axe', 'the pike and the axe held two-handed, as their models');
  check((item('bow') as { drawIcon?: string }).drawIcon === 'bow_pulling', 'the bow draws');

  // Every sound asked for, and every monster's, is one the screen has.
  const asked = seen.flatMap((e) => (e.t === 'call' && e.call.target === 'audio' && e.call.method === 'play' ? [e.call] : []));
  const heard = new Set(asked.flatMap((c) => soundOf(c.args[0] as string, c.args[1] as never, item)?.[0] ?? []));
  const mobs = content.flatMap((d) => (d.kind === 'entity' ? Object.values((d.def as EntityDefinition).sounds ?? {}) : []));
  const missing = [...heard, ...mobs].filter((n) => !voices.has(n) && !ENGINE_SOUNDS.includes(n));
  check(mobs.length >= 10 && !missing.length, `sounds the screen doesn't have: ${missing.join(', ')}`);
  check(['zombie', 'skeleton', 'spider', 'brute', 'slam', 'boss'].every((n) => voices.has(n)), `the game's own voices on the screen: ${[...voices.keys()].join(', ')}`);
  return `on a screen: ${served.length} items with their looks, ${voices.size} voices, ${heard.size} sounds asked for and ${new Set(mobs).size} monsters' all there`;
}
