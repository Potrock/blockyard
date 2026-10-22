import { atWar, cityAt, civOf, has, note, random, spawnUnit, unitsOf } from './core';
import { service } from './citystates';
import { canFire, canPillage, melee, pillage, ranged } from './combat';
import { distance, neighbours, within } from './hex';
import { canEnter, occupants, planPath, campHooks } from './movement';
import { campCleared } from './quests';
import { clanAt, clanById, clanPillaged, clansTurn, endClan, newClan, raidTarget, spares } from './clans';
import type { Game, Unit } from './state';
import { TERRAINS } from './terrain';
import { UNITS } from './units';

/**
 * Barbarians, Civ V's way: camps appear in land nobody can see, each sends out a raider every so
 * often (stronger as the world's techs advance), raiders go for whatever's near (units, workers,
 * cities) and pillage what they stand on, and whoever clears a camp takes 25 gold (Germany, often a
 * raider who joins them too). They never take a city.
 *
 * Each camp is a clan's (`clans.ts`): its raiders leave alone the civs that have bribed it, and go
 * after the one it's been paid to raid, more of them, and farther.
 */

export const barbarianIndex = (game: Game) => game.players.findIndex((p) => p.civ === 'barbarian');

/** The unit a camp sends out: by the most advanced civ's era. */
function raider(game: Game): string {
  const most = Math.max(...game.players.filter((p) => p.civ !== 'barbarian').map((p) => p.techs.length));
  if (most >= 30) return 'longswordsman';
  if (most >= 22) return game.players.some((p) => p.techs.includes('horseback_riding')) && random(game) < 0.4 ? 'horseman' : 'swordsman';
  if (most >= 12) return random(game) < 0.5 ? 'spearman' : 'archer';
  return game.turn < 30 || random(game) < 0.7 ? 'warrior' : 'archer';
}

export function barbarianTurn(game: Game) {
  const b = barbarianIndex(game);
  if (b < 0 || !game.settings.barbarians) return;
  clansTurn(game);
  const seen = (t: number) => game.players.some((p) => p.index !== b && p.visible[t] > 0);
  // New camps, in land nobody sees, away from cities.
  const camps = game.tiles.filter((t) => t.camp).length;
  const maxCamps = Math.max(2, Math.round(game.tiles.length / 160));
  if (game.turn > 10 && camps < maxCamps && random(game) < 0.2) {
    for (let tries = 0; tries < 30; tries++) {
      const t = Math.floor(random(game) * game.tiles.length);
      const tile = game.tiles[t];
      if (TERRAINS[tile.terrain].water || tile.elevation === 'mountain' || tile.feature === 'ice' || tile.owner >= 0 || tile.camp || tile.ruin) continue;
      if (seen(t) || game.cities.some((c) => distance(game.grid, c.tile, t) < 5) || game.units.some((u) => u.tile === t)) continue;
      tile.camp = true;
      spawnUnit(game, raider(game), b, t, { clan: newClan(game, t).id });
      break;
    }
  }
  // Each camp sends a raider now and then (one paid to raid, more often, and more of them).
  game.tiles.forEach((tile, t) => {
    if (!tile.camp) return;
    const clan = clanAt(game, t);
    const paid = raidTarget(game, clan) !== null;
    if (random(game) > (paid ? 0.2 : 0.06)) return;
    const near = within(game.grid, t, 1).find((x) => canEnter(game, { id: -1, type: 'warrior', owner: b, tile: x, moves: 0, hp: 100, xp: 0, promotions: [] }, x));
    const around = game.units.filter((x) => x.owner === b && distance(game.grid, x.tile, t) <= 4).length;
    if (near !== undefined && around < (paid ? 4 : 2) && (paid || unitsOf(game, b).length < maxCamps * 2)) spawnUnit(game, raider(game), b, near, { clan: clan?.id });
  });
  // Raiders: attack what's next to them, else head for something within reach, else wander.
  for (const u of unitsOf(game, b)) {
    if (!game.units.includes(u)) continue;
    raid(game, u, b);
  }
}

