import type { Client, Node } from '@platform/client';
import { centre, centreNear } from '../geometry';
import type { ModelId } from '../modelids';
import type { View } from '../protocol';
import { CIVS } from '../rules/civs';
import { distance, within } from '../rules/hex';
import { TERRAINS } from '../rules/terrain';
import { cam, centreHere, toScreen, zoom } from './camera';
import { emblemEl } from './icons';
import { modelItem } from './models3d';
import { tileY } from './overlay';
import { store, teammate, type Splash } from './store';
import { h, type El } from './ui';

/**
 * How a game ends, on this screen, before its result card: the victory's moment, in the world and
 * framed like a film (dark bars above and below, its words in the lower one), then for one who lost
 * a sober card. Science: the spaceship lifts off from the winner's capital in smoke and flame and
 * climbs out of sight. Domination: the winner's colours rise over the last capital taken. Culture:
 * the camera draws back and the world's cities light up in the winner's colour, fireworks over
 * theirs. Diplomacy: the World Congress's hall, its seats filling with the vote. The turn limit: a
 * quiet sunset over the leader's capital, its lamps coming on. Each a few seconds, gone at a click;
 * with quick movement or combat off, a card only.
 */

type Rgb = [number, number, number];

/** The words for each way to win: the kick, and the line about the winner. */
const WORDS: Record<string, { kick: string; line: (name: string) => string; text: string }> = {
  science: { kick: 'Science victory', line: (n) => `${n}'s spaceship has left for the stars`, text: 'A new world awaits beyond the sky.' },
  domination: { kick: 'Domination victory', line: (n) => `${n} has conquered the world`, text: 'Every capital flies one banner now.' },
  culture: { kick: 'Cultural victory', line: (n) => `${n}'s culture has won the world`, text: 'Its songs and stories are everyone’s now.' },
  diplomatic: { kick: 'Diplomatic victory', line: (n) => `${n} is elected World Leader`, text: 'The nations of the world have chosen.' },
  score: { kick: 'The age ends', line: (n) => `${n} leads the world`, text: 'Time has run out; history will judge the rest.' },
};
const words = (how: string) => WORDS[how === 'time' ? 'score' : how] ?? WORDS.score;

const colourOf = (owner: number) => CIVS[store.view?.players[owner]?.civ ?? '']?.color ?? '#f2c14e';
function linear(hex: string): Rgb {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.pow(c / 255, 2.2)) as Rgb;
}

/** Whether the viewer won (they, or their team: one who fell with it too). */
const won = (v: View) => {
  const me = v.fallen ?? v.you;
  return v.over!.winner === me || teammate(v.over!.winner);
};

/** Where the moment happens: the last capital taken (domination), else the winner's capital; only where the viewer knows. */
function placeOf(v: View): number | undefined {
  const o = v.over!;
  let tile: number | undefined;
  if (o.how === 'domination') {
    const taken = v.replay?.events.filter((e) => e[1] === 'taken').pop();
    if (taken) tile = v.cities.find((c) => c.id === taken[2])?.tile;
  }
  tile ??= v.cities.find((c) => c.owner === o.winner && c.capital)?.tile;
  return tile !== undefined && store.known[tile] ? tile : undefined;
}

/** Open land two tiles from a city (its town and wonders keep to the tiles beside it), nearest the camera first: where its spaceship stands. */
function padBy(tile: number): number | undefined {
  const g = store.grid!;
  const open = (t: number) => {
    const s = store.terrain[t];
    return !!s && !TERRAINS[s.terrain]?.water && s.elevation !== 'mountain' && !!store.known[t] && !store.view?.cities.some((c) => c.tile === t);
  };
  return within(g, tile, 2)
    .filter((t) => distance(g, tile, t) === 2 && open(t))
    .sort((a, b) => centre(g, b).z - centre(g, a).z)[0];
}

/**
 * The moments a game just over brings: its victory's (in the world, if it's somewhere the viewer
 * knows and moments aren't off; else a card), then a sober card for one who lost.
 */
