import type { GameContext, MenuHandle, MenuOptions, Player } from '@platform';
import { addXp, containerEmpty, give, openContainer, removeContainer, take } from '../survival/bag';
import { SPECIES, type SpeciesId } from '../species';
import { go } from './ai';
import { gatherTick, haulCount, haulRoom, haulText } from './gather';
import { mountUp } from './riding';
import { Tags } from './tags';
import { MAX_TAME_LEVEL, TUNING, levelBonus, xpForLevel } from './tuning';
import { brains, clock, flat, itemName, loaded, makeBrain, nearestPlayer, newHerd, ownerKey, ownerOf, rides, setClip, tames, type Brain, type Order, type Stance, type TameRecord } from './state';

/**
 * Tames: animals that are someone's. Each has a record (its owner, species, name, level, health,
 * place and orders) kept in `game.store` under `tame:<id>`, so it outlives a server restart. A
 * tame near any player is in the world as an entity; one that everybody has left behind is put
 * away (its record keeps its place) and comes back when someone comes near again.
 */

const STORE = 'tame:';
/** This server process: a guest's tames are theirs only while it runs (their id means nothing afterwards). */
const BOOT = Math.random().toString(36).slice(2, 10);
/** A tame comes into the world when a player is this near its place, and is put away past `UNLOAD`. */
const LOAD = 72;
const UNLOAD = 112;
const TAG_RANGE = 36;

const NAMES = ['Pebble', 'Bramble', 'Thistle', 'Moss', 'Ember', 'Cobble', 'Fern', 'Nettle', 'Rumble', 'Biscuit', 'Juniper', 'Flint', 'Dusty', 'Clover', 'Tumble', 'Sorrel', 'Basalt', 'Sprout', 'Gravel', 'Maple', 'Otis', 'Hazel', 'Boulder', 'Pip', 'Marrow', 'Wren', 'Sable', 'Tansy', 'Onyx', 'Quill'];

const GATHERS: Record<string, string> = { herbivore: 'Forages round this spot: berries, fibre, wood', carnivore: 'Hunts small game round this spot', piscivore: 'Fishes if there is water near, else hunts', scavenger: 'Picks over the ground round this spot' };

const dirty = new Set<string>();
const tags = new Tags('bt_tame:');
const menus = new Map<string, MenuHandle>();
let counter = 0;

/** A saddled tame's saddlebag: a container of the survival part's, bigger under a bigger saddle. */
const BAG_SLOTS: Record<string, number> = { saddle_small: 6, saddle_medium: 12, saddle_large: 20, saddle_giant: 30 };
export const bagId = (rec: TameRecord): string => `bt_bag:${rec.id}`;
export const bagSlots = (rec: TameRecord): number => BAG_SLOTS[TUNING[rec.species].saddle ?? ''] ?? 0;

/** What a tame carried falls where it stood: its saddlebag's contents and what it had gathered. */
function spill(game: GameContext, rec: TameRecord, at: { x: number; y: number; z: number }) {
  if (bagSlots(rec)) removeContainer(bagId(rec), at);
  for (const [item, n] of Object.entries(rec.haul ?? {})) {
    if (n > 0 && game.items.get(item)) game.items.spawnPickup(item, { x: at.x, y: at.y + 0.6, z: at.z }, { count: n, despawn: 600 });
  }
  rec.haul = {};
}

/** Hand a tame's haul to its owner: what there's no room for stays on its back. */
export function takeHaul(player: Player, rec: TameRecord): number {
  let moved = 0;
  for (const [item, n] of Object.entries(rec.haul ?? {})) {
    const got = n > 0 ? give(player, item, n) : 0;
    moved += got;
    rec.haul![item] = n - got;
    if (rec.haul![item]! <= 0) delete rec.haul![item];
  }
  if (moved) dirty.add(rec.id);
  return moved;
}

export const maxHp = (rec: TameRecord): number => SPECIES[rec.species].health;
export const tamesOf = (player: Player): TameRecord[] => [...tames.values()].filter((r) => r.owner === ownerKey(player));

export function saveTame(game: GameContext, rec: TameRecord) {
  dirty.delete(rec.id);
  game.store.set(STORE + rec.id, rec);
}

