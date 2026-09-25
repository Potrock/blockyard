import { defineGame, type Bot, type GameContext, type MenuHandle, type Pickup, type Player } from '@platform';
import { ATLAS, defineArt, OUTFITS, skinOrigin } from './art';
import { Bots } from './bots';
import { MAP, type SpawnPoint } from './map';
import { NavGrid } from './nav';
import { defineSounds } from './sounds';
import { BLURBS, defineWeapons, feedIcon, PRIMARIES, WEAPONS, type Primary } from './weapons';
import { GUNS } from './models';

/**
 * Call of Blocky: a fast free-for-all on Jackrabbit Lane, a Nuketown-style cul-de-sac painted
 * pulp-pop. First to 25 kills (or the most when the clock runs out) takes it. Bots fill the
 * street up to six fighters; people joining take a bot's place.
 *
 * Everyone carries a primary of their choosing (L), the Lucky 45 and a katana. Three kills in
 * a row light up the radar for you (UAV); five get an Adrenaline Shot: faster, and patched up.
 */

const SCORE_LIMIT = 25;
const TIME_LIMIT = 8 * 60;
/** Bots fill the match up to this many fighters (and never past eight). */
const FIGHTERS = 6;
const MAX_FIGHTERS = 8;
const RESPAWN = 3;
const BOT_NAMES = ['Lucky Lou', 'Dolly Dagger', 'Sal Nero', 'Candy Kane', 'Rocco', 'Velma', 'Big Tony', 'Honey', 'Duke', 'Jackie Rabbit', 'Frankie Two-Guns', 'Mona', 'Zed', 'Butch'];
const COLORS = { gold: '#ffcc00', red: '#e63946', ink: '#111111', cream: '#fdf1d6', pink: '#ff5c8a', teal: '#1fa3a0' };

interface Fighter {
  player: Player;
  kills: number;
  deaths: number;
  score: number;
  streak: number;
  best: number;
  headshots: number;
  primary: Primary;
  outfit: number;
  /** When they died (-1: alive), and who did it. */
  diedAt: number;
  spawnedAt: number;
  lastKillAt: number;
  multi: number;
  uavUntil: number;
  rushUntil: number;
  /** Last shot: they show on everyone's radar for a moment. */
  firedAt: number;
  menu: MenuHandle | null;
  /** What their radar shows now (only changes go out). */
  radar: string;
  heartbeat: number;
  chose: boolean;
}

let fighters = new Map<string, Fighter>();
let phase: 'playing' | 'over' = 'playing';
/** A match has begun (`start`): newcomers go straight in. */
let running = false;
let startedAt = 0;
let overAt = 0;
let firstBlood = false;
let nav: NavGrid | null = null;
let bots: Bots;
let boardDirty = true;
/** The briefcase: on the street (a pickup), and when the next one turns up. */
let briefcase: Pickup | null = null;
let nextBriefcase = 0;
let boardAt = 0;
let lastSecond = -1;

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** What a bot carries: mostly rifles and SMGs, now and then a shotgun, rarely a sniper. */
function botPrimary(r: number): Primary {
  return r < 0.42 ? 'rifle' : r < 0.74 ? 'smg' : r < 0.92 ? 'shotgun' : 'sniper';
}

function standings(): Fighter[] {
  return [...fighters.values()].sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);
}

// -------------------------------------------------------------------------------------------------
// Fighters: joining, spawning, loadouts
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
    primary: p.bot ? botPrimary(game.rng.next()) : 'rifle',
    outfit,
    diedAt: -1,
    spawnedAt: 0,
    lastKillAt: -99,
    multi: 0,
    uavUntil: 0,
    rushUntil: 0,
    firedAt: -99,
    menu: null,
    radar: '',
    heartbeat: 0,
    chose: false,
  };
  p.setSkin(skinOrigin(outfit), ATLAS);
  fighters.set(p.id, f);
  boardDirty = true;
  return f;
}

