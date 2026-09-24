import { defineGame, Models, type Actor, type GameContext, type Player } from '@platform';
import { building, interactions, type Building, type Interactions } from '@platform/kits';
import { BEDWARS_ATLAS, Skin, botSword, paintBedwarsAtlas } from './art';
import { Bot, type Target } from './bots';
import { Fireballs } from './fireballs';
import { defineItems } from './items';
import { buildMap } from './map';
import { Nav } from './nav';
import { Shop } from './shop';
import { defineSounds } from './sounds';
import {
  armorPoints,
  CURRENCIES,
  CURRENCY_NAME,
  emptyWallet,
  Match,
  mineTime,
  Pile,
  PICK_ITEMS,
  RESPAWN_SECONDS,
  SUDDEN_DEATH_AT,
  swordItem,
  type Team,
} from './state';

const map = buildMap();
const RED = map.teams[0];

// Match state, created in setup.
let match: Match;
let nav: Nav;
let shop: Shop;
let fireballs: Fireballs;
/** Survival building (mining and placing, under Bed Wars' rules) and the shopkeepers. */
let build: Building;
let talk: Interactions;
const bots = new Map<number, Bot>();
/** HUD timers and the diamond / emerald countdowns. */
const hud = { refresh: 0, diamondIn: 30, emeraldIn: 60 };
/** Per team: when it may next be warned of an enemy at its bed. */
const alarms = new Map<Team, number>();
let nextBotSkill = 0;
/** The match is on (`start` ran): players who join now take over a bot's team. */
let playing = false;

/** A player's all-time numbers, kept by name in `game.store` (the server's database). */
interface AllTime {
  games: number;
  wins: number;
  kills: number;
  finals: number;
  beds: number;
}
/** Players whose match has been counted (once each, when it ends for them). */
const recorded = new Set<Player>();

/** Count this match into a player's all-time numbers (once), and return them. */
function record(game: GameContext, p: Player, t: Team, won: boolean): AllTime {
  const key = `stats:${p.name}`;
  const r: AllTime = { games: 0, wins: 0, kills: 0, finals: 0, beds: 0, ...game.store.get<AllTime>(key) };
  if (!recorded.has(p)) {
    recorded.add(p);
    r.games++;
    if (won) r.wins++;
    r.kills += t.kills;
    r.finals += t.finals;
    r.beds += t.beds;
    game.store.set(key, r);
  }
  return r;
}

const BOT_SKILL = [0.8, 0.95, 0.88];
const BOT_NAMES: Record<string, string> = { blue: 'Blue', green: 'Green', yellow: 'Yellow', red: 'Red' };

/** Pathfinding bounds: every structure, plus room to bridge around them. */
function navBounds() {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const bp of map.blueprints) {
    x0 = Math.min(x0, bp.origin.x);
    z0 = Math.min(z0, bp.origin.z);
    x1 = Math.max(x1, bp.origin.x + bp.size.x - 1);
    z1 = Math.max(z1, bp.origin.z + bp.size.z - 1);
  }
  return { x0: x0 - 16, x1: x1 + 16, z0: z0 - 16, z1: z1 + 16, y0: map.voidY + 4, y1: Math.min(250, map.center.y + 30) };
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------------------------------------------------------------------------------------------
// Deaths, respawns, beds
// ---------------------------------------------------------------------------------------------

/** Who gets the kill: whoever dealt the blow, else whoever hit them last (knocked into the void). */
function killerOf(victim: Team, source: unknown): Team | null {
  const direct = match.teamOf(source as Actor | undefined);
  if (direct && direct !== victim) return direct;
  const lh = victim.lastHit;
  return lh && match.now - lh.at < 10 ? lh.team : null;
}

/** A team as the feed names it: its player's name, or the bot's colour. */
const who = (t: Team) => t.player?.name ?? t.name;

