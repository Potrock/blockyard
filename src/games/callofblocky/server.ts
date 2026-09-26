import { defineServer, type Bot, type GameContext, type IconRef, type MenuHandle, type MenuOptions, type Pickup, type Player, type Vec3 } from '@platform';
import { navGrid, type NavGrid } from '@platform/kits';
import { ATLAS, defineArt, OUTFITS, skinOrigin } from './art';
import { CaseRounds } from './briefcase';
import { makeBots, type Bots } from './bots';
import { DOSSIER, MATCHBAR, streakPips } from './hud';
import { MAPS, mapById, type SpawnPoint } from './map';
import { fighterOf, hostile, match, teamFighters, type Fighter } from './match';
import { FFA_LIMIT, MODES, ROTATION, ROUNDS, TDM_LIMIT, TEAMS, type MatchPlan, type ModeId, type Team } from './modes';
import { COLORS, fighterModel, shared } from './shared';
import { BLURBS, defineWeapons, feedIcon, LETHAL_BLURBS, LETHAL_COUNT, LETHALS, PRIMARIES, WEAPONS, weaponName, type Lethal, type Primary } from './weapons';

/**
 * Call of Blocky: fast pulp shootouts against bots and people, on Jackrabbit Lane (a
 * Nuketown-style cul-de-sac) and at Big Kahuna Burger (a burger joint, its parking lot and the
 * motel next door). Three modes (modes.ts):
 *
 * - **Free-for-all**: first to 25 kills (or the most when the clock runs out). The briefcase turns
 *   up on the street now and then: grab it for points and a radar sweep.
 * - **Team Deathmatch**: the Suits against the Shirts, first side to 75 kills. No friendly fire.
 * - **The Briefcase**: rounds of Search and Destroy (briefcase.ts): one life each, the attackers
 *   plant the case at A or B, the defenders stop them or crack it; first to four rounds.
 *
 * Bots fill the match (six fighters in a free-for-all, four a side in the team modes); people
 * joining take a bot's place. A public room goes round the modes and maps match by match
 * (`ROTATION`); in a room of one's own (`?room=`), M picks the mode and the map.
 *
 * Everyone carries a primary of their choosing (L), the Lucky 45, a katana and a lethal (G: two
 * Pineapple frags or a Mia firebomb). Three kills in a row light up the radar for you (UAV); five
 * get an Adrenaline Shot: faster, and patched up.
 */

const TIME_LIMIT: Record<ModeId, number> = { ffa: 8 * 60, tdm: 10 * 60, case: Infinity };
/** Never more than this many fighters, people included. */
const MAX_FIGHTERS = 8;
const RESPAWN = 3;
/** How long the Adrenaline Shot lasts. */
const RUSH = 15;
/** Seconds between the end of a match and the next. */
const INTERMISSION = 12;
const BOT_NAMES = ['Lucky Lou', 'Dolly Dagger', 'Sal Nero', 'Candy Kane', 'Rocco', 'Velma', 'Big Tony', 'Honey', 'Duke', 'Jackie Rabbit', 'Frankie Two-Guns', 'Mona', 'Zed', 'Butch'];

let fighters = match.fighters;
/** A match has begun (`start`): newcomers go straight in. */
let running = false;
let startedAt = 0;
let overAt = 0;
let firstBlood = false;
let bots: Bots;
let rounds: CaseRounds;
/** Each map's walking grid (built once its blocks have loaded, the first time a match is on it). */
let navs = new Map<string, NavGrid>();
/** The map's hotspots, where bots drift (the array the bots read: refilled for each map). */
const hotspots: Vec3[] = [];
let boardDirty = true;
/** The briefcase: on the street (a pickup), and when the next one turns up. */
let briefcase: Pickup | null = null;
let nextBriefcase = 0;
let boardAt = 0;
let lastSecond = -1;
/** What the next match plays; where the public rotation has got to; what a room of one's own has picked. */
let plan: MatchPlan = ROTATION[0];
let turn = 0;
/** The team the next fighter to join goes on (bots added to fill a side). */
let joining: Team | null = null;
/** Who a dead fighter watches in The Briefcase (their team's, until the round's out). */
const watching = new Map<string, Player>();
/** The match settings menu in a room of one's own, and whether anyone's opened it yet. */
let settings: MenuHandle | null = null;
let offered = false;

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const isCase = () => match.mode.id === 'case';
const planName = (m: MatchPlan) => `${MODES[m.mode].name} on ${mapById(m.map)?.name ?? m.map}`;

/** What a bot carries: mostly rifles and SMGs, now and then a shotgun, rarely a sniper. */
function botPrimary(r: number): Primary {
  return r < 0.42 ? 'rifle' : r < 0.74 ? 'smg' : r < 0.92 ? 'shotgun' : 'sniper';
}

function standings(): Fighter[] {
  return [...fighters.values()].sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);
}

/** A name's colour in the kill feed: their side's in a team mode. */
function nameColor(p: Player, fallback: string): string {
  const t = fighterOf(p)?.team;
  return match.mode.teams && t !== null && t !== undefined ? TEAMS[t].color : fallback;
}

// -------------------------------------------------------------------------------------------------
// Fighters: joining, teams, spawning, loadouts
// -------------------------------------------------------------------------------------------------

