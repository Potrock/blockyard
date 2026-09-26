import { readFileSync } from 'node:fs';
import type { IconRef, ItemLook, SynthVoice } from '../../src/platform';
import type { Client } from '../../src/platform/api/client';
import { soundOf } from '../../src/platform/client/present';
import { sounds } from '../../src/platform/client-kits';
import { Content } from '../../src/platform/content';
import { GameHost } from '../../src/platform/host/game';
import { PLACEHOLDER_ICON, resolveIcon } from '../../src/platform/looks';
import type { HostBatch, HostEvent, PlayerInput } from '../../src/platform/net/protocol';
import bedwarsClient from '../../src/games/bedwars/client';
import { BLOCK_ITEMS } from '../../src/games/bedwars/shared';
import { check, games } from './_harness';

type Vec = { x: number; y: number; z: number };
type Team = { color: string; player: { name: string } | null; body: unknown; wallet: Record<string, number>; bed: boolean; eliminated: boolean; base: { spawn: Vec; bed: Vec[]; shop: Vec; shopYaw: number } };

/** The fields of an item that are its look (`ItemLook`): Bed Wars' server gives none. */
const LOOK_FIELDS = ['icon', 'hold', 'sounds', 'tracer', 'trail', 'drawIcon'] as const;
/** The engine's own sounds (`audio/sfx.ts`): every screen has them without a definition. */
const ENGINE_SOUNDS = ['hit', 'hurt', 'pickup', 'heal', 'wave', 'victory', 'defeat', 'spawn', 'click', 'countdown', 'lock', 'alarm'];