function announceDeath(game: GameContext, victim: Team, killer: Team | null, fell: boolean) {
  const final = !victim.bed;
  const v = who(victim);
  let text: string;
  if (killer) text = fell ? `${v} was knocked into the void by ${who(killer)}` : `${v} was slain by ${who(killer)}`;
  else text = fell ? `${v} fell into the void` : `${v} died`;
  game.hud.feed(final ? `${text}. FINAL KILL!` : text, { color: final ? '#ffd84a' : undefined });
  if (killer) {
    killer.kills++;
    if (final) killer.finals++;
    // The killer takes their resources.
    const loot = victim.wallet;
    const got: string[] = [];
    for (const c of CURRENCIES) {
      if (loot[c] > 0) {
        killer.wallet[c] += loot[c];
        got.push(`+${loot[c]} ${CURRENCY_NAME[c][loot[c] === 1 ? 0 : 1]}`);
      }
    }
    const p = killer.player;
    if (p) {
      if (got.length) p.hud.feed(got.join('  '), { color: '#9fe88a' });
      p.audio.play(final ? 'final_kill' : 'crit', { volume: 0.7 });
    }
  }
  victim.wallet = emptyWallet();
  victim.lastHit = null;
}

function eliminate(game: GameContext, t: Team) {
  if (t.eliminated) return;
  t.eliminated = true;
  t.respawnAt = null;
  game.audio.play('final_kill');
  game.hud.feed(`TEAM ELIMINATED › ${who(t)} (${t.name}) is out of the game`, { color: t.css });
  const alive = match.alive();
  // Over when one team is left, or when nobody's left playing to watch it end.
  if (alive.length <= 1 || !alive.some((x) => x.player)) {
    finish(game, alive.length === 1 ? alive[0] : null);
    return;
  }
  const p = t.player;
  if (p) {
    shop.close(p);
    p.hud.screen({
      title: 'ELIMINATED',
      subtitle: 'Your team is out. Watch the others fight it out.',
      tone: 'defeat',
      stats: stats(t, record(game, p, t, false)),
      buttons: [
        { label: 'Watch', primary: true, onClick: () => {} },
        { label: 'Exit', onClick: () => game.exit() },
      ],
    });
  }
}

function destroyBed(game: GameContext, owner: Team, by: Team | null) {
  if (!owner.bed) return;
  owner.bed = false;
  for (const b of owner.base.bed) if (game.world.getBlock(b.x, b.y, b.z) > 0) game.world.setBlock(b.x, b.y, b.z, 'air');
  const c = owner.base.bed[0];
  game.fx.burst({ x: c.x + 0.5, y: c.y + 0.6, z: c.z + 0.5 }, { color: owner.css, count: 40, speed: 5, size: 0.14 });
  game.audio.play('bed_break');
  if (by) by.beds++;
  const how = by ? ` by ${who(by)}` : match.suddenDeath ? ' by sudden death' : '';
  // Its owner hears it their way; everyone else sees whose bed went.
  for (const p of game.players) {
    if (match.seatOf(p) === owner) {
      p.hud.banner('BED DESTROYED!', 'You will no longer respawn', { duration: 3, color: '#ff5b5b' });
      p.audio.play('alarm', { volume: 0.6 });
    } else {
      p.hud.banner('BED DESTRUCTION', `${owner.name} bed was destroyed${how}`, { duration: 2.6, color: owner.css });
    }
  }
  game.hud.feed(`BED DESTRUCTION › ${owner.name} bed (${who(owner)}) was destroyed${how}`, { color: owner.css });
  // Someone waiting to respawn is now out.
  if (owner.respawnAt !== null) eliminate(game, owner);
}

/** Up above the middle, looking on. */
function spectate(p: Player) {
  const c = map.center;
  p.teleport({ x: c.x, y: c.y + 26, z: c.z + 34 }, 0, -0.55);
  p.freeze(true);
}

/**
 * Put a team's player on their island with the team's gear. After a death, the sword is lost
 * and the pickaxe drops a tier (armour and shears stay).
 */
