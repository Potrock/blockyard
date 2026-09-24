import { readFileSync } from 'node:fs';
import { GameHost } from '../../src/platform/host/game';
import type { HostBatch, HostEvent, PlayerInput } from '../../src/platform/net/protocol';
import { check, games } from './_harness';

type Vec = { x: number; y: number; z: number };
type Team = { color: string; player: { name: string } | null; body: unknown; wallet: Record<string, number>; bed: boolean; eliminated: boolean; base: { spawn: Vec; bed: Vec[] } };

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

  // PvP: Bob stands in front of Ann; Ann swings until he's down.
  const [pa, pb] = host.sim.players;
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
}
