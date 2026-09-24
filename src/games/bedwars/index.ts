import { defineGame, Models, type Actor, type GameContext } from '@platform';
import { building, interactions, type Building, type Interactions } from '@platform/kits';
import { BEDWARS_ATLAS, Skin, botSword, paintBedwarsAtlas } from './art';
import { Bot, type Target } from './bots';
import { Fireballs } from './fireballs';
import { defineItems, defineSwords } from './items';
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
const hud = { refresh: 0, alarm: 0, diamondIn: 30, emeraldIn: 60 };
let nextBotSkill = 0;

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

function announceDeath(game: GameContext, victim: Team, killer: Team | null, fell: boolean) {
  const final = !victim.bed;
  const who = (t: Team) => (t.isPlayer ? 'You' : t.name);
  let text: string;
  if (killer) text = fell ? `${who(victim)} ${victim.isPlayer ? 'were' : 'was'} knocked into the void by ${killer.isPlayer ? 'you' : killer.name}` : `${who(victim)} ${victim.isPlayer ? 'were' : 'was'} slain by ${killer.isPlayer ? 'you' : killer.name}`;
  else text = fell ? `${who(victim)} fell into the void` : `${who(victim)} died`;
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
    if (killer.isPlayer) {
      if (got.length) game.hud.feed(got.join('  '), { color: '#9fe88a' });
      game.audio.play(final ? 'final_kill' : 'crit', { volume: 0.7 });
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
  game.hud.feed(`TEAM ELIMINATED › ${t.name} is out of the game`, { color: t.css });
  if (t.isPlayer) finish(game, false);
  else if (match.teams.every((o) => o.isPlayer || o.eliminated)) finish(game, true);
}

function destroyBed(game: GameContext, owner: Team, by: Team | null) {
  if (!owner.bed) return;
  owner.bed = false;
  for (const b of owner.base.bed) if (game.world.getBlock(b.x, b.y, b.z) > 0) game.world.setBlock(b.x, b.y, b.z, 'air');
  const c = owner.base.bed[0];
  game.fx.burst({ x: c.x + 0.5, y: c.y + 0.6, z: c.z + 0.5 }, { color: owner.css, count: 40, speed: 5, size: 0.14 });
  game.audio.play('bed_break');
  if (by) by.beds++;
  if (owner.isPlayer) {
    game.hud.banner('BED DESTROYED!', 'You will no longer respawn', { duration: 3, color: '#ff5b5b' });
    game.audio.play('alarm', { volume: 0.6 });
  } else {
    const how = by ? ` by ${by.isPlayer ? 'you' : by.name}` : match.suddenDeath ? ' by sudden death' : '';
    game.hud.banner('BED DESTRUCTION', `${owner.name} bed was destroyed${how}`, { duration: 2.6, color: owner.css });
  }
  game.hud.feed(`BED DESTRUCTION › ${owner.isPlayer ? 'Your' : `${owner.name}`} bed was destroyed${by ? ` by ${by.isPlayer ? 'you' : by.name}` : ''}`, { color: owner.css });
  // Someone waiting to respawn is now out.
  if (owner.respawnAt !== null) eliminate(game, owner);
}

function spectate(game: GameContext) {
  const c = map.center;
  game.player.teleport({ x: c.x, y: c.y + 26, z: c.z + 34 }, 0, -0.55);
  game.player.freeze(true);
}

function respawnPlayer(game: GameContext) {
  const t = match.player;
  t.respawnAt = null;
  game.player.revive();
  game.player.teleport(t.base.spawn, t.base.spawnYaw, 0);
  // Swords, blocks and consumables are lost; the pickaxe drops a tier; armour and shears stay.
  t.sword = 0;
  t.pick = t.pick > 1 ? t.pick - 1 : t.pick;
  const inv = game.player.inventory;
  inv.clear();
  inv.give('wooden_sword');
  if (t.pick) inv.give(PICK_ITEMS[t.pick]);
  if (t.shears) inv.give('shears');
  inv.select(0);
  applyGear(game);
  game.audio.play('spawn');
  game.hud.banner('RESPAWNED', '', { duration: 1.2, color: t.css });
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

function applyGear(game: GameContext) {
  game.player.armor = armorPoints(match.player);
  for (const t of match.teams) if (t.body?.alive) t.body.armor = armorPoints(t);
}

// ---------------------------------------------------------------------------------------------
// End of the match
// ---------------------------------------------------------------------------------------------

function finish(game: GameContext, won: boolean) {
  if (match.over) return;
  match.over = true;
  shop.close();
  const t = match.player;
  const time = clock(match.now);
  if (won) {
    game.audio.play('victory');
    game.fx.fireworks(t.base.spawn, 6);
  } else {
    game.audio.play('defeat');
  }
  game.clock.after(won ? 1.8 : 1.4, () => {
    game.hud.screen({
      title: won ? 'VICTORY!' : 'GAME OVER',
      subtitle: won ? 'Your team is the last one standing' : 'Your team has been eliminated',
      tone: won ? 'victory' : 'defeat',
      stats: [
        ['Kills', String(t.kills)],
        ['Final kills', String(t.finals)],
        ['Beds broken', String(t.beds)],
        ['Time', time],
      ],
      buttons: [
        { label: 'Play again', primary: true, onClick: () => game.restart() },
        { label: 'Exit', onClick: () => game.exit() },
      ],
    });
  });
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
  const status = match.teams
    .map((t) => `${t.name.toUpperCase()} ${t.eliminated ? '✘' : t.bed ? '✔' : '1'}${t.isPlayer ? ' (you)' : ''}`)
    .join('   ');
  game.hud.objective(`${status}   ·   ${nextEvent()}`);
  const w = match.player.wallet;
  // The wallet is the player's own; the scoreboard above is everyone's.
  const own = game.player.hud;
  own.stat('iron', 'Iron', w.iron);
  own.stat('gold', 'Gold', w.gold);
  own.stat('diamond', 'Diamonds', w.diamond);
  own.stat('emerald', 'Emeralds', w.emerald);
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
    shop = new Shop(match, () => {
      applyGear(game);
      defineSwords(game, match.player.sharp);
    });
    defineItems(game, match, fireballs);
    if (import.meta.env.DEV) (globalThis as unknown as { __bw: unknown }).__bw = { match, bots, nav };

    // Generators: iron and gold on every island, diamonds on the small ones, emeralds in the middle.
    for (const t of match.teams) {
      match.piles.push(new Pile('iron', t.base.generator, 48), new Pile('gold', t.base.generator, 12));
    }
    for (const d of map.diamonds) match.piles.push(new Pile('diamond', d, 4, '#6fe8ff'));
    for (const e of map.emeralds) match.piles.push(new Pile('emerald', e, 3, '#4dff91'));

    for (const t of match.teams) {
      if (t.isPlayer) continue;
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
      if (bot) bot.provoke(by.isPlayer ? { kind: 'player' } : ({ kind: 'bot', team: by, e: by.body! } as Target));
    });
    game.events.on('playerDamage', (e) => {
      const by = match.teamOf(e.source ?? null);
      if (by && !by.isPlayer) match.player.lastHit = { team: by, at: match.now };
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
      const t = match.player;
      if (match.over) return;
      shop.close();
      const fell = game.player.position.y < map.voidY + 1;
      announceDeath(game, t, killerOf(t, e.source), fell);
      if (t.bed) {
        t.respawnAt = match.now + RESPAWN_SECONDS;
        game.hud.banner('YOU DIED!', `Respawning in ${RESPAWN_SECONDS} seconds`, { duration: 2, color: '#ff5b5b' });
      } else {
        eliminate(game, t);
      }
      game.clock.after(1.2, () => {
        if (!game.player.alive && !match.over) spectate(game);
      });
    });

    game.commands.register('bw', {
      help: 'Bed Wars tools',
      usage: 'rich | bed <team> | win | lose | time <seconds>',
      run(args, g) {
        const [cmd, arg] = args;
        if (cmd === 'rich') {
          const w = match.player.wallet;
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
          finish(g, cmd === 'win');
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
    match.reset();
    bots.clear();
    fireballs.clear();
    shop.close();
    nextBotSkill = 0;
    defineSwords(game, false);
    Object.assign(hud, { refresh: 0, alarm: 0, diamondIn: match.diamondEvery, emeraldIn: match.emeraldEvery });

    for (const t of match.teams) {
      game.entities.spawn('shopkeeper', t.base.shop, { yaw: t.base.shopYaw });
      if (!t.isPlayer) spawnBot(game, t, true);
    }
    const inv = game.player.inventory;
    inv.clear();
    inv.give('wooden_sword');
    game.player.teleport(RED.spawn, RED.spawnYaw, 0);
    applyGear(game);

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
    if (game.player.alive && game.player.position.y < map.voidY) game.player.damage(1000, { source: 'world', knockback: 0 });
    for (const t of match.teams) if (t.body?.alive && t.body.position.y < map.voidY) t.body.kill();

    // Respawns.
    for (const t of match.teams) {
      if (t.respawnAt === null || now < t.respawnAt || t.eliminated) continue;
      if (t.isPlayer) respawnPlayer(game);
      else spawnBot(game, t, false);
    }
    const pt = match.player;
    if (!game.player.alive && pt.respawnAt !== null) game.hud.objective(`Respawning in ${Math.ceil(pt.respawnAt - now)}…`);

    // Heal pool.
    if (pt.heal && game.player.alive && Math.hypot(game.player.position.x - pt.base.spawn.x, game.player.position.z - pt.base.spawn.z) < 14) game.player.heal(0.8 * dt);

    fireballs.update(dt);
    shop.refresh();

    // Nametags over the bots, with their health.
    const eye = game.player.position;
    for (const t of match.teams) {
      if (t.isPlayer) continue;
      const b = t.body;
      const p = b?.position;
      const show = b?.alive && p && Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z) < 40;
      game.hud.marker(`tag-${t.color}`, show ? { x: p.x, y: p.y + 2.25, z: p.z } : null, { shape: 'dot', size: 3, color: t.css, label: show ? `${t.name}  ${Math.ceil(b.health)}♥` : '' });
    }

    // Warn when an enemy is at our bed.
    hud.alarm -= dt;
    if (pt.bed && hud.alarm <= 0) {
      const bed = pt.base.bed[0];
      for (const t of match.teams) {
        const b = t.body;
        if (b?.alive && Math.hypot(b.position.x - bed.x, b.position.z - bed.z) < 9 && Math.abs(b.position.y - bed.y) < 4) {
          game.hud.toast(`${t.name} is at your bed!`);
          game.audio.play('alarm', { volume: 0.35 });
          hud.alarm = 12;
          break;
        }
      }
    }

    hud.refresh -= dt;
    if (hud.refresh <= 0) {
      hud.refresh = 0.25;
      if (game.player.alive || pt.respawnAt === null) refreshHud(game);
    }
  },
});