function addFighter(game: GameContext, p: Player): Fighter {
  const taken = new Set([...fighters.values()].map((f) => f.outfit));
  const free = OUTFITS.map((_, i) => i).filter((i) => !taken.has(i));
  const outfit = free.length ? free[Math.floor(game.rng.next() * free.length)] : game.rng.int(0, OUTFITS.length - 1);
  const f: Fighter = {
    player: p,
    kills: 0,
    deaths: 0,
    score: 0,
    streak: 0,
    best: 0,
    headshots: 0,
    plants: 0,
    defuses: 0,
    primary: p.bot ? botPrimary(game.rng.next()) : 'rifle',
    lethal: p.bot && game.rng.next() < 0.35 ? 'molotov' : 'frag',
    outfit,
    team: null,
    diedAt: -1,
    spawnedAt: 0,
    lastKillAt: -99,
    multi: 0,
    uavUntil: 0,
    uavFor: 0,
    rushUntil: 0,
    firedAt: -99,
    menu: null,
    radar: '',
    heartbeat: 0,
    chose: false,
  };
  // Their fighter, and the skin behind it (the box figure, for a client still fetching the model).
  dress(p, outfit);
  fighters.set(p.id, f);
  if (match.mode.teams) setTeam(game, f, joining ?? smallerTeam(!p.bot));
  boardDirty = true;
  return f;
}

function dress(p: Player, outfit: number) {
  p.setSkin(skinOrigin(outfit), ATLAS);
  p.setModel(fighterModel(outfit));
}

/** The side with fewer on it (counting only people, for a person joining; then everyone). */
function smallerTeam(person: boolean): Team {
  const count = (t: Team, people: boolean) => teamFighters(t).filter((f) => !people || !f.player.bot).length;
  if (person && count(0, true) !== count(1, true)) return count(0, true) < count(1, true) ? 0 : 1;
  return count(0, false) <= count(1, false) ? 0 : 1;
}

/** Put a fighter on a side: its colour over their head, and one of its outfits. */
function setTeam(game: GameContext, f: Fighter, t: Team) {
  f.team = t;
  const p = f.player;
  const wardrobe = TEAMS[t].outfits;
  if (!wardrobe.includes(f.outfit)) {
    const worn = new Set(teamFighters(t).filter((o) => o !== f).map((o) => o.outfit));
    const free = wardrobe.filter((o) => !worn.has(o));
    f.outfit = free.length ? free[game.rng.int(0, free.length - 1)] : wardrobe[game.rng.int(0, wardrobe.length - 1)];
    dress(p, f.outfit);
  }
  p.color = TEAMS[t].color;
  if (!p.bot) p.hud.widget('matchbar', { mine: t });
  boardDirty = true;
}

/** New sides for a team match: people spread across them first, then the bots fill in. */
function formTeams(game: GameContext) {
  for (const f of fighters.values()) f.team = null;
  const all = [...fighters.values()];
  for (const f of [...all.filter((f) => !f.player.bot), ...all.filter((f) => f.player.bot)]) setTeam(game, f, smallerTeam(!f.player.bot));
}

/** Back to everyone for themselves. */
function clearTeams() {
  for (const f of fighters.values()) {
    f.team = null;
    f.player.color = null;
  }
}

/** The spawn point furthest from any enemy who could see it (and, in Team Deathmatch, near a friend). */
function pickSpawn(game: GameContext, me: Player): SpawnPoint {
  const map = match.map;
  const teams = match.mode.teams;
  const pool = teams ? [...map.spawns, ...map.teams[0], ...map.teams[1]] : map.spawns;
  const enemies = game.players.filter((p) => p !== me && p.alive && hostile(me, p));
  const friends = teams ? game.players.filter((p) => p !== me && p.alive && !hostile(me, p)) : [];
  let best = pool[0];
  let bestScore = -Infinity;
  for (const sp of pool) {
    let near = 60;
    let seen = false;
    for (const e of enemies) {
      const q = e.position;
      const d = Math.hypot(q.x - sp.x, q.y - sp.y, q.z - sp.z);
      near = Math.min(near, d);
      if (!seen && d < 55 && game.world.lineOfSight(e.eye, { x: sp.x, y: sp.y + 1.6, z: sp.z })) seen = true;
    }
    const friend = friends.some((p) => Math.hypot(p.position.x - sp.x, p.position.z - sp.z) < 22) ? 8 : 0;
    const score = near - (seen ? 40 : 0) + game.rng.next() * 6 + friend;
    if (score > bestScore) {
      bestScore = score;
      best = sp;
    }
  }
  return best;
}

function arm(p: Player, primary: Primary, lethal: Lethal) {
  const inv = p.inventory;
  inv.clear();
  inv.give(primary);
  inv.give('pistol');
  inv.give('katana');
  // The lethal rides in the fourth slot: thrown with G, never switched to.
  inv.give(lethal, LETHAL_COUNT[lethal] ?? 1);
  inv.select(0);
}

/** Revive a fighter at a spawn point, armed, protected for a moment. */
function spawnAt(game: GameContext, f: Fighter, sp: SpawnPoint) {
  const p = f.player;
  p.camera.orbit(null);
  watching.delete(p.id);
  p.freeze(false);
  p.revive();
  p.health = p.maxHealth;
  p.teleport({ x: sp.x, y: sp.y + 0.05, z: sp.z }, sp.yaw, 0);
  arm(p, f.primary, f.lethal);
  p.protect(1.5);
  p.speed = 1;
  f.diedAt = -1;
  f.spawnedAt = game.clock.now;
  f.rushUntil = 0;
  if (p.bot) bots.reset(p);
  else p.audio.play('respawn');
}

