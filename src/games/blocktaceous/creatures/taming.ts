import type { GameContext, Player } from '@platform';
import { take } from '../survival/bag';
import { go, provoke } from './ai';
import { adopt } from './tames';
import { Tags } from './tags';
import { brains, clock, flat, inPlay, itemName, near, type Brain } from './state';

/**
 * Making a wild animal yours. Gentle and nervous animals are befriended: come up to them calmly
 * (sneaking, or holding out what they like best), and feed them by hand (E) again and again
 * until they trust you. Dangerous ones have to be subdued first: a bola pins the smaller ones
 * for a few seconds, and a club or sleep darts fill a daze meter until the animal drops; then
 * it's fed while it's out, before the daze wears off. Hurting an animal costs its trust, and the
 * harder the species, the more feedings (and the longer between them) it takes.
 */

/** Daze a club's blow and a sleep dart add, and how long a bola holds (seconds). */
export const CLUB_DAZE = 16;
export const DART_DAZE = 28;
export const BOLA_HOLD = 10;

const scratch: Brain[] = [];

/** Add to an animal's daze; at its limit it drops, out cold. */
export function addDaze(game: GameContext, b: Brain, amount: number, by: Player) {
  if (b.tame || !b.e.alive) return;
  b.daze = Math.min(b.t.dazeMax, b.daze + amount);
  b.dazedAt = clock.now;
  if (b.ko || b.daze < b.t.dazeMax) return;
  b.ko = true;
  b.tamer = by.id;
  b.target = null;
  go(b, 'idle', 1e9);
  b.e.stop();
  game.audio.play('bt_thud', { at: b.e.position, pitch: b.t.big ? 0.7 : 1.1 });
  by.hud.toast(`The ${b.s.name} is out cold · feed it ${itemName(game, b.s.favorite)} (E)`);
}

/** A bola round its legs: a small enough animal is held where it stands for a while. */
export function stun(game: GameContext, b: Brain, by: Player | null) {
  if (b.tame || b.ko) return;
  if (!b.t.bolaable) {
    by?.hud.toast(`A ${b.s.name} is too big for a bola`);
    return;
  }
  b.stunUntil = clock.now + BOLA_HOLD;
  b.target = null;
  go(b, 'idle', BOLA_HOLD);
  b.e.stop();
  game.audio.play('bt_thud', { at: b.e.position, pitch: 1.5 });
}

/** It came round: awake, half its trust gone, and after whoever knocked it out. */
function wake(game: GameContext, b: Brain) {
  b.ko = false;
  b.daze = 0;
  b.trust *= 0.5;
  go(b, 'idle', 1);
  const tamer = game.players.find((p) => p.id === b.tamer);
  if (tamer && inPlay(tamer) && flat(tamer.position, b.e.position) < 30) provoke(b, tamer, game);
}

/** E on a wild animal: offer it food. */
export function offerFood(game: GameContext, player: Player, b: Brain) {
  const s = b.s;
  const food = itemName(game, s.favorite);
  const held = clock.now < b.stunUntil;
  if (b.tamer && b.tamer !== player.id && b.trust > 0 && game.players.some((p) => p.id === b.tamer && flat(p.position, b.e.position) < 20)) return player.hud.toast('Someone else is taming it');
  if (!b.ko && !held) {
    if (b.t.method === 'knockout') return player.hud.toast(`A wild ${s.name} won't be fed · knock it out first (a club, sleep darts${b.t.bolaable ? ', or pin it with a bola' : ''})`);
    if (b.mode === 'flee' || b.mode === 'hunt' || b.mode === 'air' || b.mode === 'land') return player.hud.toast(`It's too wary · sneak up, or hold ${food} in your hand`);
  }
  if (clock.now < b.feedAt) return player.hud.toast("It's still chewing");
  if (!take(player, s.favorite, 1)) return player.hud.toast(`It wants ${food}`);
  b.tamer = player.id;
  b.trust += b.t.trustPerFeed;
  b.feedAt = clock.now + b.t.feedEvery;
  const p = b.e.position;
  game.audio.play('bt_eat', { at: p, pitch: b.t.big ? 0.7 : 1.2 });
  game.fx.burst({ x: p.x, y: p.y + s.hitbox.height + 0.3, z: p.z }, { color: '#7fe36b', count: 8, speed: 1.4, size: 0.1, gravity: -1.5, life: 1 });
  if (!b.ko && !held) {
    // It stays to eat rather than wandering off between mouthfuls.
    go(b, 'eat', b.t.feedEvery + 1.5);
  } else if (!b.ko) b.e.animate('eat');
  if (b.trust >= 100) adopt(game, b, player);
}

/** Hurt while it's being tamed: trust goes. */
export function shaken(b: Brain, amount: number) {
  if (b.trust > 0 && !b.tame) b.trust = Math.max(0, b.trust - amount * (b.ko ? 1.5 : 3));
}

/** Every step: the daze of the knocked out drains (they wake at nothing), the daze of the standing fades, trust left alone ebbs. */
export function tickTaming(game: GameContext, dt: number) {
  for (const b of brains.values()) {
    if (b.tame || (b.daze <= 0 && b.trust <= 0)) continue;
    if (b.ko) {
      b.daze -= (b.t.dazeMax / (50 + b.s.tameTier * 14)) * dt;
      if (b.daze <= 0) wake(game, b);
    } else if (b.daze > 0 && clock.now - b.dazedAt > 4) b.daze = Math.max(0, b.daze - 3 * dt);
    if (b.trust > 0) {
      const tamer = game.players.find((p) => p.id === b.tamer);
      if (!tamer || flat(tamer.position, b.e.position) > 20) b.trust = Math.max(0, b.trust - 3 * dt);
      if (b.trust <= 0 && !b.ko) b.tamer = null;
    }
  }
}

