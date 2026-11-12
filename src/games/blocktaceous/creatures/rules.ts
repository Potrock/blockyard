import { Models, type Entity, type GameContext, type Player } from '@platform';
import type { Part } from '../part';
import { SPECIES, SPECIES_IDS, type SpeciesId } from '../species';
import { addXp, give } from '../survival/bag';
import { ai, provoke } from './ai';
import { registerArt, standIn } from './art';
import { resetBody, swingAtBodies } from './body';
import { addHaul } from './gather';
import { defineGear, resetGear, useGear } from './gear';
import { modelUrl, strideOf } from './models';
import { census, populate, spawnHerd } from './population';
import { dismount, hurtMount, mountUp, updateRides } from './riding';
import { adopt, flushTames, forgetTameHud, gainXp, loadTames, openMenu, registerTameCommands, releaseGuestTames, saddleUp, tagTames, tameDied, tendTames } from './tames';
import { DART_DAZE, addDaze, defineTamingHud, forgetTamingHud, offerFood, resetTamingHud, shaken, showTaming, stun, tickTaming } from './taming';
import { levelBonus } from './tuning';
import { brains, carcasses, clock, flat, inPlay, isEntity, isPlayer, itemName, loaded, ownerKey, ownerOf, rebuildGrid, resetState, rides, type Brain } from './state';

/**
 * The creatures part's rules: the island's sixteen species as entity types, their wild lives
 * (ai.ts), where and how many there are (population.ts), what a carcass yields, taming
 * (taming.ts), tames and their orders (tames.ts) and riding (riding.ts, def.ts).
 *
 * Keys: E on an animal feeds a wild one, saddles or mounts your own (and gets you off again);
 * R on your own tame opens its orders.
 */

/** How far a player reaches to touch an animal (from their eyes to its body). */
const TOUCH = 6;

/** Timers for the chores that don't need doing every step (seconds until each is next due). */
const due = { grid: 0, people: 0, tend: 0, hud: 0, tags: 0, save: 0 };

function defineSpecies(game: GameContext) {
  for (const id of SPECIES_IDS) {
    const s = SPECIES[id];
    const url = modelUrl(id);
    game.entities.define(id, {
      name: s.name,
      // The species' own model once it's been built; a box animal in its hide until then.
      model: url ? Models.gltf(url, { clips: { idle: 'idle', walk: 'walk', run: 'run', attack: 'attack' }, head: 'head', stride: strideOf(id) }) : standIn(id),
      hitbox: s.hitbox,
      health: s.health,
      speed: s.walk,
      knockbackResistance: Math.min(0.97, s.health / 220),
      ai,
    });
  }
}

/** Who a hit is from, if it's from someone: an animal or a player. */
const attacker = (source: unknown): Entity | Player | null => (isEntity(source) || isPlayer(source) ? source : null);

/** A wild animal died: what it yields goes to whoever killed it (a tame's kill to its owner), or lies where it fell. */
function harvest(game: GameContext, b: Brain, killer: Entity | Player | null) {
  const p = b.e.position;
  let to: Player | null = null;
  if (isPlayer(killer)) {
    to = killer;
    const ride = rides.get(killer.id);
    if (ride) gainXp(game, ride.rec, b.t.xp);
  } else if (killer) {
    const kb = brains.get(killer.id);
    if (kb?.tame) {
      gainXp(game, kb.tame, b.t.xp);
      // A tame out gathering carries its kill itself, until its owner takes it.
      if (kb.tame.order === 'gather') {
        for (const [item, n] of b.t.drops) addHaul(kb, item, n);
        return;
      }
      to = ownerOf(game, kb.tame);
    }
  }
  if (to) {
    const got: string[] = [];
    for (const [item, n] of b.t.drops) {
      give(to, item, n);
      got.push(`${n} ${itemName(game, item)}`);
    }
    to.hud.feed(`${b.s.name}: ${got.join(', ')}`, { color: '#e8d9a8' });
    addXp(to, b.t.xp);
    return;
  }
  // Nobody's kill: the hunter and the scavengers have had most of it.
  for (const [item, n] of b.t.drops) game.items.spawnPickup(item, { x: p.x + game.rng.range(-0.6, 0.6), y: p.y + 0.6, z: p.z + game.rng.range(-0.6, 0.6) }, { count: Math.ceil(n / 2), despawn: 120 });
}