/** A (re)spawn where the mode says: the safest spot, or in The Briefcase their side's end. */
function spawn(game: GameContext, f: Fighter) {
  if (isCase() && f.team !== null) {
    const pts = f.team === rounds.attackers ? match.map.bomb.attack : match.map.bomb.defend;
    spawnAt(game, f, pts[game.rng.int(0, pts.length - 1)]);
    // Between rounds (or before one starts), they wait with everyone else.
    if (rounds.phase === 'prep' || rounds.phase === 'post') f.player.freeze(true, { weapons: true });
    return;
  }
  spawnAt(game, f, pickSpawn(game, f.player));
}

/**
 * Whether a fighter may pick this weapon from the loadout (a primary or a lethal). All of them,
 * for now: progression hooks in here.
 */
function canPick(_f: Fighter, _item: string): boolean {
  return true;
}

function loadoutMenu(game: GameContext, f: Fighter) {
  if (f.menu?.open) return;
  const p = f.player;
  // Just spawned (or waiting for the round): swap now; otherwise it's for the next life.
  const pick = (name: string) => {
    if (p.alive && (game.clock.now - f.spawnedAt < 5 || (isCase() && rounds.phase === 'prep'))) {
      arm(p, f.primary, f.lethal);
      p.hud.toast(`${name} it is`);
    } else p.hud.toast(`${name} next life`);
  };
  const entries = () =>
    PRIMARIES.filter((id) => canPick(f, id)).map((id) => ({
      icon: feedIcon(id) ?? undefined,
      label: WEAPONS[id].name,
      note: BLURBS[id],
      active: f.primary === id,
      onSelect: () => {
        f.primary = id;
        f.chose = true;
        f.menu?.close();
        pick(WEAPONS[id].name);
      },
    }));
  const lethals = () =>
    (Object.keys(LETHALS) as Lethal[])
      .filter((id) => canPick(f, id))
      .map((id) => ({
        icon: feedIcon(id) ?? undefined,
        label: LETHALS[id].name,
        note: LETHAL_BLURBS[id],
        active: f.lethal === id,
        onSelect: () => {
          f.lethal = id;
          f.menu?.update({ sections: [{ title: 'Primary', entries: entries() }, { title: 'Lethal (G)', entries: lethals() }] });
          pick(LETHALS[id].name);
        },
      }));
  f.menu = p.hud.menu({
    title: 'Pick your piece',
    subtitle: 'Your primary and your lethal. The Lucky 45 and the katana come along regardless.',
    sections: [
      { title: 'Primary', entries: entries() },
      { title: 'Lethal (G)', entries: lethals() },
    ],
    onClose: () => {
      f.menu = null;
    },
  });
}