/** Write the records that changed (the rules call it every few seconds, and when a player leaves). */
export function flushTames(game: GameContext) {
  for (const id of dirty) {
    const rec = tames.get(id);
    if (rec) game.store.set(STORE + id, rec);
  }
  dirty.clear();
}

function forget(game: GameContext, rec: TameRecord) {
  tames.delete(rec.id);
  loaded.delete(rec.id);
  dirty.delete(rec.id);
  game.store.delete(STORE + rec.id);
}

/** `start`: read every tame back from the store. They come into the world as players come near them. */
export function loadTames(game: GameContext) {
  tags.reset();
  menus.clear();
  dirty.clear();
  for (const key of game.store.keys(STORE)) {
    const rec = game.store.get<TameRecord>(key);
    if (!rec || !(rec.species in SPECIES)) {
      game.store.delete(key);
      continue;
    }
    // A guest's tames from a server process that's gone belong to nobody: they've gone back to the wild.
    if (rec.owner.startsWith('g:') && rec.boot !== BOOT) {
      game.store.delete(key);
      continue;
    }
    tames.set(rec.id, rec);
  }
}

/** A wild animal becomes a player's: its record is made and kept, and it starts following them. */
export function adopt(game: GameContext, b: Brain, player: Player): TameRecord {
  const p = b.e.position;
  const rec: TameRecord = {
    id: `${Date.now().toString(36)}${(counter++).toString(36)}`,
    owner: ownerKey(player),
    ownerName: player.name,
    species: b.id,
    name: game.rng.pick(NAMES),
    level: 1,
    xp: 0,
    hp: b.e.maxHealth,
    x: p.x,
    y: p.y,
    z: p.z,
    order: 'follow',
    stance: 'defend',
    saddled: false,
    ...(player.account ? {} : { boot: BOOT }),
  };
  b.e.heal(b.e.maxHealth);
  b.tame = rec;
  b.herd = newHerd(p.x, p.z);
  b.ko = false;
  b.daze = 0;
  b.trust = 0;
  b.tamer = null;
  b.stunUntil = 0;
  b.target = null;
  go(b, 'idle', 1);
  setClip(b, null);
  tames.set(rec.id, rec);
  loaded.set(rec.id, b);
  saveTame(game, rec);
  game.audio.play('bt_tamed', { at: p });
  game.fx.burst({ x: p.x, y: p.y + b.s.hitbox.height + 0.4, z: p.z }, { color: '#ffd76b', count: 26, speed: 2.4, size: 0.12, gravity: -1, life: 1.4, glow: 1 });
  player.hud.banner(`${rec.name} is yours!`, `A ${b.s.name} · look at it and press R for orders${b.s.rideable ? ` · it needs a ${itemName(game, b.t.saddle!)} to be ridden` : ''}`, { duration: 5 });
  game.hud.feed(`${player.name} tamed a ${b.s.name}`, { color: '#9be26b' });
  addXp(player, b.t.xp * 2);
  return rec;
}

/** Put a tame into the world where its record has it (or at `at`): null if the ground there isn't loaded. */
export function spawnTame(game: GameContext, rec: TameRecord, yaw = 0): Brain | null {
  const surface = game.world.surfaceY(rec.x, rec.z);
  if (surface < 0) return null;
  // Where it stood, if that's still open (under its owner's roof, say); else on top of whatever's there now.
  const open = game.world.collisionHeight(rec.x, rec.y, rec.z) === 0 && game.world.collisionHeight(rec.x, rec.y - 1, rec.z) > 0;
  const y = open ? rec.y : surface + 1;
  const e = game.entities.spawn(rec.species, { x: rec.x, y: y + 0.05, z: rec.z }, { yaw });
  e.health = Math.max(1, Math.min(e.maxHealth, rec.hp));
  const b = makeBrain(e, rec.species, newHerd(rec.x, rec.z), game.rng);
  b.tame = rec;
  b.yaw = yaw;
  brains.set(e.id, b);
  loaded.set(rec.id, b);
  return b;
}

/** Take a loaded tame out of the world, its record keeping where and how it was. */
export function stow(rec: TameRecord): Brain | null {
  const b = loaded.get(rec.id);
  if (!b) return null;
  const p = b.e.position;
  [rec.x, rec.y, rec.z, rec.hp] = [p.x, p.y, p.z, b.e.health];
  brains.delete(b.e.id);
  loaded.delete(rec.id);
  b.e.remove();
  dirty.add(rec.id);
  return b;
}