// ---- What players see of it ----

export const TAMING_WIDGET = 'bt_taming';

export function defineTamingHud(game: GameContext) {
  game.hud.define(TAMING_WIDGET, {
    at: 'bottom',
    html: `<div class="card">
      <div class="head"><b>{{name}}</b><span>{{kind}}</span></div>
      <div class="row" data-if="showTrust"><span>Trust</span><div class="bar"><i style="--fill: {{trust}}"></i></div><em>{{trustText}}</em></div>
      <div class="row" data-if="showDaze"><span>Daze</span><div class="bar daze"><i style="--fill: {{daze}}"></i></div><em>{{dazeText}}</em></div>
      <div class="hint">{{hint}}</div>
    </div>`,
    css: `:scope { margin-bottom: 96px }
      .card { min-width: 250px; padding: 8px 12px 9px; border-radius: 10px; background: #10160fd9; border: 1px solid #7fbf4d66; color: #eef4e6; font: 13px var(--sans) }
      .head { display: flex; justify-content: space-between; align-items: baseline; gap: 14px; margin-bottom: 5px }
      .head b { font-size: 15px } .head span { opacity: 0.7; font-size: 12px }
      .row { display: flex; align-items: center; gap: 8px; margin: 3px 0 }
      .row span { width: 38px; opacity: 0.8 } .row em { width: 40px; text-align: right; font-style: normal; opacity: 0.9 }
      .bar { flex: 1; height: 8px; border-radius: 4px; background: #ffffff22; overflow: hidden }
      .bar i { display: block; height: 100%; width: calc(var(--fill) * 1%); background: #7fe36b; transition: width 0.25s }
      .bar.daze i { background: #b58cff }
      .hint { margin-top: 5px; opacity: 0.85; font-size: 12px }`,
  });
}

const meters = new Tags('bt_sub:');
const widgetUp = new Set<string>();

export function resetTamingHud() {
  meters.reset();
  widgetUp.clear();
}

export function forgetTamingHud(player: Player) {
  meters.forget(player);
  widgetUp.delete(player.id);
}

function hintFor(game: GameContext, b: Brain, mine: boolean): string {
  const food = itemName(game, b.s.favorite);
  if (b.ko || clock.now < b.stunUntil || (b.t.method === 'hand' && mine)) {
    const wait = b.feedAt - clock.now;
    if (wait > 0) return `Chewing… it will take more in ${Math.ceil(wait)}s`;
    return `Feed it ${food} (E)${b.ko ? ' before it wakes' : ''}`;
  }
  if (b.t.method === 'hand') return `Likes ${food} · sneak up or hold some, and offer it (E)`;
  return `Likes ${food} · knock it out first${b.t.bolaable ? ' (a bola pins it)' : ''}`;
}

/** A few times a second: each player's taming card (the animal they're taming, or the wild one they look at) and the meters over subdued animals near them. */
export function showTaming(game: GameContext) {
  for (const player of game.players) {
    if (player.bot) continue;
    const at = player.position;
    let subject: Brain | null = null;
    let best = Infinity;
    meters.begin();
    if (inPlay(player)) {
      for (const b of near(at, 30, scratch)) {
        if (b.tame || (b.trust <= 0 && b.daze <= 0 && clock.now >= b.stunUntil)) continue;
        const d = flat(b.e.position, at);
        if (b.tamer === player.id && d < 16 && d < best) [best, subject] = [d, b];
        const dazed = b.t.dazeMax > 0 ? b.daze / b.t.dazeMax : 0;
        meters.tag(player, String(b.e.id), b.e, {
          shape: 'dot',
          size: 3,
          color: b.ko ? '#b58cff' : '#7fe36b',
          label: b.ko ? `Out cold · trust ${Math.floor(b.trust)}%` : b.trust > 0 ? `Trust ${Math.floor(b.trust)}%` : clock.now < b.stunUntil ? 'Pinned' : 'Dazed',
          bar: Math.round((b.ko || b.trust > 0 ? b.trust / 100 : dazed) * 50) / 50,
          offset: { x: 0, y: b.s.hitbox.height + 0.7, z: 0 },
        });
      }
      if (!subject && !player.vehicle) {
        const hit = game.entities.raycast(player.eye, player.look, 9, { margin: 0.3 });
        const b = hit && brains.get(hit.entity.id);
        if (b && !b.tame) subject = b;
      }
    }
    meters.end(player);
    if (!subject) {
      if (widgetUp.delete(player.id)) player.hud.widget(TAMING_WIDGET).remove();
      continue;
    }
    const b = subject;
    widgetUp.add(player.id);
    player.hud.widget(TAMING_WIDGET, {
      name: `Wild ${b.s.name}`,
      kind: `${b.s.temper} · tier ${b.s.tameTier}`,
      showTrust: b.trust > 0 || b.ko,
      trust: Math.min(100, Math.round(b.trust)),
      trustText: `${Math.min(100, Math.floor(b.trust))}%`,
      showDaze: b.daze > 0,
      daze: Math.round((b.daze / b.t.dazeMax) * 100),
      dazeText: b.ko ? 'out' : `${Math.round((b.daze / b.t.dazeMax) * 100)}%`,
      hint: hintFor(game, b, b.tamer === player.id && b.trust > 0),
    });
  }
}