/** The spawn point furthest from anyone who could see it. */
function pickSpawn(game: GameContext, me: Player): SpawnPoint {
  const enemies = game.players.filter((p) => p !== me && p.alive);
  let best = MAP.spawns[0];
  let bestScore = -Infinity;
  for (const sp of MAP.spawns) {
    let near = 60;
    let seen = false;
    for (const e of enemies) {
      const q = e.position;
      const d = Math.hypot(q.x - sp.x, q.y - sp.y, q.z - sp.z);
      near = Math.min(near, d);
      if (!seen && d < 55 && game.world.lineOfSight(e.eye, { x: sp.x, y: sp.y + 1.6, z: sp.z })) seen = true;
    }
    const score = near - (seen ? 40 : 0) + game.rng.next() * 6;
    if (score > bestScore) {
      bestScore = score;
      best = sp;
    }
  }
  return best;
}

function arm(p: Player, primary: Primary) {
  const inv = p.inventory;
  inv.clear();
  inv.give(primary);
  inv.give('pistol');
  inv.give('katana');
  inv.select(0);
}

function spawn(game: GameContext, f: Fighter) {
  const p = f.player;
  const sp = pickSpawn(game, p);
  p.camera.orbit(null);
  p.freeze(false);
  p.revive();
  p.health = p.maxHealth;
  p.teleport({ x: sp.x, y: sp.y + 0.05, z: sp.z }, sp.yaw, 0);
  arm(p, f.primary);
  p.protect(1.5);
  p.speed = 1;
  f.diedAt = -1;
  f.spawnedAt = game.clock.now;
  f.rushUntil = 0;
  if (p.bot) bots.respawned(p);
  else p.audio.play('respawn');
}

function loadoutMenu(game: GameContext, f: Fighter) {
  if (f.menu?.open) return;
  const p = f.player;
  const entries = () =>
    PRIMARIES.map((id) => ({
      icon: feedIcon(id) ?? undefined,
      label: WEAPONS[id].name,
      note: BLURBS[id],
      active: f.primary === id,
      onSelect: () => {
        f.primary = id;
        f.chose = true;
        f.menu?.close();
        // Just spawned: swap now; otherwise it's for the next life.
        if (p.alive && game.clock.now - f.spawnedAt < 5) {
          arm(p, id);
          p.hud.toast(`${WEAPONS[id].name} it is`);
        } else p.hud.toast(`${WEAPONS[id].name} next life`);
      },
    }));
  f.menu = p.hud.menu({
    title: 'Pick your piece',
    subtitle: 'Your primary. The Lucky 45 and the katana come along regardless.',
    sections: [{ entries: entries() }],
    onClose: () => {
      f.menu = null;
    },
  });
}