export function endingMoments(v: View, full: boolean): Splash[] {
  const o = v.over!;
  const winner = v.players[o.winner];
  const name = winner ? (CIVS[winner.civ]?.name ?? winner.name) : 'A civilization';
  const w = words(o.how);
  const tile = placeOf(v);
  const out: Splash[] = [];
  const kick = won(v) ? `Victory · ${w.kick}` : w.kick;
  const pad = o.how === 'science' && tile !== undefined ? padBy(tile) : undefined;
  if (full && (tile !== undefined || o.how === 'diplomatic')) out.push({ kick, title: w.line(name), text: w.text, ending: { how: o.how, winner: o.winner, tile, pad }, visit: pad ?? tile });
  else out.push({ kick, title: w.line(name), text: w.text, emblem: winner ? { civ: winner.civ } : undefined });
  const me = v.players[v.fallen ?? v.you];
  if (!won(v) && me && !(v.spectator && v.fallen === undefined))
    out.push({
      kick: 'Defeat',
      title: `${CIVS[me.civ]?.name ?? me.name} did not prevail`,
      text: `${name} has won. Your people will be remembered; the story of the game is in its replay.`,
      picture: `l_${me.civ}`,
      sober: true,
    });
  return out;
}

// -------------------------------------------------------------------------------------------------
// In the world

/** The moment under way: since when (the screen's seconds), what's happened of it (by name), the rocket, and how far off the camera was before it. */
let playing: { s: Splash; t0: number; done: Set<string>; node: Node | null; dist: number } | null = null;
/** How far off the camera looks at the moment (blocks): close in, or (culture) drawn back over the world. */
const CLOSE = 36;
const WIDE = 95;
/** The spaceship's size (a voxel a sixteenth of a block at 1: about eight blocks tall). */
const SHIP_SCALE = 3.2;
/** The cities lit at a culture victory, at most (the nearest). */
const BEACONS = 40;
/** When each recurring effect last went (by name). */
const every = new Map<string, number>();

/** A model in a holder in the scene, at a scale (null until its file is here). */
function model(client: Client, id: ModelId, scale: number): Node | null {
  const made = client.scene.item(modelItem(id));
  if (!made) return null;
  const holder = client.scene.node();
  made.node.scale.setScalar(scale);
  holder.add(made.node);
  client.scene.add(holder);
  return holder;
}