/** A tame died (in a fight, or under its rider): its record goes, and its owner is told. */
export function tameDied(game: GameContext, rec: TameRecord, at?: { x: number; y: number; z: number }) {
  spill(game, rec, at ?? rec);
  forget(game, rec);
  const owner = ownerOf(game, rec);
  owner?.hud.feed(`${rec.name}, your ${SPECIES[rec.species].name}, has died`, { color: '#ff7a6b' });
  if (owner) menus.get(owner.id)?.close();
}

/** Experience for a tame (its kills, the ground it covers under a rider): levels make it hit harder and take less. */
export function gainXp(game: GameContext, rec: TameRecord, amount: number) {
  if (rec.level >= MAX_TAME_LEVEL) return;
  rec.xp += amount;
  while (rec.level < MAX_TAME_LEVEL && rec.xp >= xpForLevel(rec.level)) {
    rec.xp -= xpForLevel(rec.level);
    rec.level++;
    rec.hp = maxHp(rec);
    loaded.get(rec.id)?.e.heal(maxHp(rec));
    ownerOf(game, rec)?.hud.feed(`${rec.name} reached level ${rec.level}`, { color: '#ffd76b' });
  }
  dirty.add(rec.id);
}

/** Back to the wild: the record goes, and the animal is its old self again. */
function release(game: GameContext, rec: TameRecord) {
  const b = loaded.get(rec.id);
  spill(game, rec, b ? b.e.position : rec);
  forget(game, rec);
  if (!b) return;
  b.tame = null;
  b.target = null;
  b.hungryAt = clock.now + 120;
  go(b, 'idle', 3);
}

/** A guest leaving takes nothing with them: their tames go back to the wild. */
export function releaseGuestTames(game: GameContext, player: Player) {
  if (player.account) return;
  for (const rec of tamesOf(player)) release(game, rec);
}

const FOODS: Record<string, string[]> = {
  herbivore: ['berries'],
  carnivore: ['raw_meat', 'prime_meat', 'cooked_meat', 'raw_fish'],
  scavenger: ['raw_meat', 'raw_fish', 'cooked_meat'],
  piscivore: ['raw_fish', 'raw_meat', 'cooked_fish'],
};

/** Feed a tame from what its owner carries: its favourite first, then anything it eats. It heals a good part of its health. */
export function feedTame(game: GameContext, player: Player, b: Brain): boolean {
  const rec = b.tame!;
  const s = b.s;
  if (b.e.health >= b.e.maxHealth) return (player.hud.toast(`${rec.name} isn't hungry`), false);
  const food = [s.favorite, ...FOODS[s.diet]].find((f) => take(player, f, 1));
  if (!food) return (player.hud.toast(`${rec.name} eats ${itemName(game, s.favorite)}`), false);
  b.e.heal(b.e.maxHealth * (food === 'prime_meat' ? 0.6 : 0.25));
  rec.hp = b.e.health;
  dirty.add(rec.id);
  b.e.animate('eat');
  game.audio.play('bt_eat', { at: b.e.position, pitch: b.t.big ? 0.7 : 1.2 });
  return true;
}

export function saddleUp(game: GameContext, player: Player, rec: TameRecord): boolean {
  const saddle = TUNING[rec.species].saddle;
  if (!saddle || rec.saddled) return false;
  if (!take(player, saddle, 1)) return (player.hud.toast(`${rec.name} needs a ${itemName(game, saddle)}`), false);
  rec.saddled = true;
  saveTame(game, rec);
  player.hud.toast(`${rec.name} is saddled · E to ride`);
  game.audio.play('bt_saddle', { at: player.position });
  return true;
}