/** Bots fill the street to `FIGHTERS`; people take their places. */
function balanceBots(game: GameContext) {
  const humans = game.players.filter((p) => !p.bot).length;
  const want = Math.max(0, Math.min(MAX_FIGHTERS - humans, FIGHTERS - humans));
  const have = game.bots.all;
  if (have.length < want) {
    const used = new Set(game.players.map((p) => p.name));
    for (let i = have.length; i < want; i++) {
      const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Goon ${i + 1}`;
      used.add(name);
      game.bots.add(name);
    }
  } else if (have.length > want) {
    // The lowest scorers go first.
    const out = [...have].sort((a, b) => (fighters.get(a.id)?.score ?? 0) - (fighters.get(b.id)?.score ?? 0)).slice(0, have.length - want);
    for (const b of out) game.bots.remove(b);
  }
}

// -------------------------------------------------------------------------------------------------
// Kills
// -------------------------------------------------------------------------------------------------

function onDeath(game: GameContext, victim: Player, source: unknown, weapon: string | undefined, headshot: boolean) {
  const v = fighters.get(victim.id);
  if (!v || phase !== 'playing') return;
  const now = game.clock.now;
  v.deaths++;
  v.streak = 0;
  v.diedAt = now;
  v.uavUntil = 0;
  boardDirty = true;
  const killer = typeof source === 'object' && source !== null && (source as Player).kind === 'player' ? (source as Player) : null;
  const k = killer && killer !== victim ? fighters.get(killer.id) : undefined;
  const icon = weapon ? feedIcon(weapon) : null;
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
      killer.hud.banner('UAV ONLINE', 'Everyone shows on your radar', { color: COLORS.gold, duration: 2 });
      killer.audio.play('lock');
    }
    if (k.streak === 5) {
      k.rushUntil = now + 15;
      killer.speed = 1.2;
      killer.heal(killer.maxHealth);
      killer.hud.banner('ADRENALINE SHOT', 'Faster and patched up, for fifteen seconds', { color: COLORS.pink, duration: 2 });
      killer.audio.play('heal');
    }
    game.hud.feed([{ text: killer.name, color: killer.bot ? '#ffe7a3' : COLORS.gold }, ...(icon ? [{ icon }] : weapon ? [` ${WEAPONS[weapon]?.name ?? weapon} `] : [' ✕ ']), ...(headshot ? ['⌖'] : []), { text: victim.name, color: victim.bot ? '#ffd0d0' : COLORS.red }]);
    victim.hud.banner('KILLED BY', `${killer.name}${weapon ? ` · ${WEAPONS[weapon]?.name ?? weapon}` : ''}${headshot ? ' · headshot' : ''}`, { color: COLORS.red, duration: RESPAWN - 0.3 });
    // The kill cam: watch whoever did it.
    if (!victim.bot && killer.alive) victim.camera.orbit(killer, { distance: 4.5, min: 4.5, max: 4.5 });
    if (k.kills >= SCORE_LIMIT) endMatch(game, killer);
  } else {
    game.hud.feed([{ text: victim.name, color: COLORS.red }, ' took the easy way out']);
    victim.hud.banner('WIPED OUT', undefined, { color: COLORS.red, duration: RESPAWN - 0.3 });
  }
}

function endMatch(game: GameContext, winner: Player | null) {
  if (phase === 'over') return;
  phase = 'over';
  overAt = game.clock.now;
  const table = standings();
  const top = winner ?? table[0]?.player ?? null;
  for (const f of fighters.values()) {
    const p = f.player;
    p.freeze(true);
    f.menu?.close();
    if (p.bot) continue;
    const place = table.indexOf(f) + 1;
    p.hud.banner(p === top ? 'YOU WIN' : 'GAME OVER', top ? `${top.name} takes Jackrabbit Lane · you came ${ordinal(place)}` : undefined, { color: p === top ? COLORS.gold : COLORS.red, duration: 9 });
    // All-time numbers, kept by name.
    const key = `stats:${p.name}`;
    const s = game.store.get<{ games: number; wins: number; kills: number; deaths: number; best: number }>(key) ?? { games: 0, wins: 0, kills: 0, deaths: 0, best: 0 };
    s.games++;
    if (p === top) s.wins++;
    s.kills += f.kills;
    s.deaths += f.deaths;
    s.best = Math.max(s.best, f.best);
    game.store.set(key, s);
    p.hud.toast(`All time: ${s.wins} wins · ${s.kills} kills · best streak ${s.best}`);
  }
  game.audio.play('match_end');
  scoreboard(game, true);
}

// -------------------------------------------------------------------------------------------------
// The briefcase: every so often it turns up on the street, glowing. Whoever grabs it gets points
// and a radar sweep. Nobody knows what's inside.
// -------------------------------------------------------------------------------------------------

const BRIEFCASE_EVERY = 50;
const BRIEFCASE_POINTS = 300;

function defineBriefcase(game: GameContext) {
  const model = GUNS.find((g) => g.id === 'briefcase')?.url;
  game.items.define('briefcase', {
    kind: 'misc',
    name: 'The Briefcase',
    icon: model ? { gltf: model } : { block: 'yellow_concrete' },
    onPickup: (g, _n, player) => {
      const f = fighters.get(player.id);
      if (!f || !player.alive) return false;
      f.score += BRIEFCASE_POINTS;
      f.uavUntil = Math.max(f.uavUntil, g.clock.now + 20);
      boardDirty = true;
      briefcase = null;
      bots.objective = null;
      g.hud.marker('briefcase', null);
      g.hud.feed([{ text: player.name, color: COLORS.gold }, ' has the briefcase']);
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
  const spots = MAP.hotspots.length ? MAP.hotspots : MAP.spawns;
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
  game.hud.banner('THE BRIEFCASE', 'Somebody left it on the street. Grab it.', { color: COLORS.gold, duration: 2.5 });
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
  const left = Math.max(0, TIME_LIMIT - (game.clock.now - startedAt));
  const rows = standings().map((f, i) => ({
    name: `${f.player.name}${f.player.bot ? ' ·bot' : ''}`,
    values: [f.score, f.kills, f.deaths, f.best],
    color: i === 0 ? COLORS.gold : undefined,
    player: f.player,
  }));
  game.hud.scoreboard({
    title: phase === 'over' ? 'FINAL SCORES · JACKRABBIT LANE' : 'JACKRABBIT LANE · FREE-FOR-ALL',
    columns: ['Score', 'Kills', 'Deaths', 'Streak'],
    rows,
    footer: phase === 'over' ? `Next match in ${Math.max(0, Math.ceil(12 - (game.clock.now - overAt)))}` : `First to ${SCORE_LIMIT} · ${fmt(left)} left`,
    show,
  });
}

/** Each person's corner: their kills, their place, the leader; their radar. */
function personalHud(game: GameContext, f: Fighter, dt: number) {
  const p = f.player;
  const table = standings();
  const place = table.indexOf(f) + 1;
  const leader = table[0];
  p.hud.stat('kills', 'Kills', `${f.kills} / ${SCORE_LIMIT}`);
  p.hud.stat('place', 'Place', `${ordinal(place)} of ${table.length}`);
  p.hud.stat('lead', leader === f ? 'Leading by' : 'Leader', leader === f ? String(f.kills - (table[1]?.kills ?? 0)) : `${leader.player.name} · ${leader.kills}`);
  // The radar: enemies who just fired (unsuppressed), or everyone under a UAV.
  const now = game.clock.now;
  const uav = f.uavUntil > now;
  const blips = [...fighters.values()].filter((e) => e !== f && e.player.alive && (uav || now - e.firedAt < 1.6)).map((e) => e.player);
  const key = `${uav}|${blips.map((b) => b.id).join(',')}`;
  if (key !== f.radar) {
    f.radar = key;
    p.hud.radar({ center: p, range: 48, blips: blips.map((b) => ({ at: b, color: uav ? COLORS.pink : COLORS.red, size: 5 })) });
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

// -------------------------------------------------------------------------------------------------
// The game
// -------------------------------------------------------------------------------------------------

/** The map's middle (where the host generates the world first): everyone's placed from here. */
const centre = { x: (MAP.bounds.min.x + MAP.bounds.max.x) / 2, z: (MAP.bounds.min.z + MAP.bounds.max.z) / 2 };

export default defineGame({
  id: 'callofblocky',
  title: 'Call of Blocky',
  tagline: 'Free-for-all on Jackrabbit Lane. First to 25.',
  accent: COLORS.gold,
  controls: [
    ['LMB', 'fire'],
    ['RMB', 'aim'],
    ['R', 'reload'],
    ['Shift', 'sprint'],
    ['C', 'crouch · slide'],
    ['1 2 3', 'weapons'],
    ['L', 'loadout'],
    ['Tab', 'scores'],
  ],
  instances: true,
  world: {
    seed: MAP.seed,
    structures: MAP.structures,
    terraform: MAP.terraform,
    spawn: { x: centre.x + 0.5, y: MAP.floorY + 0.05, z: centre.z + 0.5 },
    spawnYaw: MAP.spawns[0]?.yaw ?? 0,
    time: MAP.time,
    freezeTime: true,
  },
  player: {
    health: 100,
    regen: { delay: 4.5, perSecond: 35 },
    hurtCooldown: 0,
    pvp: true,
    fallDamage: false,
    hotbar: 'items',
    skin: skinOrigin(0),
    skinAtlas: ATLAS,
    movement: {
      walk: 6,
      sprint: 8.4,
      crouch: 2.8,
      jump: 1.3,
      gravity: 30,
      acceleration: 16,
      airControl: 4,
      sprintKeys: ['ShiftLeft', 'ShiftRight'],
      crouchKeys: ['KeyC'],
      doubleTapSprint: false,
      edgeGuard: false,
      slide: { speed: 11.5, time: 0.8, friction: 1.3, cooldown: 0.6 },
      mantle: 1.1,
    },
  },
  hud: {
    health: 'bar',
    healthBars: true,
    nameTags: 'sight',
    theme: {
      display: "'Bangers', 'Impact', 'Arial Black', sans-serif",
      text: "'Archivo', 'Helvetica Neue', system-ui, sans-serif",
      fonts: ['Bangers', 'Archivo'],
      colors: { accent: COLORS.gold, ink: COLORS.ink, paper: COLORS.cream, text: COLORS.ink, danger: COLORS.red, good: COLORS.gold },
      comic: true,
    },
  },

  setup(game) {
    defineArt(game);
    defineWeapons(game);
    defineBriefcase(game);
    defineSounds(game);
    bots = new Bots(game, () => nav, MAP.hotspots);
    game.events.on('playerJoin', ({ player }) => {
      const f = fighters.get(player.id) ?? addFighter(game, player);
      if (player.bot) bots.add(player as Bot, 0.45 + game.rng.next() * 0.45);
      if (running && phase === 'playing') spawn(game, f);
      if (!player.bot) {
        if (running) loadoutMenu(game, f);
        balanceBots(game);
        game.hud.feed([{ text: player.name, color: COLORS.gold }, ' rolled into Jackrabbit Lane']);
      }
    });
    game.events.on('playerLeave', ({ player }) => {
      fighters.get(player.id)?.menu?.close();
      fighters.delete(player.id);
      bots.remove(player);
      boardDirty = true;
      if (!player.bot) balanceBots(game);
    });
    game.events.on('playerDeath', ({ player, source, weapon, headshot }) => onDeath(game, player, source, weapon, !!headshot));
    game.events.on('shot', ({ player, from }) => {
      const f = fighters.get(player.id);
      if (f) f.firedAt = game.clock.now;
      bots.heard(player, from);
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
    game.commands.register('win', { help: 'End the match now', cheat: true, run: (_a, g, p) => endMatch(g, p) });
  },

  start(game) {
    running = true;
    phase = 'playing';
    startedAt = game.clock.now;
    firstBlood = false;
    lastSecond = -1;
    boardDirty = true;
    briefcase = null;
    bots.objective = null;
    nextBriefcase = game.clock.now + 35;
    for (const f of fighters.values()) {
      Object.assign(f, { kills: 0, deaths: 0, score: 0, streak: 0, best: 0, headshots: 0, diedAt: -1, uavUntil: 0, rushUntil: 0, firedAt: -99, radar: '', multi: 0 });
    }
    for (const p of game.players) if (!fighters.has(p.id)) addFighter(game, p);
    balanceBots(game);
    for (const f of fighters.values()) spawn(game, f);
    game.hud.banner('JACKRABBIT LANE', `Free-for-all · first to ${SCORE_LIMIT}`, { color: COLORS.gold, duration: 3 });
    game.audio.play('match_start');
    for (const f of fighters.values()) if (!f.player.bot && !f.chose) loadoutMenu(game, f);
  },

  update(game, dt) {
    const now = game.clock.now;
    // The walking grid, once the map's blocks are here.
    if (!nav) {
      const { min, max } = MAP.bounds;
      if ([min.x, max.x].every((x) => [min.z, max.z].every((z) => game.world.getBlock(x, MAP.floorY - 1, z) >= 0))) {
        nav = new NavGrid(game, MAP.bounds);
        nav.build();
      }
    }
    bots.update(dt, phase !== 'playing');

    if (phase === 'over') {
      if (now - overAt > 12) game.restart();
      else if (Math.floor(now) !== lastSecond) {
        lastSecond = Math.floor(now);
        scoreboard(game, true);
      }
      return;
    }

    // Respawns, streak timers, the edge of the map.
    for (const f of fighters.values()) {
      const p = f.player;
      if (!p.alive) {
        if (f.diedAt < 0) f.diedAt = now;
        if (now - f.diedAt >= RESPAWN) spawn(game, f);
        continue;
      }
      if (f.rushUntil && now > f.rushUntil) {
        f.rushUntil = 0;
        p.speed = 1;
      }
      const q = p.position;
      if (q.y < MAP.bounds.min.y - 4) p.damage(1000, { source: 'world', knockback: 0 });
      if (!p.bot) {
        if (p.input.pressed('KeyL')) loadoutMenu(game, f);
        personalHud(game, f, dt);
      }
    }

    updateBriefcase(game);
    // The clock.
    const left = TIME_LIMIT - (now - startedAt);
    if (left <= 0) {
      endMatch(game, null);
      return;
    }
    const second = Math.floor(now);
    if (second !== lastSecond) {
      lastSecond = second;
      game.hud.objective(`${fmt(left)} · First to ${SCORE_LIMIT}`);
      if (left <= 10.5 && left > 0) game.audio.play('countdown');
      boardDirty = true;
    }
    if (boardDirty && now - boardAt > 0.25) {
      boardDirty = false;
      boardAt = now;
      scoreboard(game);
    }
  },
});