/** The moment's effects as its time goes by (`splash.ts` calls this each frame it's on show). */
export function frameEnding(client: Client, s: Splash) {
  const e = s.ending;
  const g = store.grid;
  if (!e || !g) return;
  const now = client.time;
  if (playing?.s !== s) {
    endingDone(client);
    playing = { s, t0: now, done: new Set(), node: null, dist: cam.dist };
    every.clear();
    zoom(CLOSE / cam.dist);
  }
  const p = playing;
  const t = now - p.t0;
  const once = (key: string, at: number, run: () => void) => {
    if (t >= at && !p.done.has(key)) {
      p.done.add(key);
      run();
    }
  };
  const repeat = (key: string, from: number, to: number, gap: number, run: () => void) => {
    if (t < from || t > to || now - (every.get(key) ?? -Infinity) < gap) return;
    every.set(key, now);
    run();
  };
  const fx = client.fx;
  const colour = linear(colourOf(e.winner));
  if (e.tile === undefined) return;
  // (Round a world that wraps, at the copy nearest the camera, all of it about that.)
  const c = centreHere(g, e.tile);
  const ground = tileY(e.tile) + 0.6;
  const at = { x: c.x, y: ground, z: c.z };
  switch (e.how) {
    case 'science': {
      // On its pad by the capital: the ship stands, its engines light, it climbs, faster and faster, out of sight.
      const pad = centreNear(g, e.pad ?? e.tile, c.x);
      const floor = tileY(e.pad ?? e.tile);
      if (!p.node) p.node = model(client, 'm_ship', SHIP_SCALE);
      const lift = t < 3 ? 0 : 0.5 * 6 * (t - 3) ** 2;
      const shake = t > 1.6 && t < 3.4 ? Math.sin(t * 60) * 0.05 : 0;
      p.node?.position.set(pad.x + shake, floor + lift, pad.z);
      const foot = { x: pad.x, y: floor + lift, z: pad.z };
      repeat('smoke', 1.6, 7, 0.04, () => fx.particles({ x: pad.x, y: floor + 0.4, z: pad.z }, [0.86, 0.86, 0.88], { count: t < 3.6 ? 10 : 4, speed: t < 3.6 ? 4 : 1.2, size: 2.2, gravity: -0.3, life: 3.4, spread: 1, up: 0.3, drag: 1, collide: false }));
      repeat('flame', 1.8, 9, 0.03, () => fx.particles(foot, Math.random() < 0.5 ? [1, 0.55, 0.1] : [1, 0.85, 0.4], { count: 8, speed: 1.4, size: 0.9, gravity: 8, life: 0.45, spread: 0.3, up: -2, glow: 3, collide: false }));
      repeat('glow', 2, 9, 0.08, () => fx.flare(foot, 2.4));
      once('liftoff', 3, () => {
        fx.flare(foot, 6);
        fx.shockwave({ x: pad.x, y: floor + 0.2, z: pad.z }, 9, '#e8e2d8');
      });
      break;
    }
    case 'domination':
      // The winner's colours rising over the city, a ring of their colour, fireworks.
      once('ring', 0.8, () => fx.shockwave(at, 7, colourOf(e.winner)));
      once('flare', 1.2, () => fx.flare({ ...at, y: at.y + 4 }, 4));
      repeat('banners', 0.8, 7, 0.05, () => {
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + 0.5;
          fx.particles({ x: c.x + Math.cos(a) * 2.2, y: ground, z: c.z + Math.sin(a) * 2.2 }, colour, { count: 4, speed: 0.1, size: 1.8, gravity: 0, life: 1.6, spread: 0.3, up: 0, velocity: { x: 0, y: 6, z: 0 }, glow: 2.4, collide: false });
        }
      });
      for (const [i, when] of [2.2, 3.8, 5.4].entries()) once(`fireworks${i}`, when, () => fx.fireworks({ ...at, y: at.y + 6 }, 5));
      break;
    case 'culture': {
      // The camera draws back; the cities light up in the winner's colour, nearest first; fireworks over theirs.
      once('back', 0.6, () => zoom(WIDE / cam.dist));
      // Each city, as it's reached, a beacon of the winner's colour from then on (those on the screen).
      const cities = (store.view?.cities ?? []).filter((x) => store.known[x.tile]).sort((a, b) => dist(a.tile) - dist(b.tile)).slice(0, BEACONS);
      const lit = cities.filter((_, i) => t >= 1 + i * 0.12);
      cities.forEach((x, i) =>
        once(`city${x.id}`, 1 + i * 0.12, () => {
          const spot = cityTop(x.tile);
          if (visible(spot)) fx.shockwave(spot, 5, colourOf(e.winner));
        }),
      );
      repeat('beacons', 1, 9, 0.12, () => {
        for (const x of lit) {
          const spot = cityTop(x.tile);
          if (visible(spot)) fx.particles(spot, colour, { count: 3, speed: 0.2, size: 3.2, gravity: 0, life: 1.8, spread: 0.9, up: 0, velocity: { x: 0, y: 8, z: 0 }, glow: 3, collide: false });
        }
      });
      for (const [i, when] of [2, 3.6, 5.2, 6.8].entries()) once(`fireworks${i}`, when, () => fx.fireworks({ ...at, y: at.y + 6 }, 5));
      break;
    }
    case 'diplomatic':
      for (const [i, when] of [1.5, 3.5].entries()) once(`fireworks${i}`, when, () => fx.fireworks({ ...at, y: at.y + 6 }, 4));
      break;
    default:
      // The turn limit: lamps coming on among the houses as the sun goes down.
      repeat('lamps', 2, 10, 0.12, () => {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 2.6;
        fx.particles({ x: c.x + Math.cos(a) * r, y: ground + 0.6 + Math.random() * 1.2, z: c.z + Math.sin(a) * r }, [1, 0.7, 0.3], { count: 1, speed: 0.05, size: 0.6, gravity: -0.15, life: 2.6, spread: 0.05, up: 0, glow: 3, collide: false });
      });
  }

  /** Over a city's middle (its houses' tops). */
  function cityTop(t: number) {
    const q = centreHere(g!, t);
    return { x: q.x, y: tileY(t) + 2, z: q.z };
  }

  /** Steps from the moment's tile. */
  function dist(t: number) {
    const a = centreNear(g!, t, c.x);
    return Math.hypot(a.x - c.x, a.z - c.z);
  }
}