function placePlayer(t: Team, afterDeath: boolean) {
  const p = t.player!;
  t.respawnAt = null;
  p.revive();
  p.freeze(false);
  p.teleport(t.base.spawn, t.base.spawnYaw, 0);
  if (afterDeath) {
    t.sword = 0;
    t.pick = t.pick > 1 ? t.pick - 1 : t.pick;
  }
  const inv = p.inventory;
  inv.clear();
  inv.give(swordItem(t, t.sword));
  if (t.pick) inv.give(PICK_ITEMS[t.pick]);
  if (t.shears) inv.give('shears');
  inv.select(0);
  applyGear();
  if (afterDeath) {
    p.audio.play('spawn');
    p.hud.banner('RESPAWNED', '', { duration: 1.2, color: t.css });
  }
}

/**
 * A player takes a team: one nobody's playing (its bot steps aside, and they carry on with the
 * team's bed, gear and wallet), in colour order. With every team taken, they watch.
 */
function seat(game: GameContext, p: Player) {
  if (match.seatOf(p)) return;
  const t = match.teams.find((x) => !x.player && !x.eliminated);
  if (!t) {
    spectate(p);
    p.hud.banner('WATCHING', 'Every team is taken', { duration: 3 });
    return;
  }
  t.player = p;
  p.setSkin([Skin[t.color][0], Skin[t.color][1]], BEDWARS_ATLAS);
  p.color = t.css;
  if (!playing) return;
  const bot = t.body;
  if (bot) {
    bots.delete(bot.id);
    bot.remove();
    t.body = null;
  }
  if (t.respawnAt === null) placePlayer(t, false);
  else spectate(p);
  p.hud.banner(`${t.name.toUpperCase()} TEAM`, t.bed ? 'Protect your bed · Destroy the others' : 'Your bed is gone: this life is your last', { duration: 3, color: t.css });
  game.hud.feed(`${p.name} takes over ${t.name}`, { color: t.css });
}

/** A player left: a bot carries on for their team. */
function unseat(game: GameContext, p: Player) {
  const t = match.seatOf(p);
  if (!t) return;
  t.player = null;
  shop.close(p);
  if (!playing || match.over || t.eliminated) return;
  game.hud.feed(`${p.name} left: a bot plays ${t.name}`, { color: t.css });
  // Waiting to respawn: the bot comes in then instead.
  if (t.respawnAt === null) spawnBot(game, t, true);
}

function spawnBot(game: GameContext, t: Team, firstLife: boolean) {
  const s = t.base.spawn;
  const e = game.entities.spawn(`bot_${t.color}`, s, { yaw: t.base.spawnYaw, data: { team: t.color } });
  t.body = e;
  t.respawnAt = null;
  if (!firstLife) {
    t.sword = 0;
    t.pick = t.pick > 1 ? t.pick - 1 : t.pick;
  }
  const skill = BOT_SKILL[nextBotSkill++ % BOT_SKILL.length];
  bots.set(e.id, new Bot(match, nav, build, fireballs, t, e, skill, firstLife));
}

function applyGear() {
  for (const t of match.teams) {
    if (t.player) t.player.armor = armorPoints(t);
    if (t.body?.alive) t.body.armor = armorPoints(t);
  }
}

// ---------------------------------------------------------------------------------------------
// End of the match
// ---------------------------------------------------------------------------------------------

const stats = (t: Team, all: AllTime): [string, string][] => [
  ['Kills', String(t.kills)],
  ['Final kills', String(t.finals)],
  ['Beds broken', String(t.beds)],
  ['Time', clock(match.now)],
  ['All-time wins', `${all.wins} of ${all.games}`],
  ['All-time kills', String(all.kills)],
];