/** A name a player may give: a few words, nothing that isn't a letter, a digit or simple punctuation. */
export function cleanName(raw: string): string | null {
  const name = raw
    .replace(/[^\p{L}\p{N} '\-.]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
  return name.length >= 2 ? name : null;
}

function menuFor(game: GameContext, player: Player, b: Brain): MenuOptions {
  const rec = b.tame!;
  const s = b.s;
  const again = () => menus.get(player.id)?.update(menuFor(game, player, b));
  const order = (label: string, o: Order, note: string) => ({
    label,
    note,
    active: rec.order === o,
    onSelect: () => {
      rec.order = o;
      const p = b.e.position;
      // "Stay" and "wander" are about here: its range is where it stands now.
      b.herd = newHerd(p.x, p.z);
      b.until = 0;
      dirty.add(rec.id);
      again();
    },
  });
  const stance = (label: string, st: Stance, note: string) => ({
    label,
    note,
    active: rec.stance === st,
    onSelect: () => {
      rec.stance = st;
      if (st === 'passive') b.target = null;
      dirty.add(rec.id);
      again();
    },
  });
  const saddle = b.t.saddle;
  const care = [
    { label: 'Feed', note: `Eats ${itemName(game, s.favorite)} · heals it`, disabled: b.e.health >= b.e.maxHealth, onSelect: () => (feedTame(game, player, b), again()) },
    ...(saddle
      ? [
          rec.saddled
            ? { label: 'Take the saddle off', note: `Back to you: ${itemName(game, saddle)}`, onSelect: () => (containerEmpty(bagId(rec)) ? ((rec.saddled = false), give(player, saddle, 1), saveTame(game, rec)) : player.hud.toast('Empty its saddlebag first'), again()) }
            : { label: 'Saddle up', note: `Needs a ${itemName(game, saddle)}`, onSelect: () => (saddleUp(game, player, rec), again()) },
          ...(rec.saddled ? [{ label: 'Saddlebag', note: `${bagSlots(rec)} slots that go where it goes`, onSelect: () => (menus.get(player.id)?.close(), openContainer(player, bagId(rec), bagSlots(rec), `${rec.name}'s saddlebag`)) }] : []),
          { label: 'Ride', note: rec.saddled ? 'E on it does the same' : 'Saddle it first', disabled: !rec.saddled, onSelect: () => (menus.get(player.id)?.close(), void mountUp(game, player, b)) },
        ]
      : []),
  ];
  return {
    title: rec.name,
    subtitle: `${s.name} · level ${rec.level} · ${Math.ceil(b.e.health * levelBonus(rec.level))} / ${Math.ceil(b.e.maxHealth * levelBonus(rec.level))} health · bite ${(s.damage * levelBonus(rec.level)).toFixed(1)} · ${rec.level >= MAX_TAME_LEVEL ? 'top level' : `${Math.floor(rec.xp)} / ${xpForLevel(rec.level)} xp`}`,
    sections: [
      { title: 'Orders', entries: [order('Follow me', 'follow', 'Stays at your heels'), order('Stay', 'stay', 'Waits right here'), order('Wander', 'wander', 'Grazes round this spot'), order('Gather', 'gather', GATHERS[s.diet] ?? 'Forages round this spot')] },
      {
        title: `Gathered · ${haulCount(rec)} / ${haulRoom(b)}`,
        entries: [{ label: 'Take what it carries', note: haulText(game, rec), disabled: haulCount(rec) === 0, onSelect: () => (takeHaul(player, rec) ? game.audio.play('pickup', { at: player.position }) : player.hud.toast('Your pack is full'), again()) }],
      },
      { title: 'In a fight', entries: [stance('Passive', 'passive', 'Never fights'), stance('Defend', 'defend', 'Fights what hurts you or it'), stance('Attack my target', 'attack', 'Also goes for whatever you hit')] },
      { title: 'Care', entries: care },
      {
        title: 'Other',
        entries: [
          { label: 'Give it another name', note: 'Or choose one: /name <new name>', onSelect: () => ((rec.name = game.rng.pick(NAMES)), saveTame(game, rec), again()) },
          { label: 'Set it free', note: 'It goes back to the wild for good', onSelect: () => (menus.get(player.id)?.close(), release(game, rec), player.hud.toast(`${rec.name} is wild again`)) },
        ],
      },
    ],
    onClose: () => void menus.delete(player.id),
  };
}

/** A tame's orders, on its owner's screen. */
export function openMenu(game: GameContext, player: Player, b: Brain) {
  menus.get(player.id)?.close();
  menus.set(player.id, player.hud.menu(menuFor(game, player, b)));
}

/** A player's own tame nearest to them, within a few blocks (for the commands). */
function nearestOwn(player: Player, range: number): Brain | null {
  let best: Brain | null = null;
  let d = range;
  for (const b of loaded.values()) {
    if (b.tame!.owner !== ownerKey(player)) continue;
    const f = flat(b.e.position, player.position);
    if (f < d) [d, best] = [f, b];
  }
  return best;
}

export function registerTameCommands(game: GameContext) {
  game.commands.register('name', {
    help: 'Name your tame (the nearest one)',
    usage: '<new name>',
    run(args, g, player) {
      const b = nearestOwn(player, 12);
      if (!b) throw new Error('Stand next to one of your tames');
      const name = cleanName(args.join(' '));
      if (!name) throw new Error('A name is 2 to 20 letters');
      b.tame!.name = name;
      saveTame(g, b.tame!);
      return `Named ${name}`;
    },
  });
  game.commands.register('tames', {
    help: 'List your tames',
    run(_args, _g, player) {
      const mine = tamesOf(player);
      if (!mine.length) return 'You have no tames yet';
      return mine.map((r) => `${r.name} (${SPECIES[r.species].name}, level ${r.level}) at ${Math.round(r.x)}, ${Math.round(r.z)}`).join(' · ');
    },
  });
}

/**
 * Once a second: tames come into the world near players and are put away far from everyone;
 * the loaded ones rest and mend, and their records follow where they are.
 */
export function tendTames(game: GameContext) {
  for (const rec of tames.values()) {
    const b = loaded.get(rec.id);
    if (!b) {
      const ridden = [...rides.values()].some((r) => r.rec === rec);
      if (!ridden && nearestPlayer(game, rec).d < LOAD) spawnTame(game, rec);
      continue;
    }
    if (!b.e.alive) continue;
    const p = b.e.position;
    if (nearestPlayer(game, p).d > UNLOAD) {
      stow(rec);
      continue;
    }
    if (clock.now - b.hurtAt > 10 && b.e.health < b.e.maxHealth) b.e.heal(b.e.maxHealth * 0.01);
    if (rec.order === 'gather' && gatherTick(game, b)) dirty.add(rec.id);
    if (flat(p, rec) > 3 || Math.abs(rec.hp - b.e.health) > 1) {
      [rec.x, rec.y, rec.z, rec.hp] = [p.x, p.y, p.z, b.e.health];
      dirty.add(rec.id);
    }
  }
}

/** A couple of times a second: name tags over the tames near each player (name, level, health; green for their own). */
export function tagTames(game: GameContext) {
  for (const player of game.players) {
    if (player.bot) continue;
    const mine = ownerKey(player);
    tags.begin();
    for (const [id, b] of loaded) {
      if (!b.e.alive || flat(b.e.position, player.position) > TAG_RANGE) continue;
      const rec = b.tame!;
      tags.tag(
        player,
        id,
        b.e,
        {
          shape: 'dot',
          size: 3,
          color: rec.owner === mine ? '#9be26b' : '#e8e8e8',
          label: `${rec.name} · Lv ${rec.level}`,
          sub: rec.owner === mine ? undefined : `${rec.ownerName}'s ${b.s.name}`,
          bar: Math.round((b.e.health / b.e.maxHealth) * 25) / 25,
          offset: { x: 0, y: b.s.hitbox.height + 0.6, z: 0 },
        },
        b.e.id,
      );
    }
    for (const [pid, ride] of rides) {
      if (pid === player.id || flat(ride.rec, player.position) > TAG_RANGE) continue;
      const s = SPECIES[ride.rec.species as SpeciesId];
      tags.tag(player, ride.rec.id, ride.prop, { shape: 'dot', size: 3, color: '#e8e8e8', label: `${ride.rec.name} · Lv ${ride.rec.level}`, sub: `${ride.rec.ownerName}'s ${s.name}`, bar: Math.round((ride.rec.hp / s.health) * 25) / 25, offset: { x: 0, y: s.hitbox.height + 0.6, z: 0 } }, `ride${pid}`);
    }
    tags.end(player);
  }
}

export function forgetTameHud(player: Player) {
  tags.forget(player);
  menus.delete(player.id);
}