const visible = (p: { x: number; y: number; z: number }) => {
  const s = toScreen(p.x, p.y, p.z);
  return !!s && s.x > -40 && s.y > -40 && s.x < window.innerWidth + 40 && s.y < window.innerHeight + 40;
};

/** The moment over: the rocket goes, the camera comes back in. */
export function endingDone(client: Client) {
  if (!playing) return;
  if (playing.node) client.scene.remove(playing.node);
  zoom(playing.dist / cam.dist);
  playing = null;
}

// -------------------------------------------------------------------------------------------------
// On the screen

/** The moment framed like a film: dark bars above and below (a warm dusk over it all at the turn limit), its words in the lower bar. */
export function endingScene(s: Splash, onclick: () => void): El {
  const e = s.ending!;
  const winner = store.view?.players[e.winner];
  if (e.how === 'diplomatic') return congressCard(s, onclick);
  return h(
    `div.en-scene${e.how === 'score' || e.how === 'time' ? '.dusk' : ''}`,
    { onclick },
    h('div.en-sky'),
    h('div.en-bar.top'),
    h(
      'div.en-bar.bottom',
      {},
      h('div.en-cap', {}, winner ? emblemEl(winner.civ, 44) : null, h('div', {}, h('div.kick', {}, s.kick), h('h2', {}, s.title), h('p', {}, s.text)), h('small.go', {})),
    ),
  );
}

/** The World Congress at the vote: its hall, the seats filling with each candidate's delegates, the winner's banner over the floor. */
function congressCard(s: Splash, onclick: () => void): El {
  const v = store.view!;
  const votes = v.unVotes?.votes ?? [];
  const needed = v.unVotes?.needed ?? 0;
  const top = votes[0];
  const tally = top ? `${v.players[top.candidate]?.name ?? '?'}: ${top.votes} votes, ${needed} needed` : '';
  return h(
    'div.cv-splash.cv-panel.en-congress',
    { onclick },
    h('div.kick', {}, s.kick),
    h('div.art.room', {}, hall(v, s.ending!.winner)),
    h('div.words', {}, h('h2', {}, s.title), h('p', {}, tally || s.text), h('small.go', {})),
  );
}

/** The hall's canvas (its pixels two of the screen's), drawn as the seats fill. */
function hall(v: View, winner: number): El {
  const W = 128;
  const H = 76;
  const canvas = h('canvas.dp-room', { width: String(W), height: String(H) }) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  // Each seat's colour: the delegates' candidates, the most first; abstaining seats grey.
  const seats: string[] = [];
  for (const x of v.unVotes?.votes ?? []) for (let i = 0; i < x.votes; i++) seats.push(colourOf(x.candidate));
  const rows = [{ r: 30, n: 13 }, { r: 40, n: 17 }, { r: 50, n: 21 }];
  const total = rows.reduce((n, x) => n + x.n, 0);
  while (seats.length < total) seats.push('#4a4f5a');
  const start = performance.now();
  const draw = () => {
    const k = Math.min(1, (performance.now() - start) / 2500);
    ctx.fillStyle = '#1c2230';
    ctx.fillRect(0, 0, W, H);
    // The back wall, its tall windows and the world's flags along it.
    ctx.fillStyle = '#2a3244';
    ctx.fillRect(0, 0, W, 26);
    for (let x = 8; x < W; x += 16) {
      ctx.fillStyle = '#3e5a86';
      ctx.fillRect(x, 4, 6, 16);
      ctx.fillStyle = '#5a7ab0';
      ctx.fillRect(x, 4, 6, 2);
    }
    v.players.filter((p) => !p.cityState && p.civ !== 'barbarian').forEach((p, i, all) => {
      const x = Math.round(14 + (i * (W - 28)) / Math.max(1, all.length - 1));
      ctx.fillStyle = '#9a8a6a';
      ctx.fillRect(x, 22, 1, 8);
      ctx.fillStyle = colourOf(p.index);
      ctx.fillRect(x + 1, 22, 4, 3);
    });
    // The floor, and the seats in rows round it, filling as the votes are counted.
    ctx.fillStyle = '#3a2e26';
    ctx.fillRect(0, 30, W, H - 30);
    let n = 0;
    const shown = Math.round(k * total);
    for (const row of rows)
      for (let i = 0; i < row.n; i++) {
        const a = Math.PI * (0.08 + (0.84 * i) / (row.n - 1));
        const x = Math.round(W / 2 - Math.cos(a) * row.r * 1.15);
        const y = Math.round(H - 6 - Math.sin(a) * row.r * 0.62);
        ctx.fillStyle = '#14161c';
        ctx.fillRect(x - 2, y - 1, 5, 4);
        ctx.fillStyle = n < shown ? seats[n] : '#2a2c33';
        ctx.fillRect(x - 1, y - 1, 3, 2);
        n++;
      }
    // The speaker's stand, and over it the winner's banner once the count is in.
    ctx.fillStyle = '#6a5a44';
    ctx.fillRect(W / 2 - 6, H - 12, 12, 8);
    if (k >= 1) {
      ctx.fillStyle = colourOf(winner);
      ctx.fillRect(W / 2 - 5, 28, 10, 14);
      ctx.fillStyle = '#07090c';
      ctx.fillRect(W / 2 - 5, 42, 10, 1);
    }
    if (k < 1) requestAnimationFrame(draw);
  };
  draw();
  return h('div.dp-scene.era', {}, canvas);
}

