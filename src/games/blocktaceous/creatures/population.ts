import type { GameContext } from '@platform';
import { biomeAt, SPAWNS } from '../island/index';
import { SPECIES, SPECIES_IDS, type BiomeId, type SpeciesId } from '../species';
import { TUNING } from './tuning';
import { brains, dist2, flat, inPlay, makeBrain, nearestPlayer, newHerd, type Brain } from './state';

/**
 * Who lives where, and how many. Wild animals appear out of sight round the players, by biome,
 * in their herds, and go again once everyone has left them far behind. The island is never
 * crowded: there's a hard budget for the whole room, and a smaller one for the ground round any
 * one player, so players standing together share the animals between them.
 */
export const WILD_MAX = 64;
/** Wild animals within `LOCAL_RADIUS` of a player before no more appear round them. */
export const LOCAL_MAX = 14;
export const LOCAL_RADIUS = 80;
/** New animals appear this far from the player they're for, and never nearer than `CLEAR` to anyone. */
const SPAWN_NEAR = 30;
const SPAWN_FAR = 62;
const CLEAR = 24;
/** Wild animals further than this from every player go. */
const DESPAWN = 118;
/** The island's rare giants and top predators: this many at once, and none within `APEX_APART` of its own kind. */
const APEX_MAX = 4;
const APEX_APART = 150;

const SEMI_AQUATIC = new Set<SpeciesId>(['spinosaurus', 'sarcosuchus']);

/** The biome at a column, whatever the island part is up to: grassland if it can't say. */
function biomeOf(x: number, z: number): BiomeId {
  try {
    return biomeAt(x, z) ?? 'grassland';
  } catch {
    return 'grassland';
  }
}

const byBiome = new Map<BiomeId, SpeciesId[]>();
function speciesIn(biome: BiomeId): SpeciesId[] {
  let list = byBiome.get(biome);
  if (!list) byBiome.set(biome, (list = SPECIES_IDS.filter((id) => (SPECIES[id].biomes as BiomeId[]).includes(biome))));
  return list;
}

export const wildCount = (): number => {
  let n = 0;
  for (const b of brains.values()) if (!b.tame && b.e.alive) n++;
  return n;
};

/** A player's building within a few blocks of a spot: nothing wild appears in or beside a base. */
function nearBase(game: GameContext, x: number, y: number, z: number): boolean {
  for (let dx = -4; dx <= 4; dx += 4) {
    for (let dz = -4; dz <= 4; dz += 4) {
      for (let dy = -1; dy <= 3; dy++) {
        const id = game.world.getBlock(x + dx, y + dy, z + dz);
        if (id > 0 && game.world.blockName(id).startsWith('bt_')) return true;
      }
    }
  }
  return false;
}

/** Where an animal of a species could stand at a column: the height of its feet, or null (not loaded, open water, a base). */
function standAt(game: GameContext, id: SpeciesId, x: number, z: number): number | null {
  const y = game.world.surfaceY(x, z);
  if (y < 1) return null;
  const top = game.world.blockName(game.world.getBlock(x, y, z));
  if ((top === 'water' && !SEMI_AQUATIC.has(id)) || top === 'lava') return null;
  if (top.endsWith('_leaves') || nearBase(game, x, y, z)) return null;
  return y + 1;
}

/** Put one animal into the world (the rules' `spawn`): wild, in a herd; null if it can't stand there. */
export function spawnAnimal(game: GameContext, id: SpeciesId, x: number, z: number, herd: number, y?: number): Brain | null {
  const feet = y ?? standAt(game, id, x, z);
  if (feet === null) return null;
  const e = game.entities.spawn(id, { x, y: feet + 0.05, z }, { yaw: game.rng.range(0, Math.PI * 2) });
  const b = makeBrain(e, id, herd, game.rng);
  brains.set(e.id, b);
  return b;
}