/** Bots fill the match to the mode's size (in a team mode, each side to half of it); people take their places. */
function balanceBots(game: GameContext) {
  const size = match.mode.fighters;
  const used = new Set(game.players.map((p) => p.name));
  const add = (team: Team | null) => {
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Goon ${game.players.length + 1}`;
    used.add(name);
    joining = team;
    game.bots.add(name);
    joining = null;
  };
  // The lowest scorers go first.
  const drop = (list: readonly Player[], n: number) => {
    const out = [...list].sort((a, b) => (fighters.get(a.id)?.score ?? 0) - (fighters.get(b.id)?.score ?? 0)).slice(0, n);
    for (const b of out) game.bots.remove(b);
  };
  if (!match.mode.teams) {
    const humans = game.players.filter((p) => !p.bot).length;
    const want = Math.max(0, Math.min(MAX_FIGHTERS - humans, size - humans));
    const have = game.bots.all;
    if (have.length < want) for (let i = have.length; i < want; i++) add(null);
    else if (have.length > want) drop(have, have.length - want);
    return;
  }
  for (const t of [0, 1] as Team[]) {
    const side = teamFighters(t);
    const people = side.filter((f) => !f.player.bot).length;
    const mine = side.filter((f) => f.player.bot).map((f) => f.player);
    const want = Math.max(0, Math.min(size / 2, MAX_FIGHTERS / 2) - people);
    if (mine.length < want) for (let i = mine.length; i < want; i++) add(t);
    else if (mine.length > want) drop(mine, mine.length - want);
  }
}

// -------------------------------------------------------------------------------------------------
// Kills
// -------------------------------------------------------------------------------------------------

/** What a kill was made with, for the feed: the weapon side on, or the case. */
const killIcon = (weapon: string): IconRef | null => (weapon === 'briefcase' ? { item: 'briefcase' } : feedIcon(weapon));
const killName = (weapon: string) => (weapon === 'briefcase' ? 'the case' : weaponName(weapon));

/**
 * Everything a death means, in one place: the victim's and the killer's numbers, points and
 * streaks, the kill feed and the banners, the mode's score (and The Briefcase's rounds), the end
 * of the match. Anything else that wants to hear of a kill (a kill cam, progression) hooks in at
 * the marked spots.
 */
function onDeath(game: GameContext, victim: Player, source: unknown, weapon: string | undefined, headshot: boolean, through = 0) {
  const v = fighters.get(victim.id);
  if (!v || match.phase !== 'playing') return;
  const now = game.clock.now;
  v.deaths++;
  v.streak = 0;
  v.diedAt = now;
  v.uavUntil = 0;
  boardDirty = true;
  const killer = typeof source === 'object' && source !== null && (source as Player).kind === 'player' ? (source as Player) : null;
  const k = killer && killer !== victim ? fighters.get(killer.id) : undefined;
  const icon = weapon ? killIcon(weapon) : null;
  if (k && killer) {
    k.kills++;
    k.streak++;
    k.best = Math.max(k.best, k.streak);
    let points = 100;
    const calls: string[] = [];
    if (headshot) {
      k.headshots++;
      points += 50;
      calls.push('HEADSHOT');
    }
    if (weapon === 'katana') calls.push('SLICED');
    if (weapon === 'frag') calls.push('BLOWN UP');
    if (weapon === 'molotov') calls.push('TOASTED');
    if (through > 0) {
      points += 50;
      calls.push('WALLBANG');
    }
    if (!firstBlood) {
      firstBlood = true;
      points += 50;
      calls.push('FIRST BLOOD');
    }
    k.multi = now - k.lastKillAt < 4 ? k.multi + 1 : 1;
    k.lastKillAt = now;
    const multi = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'MASSACRE'][Math.min(4, k.multi)];
    if (multi) points += 50 * (k.multi - 1);
    k.score += points;
    // What the killer sees: the points and why.
    const big = multi || (k.streak === 5 ? 'ON A ROLL' : k.streak === 10 ? 'UNSTOPPABLE' : '');
    if (big) {
      killer.hud.pop(big, { big: true, color: COLORS.gold, sub: `+${points}${calls.length ? ` · ${calls.join(' · ')}` : ''}` });
      killer.audio.play('streak');
    } else killer.hud.pop(`+${points}`, { sub: calls.join(' · ') || `${victim.name.toUpperCase()}` });
    // Streak rewards.
    if (k.streak === 3) {
      k.uavUntil = now + 25;
      k.uavFor = 25;
      killer.hud.banner('UAV ONLINE', 'Everyone shows on your radar', { color: COLORS.gold, duration: 2 });
      killer.audio.play('lock');
    }
    if (k.streak === 5) {
      k.rushUntil = now + RUSH;
      killer.speed = 1.2;
      killer.heal(killer.maxHealth);
      killer.hud.banner('ADRENALINE SHOT', 'Faster and patched up, for fifteen seconds', { color: COLORS.pink, duration: 2 });
      killer.audio.play('heal');
    }
    game.hud.feed([
      { text: killer.name, color: nameColor(killer, killer.bot ? '#ffe7a3' : COLORS.gold) },
      ...(icon ? [{ icon }] : weapon ? [` ${killName(weapon)} `] : [' ✕ ']),
      ...(headshot ? ['⌖'] : []),
      ...(through > 0 ? ['▦'] : []),
      { text: victim.name, color: nameColor(victim, victim.bot ? '#ffd0d0' : COLORS.red) },
    ]);
    victim.hud.banner('KILLED BY', `${killer.name}${weapon ? ` · ${killName(weapon)}` : ''}${headshot ? ' · headshot' : ''}${through > 0 ? ' · through the wall' : ''}`, { color: COLORS.red, duration: RESPAWN - 0.3 });
    // The kill cam: watch whoever did it. (Hook: a kill cam of its own goes here.)
    if (!victim.bot && killer.alive) victim.camera.orbit(killer, { distance: 4.5, min: 4.5, max: 4.5 });
    // (Hook: whatever else counts a kill, progression say, hears of it here: `k` got `points`.)
    // The mode's score.
    if (match.mode.id === 'ffa' && k.kills >= FFA_LIMIT) endMatch(game, killer);
    if (match.mode.id === 'tdm' && k.team !== null) {
      match.score[k.team]++;
      if (match.score[k.team] >= TDM_LIMIT) endMatch(game, null, k.team);
    }
  } else {
    game.hud.feed([{ text: victim.name, color: nameColor(victim, COLORS.red) }, weapon && LETHALS[weapon] ? ` cooked their own ${LETHALS[weapon].name}` : weapon === 'briefcase' ? ' stood too close to the case' : ' took the easy way out']);
    victim.hud.banner('WIPED OUT', undefined, { color: COLORS.red, duration: RESPAWN - 0.3 });
  }
  if (isCase()) rounds.died(v);
}

/** Points for something done (a plant, a crack), with a pop-up. */
function award(f: Fighter, points: number, title: string) {
  f.score += points;
  boardDirty = true;
  f.player.hud.pop(title, { big: true, color: COLORS.gold, sub: `+${points}` });
  f.player.audio.play('streak');
}

/** The match is over: `winner` took the free-for-all, or `team` the team match. */
function endMatch(game: GameContext, winner: Player | null, team?: Team) {
  if (match.phase === 'over') return;
  match.phase = 'over';
  overAt = game.clock.now;
  const table = standings();
  const teams = match.mode.teams;
  // A team match with no winner named (the clock ran out): the side ahead, if any.
  const won: Team | null = team ?? (teams && match.score[0] !== match.score[1] ? (match.score[0] > match.score[1] ? 0 : 1) : null);
  const top = winner ?? table[0]?.player ?? null;
  if (isCase()) rounds.end();
  for (const f of fighters.values()) {
    const p = f.player;
    p.freeze(true);
    f.menu?.close();
    p.hud.progress(null);
    if (p.bot) continue;
    const place = table.indexOf(f) + 1;
    const mine = teams ? f.team === won : p === top;
    if (teams) p.hud.banner(won === null ? 'DRAW' : mine ? 'VICTORY' : 'DEFEAT', won === null ? `${TEAMS[0].name} ${match.score[0]} · ${TEAMS[1].name} ${match.score[1]}` : `${TEAMS[won].name} take ${match.map.name} · ${match.score[won]} to ${match.score[1 - won]}`, { color: mine ? COLORS.gold : COLORS.red, duration: 9 });
    else p.hud.banner(p === top ? 'YOU WIN' : 'GAME OVER', top ? `${top.name} takes ${match.map.name} · you came ${ordinal(place)}` : undefined, { color: p === top ? COLORS.gold : COLORS.red, duration: 9 });
    // All-time numbers, kept by name.
    const key = `stats:${p.name}`;
    const s = game.store.get<{ games: number; wins: number; kills: number; deaths: number; best: number }>(key) ?? { games: 0, wins: 0, kills: 0, deaths: 0, best: 0 };
    s.games++;
    if (mine) s.wins++;
    s.kills += f.kills;
    s.deaths += f.deaths;
    s.best = Math.max(s.best, f.best);
    game.store.set(key, s);
    p.hud.toast(`All time: ${s.wins} wins · ${s.kills} kills · best streak ${s.best}`);
  }
  // What's next: the rotation's next match in a public room; the same again in one's own.
  if (game.room === 'public') plan = ROTATION[++turn % ROTATION.length];
  game.audio.play('match_end');
  scoreboard(game, true);
}

// -------------------------------------------------------------------------------------------------
// The briefcase (free-for-all and Team Deathmatch): every so often it turns up on the street,
// glowing. Whoever grabs it gets points and a radar sweep. Nobody knows what's inside.
// -------------------------------------------------------------------------------------------------

const BRIEFCASE_EVERY = 50;
const BRIEFCASE_POINTS = 300;

function defineBriefcase(game: GameContext) {
  // (Its model is each screen's: `client/looks.ts`.)
  game.items.define('briefcase', {
    kind: 'misc',
    name: 'The Briefcase',
    onPickup: (g, _n, player) => {
      const f = fighters.get(player.id);
      if (!f || !player.alive) return false;
      f.score += BRIEFCASE_POINTS;
      if (g.clock.now + 20 > f.uavUntil) {
        f.uavUntil = g.clock.now + 20;
        f.uavFor = 20;
      }
      boardDirty = true;
      briefcase = null;
      bots.objective = null;
      g.hud.marker('briefcase', null);
      g.hud.feed([{ text: player.name, color: nameColor(player, COLORS.gold) }, ' has the briefcase']);
      player.hud.pop('THE BRIEFCASE', { big: true, color: COLORS.gold, sub: `+${BRIEFCASE_POINTS} · UAV online` });
      g.audio.play('streak', { at: player.position });
      g.fx.burst({ x: player.position.x, y: player.position.y + 1.2, z: player.position.z }, { color: '#ffcc00', count: 40, speed: 5, glow: 2, life: 0.8, gravity: 2 });
      nextBriefcase = g.clock.now + BRIEFCASE_EVERY;
      return true;
    },
  });
}

/** Put the briefcase somewhere worth fighting over, away from everyone. */
function dropBriefcase(game: GameContext) {
  const spots = match.map.hotspots.length ? match.map.hotspots : match.map.spawns;
  let best = spots[0];
  let score = -Infinity;
  for (const s of spots) {
    const near = Math.min(60, ...game.players.filter((p) => p.alive).map((p) => Math.hypot(p.position.x - s.x, p.position.z - s.z)));
    const v = Math.min(near, 18) + game.rng.next() * 8;
    if (v > score) {
      score = v;
      best = s;
    }
  }
  const at = { x: best.x, y: best.y + 1, z: best.z };
  briefcase = game.items.spawnPickup('briefcase', at, { beam: '#ffcc00', despawn: 40 });
  bots.objective = { x: best.x, y: best.y, z: best.z };
  game.hud.marker('briefcase', at, { shape: 'diamond', color: COLORS.gold, label: 'THE BRIEFCASE', edge: true, pulse: true, size: 22 });
  game.hud.banner('THE BRIEFCASE', `Somebody left it ${match.map.id === 'jackrabbit' ? 'on the street' : 'lying around'}. Grab it.`, { color: COLORS.gold, duration: 2.5 });
  game.audio.play('lock');
}

function updateBriefcase(game: GameContext) {
  const now = game.clock.now;
  if (briefcase && !briefcase.alive) {
    // Nobody took it in time.
    briefcase = null;
    bots.objective = null;
    game.hud.marker('briefcase', null);
    nextBriefcase = now + BRIEFCASE_EVERY;
  }
  if (!briefcase && now >= nextBriefcase) dropBriefcase(game);
}

// -------------------------------------------------------------------------------------------------
// HUD
// -------------------------------------------------------------------------------------------------

function scoreboard(game: GameContext, show = false) {
  const left = Math.max(0, TIME_LIMIT[match.mode.id] - (game.clock.now - startedAt));
  const teams = match.mode.teams;
  const table = standings();
  const rows = (teams ? [...table].sort((a, b) => (a.team ?? 0) - (b.team ?? 0)) : table).map((f, i) => ({
    name: `${f.player.name}${f.player.bot ? ' ·bot' : ''}${isCase() && !f.player.alive && match.phase === 'playing' ? ' ✕' : ''}`,
    values: isCase() ? [f.score, f.kills, f.deaths, f.plants + f.defuses] : [f.score, f.kills, f.deaths, f.best],
    color: teams && f.team !== null ? TEAMS[f.team].color : i === 0 ? COLORS.gold : undefined,
    player: f.player,
  }));
  const where = match.map.name.toUpperCase();
  const next = `Next: ${planName(plan)} in ${Math.max(0, Math.ceil(INTERMISSION - (game.clock.now - overAt)))}`;
  const sides = `${TEAMS[0].short} ${match.score[0]} · ${TEAMS[1].short} ${match.score[1]}`;
  const footer =
    match.phase === 'over'
      ? teams
        ? `${sides} · ${next}`
        : next
      : match.mode.id === 'ffa'
        ? `First to ${FFA_LIMIT} · ${fmt(left)} left`
        : match.mode.id === 'tdm'
          ? `${sides} · first to ${TDM_LIMIT} · ${fmt(left)} left`
          : `${sides} · round ${rounds.round} · first to ${ROUNDS}`;
  game.hud.scoreboard({
    title: match.phase === 'over' ? `FINAL SCORES · ${where}` : `${where} · ${match.mode.name.toUpperCase()}`,
    columns: isCase() ? ['Score', 'Kills', 'Deaths', 'Case'] : ['Score', 'Kills', 'Deaths', 'Streak'],
    rows,
    footer,
    show,
  });
}

/** The team modes' bar across the top (hud.ts): the sides, their scores, the clock, what's happening. */
function matchBar(game: GameContext) {
  const side = (t: Team) => {
    const info = TEAMS[t];
    const all = teamFighters(t);
    return {
      short: info.short,
      color: info.color,
      score: match.score[t],
      role: isCase() ? (t === rounds.attackers ? 'Attack' : 'Defend') : '',
      cards: Array.from({ length: ROUNDS }, (_, i) => (i < match.score[t] ? 'won' : '')),
      up: all.map((f) => (f.player.alive ? 'up' : 'down')),
    };
  };
  let clock: string;
  let note: string;
  let state: string;
  if (isCase()) {
    const r = rounds;
    clock = r.phase === 'post' ? '—' : fmt(Math.ceil(r.clock()));
    state = r.phase;
    note =
      r.phase === 'prep'
        ? `Round ${r.round} · get ready`
        : r.phase === 'live'
          ? `Round ${r.round} · plant at A or B`
          : r.phase === 'planted'
            ? `Case down at ${r.planted?.site.name ?? '?'}`
            : r.result
              ? `${TEAMS[r.result.winner].short} take round ${r.round}`
              : '';
  } else {
    clock = fmt(Math.max(0, TIME_LIMIT[match.mode.id] - (game.clock.now - startedAt)));
    state = 'live';
    note = `First to ${TDM_LIMIT}`;
  }
  game.hud.widget('matchbar', { mode: match.mode.id, rounds: isCase(), a: side(0), b: side(1), clock, note, state });
}

/** Each person's corner (the dossier widget, see hud.ts), their radar, their heartbeat. */
function personalHud(game: GameContext, f: Fighter, dt: number) {
  const p = f.player;
  const table = standings();
  const place = table.indexOf(f) + 1;
  const leader = table[0];
  const now = game.clock.now;
  const teams = match.mode.teams && f.team !== null;
  // Every tick: only what changed goes to their screen.
  p.hud.widget('dossier', {
    ffa: !teams,
    kills: f.kills,
    limit: FFA_LIMIT,
    place: ordinal(place),
    fighters: table.length,
    leading: leader === f,
    margin: f.kills - (table[1]?.kills ?? 0),
    leader: leader.player.name,
    leaderKills: leader.kills,
    score: f.score,
    teamName: teams ? TEAMS[f.team!].name : '',
    teamColor: teams ? TEAMS[f.team!].color : '',
    role: isCase() && teams ? (f.team === rounds.attackers ? 'Attacking' : 'Defending') : 'Team',
    carrier: isCase() && rounds.carrier === f ? 'Hold F at A or B' : '',
    pips: streakPips(f.streak),
    extra: Math.max(0, f.streak - 5),
    uav: Math.max(0, Math.ceil(f.uavUntil - now)),
    uavFor: f.uavFor,
    rush: Math.max(0, Math.ceil(f.rushUntil - now)),
    rushFor: RUSH,
  });
  // The radar: their side always (a team mode); enemies who just fired (unsuppressed), or all of them under a UAV.
  const uav = f.uavUntil > now;
  const others = [...fighters.values()].filter((e) => e !== f && e.player.alive);
  const friends = teams ? others.filter((e) => !hostile(p, e.player)) : [];
  const foes = others.filter((e) => hostile(p, e.player) && (uav || now - e.firedAt < 1.6));
  const key = `${uav}|${friends.map((b) => b.player.id).join(',')}|${foes.map((b) => b.player.id).join(',')}`;
  if (key !== f.radar) {
    f.radar = key;
    p.hud.radar({
      center: p,
      range: 48,
      blips: [...friends.map((e) => ({ at: e.player, color: TEAMS[f.team!].color, size: 4 })), ...foes.map((e) => ({ at: e.player, color: uav ? COLORS.pink : COLORS.red, size: 5 }))],
    });
  }
  // Low on health: a heartbeat.
  if (p.alive && p.health < p.maxHealth * 0.3) {
    f.heartbeat -= dt;
    if (f.heartbeat <= 0) {
      f.heartbeat = 0.9;
      p.audio.play('heartbeat', { volume: 0.8 });
      p.fx.flash('rgba(190, 0, 0, 1)', 0.3, 0.85);
    }
  }
}

/** Down in The Briefcase: watch a teammate who's still up until the round's out. */
function spectate(f: Fighter) {
  const p = f.player;
  const now = watching.get(p.id);
  if (now?.alive) return;
  const mate = teamFighters(f.team ?? 0).find((o) => o !== f && o.player.alive)?.player ?? null;
  if (mate) {
    watching.set(p.id, mate);
    p.camera.orbit(mate, { distance: 4.5, min: 2, max: 9 });
  } else watching.delete(p.id);
}

// -------------------------------------------------------------------------------------------------
// Choosing the match: a public room goes round the rotation; a room of one's own picks (M)
// -------------------------------------------------------------------------------------------------

function matchMenu(game: GameContext, p: Player) {
  if (game.room === 'public') {
    p.hud.toast(`Public games go round the modes and maps · next: ${planName(plan)}`);
    return;
  }
  if (settings?.open) return;
  const pick: MatchPlan = { mode: match.mode.id, map: match.map.id };
  const sections = (): MenuOptions['sections'] => [
    { title: 'Mode', entries: Object.values(MODES).map((m) => ({ label: m.name, note: m.goal, active: pick.mode === m.id, onSelect: () => ((pick.mode = m.id), settings?.update({ sections: sections() })) })) },
    { title: 'Map', entries: MAPS.map((m) => ({ label: m.name, note: m.blurb, active: pick.map === m.id, onSelect: () => ((pick.map = m.id), settings?.update({ sections: sections() })) })) },
    {
      title: 'Go',
      entries: [
        {
          label: 'Start the match',
          note: planName(pick),
          onSelect: () => {
            plan = { ...pick };
            settings?.close();
            game.hud.feed([{ text: p.name, color: COLORS.gold }, ` started ${planName(plan)}`]);
            game.restart();
          },
        },
      ],
    },
  ];
  offered = true;
  settings = p.hud.menu({
    title: 'Your game',
    subtitle: 'Pick the mode and the map, then start: the match begins again with them. M brings this back.',
    sections: sections(),
    onClose: () => {
      settings = null;
    },
  });
}

// -------------------------------------------------------------------------------------------------
// The game
// -------------------------------------------------------------------------------------------------

export default defineServer(shared, {
  setup(game) {
    // A fresh game (a page can host one game after another): nothing carries over.
    match.fighters = fighters = new Map();
    match.phase = 'playing';
    match.mode = MODES.ffa;
    match.map = MAPS[0];
    running = false;
    briefcase = null;
    plan = ROTATION[0];
    turn = 0;
    offered = false;
    settings = null;
    watching.clear();
    defineArt(game);
    defineWeapons(game);
    defineBriefcase(game);
    // (Its voices are each screen's, `client/sounds.ts`: played here by name.)
    game.hud.define('dossier', DOSSIER);
    game.hud.define('matchbar', MATCHBAR);
    // Each map's walking grid (built once its blocks are here, kept up with holes and breaks), and
    // the bots on whichever the match is on.
    navs = new Map(MAPS.map((m) => [m.id, navGrid(game, { bounds: m.bounds })]));
    bots = makeBots(game, () => navs.get(match.map.id) ?? null, hotspots);
    rounds = new CaseRounds(game, { spawnAt: (f, at) => spawnAt(game, f, at), award, endMatch: (t) => endMatch(game, null, t) });
    game.events.on('playerJoin', ({ player }) => {
      const f = fighters.get(player.id) ?? addFighter(game, player);
      if (player.bot) bots.add(player as Bot, 0.3 + game.rng.next() * 0.5);
      if (running && match.phase === 'playing') spawn(game, f);
      if (!player.bot) {
        if (running) loadoutMenu(game, f);
        balanceBots(game);
        game.hud.feed([{ text: player.name, color: nameColor(player, COLORS.gold) }, ` rolled into ${match.map.name}`]);
      }
    });
    game.events.on('playerReady', ({ player }) => {
      // A room of one's own: the first one in picks what to play.
      if (game.room !== 'public' && !offered) matchMenu(game, player);
    });
    game.events.on('playerLeave', ({ player }) => {
      const f = fighters.get(player.id);
      f?.menu?.close();
      fighters.delete(player.id);
      watching.delete(player.id);
      bots.remove(player);
      boardDirty = true;
      if (f && isCase()) rounds.left(f);
      if (!player.bot) balanceBots(game);
    });
    game.events.on('playerDeath', ({ player, source, weapon, headshot, through }) => onDeath(game, player, source, weapon, !!headshot, through ?? 0));
    game.events.on('shot', ({ player }) => {
      const f = fighters.get(player.id);
      if (f) f.firedAt = game.clock.now;
    });
    // No friendly fire in a team mode (your own frag still hurts you).
    game.events.on('damage', (hit) => {
      const by = hit.source;
      if (!match.mode.teams || !by || by === 'world' || by.kind !== 'player' || hit.target.kind !== 'player' || by === hit.target) return;
      if (!hostile(by, hit.target)) hit.cancel();
    });
    game.commands.register('bots', {
      usage: '<n>',
      help: 'Fill the match up to n fighters',
      cheat: true,
      run: ([n], g) => {
        const want = Math.max(0, Math.min(MAX_FIGHTERS, Number(n) || 0) - g.players.filter((p) => !p.bot).length);
        while (g.bots.all.length > want) g.bots.remove(g.bots.all[g.bots.all.length - 1]);
        const used = new Set(g.players.map((p) => p.name));
        while (g.bots.all.length < want) {
          const name = BOT_NAMES.find((x) => !used.has(x)) ?? `Goon ${g.bots.all.length}`;
          used.add(name);
          g.bots.add(name);
        }
        return `${g.players.length} fighters`;
      },
    });
    game.commands.register('win', { help: 'End the match now', cheat: true, run: (_a, g, p) => endMatch(g, p, match.mode.teams ? (fighterOf(p)?.team ?? 0) : undefined) });
    game.commands.register('case', {
      usage: '[A|B]',
      help: 'The Briefcase: take the case (you attack), or plant it at A or B now',
      cheat: true,
      run: ([site], _g, p) => {
        const f = fighterOf(p);
        if (!isCase() || !f) return 'not in The Briefcase';
        if (site) return rounds.plantAt(site) ? `planted at ${site.toUpperCase()}` : 'no round on, or no such site';
        return rounds.give(f) ? 'you have the case' : 'only an attacker, while the round is on';
      },
    });
    game.commands.register('mode', {
      usage: '<ffa|tdm|case> [jackrabbit|kahuna]',
      help: 'Start a match of this mode (on this map)',
      cheat: true,
      run: ([m, where], g) => {
        if (!m || !(m in MODES)) return `modes: ${Object.keys(MODES).join(', ')}`;
        if (where && !mapById(where)) return `maps: ${MAPS.map((x) => x.id).join(', ')}`;
        plan = { mode: m as ModeId, map: where ?? match.map.id };
        g.restart();
        return planName(plan);
      },
    });
  },

  start(game) {
    running = true;
    match.phase = 'playing';
    // The match planned: its mode, its map (the bots' grid and hotspots with it).
    match.mode = MODES[plan.mode];
    match.map = mapById(plan.map) ?? MAPS[0];
    match.score = [0, 0];
    hotspots.splice(0, hotspots.length, ...match.map.hotspots);
    startedAt = game.clock.now;
    firstBlood = false;
    lastSecond = -1;
    boardDirty = true;
    briefcase = null;
    bots.objective = null;
    watching.clear();
    nextBriefcase = game.clock.now + 35;
    for (const f of fighters.values()) {
      Object.assign(f, { kills: 0, deaths: 0, score: 0, streak: 0, best: 0, headshots: 0, plants: 0, defuses: 0, diedAt: -1, uavUntil: 0, uavFor: 0, rushUntil: 0, firedAt: -99, radar: '', multi: 0 });
    }
    for (const p of game.players) if (!fighters.has(p.id)) addFighter(game, p);
    if (match.mode.teams) formTeams(game);
    else clearTeams();
    balanceBots(game);
    bots.rules = match.mode.id === 'ffa' ? null : { hostile: (bot, other) => hostile(bot, other), goal: (bot, mind) => (isCase() ? rounds.goal(bot, mind) : null) };
    const where = match.map.name.toUpperCase();
    if (isCase()) {
      // The rounds put everyone where they start.
      matchBar(game);
      rounds.begin();
      game.hud.feed([`${match.mode.name} on ${match.map.name}: ${match.mode.goal}`]);
    } else {
      // Team Deathmatch starts each side at its end of the map; a free-for-all wherever's safest.
      const count = [0, 0];
      for (const f of fighters.values()) {
        if (match.mode.teams && f.team !== null) {
          const side = match.map.teams[f.team];
          spawnAt(game, f, side[count[f.team]++ % side.length]);
        } else spawn(game, f);
      }
      if (match.mode.teams) matchBar(game);
      game.hud.banner(where, match.mode.id === 'ffa' ? `Free-for-all · first to ${FFA_LIMIT}` : `${match.mode.name} · ${match.mode.goal}`, { color: COLORS.gold, duration: 3 });
      game.audio.play('match_start');
    }
    // Their own copy of the bar says which side is theirs.
    if (match.mode.teams) for (const f of fighters.values()) if (!f.player.bot && f.team !== null) f.player.hud.widget('matchbar', { mine: f.team });
    for (const f of fighters.values()) if (!f.player.bot && !f.chose) loadoutMenu(game, f);
  },

  update(game, dt) {
    const now = game.clock.now;
    const between = isCase() && (rounds.phase === 'prep' || rounds.phase === 'post');
    bots.update(dt, match.phase !== 'playing' || between);
    if (isCase() && match.phase === 'playing') rounds.driveBots(bots);

    if (match.phase === 'over') {
      if (now - overAt > INTERMISSION) game.restart();
      else if (Math.floor(now) !== lastSecond) {
        lastSecond = Math.floor(now);
        scoreboard(game, true);
      }
      return;
    }

    // Respawns (not in The Briefcase: the down watch a teammate), streak timers, the edge of the map.
    for (const f of fighters.values()) {
      const p = f.player;
      if (!p.bot && p.input.pressed('KeyM')) matchMenu(game, p);
      if (!p.alive) {
        if (f.diedAt < 0) f.diedAt = now;
        if (isCase()) {
          if (!p.bot && now - f.diedAt >= RESPAWN) spectate(f);
        } else if (now - f.diedAt >= RESPAWN) spawn(game, f);
        if (!p.bot) personalHud(game, f, dt);
        continue;
      }
      if (f.rushUntil && now > f.rushUntil) {
        f.rushUntil = 0;
        p.speed = 1;
      }
      const q = p.position;
      if (q.y < match.map.bounds.min.y - 4) p.damage(1000, { source: 'world', knockback: 0 });
      if (!p.bot) {
        if (p.input.pressed('KeyL')) loadoutMenu(game, f);
        personalHud(game, f, dt);
      }
    }

    if (isCase()) rounds.update(dt);
    else updateBriefcase(game);
    if (match.phase !== 'playing') return;
    // The clock.
    const left = TIME_LIMIT[match.mode.id] - (now - startedAt);
    if (left <= 0) {
      endMatch(game, null);
      return;
    }
    const second = Math.floor(now);
    if (second !== lastSecond) {
      lastSecond = second;
      if (match.mode.id === 'ffa') game.hud.objective(`${fmt(left)} · First to ${FFA_LIMIT}`);
      if (left <= 10.5 && left > 0) game.audio.play('countdown');
      boardDirty = true;
    }
    if (match.mode.teams) matchBar(game);
    if (boardDirty && now - boardAt > 0.25) {
      boardDirty = false;
      boardAt = now;
      scoreboard(game);
    }
  },
});