function raid(game: Game, u: Unit, b: number) {
  const type = UNITS[u.type];
  // (Its clan's: whom it spares, a bribe's or a raid paid for, and whom it's been paid to raid.)
  const clan = clanById(game, u.clan);
  const spared = (owner: number) => !!clan && owner >= 0 && spares(game, clan, owner);
  const paid = raidTarget(game, clan);
  // Attack.
  for (const t of within(game.grid, u.tile, type.ranged ? (type.range ?? 1) : 1)) {
    if (t === u.tile) continue;
    const enemy = occupants(game, t).military ?? occupants(game, t).civilian;
    const city = cityAt(game, t);
    const whose = city ? city.owner : enemy && atWar(game, b, enemy.owner) ? enemy.owner : -1;
    if (whose < 0 || spared(whose)) continue;
    if (type.ranged && !canFire(game, u.tile, t, type.range ?? 1)) continue;
    if (city && !type.ranged && city.hp <= 30) continue; // they don't take cities
    const r = type.ranged ? ranged(game, u, t) : melee(game, u, t);
    if (r) return;
  }
  // Pillage what it stands on.
  if (canPillage(game, u) && !spared(game.tiles[u.tile].owner)) {
    pillage(game, u, 0);
    clanPillaged(game, u);
    return;
  }
  // Hunt: the nearest unit or city of anyone within 7 (paid to raid a civ: its, within 14, else its nearest city).
  const prey = (owner: number) => (paid !== null ? owner === paid : owner !== b && !spared(owner));
  const reach = paid !== null ? 14 : 7;
  const targets = game.units.filter((o) => prey(o.owner) && distance(game.grid, o.tile, u.tile) <= reach).map((o) => o.tile).concat(game.cities.filter((c) => prey(c.owner) && distance(game.grid, c.tile, u.tile) <= reach).map((c) => c.tile));
  if (paid !== null && !targets.length) targets.push(...game.cities.filter((c) => c.owner === paid && distance(game.grid, c.tile, u.tile) <= 30).map((c) => c.tile));
  targets.sort((a, c) => distance(game.grid, a, u.tile) - distance(game.grid, c, u.tile));
  for (const t of targets.slice(0, 1)) {
    const step = neighbours(game.grid, t).filter((x) => !TERRAINS[game.tiles[x].terrain].water).sort((a, c) => distance(game.grid, a, u.tile) - distance(game.grid, c, u.tile))[0];
    if (step === undefined) continue;
    const p = planPath(game, u, step);
    if (!p) continue;
    u.path = p;
    return;
  }
  // Wander.
  const around = neighbours(game.grid, u.tile).filter((x) => canEnter(game, u, x));
  if (around.length && random(game) < 0.5) u.path = [around[Math.floor(random(game) * around.length)]];
}

/** A camp cleared by a unit stepping into it: 25 gold (Civ V's). */
campHooks.onCamp = (game, u) => {
  const tile = game.tiles[u.tile];
  if (!tile.camp || game.players[u.owner].civ === 'barbarian') return;
  const clan = clanAt(game, u.tile);
  tile.camp = false;
  tile.antiquity = true;
  endClan(game, u.tile);
  const p = game.players[u.owner];
  p.gold += 25;
  note(game, u.owner, { text: `You have cleared ${clan ? `the camp of the ${clan.name} clan` : 'a barbarian camp'}: 25 gold.`, at: u.tile, kind: 'good' });
  service(game, p, u.tile, 30);
  campCleared(game, p, u.tile);
  // Germany: two times in three, a barbarian joins them.
  if (has([civOf(p).ability.effects], 'barbarian_recruits') && random(game) < 0.67) {
    const type = raider(game);
    const at = within(game.grid, u.tile, 1).find((x) => canEnter(game, { id: -1, type, owner: u.owner, tile: x, moves: 0, hp: 100, xp: 0, promotions: [] }, x));
    if (at !== undefined) {
      spawnUnit(game, type, u.owner, at, { moves: 0 });
      note(game, u.owner, { text: 'A barbarian warband joins your cause.', at, kind: 'good' });
    }
  }
};