/** Solo Bed Wars with people: seats, wallets, PvP, takeovers, beds and the end, per player. */
export default function bedwarsMultiplayer() {
  const def = games.find((g) => g.id === 'bedwars')!;
  const host = new GameHost(def, { engine: readFileSync('engine/pkg/voxel_engine_bg.wasm'), seed: 3, remote: true, radius: 6, budget: Infinity, cheats: true, player: { id: 'p1', name: 'Player' } });
  const bw = (globalThis as unknown as { __bw: { match: { teams: Team[] } } }).__bw;
  const teams = () => bw.match.teams;
  const seats = () => teams().map((t) => `${t.color}:${t.player?.name ?? (t.body ? 'bot' : '-')}`).join(' ');
  let last = new Map<string, HostBatch>();
  const events = new Map<string, HostEvent[]>();
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      last = host.step(1 / 30);
      for (const [id, b] of last) events.set(id, [...(events.get(id) ?? []), ...b.events]);
    }
  };
  const calls = (id: string, method: string) => (events.get(id) ?? []).flatMap((e) => (e.t === 'call' && e.call.method === method ? [e.call.args] : []));
  const feed = () => calls('p1', 'feed').map((a) => String(a[0]));

  const ann = host.connect('Ann');
  const annFirst = ann.batch.events;
  const bob = host.connect('Bob');
  host.command(ann.id, { t: 'start' });
  host.command(bob.id, { t: 'start' });
  step(10);
  check(seats() === 'red:Ann blue:Bob green:bot yellow:bot', `seats: ${seats()}`);
  const frame = () => last.get(ann.id)!.frame!;
  const fp = (id: string) => frame().players.find((p) => p.id === id)!;
  check(fp(ann.id).color === '#ff5b5b' && fp(bob.id).color === '#5d8dff' && fp(ann.id).skin?.uv.join() !== fp(bob.id).skin?.uv.join(), 'team colours and skins');

  // Wallets are per team.
  host.command(ann.id, { t: 'exec', id: 1, line: 'bw rich' });
  step(10);
  const [red, blue] = teams();
  check(red.wallet.iron >= 64 && blue.wallet.iron === 0, `Ann's wallet only: red ${red.wallet.iron}, blue ${blue.wallet.iron}`);
  check(calls(ann.id, 'stat').some((a) => a[0] === 'iron' && Number(a[2]) >= 64) && !calls(bob.id, 'stat').some((a) => a[0] === 'iron' && Number(a[2]) >= 64), 'each sees their own wallet');

  const [pa, pb] = host.sim.players;
  // The shop: Ann right-clicks the red shopkeeper.
  const keeper = red.base;
  const facing = { x: -Math.sin(keeper.shopYaw), z: -Math.cos(keeper.shopYaw) };
  pa.api.teleport({ x: keeper.shop.x + facing.x * 2.5, y: keeper.shop.y, z: keeper.shop.z + facing.z * 2.5 }, keeper.shopYaw + Math.PI, -0.15);
  step(2);
  const use = (clicked: number): PlayerInput => ({ active: true, down: [], pressed: [], buttons: clicked, clicked, mouseX: 0, mouseY: 0, wheel: 0, yaw: keeper.shopYaw + Math.PI, pitch: -0.15, viewSeq: pa.viewSeq });
  host.command(ann.id, { t: 'input', input: use(4) });
  step(1);
  host.command(ann.id, { t: 'input', input: use(0) });
  step(2);
  const shop = calls(ann.id, 'menu')
    .flatMap((a) => a)
    .find((o): o is { title: string; sections: { title: string; entries: { label: string; icon?: IconRef }[] }[] } => typeof o === 'object' && o !== null && 'sections' in o);
  check(shop?.title === 'Item Shop', `Ann's shop opened: ${JSON.stringify(calls(ann.id, 'menu')).slice(0, 200)}`);

  // PvP: Bob stands in front of Ann; Ann swings until he's down.
  const s = red.base.spawn;
  pa.api.teleport({ x: s.x, y: s.y, z: s.z }, 0, 0);
  pb.api.teleport({ x: s.x, y: s.y, z: s.z - 1.6 }, Math.PI, 0);
  step(2);
  const hp0 = pb.api.health;
  const swing = (clicked: number): PlayerInput => ({ active: true, down: [], pressed: [], buttons: clicked, clicked, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: -0.25, viewSeq: pa.viewSeq });
  let lowest = hp0;
  for (let i = 0; i < 40 && pb.api.alive; i++) {
    // Bob keeps stepping back in (a knockback sends him out of reach).
    pb.api.teleport({ x: s.x, y: s.y, z: s.z - 1.6 });
    host.command(ann.id, { t: 'input', input: swing(1) });
    step(1);
    lowest = Math.min(lowest, pb.api.health);
    host.command(ann.id, { t: 'input', input: swing(0) });
    step(16);
  }
  check(lowest < hp0, `Ann's sword hurt Bob: ${hp0} -> ${lowest}`);
  check(!pb.api.alive, 'Ann killed Bob');
  step(2);
  check(feed().some((f) => /Bob was (slain|knocked into the void) by Ann/.test(f)), `kill credit in the feed: ${feed().slice(-3).join(' | ')}`);
  check(calls(bob.id, 'banner').some((a) => a[0] === 'YOU DIED!') && !calls(ann.id, 'banner').some((a) => a[0] === 'YOU DIED!'), 'only Bob is told he died');

  // Cat joins mid-match and takes over green from its bot; Bob leaves and a bot plays blue.
  const cat = host.connect('Cat');
  host.command(cat.id, { t: 'start' });
  step(2);
  check(seats().startsWith('red:Ann blue:Bob green:Cat'), `Cat took green: ${seats()}`);
  host.disconnect(bob.id);
  step(30 * 6);
  check(seats() === 'red:Ann blue:bot green:Cat yellow:bot', `a bot plays blue after Bob's respawn time: ${seats()}`);
  check(feed().some((f) => f.includes('Cat takes over Green')) && feed().some((f) => f.includes('Bob left')), 'the feed tells of both');

  // Ann breaks Cat's bed: Cat hears it one way, Ann the other.
  const greenBed = teams()[2].base.bed[0];
  host.sim.breakBlockAt(greenBed.x, greenBed.y, greenBed.z, pa.api);
  step(2);
  check(!teams()[2].bed, 'green bed broken');
  check(calls(cat.id, 'banner').some((a) => a[0] === 'BED DESTROYED!') && calls(ann.id, 'banner').some((a) => a[0] === 'BED DESTRUCTION'), 'bed news, each their way');

  // The end: everyone but Ann is out.
  host.command(ann.id, { t: 'exec', id: 2, line: 'bw win' });
  step(70);
  const title = (id: string) => (calls(id, 'screen').at(-1)?.[1] as { title?: string } | undefined)?.title;
  check(title(ann.id) === 'VICTORY!' && title(cat.id) === 'GAME OVER', `result screens: Ann ${title(ann.id)}, Cat ${title(cat.id)}`);
  const errors = (events.get(ann.id) ?? []).filter((e) => e.t === 'error');
  check(!errors.length, `the game threw: ${errors.map((e) => (e.t === 'error' ? e.text.slice(0, 300) : '')).join(' | ')}`);
  console.log(`  seats, wallets, PvP kill, takeover, leaving, beds and results per player · feed: ${feed().slice(-4).join(' | ')}`);
  looks([...annFirst, ...(events.get(ann.id) ?? [])], shop!.sections);
}