/** The match is over: `winner` is the last team standing (null: no one's left playing). */
function finish(game: GameContext, winner: Team | null) {
  if (match.over) return;
  match.over = true;
  shop.closeAll();
  if (winner?.player) game.fx.fireworks(winner.base.spawn, 6);
  for (const p of game.players) {
    const t = match.seatOf(p);
    const won = !!t && t === winner;
    const all = t ? record(game, p, t, won) : null;
    p.audio.play(won ? 'victory' : 'defeat');
    game.clock.after(won ? 1.8 : 1.4, () =>
      p.hud.screen({
        title: won ? 'VICTORY!' : 'GAME OVER',
        subtitle: won ? 'Your team is the last one standing' : winner ? `${who(winner)} (${winner.name}) wins` : 'Your team has been eliminated',
        tone: won ? 'victory' : 'defeat',
        stats: t && all ? stats(t, all) : [['Time', clock(match.now)]],
        buttons: [
          { label: 'Play again', primary: true, onClick: () => game.restart() },
          { label: 'Exit', onClick: () => game.exit() },
        ],
      }),
    );
  }
}

// ---------------------------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------------------------

function nextEvent(): string {
  const t = match.now;
  const events: [number, string][] = [
    [240, 'Diamond II'],
    [360, 'Emerald II'],
    [480, 'Diamond III'],
    [SUDDEN_DEATH_AT, 'Sudden death'],
  ];
  const next = events.find(([at]) => at > t);
  return next ? `${next[1]} in ${clock(next[0] - t)}` : 'Sudden death!';
}

function refreshHud(game: GameContext) {
  // Everyone's scoreboard, with their own team marked, and their own wallet.
  for (const p of game.players) {
    const mine = match.seatOf(p);
    if (mine && !p.alive && mine.respawnAt !== null) {
      p.hud.objective(`Respawning in ${Math.ceil(mine.respawnAt - match.now)}…`);
    } else {
      const status = match.teams.map((t) => `${t.name.toUpperCase()} ${t.eliminated ? '✘' : t.bed ? '✔' : '1'}${t === mine ? ' (you)' : ''}`).join('   ');
      p.hud.objective(`${status}   ·   ${nextEvent()}`);
    }
    const w = mine?.wallet ?? emptyWallet();
    p.hud.stat('iron', 'Iron', w.iron);
    p.hud.stat('gold', 'Gold', w.gold);
    p.hud.stat('diamond', 'Diamonds', w.diamond);
    p.hud.stat('emerald', 'Emeralds', w.emerald);
  }
  // Generator holograms.
  map.diamonds.forEach((d, i) => {
    game.hud.marker(`dia${i}`, { x: d.x, y: d.y + 2.4, z: d.z }, { shape: 'dot', color: '#6fe8ff', size: 5, label: `Diamond ${'I'.repeat(match.diamondTier)} · ${Math.ceil(hud.diamondIn)}s` });
  });
  map.emeralds.forEach((d, i) => {
    game.hud.marker(`em${i}`, { x: d.x, y: d.y + 2.4, z: d.z }, { shape: 'dot', color: '#4dff91', size: 5, label: `Emerald ${'I'.repeat(match.emeraldTier)} · ${Math.ceil(hud.emeraldIn)}s` });
  });
}

// ---------------------------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------------------------