export const ENDING_CSS = `
.cv-root .en-scene { position: absolute; inset: 0; pointer-events: auto; cursor: pointer; }
.en-bar { position: absolute; left: 0; right: 0; background: #050608; }
.en-bar.top { top: 0; height: 11vh; animation: enBarTop .6s steps(6, end) both; }
.en-bar.bottom { bottom: 0; height: 24vh; min-height: 96px; animation: enBarBottom .6s steps(6, end) both; display: flex; align-items: center; justify-content: center; }
@keyframes enBarTop { from { transform: translateY(-100%); } to { transform: none; } }
@keyframes enBarBottom { from { transform: translateY(100%); } to { transform: none; } }
.en-cap { display: flex; align-items: center; gap: 16px; max-width: min(760px, 92vw); padding: 0 12px; animation: enIn 1s steps(5, end) .5s both; }
.en-cap .kick { font: 400 18px/1 'Jersey 10', monospace; letter-spacing: .1em; color: var(--gold); text-transform: uppercase; }
.en-cap h2 { margin: 2px 0 0; font: 400 36px/1 'Jersey 10', monospace; color: #fff; text-shadow: 2px 2px 0 #0b0d12; }
.en-cap p { margin: 4px 0 0; font: 400 14.5px/1.35 'Chakra Petch', system-ui, sans-serif; color: var(--muted); }
.en-cap small { align-self: flex-end; white-space: nowrap; font: 400 12px/1 'Chakra Petch', system-ui, sans-serif; color: var(--dim); }
@keyframes enIn { from { opacity: 0; } to { opacity: 1; } }
.en-sky { position: absolute; inset: 0; pointer-events: none; opacity: 0; }
.en-scene.dusk .en-sky { background: linear-gradient(180deg, rgba(60,30,80,.55) 0%, rgba(230,110,40,.35) 55%, rgba(30,15,30,.55) 100%); mix-blend-mode: multiply; animation: enDusk 6s ease-in both; }
@keyframes enDusk { from { opacity: 0; } to { opacity: 1; } }
.cv-splash.sober { filter: saturate(.35); }
.cv-splash.sober .kick { color: #9aa4b5 !important; }
.cv-splash.sober .art img { filter: grayscale(1) brightness(.85); }
.cv-splash.en-congress { width: min(480px, 92vw); }
@media (max-height: 520px) {
  .en-bar.top { height: 8vh; }
  .en-bar.bottom { height: 34vh; min-height: 0; }
  .en-cap { gap: 10px; }
  .en-cap .cv-em svg, .en-cap .cv-em img { width: 32px; height: 32px; }
  .en-cap h2 { font-size: 26px; }
  .en-cap p { font-size: 12.5px; }
  .en-cap small { display: none; }
}
@media (prefers-reduced-motion: reduce) { .en-bar, .en-cap, .en-sky { animation: none !important; opacity: 1; } }
`;