/**
 * How Ann's screen draws and plays Bed Wars (its client code: `client/looks.ts`, `client/sounds.ts`):
 * the server sent no voices and no item looks; every item has its look, the shop's offers of items
 * name them and show them as the screen has them, and every sound the server asked for is one the
 * screen has.
 */
function looks(seen: HostEvent[], sections: { title: string; entries: { label: string; icon?: IconRef }[] }[]) {
  const content = seen.flatMap((e) => (e.t === 'content' ? [e.def] : []));
  check(!content.some((d) => d.kind === 'sound'), `the server defines no voices: ${content.flatMap((d) => (d.kind === 'sound' ? [d.name] : []))}`);
  const served = [...new Map(content.flatMap((d) => (d.kind === 'item' ? [[d.name, d] as const] : []))).values()];
  const lookish = served.filter((d) => LOOK_FIELDS.some((k) => k in d.def));
  check(served.length >= 25 && !lookish.length, `nor any item's look (${served.length} items): ${lookish.map((d) => `${d.name}: ${Object.keys(d.def)}`).join('; ')}`);
  check(served.find((d) => d.name === 'bow')?.def.kind === 'bow' && (served.find((d) => d.name === 'bow')!.def as { projectile?: string }).projectile === 'arrow', 'the bow shoots arrows the server draws');

  // The screen: the server's definitions, then the game's client code (after the standard voices, as its kits run first).
  const screen = new Content();
  for (const d of content) screen.apply(d);
  const voices = new Map<string, SynthVoice>();
  const client = {
    audio: { play() {}, define: (n: string, v: SynthVoice) => voices.set(n, v) },
    items: { look: (id: string, l: ItemLook) => screen.lookItem(id, l), get: (id: string) => screen.items.get(id) },
  } as unknown as Client;
  for (const k of sounds.standard()) k.setup?.(client);
  bedwarsClient.client.setup!(client);
  const item = (id: string) => screen.items.get(id);
  const bare = served.filter((d) => item(d.name)?.icon === PLACEHOLDER_ICON);
  check(!bare.length, `items with no look on the screen: ${bare.map((d) => d.name).join(', ')}`);
  for (const [id, block] of Object.entries(BLOCK_ITEMS)) check(JSON.stringify(item(id)?.icon) === JSON.stringify({ block }), `${id} looks like the ${block} it places: ${JSON.stringify(item(id)?.icon)}`);
  check(item('iron_sword_sharp')?.hold?.model === item('iron_sword')?.hold?.model && item('iron_sword')?.hold?.model, 'a sharpened sword looks like its plain one, held as its model');
  check((item('bow') as { drawIcon?: string }).drawIcon === 'bow_pulling', 'the bow draws');

  // The shop: its items by name, drawn as the screen has them; armour and the team upgrades as sprites of their own.
  const entries = sections.flatMap((s) => s.entries.map((e) => ({ ...e, section: s.title })));
  const byName = entries.filter((e) => typeof e.icon === 'object' && 'item' in e.icon);
  check(entries.filter((e) => e.section !== 'Team upgrades' && !e.label.includes('Armor')).every((e) => byName.includes(e)), `the shop names its items: ${JSON.stringify(entries.map((e) => [e.label, e.icon]))}`);
  for (const e of entries) {
    const drawn = resolveIcon(e.icon!, item);
    check(drawn && drawn !== PLACEHOLDER_ICON, `the shop's ${e.label} is drawn: ${JSON.stringify(e.icon)}`);
  }

  // Every sound asked for is one the screen has.
  const asked = seen.flatMap((e) => (e.t === 'call' && e.call.target === 'audio' && e.call.method === 'play' ? [e.call] : []));
  const heard = new Set(asked.flatMap((c) => soundOf(c.args[0] as string, c.args[1] as never, item)?.[0] ?? []));
  const missing = [...heard].filter((n) => !voices.has(n) && !ENGINE_SOUNDS.includes(n));
  check(heard.has('bed_break') && !missing.length, `sounds the screen doesn't have: ${missing.join(', ')} (heard ${[...heard].join(', ')})`);
  check(['bed_break', 'buy', 'eat', 'final_kill', 'fireball'].every((n) => voices.has(n)), `the game's own voices on the screen: ${[...voices.keys()].join(', ')}`);
  console.log(`  on Ann's screen: ${served.length} items, each with its look; ${voices.size} voices; the shop's ${byName.length} items by name (of ${entries.length} offers); ${heard.size} sounds asked for, all there`);
}