export default defineGame({
  id: 'bedwars',
  title: 'Bed Wars',
  tagline: 'Guard your bed, bridge out, break theirs. Last team standing wins.',
  accent: '#ff5b5b',
  controls: [
    ['LMB', 'attack · hold to mine'],
    ['RMB', 'place block · use item'],
    ['RMB', 'talk to the shopkeeper'],
  ],
  world: {
    terrain: 'void',
    structures: map.blueprints,
    spawn: RED.spawn,
    spawnYaw: RED.spawnYaw,
    time: 0.36,
    freezeTime: true,
    viewDistance: 8,
  },
  player: {
    hotbar: 'items',
    health: 20,
    regen: { delay: 5, perSecond: 0.5 },
    fallDamage: true,
    skin: [Skin.red[0], Skin.red[1]],
    skinAtlas: BEDWARS_ATLAS,
    // Players fight each other (swords, bows, fireballs).
    pvp: true,
  },
  setup(game) {
    const art = paintBedwarsAtlas();
    game.items.atlas(BEDWARS_ATLAS, { width: art.width, height: art.height, pixels: art.albedo, emissive: art.emissive });
    defineSounds(game);
    match = new Match(game, map);
    nav = new Nav(game, navBounds(), (x, y, z) => match.isPlaced(x, y, z));
    build = building(game, {
      canBreak: (at, block, by) => match.canBreak(at, block, by),
      canPlace: (at, block, by) => match.canPlace(at, block, by),
      breakTime: (block, held) => {
        const item = held?.item ?? '';
        return mineTime(block, Math.max(0, PICK_ITEMS.indexOf(item)), item === 'shears');
      },
    });
    talk = interactions(game, { shopkeeper: (_keeper, player) => shop.show(player) });
    fireballs = new Fireballs(match);
    shop = new Shop(match, () => applyGear());
    defineItems(game, match, fireballs);
    if (import.meta.env.DEV) (globalThis as unknown as { __bw: unknown }).__bw = { match, bots, nav };

    // Generators: iron and gold on every island, diamonds on the small ones, emeralds in the middle.
    for (const t of match.teams) {
      match.piles.push(new Pile('iron', t.base.generator, 48), new Pile('gold', t.base.generator, 12));
    }
    for (const d of map.diamonds) match.piles.push(new Pile('diamond', d, 4, '#6fe8ff'));
    for (const e of map.emeralds) match.piles.push(new Pile('emerald', e, 3, '#4dff91'));

    // Every team has a bot, playing it whenever no one else is.
    for (const t of match.teams) {
      const skin = Skin[t.color];
      game.entities.define(`bot_${t.color}`, {
        name: BOT_NAMES[t.color],
        model: Models.humanoid({ skin: [skin[0], skin[1]], atlas: BEDWARS_ATLAS, extras: [botSword(skin)] }),
        hitbox: { width: 0.6, height: 1.8 },
        health: 20,
        speed: 4.3,
        sounds: { hurt: 'hurt', death: 'mob_death' },
        ai: (self, _g, dt) => bots.get(self.id)?.update(dt),
      });
    }
    game.entities.define('shopkeeper', {
      name: 'Item Shop',
      model: Models.humanoid({ skin: [Skin.shopkeeper[0], Skin.shopkeeper[1]], atlas: BEDWARS_ATLAS }),
      hitbox: { width: 0.6, height: 1.9 },
      health: 100,
      speed: 0,
      knockbackResistance: 1,
      invulnerable: true,
      ai: (self) => {
        const p = self.nearestPlayer();
        self.lookAt(p && self.distanceTo(p) < 7 ? p : null);
      },
    });

    // Blocks placed during the match are the only ones that can be broken.
    game.events.on('blockPlace', (e) => match.markPlaced(e.x, e.y, e.z, true));
    game.events.on('blockBreak', (e) => {
      match.markPlaced(e.x, e.y, e.z, false);
      const owner = match.bedAt(e);
      if (owner) destroyBed(game, owner, match.teamOf(e.by));
    });

    // Kill credit, and bots turning on whoever hits them.
    game.events.on('entityDamage', (e) => {
      const victim = match.teamOf(e.entity);
      const by = match.teamOf(e.source ?? null);
      if (!victim || !by || by === victim) return;
      victim.lastHit = { team: by, at: match.now };
      const bot = bots.get(e.entity.id);
      const src = e.source;
      if (bot) bot.provoke(src && src !== 'world' && src.kind === 'player' ? { kind: 'player', team: by, p: src } : ({ kind: 'bot', team: by, e: by.body! } as Target));
    });
    game.events.on('playerDamage', (e) => {
      const victim = match.seatOf(e.player);
      const by = match.teamOf(e.source ?? null);
      if (victim && by && by !== victim) victim.lastHit = { team: by, at: match.now };
    });
    game.events.on('entityDeath', (e) => {
      const t = match.teamOf(e.entity);
      if (!t || t.body !== e.entity) return;
      bots.delete(e.entity.id);
      t.body = null;
      const fell = e.entity.position.y < map.voidY + 1;
      announceDeath(game, t, killerOf(t, e.killer), fell);
      if (t.bed) t.respawnAt = match.now + RESPAWN_SECONDS;
      else eliminate(game, t);
    });
    game.events.on('playerDeath', (e) => {
      const p = e.player;
      const t = match.seatOf(p);
      if (!t || match.over) return;
      shop.close(p);
      const fell = p.position.y < map.voidY + 1;
      announceDeath(game, t, killerOf(t, e.source), fell);
      if (t.bed) {
        t.respawnAt = match.now + RESPAWN_SECONDS;
        p.hud.banner('YOU DIED!', `Respawning in ${RESPAWN_SECONDS} seconds`, { duration: 2, color: '#ff5b5b' });
      } else {
        eliminate(game, t);
      }
      game.clock.after(1.2, () => {
        if (!p.alive && !match.over && match.seatOf(p) === t) spectate(p);
      });
    });

    // Players coming and going mid-match take over from bots, and hand back to them.
    game.events.on('playerJoin', (e) => {
      if (playing) seat(game, e.player);
    });
    game.events.on('playerLeave', (e) => unseat(game, e.player));

    game.commands.register('bw', {
      help: 'Bed Wars tools',
      usage: 'rich | bed <team> | win | lose | time <seconds>',
      run(args, g, player) {
        const [cmd, arg] = args;
        const mine = match.seatOf(player) ?? match.player;
        if (cmd === 'rich') {
          const w = mine.wallet;
          Object.assign(w, { iron: w.iron + 64, gold: w.gold + 32, diamond: w.diamond + 8, emerald: w.emerald + 8 });
          return 'Wallet filled';
        }
        if (cmd === 'bed') {
          const t = match.teams.find((x) => x.color === arg);
          if (!t) throw new Error('Which team? red, blue, green or yellow');
          destroyBed(g, t, null);
          return `${t.name} bed destroyed`;
        }
        if (cmd === 'win' || cmd === 'lose') {
          finish(g, cmd === 'win' ? mine : (match.teams.find((t) => t !== mine) ?? null));
          return '';
        }
        if (cmd === 'time') {
          match.startedAt -= Number(arg) || 60;
          return `Match clock at ${clock(match.now)}`;
        }
        throw new Error('Try: rich, bed <team>, win, lose, time <seconds>');
      },
      complete: (args) => (args.length <= 1 ? ['rich', 'bed', 'win', 'lose', 'time'] : args[0] === 'bed' ? ['red', 'blue', 'green', 'yellow'] : []),
    });
  },

  start(game) {
    playing = false;
    match.reset();
    bots.clear();
    fireballs.clear();
    shop.closeAll();
    alarms.clear();
    recorded.clear();
    nextBotSkill = 0;
    Object.assign(hud, { refresh: 0, diamondIn: match.diamondEvery, emeraldIn: match.emeraldEvery });

    // Everyone here takes a team, in colour order; bots play the rest.
    for (const t of match.teams) t.player = null;
    for (const p of game.players) seat(game, p);
    for (const t of match.teams) {
      game.entities.spawn('shopkeeper', t.base.shop, { yaw: t.base.shopYaw });
      if (t.player) placePlayer(t, false);
      else spawnBot(game, t, true);
    }
    playing = true;

    // Iron and gold at every island.
    game.clock.every(1.2, () => {
      for (const p of match.piles) if (p.item === 'iron') p.add(game, 1);
    });
    game.clock.every(7, () => {
      for (const p of match.piles) if (p.item === 'gold') p.add(game, 1);
    });

    game.hud.banner('BED WARS', 'Protect your bed · Destroy the others', { duration: 3, color: '#ff5b5b' });
    game.audio.play('wave');
    refreshHud(game);
  },

  update(game, dt) {
    // Talking to a shopkeeper takes the right-click before building can.
    talk.update();
    build.update(dt);
    if (match.over) return;
    const now = match.now;
    for (const p of match.piles) p.sync();

    // Diamond and emerald generators, and the match timeline.
    hud.diamondIn -= dt;
    hud.emeraldIn -= dt;
    if (hud.diamondIn <= 0) {
      hud.diamondIn = match.diamondEvery;
      for (const p of match.piles) if (p.item === 'diamond') p.add(game, 1);
    }
    if (hud.emeraldIn <= 0) {
      hud.emeraldIn = match.emeraldEvery;
      for (const p of match.piles) if (p.item === 'emerald') p.add(game, 1);
    }
    const tier = (kind: 'diamond' | 'emerald', level: number, every: number) => {
      if (kind === 'diamond' && match.diamondTier < level) {
        match.diamondTier = level;
        match.diamondEvery = every;
      } else if (kind === 'emerald' && match.emeraldTier < level) {
        match.emeraldTier = level;
        match.emeraldEvery = every;
      } else return;
      game.hud.banner(`${kind === 'diamond' ? 'Diamond' : 'Emerald'} Generators ${'I'.repeat(level)}`, 'They now spawn faster', { duration: 2.2, color: kind === 'diamond' ? '#6fe8ff' : '#4dff91' });
      game.audio.play('wave', { volume: 0.6 });
    };
    if (now > 240) tier('diamond', 2, 22);
    if (now > 360) tier('emerald', 2, 45);
    if (now > 480) tier('diamond', 3, 15);
    if (now > SUDDEN_DEATH_AT && !match.suddenDeath) {
      match.suddenDeath = true;
      game.hud.banner('SUDDEN DEATH', 'Every bed is gone', { duration: 3, color: '#ff5b5b' });
      for (const t of match.teams) destroyBed(game, t, null);
    }

    // The void.
    for (const p of game.players) if (p.alive && p.position.y < map.voidY) p.damage(1000, { source: 'world', knockback: 0 });
    for (const t of match.teams) if (t.body?.alive && t.body.position.y < map.voidY) t.body.kill();

    // Respawns.
    for (const t of match.teams) {
      if (t.respawnAt === null || now < t.respawnAt || t.eliminated) continue;
      if (t.player) placePlayer(t, true);
      else spawnBot(game, t, false);
    }

    // Heal pools.
    for (const t of match.teams) {
      const p = t.player;
      if (t.heal && p?.alive && Math.hypot(p.position.x - t.base.spawn.x, p.position.z - t.base.spawn.z) < 14) p.heal(0.8 * dt);
    }

    fireballs.update(dt);
    shop.refresh();

    // Nametags over the bots near each player, with their health.
    for (const p of game.players) {
      const eye = p.position;
      for (const t of match.teams) {
        const b = t.body;
        const q = b?.position;
        const show = b?.alive && q && Math.hypot(q.x - eye.x, q.y - eye.y, q.z - eye.z) < 40;
        p.hud.marker(`tag-${t.color}`, show ? { x: q.x, y: q.y + 2.25, z: q.z } : null, { shape: 'dot', size: 3, color: t.css, label: show ? `${t.name}  ${Math.ceil(b.health)}♥` : '' });
      }
    }

    // Warn a team's player when an enemy is at their bed.
    for (const t of match.teams) {
      const p = t.player;
      if (!p || !t.bed || (alarms.get(t) ?? 0) > now) continue;
      const bed = t.base.bed[0];
      const near = (q: { x: number; y: number; z: number }) => Math.hypot(q.x - bed.x, q.z - bed.z) < 9 && Math.abs(q.y - bed.y) < 4;
      const enemy = match.teams.find((o) => o !== t && ((o.body?.alive && near(o.body.position)) || (o.player?.alive && near(o.player.position))));
      if (enemy) {
        p.hud.toast(`${who(enemy)} is at your bed!`);
        p.audio.play('alarm', { volume: 0.35 });
        alarms.set(t, now + 12);
      }
    }

    hud.refresh -= dt;
    if (hud.refresh <= 0) {
      hud.refresh = 0.25;
      refreshHud(game);
    }
  },
});