/** A herd of a species round a spot, as many as the species keeps together (give or take). */
export function spawnHerd(game: GameContext, id: SpeciesId, x: number, z: number, size?: number): Brain[] {
  const s = SPECIES[id];
  const n = size ?? Math.max(1, Math.round(s.herd * game.rng.range(0.6, 1.2)));
  const herd = newHerd(x, z);
  const out: Brain[] = [];
  const spread = 1.5 + s.hitbox.width * 1.6;
  for (let i = 0; i < n; i++) {
    const a = game.rng.range(0, Math.PI * 2);
    const d = i === 0 ? 0 : game.rng.range(spread * 0.6, spread * (1 + i * 0.4));
    const b = spawnAnimal(game, id, x + Math.cos(a) * d, z + Math.sin(a) * d, herd);
    if (b) out.push(b);
  }
  return out;
}

/** How far from the landing beaches (island SPAWNS) no hunter turns up, blocks. */
const LANDING = 200;

/** Pick a species for a biome, by how common each is; the rare giants only while there's room for another. */
function pick(game: GameContext, biome: BiomeId, x: number, z: number): SpeciesId | null {
  let list = speciesIn(biome);
  if (!list.length) list = speciesIn('grassland');
  let apex = 0;
  for (const b of brains.values()) if (!b.tame && b.t.apex) apex++;
  const landing = SPAWNS.some((p) => flat(p, { x, z }) < LANDING);
  const ok = list.filter((id) => {
    // Where castaways wash up, nothing hunts: a newcomer has a fist and twenty health.
    if (landing && SPECIES[id].temper === 'aggressive') return false;
    if (!TUNING[id].apex) return true;
    if (apex >= APEX_MAX) return false;
    for (const b of brains.values()) if (b.id === id && !b.tame && flat(b.e.position, { x, z }) < APEX_APART) return false;
    return true;
  });
  let total = 0;
  for (const id of ok) total += TUNING[id].weight;
  let r = game.rng.next() * total;
  for (const id of ok) if ((r -= TUNING[id].weight) <= 0) return id;
  return ok[0] ?? null;
}

/** Set `paused` to stop the comings and goings (tests that stage their own animals; nothing in the game does). */
export const census = { paused: false };

let turn = 0;

/**
 * A step of the island's comings and goings (the rules call it twice a second): the animals
 * everyone has left behind go, and one player (each in turn) may get a new herd somewhere round
 * them, if their surroundings and the island have room.
 */
export function populate(game: GameContext) {
  if (census.paused) return;
  const players = game.players.filter(inPlay);
  for (const b of [...brains.values()]) {
    if (b.tame) continue;
    if (!b.e.alive) {
      brains.delete(b.e.id);
      continue;
    }
    if (players.length && nearestPlayer(game, b.e.position).d < DESPAWN) continue;
    brains.delete(b.e.id);
    b.e.remove();
  }
  if (!players.length) return;
  let wild = wildCount();
  // A few tries a step while the island is filling up, one once it's settled.
  for (let tries = wild < WILD_MAX / 2 ? 3 : 1; tries > 0 && wild < WILD_MAX; tries--) {
    const p = players[turn++ % players.length];
    const at = p.position;
    let local = 0;
    for (const b of brains.values()) if (!b.tame && dist2(b.e.position, at) < LOCAL_RADIUS ** 2) local++;
    if (local >= LOCAL_MAX) continue;
    const a = game.rng.range(0, Math.PI * 2);
    const d = game.rng.range(SPAWN_NEAR, SPAWN_FAR);
    const x = at.x + Math.cos(a) * d;
    const z = at.z + Math.sin(a) * d;
    if (nearestPlayer(game, { x, z }).d < CLEAR) continue;
    const id = pick(game, biomeOf(x, z), x, z);
    if (!id || standAt(game, id, x, z) === null) continue;
    const room = Math.min(WILD_MAX - wild, LOCAL_MAX - local);
    const herd = spawnHerd(game, id, x, z, Math.min(room, Math.max(1, Math.round(SPECIES[id].herd * game.rng.range(0.6, 1.2)))));
    wild += herd.length;
  }
}