function listen(game: GameContext) {
  // Before a hit lands: bolas pin and darts daze, tames and their owners don't hurt each other,
  // a level makes a tame tougher, and what's meant for a rider lands on the mount.
  game.events.on('damage', (hit) => {
    const from = attacker(hit.source);
    if (isEntity(hit.target)) {
      const b = brains.get(hit.target.id);
      if (!b) return;
      if (hit.weapon === 'bola') {
        stun(game, b, isPlayer(from) ? from : null);
        return hit.cancel();
      }
      if (b.tame) {
        if (isPlayer(from) || (from && brains.get(from.id)?.tame)) return hit.cancel();
        hit.amount /= levelBonus(b.tame.level);
        return;
      }
      if (hit.weapon === 'sleep_dart' && isPlayer(from)) addDaze(game, b, DART_DAZE, from);
      return;
    }
    if (!isEntity(from)) return;
    if (brains.get(from.id)?.tame) return hit.cancel();
    const ride = rides.get(hit.target.id);
    if (ride) {
      hurtMount(game, hit.target, ride, hit.amount);
      hit.cancel();
    }
  });

  game.events.on('entityDamage', ({ entity, amount, source }) => {
    const b = brains.get(entity.id);
    if (!b) return;
    shaken(b, amount);
    const from = attacker(source);
    if (!from || !entity.alive) return;
    if (!(b.tame && isPlayer(from))) provoke(b, from, game);
    // A player's tames told to attack their target go for what they hit.
    if (isPlayer(from) && !b.tame) rally(from, entity, 'attack');
  });

  game.events.on('playerDamage', ({ player, source }) => {
    const from = attacker(source);
    if (isEntity(from) && brains.has(from.id)) rally(player, from, 'defend');
  });

  game.events.on('entityDeath', ({ entity, killer }) => {
    const b = brains.get(entity.id);
    if (!b) return;
    brains.delete(entity.id);
    const p = entity.position;
    carcasses.push({ x: p.x, z: p.z, until: clock.now + 60 });
    if (carcasses.length > 12) carcasses.shift();
    if (b.tame) return tameDied(game, b.tame, p);
    harvest(game, b, attacker(killer));
  });

  game.events.on('playerDeath', ({ player }) => dismount(game, player));
  game.events.on('playerLeave', ({ player }) => {
    if (rides.has(player.id)) dismount(game, player);
    releaseGuestTames(game, player);
    flushTames(game);
    forgetTameHud(player);
    forgetTamingHud(player);
  });
}

/** A player's loaded tames near them take a target: those told to defend when their owner is hurt, those told to attack when their owner strikes. */
function rally(owner: Player, target: Entity, why: 'defend' | 'attack') {
  const key = ownerKey(owner);
  for (const b of loaded.values()) {
    const rec = b.tame!;
    if (rec.owner !== key || rec.stance === 'passive' || (why === 'attack' && rec.stance !== 'attack')) continue;
    if (b.target || b.e === target || flat(b.e.position, owner.position) > 35) continue;
    b.target = target;
    b.thinkAt = 0;
  }
}

/** E or R with an animal under the crosshair. */
function interact(game: GameContext, player: Player) {
  const e = player.input.pressed('KeyE');
  const r = player.input.pressed('KeyR');
  if (!e && !r) return;
  const hit = game.entities.raycast(player.eye, player.look, TOUCH, { margin: 0.4 });
  const b = hit && brains.get(hit.entity.id);
  if (!b) return;
  player.input.consume(e ? 'KeyE' : 'KeyR');
  const rec = b.tame;
  if (!rec) {
    if (e) offerFood(game, player, b);
    return;
  }
  if (rec.owner !== ownerKey(player)) return player.hud.toast(`${rec.name} is ${rec.ownerName}'s ${b.s.name}`);
  if (r) return openMenu(game, player, b);
  if (b.s.rideable && !rec.saddled && player.inventory.held?.item === b.t.saddle) return void saddleUp(game, player, rec);
  if (b.s.rideable && rec.saddled) return void mountUp(game, player, b);
  openMenu(game, player, b);
}

/** The animal a player means: the one they look at, or the nearest within a few blocks. */
function meant(game: GameContext, player: Player, tame: boolean): Brain {
  const hit = game.entities.raycast(player.eye, player.look, 30, { margin: 0.5 });
  let best = hit ? (brains.get(hit.entity.id) ?? null) : null;
  if (best && !!best.tame !== tame) best = null;
  let d = 16;
  if (!best) {
    for (const b of brains.values()) {
      const f = flat(b.e.position, player.position);
      if (!!b.tame === tame && f < d) [d, best] = [f, b];
    }
  }
  if (!best) throw new Error(tame ? 'No tame near you' : 'No wild animal near you');
  return best;
}

/** Developer commands (only where cheats are on): stage animals without the work of finding and taming them. */
function registerCheats(game: GameContext) {
  game.commands.register('creature', {
    help: 'Spawn a herd of a species in front of you',
    usage: '<species> [how many] [how far]',
    cheat: true,
    complete: () => [...SPECIES_IDS],
    run(args, g, player) {
      const id = args[0] as SpeciesId;
      if (!(id in SPECIES)) throw new Error(`Species: ${SPECIES_IDS.join(', ')}`);
      const d = args[2] ? Number(args[2]) : 6 + SPECIES[id].length;
      const l = Math.hypot(player.look.x, player.look.z) || 1;
      const herd = spawnHerd(g, id, player.position.x + (player.look.x / l) * d, player.position.z + (player.look.z / l) * d, args[1] ? Number(args[1]) : undefined);
      return `${herd.length} ${SPECIES[id].name}`;
    },
  });
  game.commands.register('wild', {
    help: 'Stop or start wild animals appearing, or clear them',
    usage: 'on | off | clear',
    cheat: true,
    run(args) {
      if (args[0] === 'clear') {
        for (const b of [...brains.values()]) {
          if (b.tame) continue;
          brains.delete(b.e.id);
          b.e.remove();
        }
        return 'Cleared';
      }
      census.paused = args[0] === 'off';
      return census.paused ? 'No more wild animals will appear' : 'Wild animals appear again';
    },
  });
  game.commands.register('daze', {
    help: 'Knock out the wild animal you look at',
    cheat: true,
    run(_args, g, player) {
      const b = meant(g, player, false);
      addDaze(g, b, b.t.dazeMax, player);
      return `${b.s.name} knocked out`;
    },
  });
  game.commands.register('tameit', {
    help: 'Tame the wild animal you look at, saddled',
    cheat: true,
    run(_args, g, player) {
      const b = meant(g, player, false);
      const rec = adopt(g, b, player);
      rec.saddled = b.s.rideable;
      return `${rec.name} the ${b.s.name} is yours`;
    },
  });
  game.commands.register('ride', {
    help: 'Mount your tame nearest you',
    cheat: true,
    run(_args, g, player) {
      return mountUp(g, player, meant(g, player, true)) ? 'Mounted' : 'Could not mount it';
    },
  });
}

export const creatures: Part = {
  setup(game) {
    registerArt(game);
    defineSpecies(game);
    defineGear(game);
    defineTamingHud(game);
    registerTameCommands(game);
    registerCheats(game);
    listen(game);
  },

  start(game) {
    resetState();
    resetGear();
    resetBody();
    resetTamingHud();
    for (const k of Object.keys(due) as (keyof typeof due)[]) due[k] = 0;
    loadTames(game);
  },

  update(game, dt) {
    clock.now = game.clock.now;
    if ((due.grid -= dt) <= 0) {
      due.grid = 0.25;
      rebuildGrid();
    }
    updateRides(game, dt);
    for (const player of game.players) {
      if (!inPlay(player) || player.vehicle || player.bot) continue;
      useGear(game, player);
      swingAtBodies(game, player);
      interact(game, player);
    }
    tickTaming(game, dt);
    if ((due.people -= dt) <= 0) {
      due.people = 0.5;
      populate(game);
    }
    if ((due.tend -= dt) <= 0) {
      due.tend = 1;
      tendTames(game);
    }
    if ((due.hud -= dt) <= 0) {
      due.hud = 0.25;
      showTaming(game);
    }
    if ((due.tags -= dt) <= 0) {
      due.tags = 0.5;
      tagTames(game);
    }
    if ((due.save -= dt) <= 0) {
      due.save = 5;
      flushTames(game);
    }
  },
};
