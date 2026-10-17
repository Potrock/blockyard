import { defineServer, type GameContext, type Player } from '@platform';
import { MODEL_IDS } from './modelids';
import { baseX, centre, extent, period, SEA_Y, tileAt } from './geometry';
import { adviseResearch, adviseWork, balanceDeal, counterOffer } from './advisor';
import { lobbySides, MAX_PINS, packStatic, PIN_ICONS, PIN_LABEL, TEAMS, type DealCheck, type ReshapeWire, type FightWire, type LobbyAction, type LobbySeat, type LobbyView, type OrderResult, type PreviewReply, type ResearchAdvice, type StatsInfo, type TeamPreset, type View, type WorkAdvice, type FameEntry } from './protocol';
import { automate, botTurn } from './rules/ai';
import { airBase } from './rules/air';
import { BUILDINGS } from './rules/buildings';
import { CIV_LIST, CIVS } from './rules/civs';
import { barbarianIndex } from './rules/barbarians';
import { canStand, cityAt, cityById, citiesOf, createGame, knowsOf, noteAll, spawnUnit, unitById, updateAllVisibility } from './rules/core';
import { distance, neighbours, within } from './rules/hex';
import { NATURAL_WONDERS } from './rules/nature';
import { isMilitary, UNITS } from './rules/units';
import { apply, endTurn, eraOf, fightHooks, learn, score, type Order } from './rules/game';
import { advanceSequence, sequenceDone, warBegun } from './rules/turns';
import { cityHooks, type CombatResult } from './rules/combat';
import { dealVerdict, type DealItem } from './rules/diplomacy';
import { previewAttack, previewCityFire } from './rules/preview';
import { DIFFICULTIES } from './rules/difficulty';
import { MAP_SIZES, NOTE_TOPICS, SPEEDS, TURN_LIMITS, type Game, type Settings } from './rules/state';
import { IDEOLOGIES } from './rules/policies';
import { dissent } from './rules/economy';
import { TECHS } from './rules/techs';
import { TERRAINS, type ImprovementId } from './rules/terrain';
import { shared } from './shared';
import meta from './meta';
import { allyOf } from './rules/citystates';
import { teammates } from './rules/teams';
import { decorKey, decorOf, Ground, type Placed } from './improvements';
import { terrainEdits, TREE_BLOCKS, type Edit } from './terrain';
import { reshapeEdits, seasonal, seasonalSpots } from './seasons';
import { seasonAt, type Season } from './rules/disasters';
import { cityInfo, mapWire, statsFor, viewFor, yieldsWire } from './views';
import { SaveThrottle } from './saves';

/**
 * Blockilization's server: the lobby (each person picks a civilization, the host sets the map and how
 * many bots), then the world built out of blocks (`terrain.ts`), then the game: everyone's orders as
 * they give them (`rules/game.ts` checks each), the turn ending when everyone's ready or the clock runs
 * out, the bots playing theirs (`rules/ai.ts`), and each person's screen sent their own view of it
 * (`views.ts`: only what their civilization can see). Each turn is saved, so a room can carry on later.
 */

type Phase = 'lobby' | 'building' | 'playing' | 'over';

const DEFAULTS: Settings = {
  size: 'small',
  type: 'continents',
  speed: 'quick',
  timer: 0,
  cityStates: 4,
  barbarians: true,
  victories: { domination: true, science: true, culture: true, diplomatic: true, score: true },
  turnLimit: 330,
  difficulty: 'prince',
};

let phase: Phase = 'lobby';
let settings: Settings = { ...DEFAULTS };
let seats: LobbySeat[] = [];
let host: string | null = null;
let civGame: Game | null = null;
/** The world's blocks still to set (some fail until their chunk's loaded: tried again). */
let edits: Edit[] = [];
let editsTotal = 0;
/**
 * Building goes in stages. The server loads the map's ground round the players (`gather`); then
 * their cameras look far off (`away`: each screen loads the world round its player's camera, so it
 * lets the map's ground go); the blocks are set (`edit`), kept by each screen for when it's back; and
 * the cameras come back to the finished map, which the screens draw whole. A screen with the ground
 * loaded redraws for every block set, and a map's worth leaves it hopelessly behind.
 */
let stage: 'gather' | 'away' | 'edit' = 'gather';
let stageAt = 0;
/** A new game waiting for the world to be put back (after `restart`), and a saved one to carry on. */
let pending: { game: Game; seats: LobbySeat[] } | null = null;
/** Who in the room needs a fresh view sent (players and those watching alike: `markAll`). */
const dirty = new Set<string>();
/** The tile yields each screen was last sent (sent again only when they change). */
const yieldsSent = new Map<string, string>();
/** The tiles each screen's view last carried (a late game's are a third of it): sent again only when they change. */
const tilesSent = new Map<string, string>();
let lastProgress = 0;
/** The bots still to play this turn (one a tick, so a big game's turn doesn't stall the room). */
let botQueue: number[] = [];
/** The host hasn't chosen how many bots: the free seats fill with them. */
let autoBots = true;
/** Teams on (each seat's team is on it), or every civ for itself. */
let teamsOn = false;
/** The seed the host chose for the next map (null: a new one each game). */
let chosenSeed: number | null = null;
/** Each player's demographics, as last worked out (`statsFor`), and the advisor's research advice. */
const demographics = new Map<string, StatsInfo>();
const researchAdvice = new Map<string, ResearchAdvice>();
/** Tiles with trees standing (forest, jungle): when one loses them (a city founded on it, a worker's
 * axe), the trees come down in the world too. */
let woods = new Set<number>();
/** The land's top as the world was built (where improvements and roads go), what each tile shows in
 * blocks now (`improvements.ts`), and the blocks still to set or take back for them. */
let ground: Ground | null = null;
const decor = new Map<number, { key: string; placed: Placed[] }>();
let decorQueue: { add: boolean; at: Placed }[] = [];
let decorChecked = 0;
/** The seasons in blocks (`seasons.ts`): the blocks that change with them (each as it is the rest of
 * the year), the season the world shows now, and the blocks still to swap for the next. */
let seasonSpots: Edit[] = [];
let shownSeason: Season | null = null;
let seasonQueue: [x: number, y: number, z: number, from: string, to: string][] = [];
/** Each tile's land as the world was last built or sent (`landKey`), and the blocks still to set
 * where the world has changed it since (the sea risen over it, an eruption's ash). */
let shaped: string[] = [];
let reshapeQueue: Edit[] = [];

const keyOf = (p: Player) => (p.account ? `acct:${p.account.id}` : `name:${p.name}`);
const humans = (game: GameContext) => game.players.filter((p) => !p.bot);
const seatOf = (p: Player) => seats.find((s) => s.key === keyOf(p));
const indexOf = (p: Player) => (civGame ? civGame.players.findIndex((x) => x.user === keyOf(p)) : -1);
const saveKey = (game: GameContext) => `save:${game.room}`;

function lobbyView(game: GameContext, p: Player): LobbyView {
  const save = game.store.get<{ game: Game; seats: LobbySeat[] }>(saveKey(game));
  return {
    phase,
    host,
    you: keyOf(p),
    seats,
    settings,
    save: save && !save.game.over ? { turn: save.game.turn, seats: save.seats.filter((s) => !s.bot).map((s) => s.name) } : null,
    progress: phase === 'building' && editsTotal ? 1 - edits.length / editsTotal : undefined,
    // (Not while a game's on: with it, anyone could work out the whole map.)
    seed: phase === 'lobby' ? chosenSeed : phase === 'over' ? (civGame?.seed ?? null) : null,
    teams: teamsOn,
  };
}

function sendLobby(game: GameContext) {
  for (const p of humans(game)) game.clients.send(p, 'lobby', lobbyView(game, p));
}

/** Everyone in the room is sent a fresh view: the players, and anyone watching. */
function markAll(game: GameContext) {
  for (const p of humans(game)) dirty.add(keyOf(p));
}

/**
 * Whether the game is only watched: every person in it has fallen (or none was ever in it) and
 * someone's in the room. The bots then play it out by themselves, a turn every few seconds, as the
 * fallen are told they can watch the rest.
 */
function onlyWatched(game: GameContext): boolean {
  return !!civGame && humans(game).length > 0 && civGame.players.every((p) => p.bot || !p.alive);
}

/** Seconds between turns the bots play out while it's only watched (time to see the world move). */
const WATCHED_TURN = 3;

/** Whether anyone playing the game is in the room (not only people watching). */
function anyonePlaying(game: GameContext): boolean {
  const here = new Set(humans(game).map(keyOf));
  return !!civGame?.players.some((p) => p.user && p.alive && here.has(p.user));
}

/** The game's own seconds left on this turn's clock. */
const timerLeft = (game: GameContext) => (civGame && turnLength > 0 ? Math.max(0, Math.ceil(civGame.turnStarted + turnLength - game.clock.now)) : null);

/** This turn's clock, in seconds (0: none): the host's choice, or the dynamic timer's for this turn. */
let turnLength = 0;

/**
 * Civilization VI's dynamic turn timer: half a minute, and more for how far on the busiest person's
 * empire is and how much it has to move (ten seconds an era, four a city, one and a half a unit), in
 * five-second steps from 30 seconds to 5 minutes.
 */
function dynamicLength(g: Game): number {
  const load = Math.max(0, ...g.players.filter((p) => p.user && p.alive).map((p) => 10 * eraOf(p) + 4 * citiesOf(g, p.index).length + 1.5 * g.units.filter((u) => u.owner === p.index).length));
  return Math.min(300, Math.max(30, Math.ceil((30 + load) / 5) * 5));
}

/** A turn's clock starts: now, as long as the host chose (or the dynamic timer makes it). */
function startClock(game: GameContext) {
  if (!civGame) return;
  civGame.turnStarted = game.clock.now;
  turnLength = settings.dynamicTimer ? dynamicLength(civGame) : settings.timer;
}

/** A message's most data (the platform's limit is 65536 characters of JSON: a part's text, its quotes escaped, can come to twice its length). */
const PART = 30000;

/**
 * A message that may be bigger than the platform carries (a late game's view: every tile, and a
 * big empire's cities and units in full): as it is if it fits, else its JSON in parts (`<name>Part`,
 * each `{ i, n, text }`), which the screen puts back together (`client.ts`).
 */
function sendLarge(game: GameContext, p: Player, name: string, data: object) {
  const text = JSON.stringify(data);
  if (text.length <= PART) return game.clients.send(p, name, data);
  const n = Math.ceil(text.length / PART);
  for (let i = 0; i < n; i++) game.clients.send(p, `${name}Part`, { i, n, text: text.slice(i * PART, (i + 1) * PART) });
}

function sendViews(game: GameContext) {
  if (!civGame) return;
  for (const t of woods) {
    const f = civGame.tiles[t].feature;
    if (f === 'forest' || f === 'jungle') continue;
    woods.delete(t);
    clearTrees(game, civGame, t);
  }
  const present = new Set(humans(game).map(keyOf));
  for (const p of humans(game)) {
    const key = keyOf(p);
    if (!dirty.has(key)) continue;
    dirty.delete(key);
    const i = indexOf(p);
    // A person whose civilization has fallen watches the rest of the game, as anyone watching does.
    const mine = i >= 0 && civGame.players[i].alive ? civGame.players[i] : null;
    const view: View = { ...viewFor(civGame, mine, timerLeft(game), present), moving: phase === 'playing' && botQueue.length > 0, autosaves: mine && alone() ? autosaveTurns(game) : undefined };
    // (The tiles left out when they're as last sent: the screen keeps what it knew.)
    const tiles = view.tiles.join('\n');
    const sent: Omit<View, 'tiles'> & { tiles?: View['tiles'] } = view;
    if (tilesSent.get(key) === tiles) delete sent.tiles;
    else tilesSent.set(key, tiles);
    sendLarge(game, p, 'view', i >= 0 && !mine ? { ...sent, fallen: i } : sent);
    if (!mine) continue;
    const yields = yieldsWire(civGame, mine);
    if (yieldsSent.get(key) === yields) continue;
    yieldsSent.set(key, yields);
    game.clients.send(p, 'yields', yields);
  }
}

/** What an attack (a unit's, or a city's fire) on a tile would come to, for a screen's preview. */
function preview(game: GameContext, p: Player, data: unknown) {
  if (!civGame || phase !== 'playing' || !data || typeof data !== 'object') return;
  const i = indexOf(p);
  const ask = data as { unit?: unknown; city?: unknown; target?: unknown; from?: unknown };
  const target = ask.target;
  if (i < 0 || !Number.isSafeInteger(target) || (target as number) < 0 || (target as number) >= civGame.tiles.length) return;
  const t = target as number;
  // (Only what this civ can see now.)
  if (!civGame.players[i].visible[t]) return;
  let reply: PreviewReply;
  if (Number.isSafeInteger(ask.unit)) {
    const u = unitById(civGame, ask.unit as number);
    if (!u || u.owner !== i) return;
    // (A charge: from a tile next to the target.)
    const from = Number.isSafeInteger(ask.from) && neighbours(civGame.grid, t).includes(ask.from as number) ? (ask.from as number) : undefined;
    reply = { ask: from === undefined ? { unit: u.id, target: t } : { unit: u.id, target: t, from }, preview: previewAttack(civGame, u, t, from) };
  } else if (Number.isSafeInteger(ask.city)) {
    const c = cityById(civGame, ask.city as number);
    if (!c || c.owner !== i) return;
    reply = { ask: { city: c.id, target: t }, preview: previewCityFire(civGame, c, t) };
  } else return;
  game.clients.send(p, 'preview', reply);
}

/** What the other side would say to a deal being drawn up on a player's trade screen. */
function checkDeal(game: GameContext, player: Player, data: unknown) {
  if (!civGame || phase !== 'playing' || !data || typeof data !== 'object') return;
  const i = indexOf(player);
  const d = data as { target?: unknown; items?: unknown; key?: unknown };
  if (i < 0 || !Number.isSafeInteger(d.target) || !Array.isArray(d.items) || typeof d.key !== 'string' || d.key.length > 2000) return;
  const verdict = dealVerdict(civGame, { from: i, to: d.target as number, items: d.items as DealItem[] });
  const reply: DealCheck = { key: d.key, ...verdict };
  game.clients.send(player, 'dealCheck', reply);
}

/**
 * The deal helper at the table (Civ V's): a bot asked what would make a deal being drawn up work
 * (`balance`), or what it would give for what's offered (`counter`), as it would weigh them
 * (`advisor.ts`). Its answer: the deal it would take, if any, and what it says.
 */
function dealHelp(game: GameContext, player: Player, data: unknown) {
  if (!civGame || phase !== 'playing' || !data || typeof data !== 'object') return;
  const i = indexOf(player);
  const d = data as { target?: unknown; items?: unknown; ask?: unknown; key?: unknown };
  const bot = civGame.players[d.target as number];
  if (i < 0 || !Number.isSafeInteger(d.target) || !bot?.bot || bot.index === i || !Array.isArray(d.items) || d.items.length > 20 || typeof d.key !== 'string' || d.key.length > 2000) return;
  // (A deal that makes no sense as it stands isn't helped: what's wrong with it is the table's verdict.)
  if (!dealVerdict(civGame, { from: i, to: bot.index, items: d.items as DealItem[] }).valid) return;
  const help = d.ask === 'counter' ? counterOffer(civGame, civGame.players[i], bot, d.items as DealItem[]) : balanceDeal(civGame, civGame.players[i], bot, d.items as DealItem[]);
  game.clients.send(player, 'dealHelp', { key: d.key, ...help });
}

/** Take the trees off a tile (a city's been founded there, or they've been cut). */
function clearTrees(game: GameContext, g: Game, t: number) {
  // (Trees stand a block into the next tile at most: the hex and a margin.)
  const c = centre(g.grid, t);
  for (let x = Math.floor(c.x - 5); x <= c.x + 5; x++)
    for (let z = Math.floor(c.z - 5); z <= c.z + 5; z++) {
      if (tileAt(g.grid, x + 0.5, z + 0.5) !== t) continue;
      // (Round a world that wraps, the column where it's built.)
      const bx = baseX(g.grid, x);
      for (let y = SEA_Y + 1; y < SEA_Y + 16; y++) if (TREE_BLOCKS.has(game.world.blockName(game.world.getBlock(bx, y, z)))) game.world.setBlock(bx, y, z, 'air');
    }
}

/** Each tile whose improvement, road or city has changed since it was last looked at: its old blocks taken back, its new ones queued. */
function refreshDecor(g: Game) {
  // (Not while tiles are being built again: their improvements go back over their new ground.)
  if (!ground || reshapeQueue.length) return;
  for (let t = 0; t < g.tiles.length; t++) {
    const key = decorKey(g, t);
    const was = decor.get(t);
    if (was?.key === key) continue;
    if (was) for (const at of was.placed) decorQueue.push({ add: false, at });
    const placed = decorOf(g, ground, t);
    for (const at of placed) decorQueue.push({ add: true, at });
    decor.set(t, { key, placed });
  }
}

/** Some of the queued improvement blocks set (or taken back): each only over what it expects to find there (a block in an unloaded chunk waits). */
function setDecor(game: GameContext) {
  const ids = new Map<string, number>();
  const id = (name: string) => ids.get(name) ?? ids.set(name, game.world.blockId(name)).get(name)!;
  const left: typeof decorQueue = [];
  let done = 0;
  for (const op of decorQueue) {
    if (done >= 2000) {
      left.push(op);
      continue;
    }
    const [x, y, z, block, under] = op.at;
    const now = game.world.getBlock(x, y, z);
    if (now < 0) {
      left.push(op);
      continue;
    }
    // (What it covers may be wearing its season's look: snow over the grass a farm goes on.)
    const want = op.add ? under : block;
    if (now === id(want) || now === id(seasonal(want, shownSeason))) game.world.setBlock(x, y, z, op.add ? block : seasonal(under, shownSeason));
    done++;
  }
  decorQueue = left;
}

/**
 * A tile's land as the world builds it, but for its feature (`packStatic`'s): woods cut and marsh
 * drained are taken off the world as they go (`clearTrees`), not built again.
 */
const landKey = (t: Game['tiles'][number]) => packStatic({ ...t, feature: undefined });

/** The season the world shows at a game's turn (`rules/disasters.ts`). */
const seasonNow = (g: Game) => seasonAt(g.turn, SPEEDS[g.settings.speed] ?? 1);

/** The season turned since the world last showed it: its blocks queued to swap (each only where it still stands as it was). */
function turnSeason(g: Game) {
  const now = seasonNow(g);
  if (now === shownSeason || seasonQueue.length || reshapeQueue.length) return;
  for (const [x, y, z, base] of seasonSpots) {
    const from = seasonal(base, shownSeason);
    const to = seasonal(base, now);
    if (from !== to) seasonQueue.push([x, y, z, from, to]);
  }
  shownSeason = now;
}

/** Some of the season's blocks swapped (a few thousand a tick; one in a chunk not loaded waits). */
function setSeason(game: GameContext) {
  const ids = new Map<string, number>();
  const id = (name: string) => ids.get(name) ?? ids.set(name, game.world.blockId(name)).get(name)!;
  const left: typeof seasonQueue = [];
  let done = 0;
  for (const op of seasonQueue) {
    const [x, y, z, from, to] = op;
    if (done >= 3000) {
      left.push(op);
      continue;
    }
    const now = game.world.getBlock(x, y, z);
    if (now < 0) {
      left.push(op);
      continue;
    }
    if (now === id(from)) game.world.setBlock(x, y, z, to);
    done++;
  }
  seasonQueue = left;
}

/**
 * Tiles whose land the world has changed (the sea over them, rich soil, a flood's silt): their columns
 * built again from the map as it is now (and their improvements set again after), the ground the
 * improvements stand on measured again, and every screen told of the land as it now is.
 */
function reshape(game: GameContext, g: Game) {
  if (!ground || reshapeQueue.length || seasonQueue.length) return;
  const now = g.tiles.map(landKey);
  const changed = now.flatMap((s, t) => (s !== shaped[t] ? [t] : []));
  if (!changed.length) return;
  const all = terrainEdits(g.grid, g.tiles);
  const land = extent(g.grid);
  ground = new Ground(Math.ceil(land.w), Math.ceil(land.d), all, period(g.grid));
  seasonSpots = seasonalSpots(g.grid, g.tiles, all, ground);
  const look = new Map(seasonSpots.map(([x, y, z, base]) => [`${x},${y},${z}`, seasonal(base, shownSeason)]));
  const built = reshapeEdits(g.grid, g.tiles, changed, all);
  reshapeQueue = built.edits.map((e) => [e[0], e[1], e[2], look.get(`${e[0]},${e[1]},${e[2]}`) ?? e[3]]);
  // (Their improvements' blocks went with the old columns: set again once the new ones stand.)
  for (const t of built.tiles) decor.delete(t);
  const wire: ReshapeWire = { tiles: Object.fromEntries(changed.map((t) => [t, packStatic(g.tiles[t])])) };
  shaped = now;
  for (const p of humans(game)) game.clients.send(p, 'reshape', wire);
}

/** Some of a reshape's blocks set (a few thousand a tick; one in a chunk not loaded waits). */
function setReshape(game: GameContext) {
  const left: Edit[] = [];
  let done = 0;
  for (const e of reshapeQueue) {
    if (done < 3000 && game.world.setBlock(e[0], e[1], e[2], e[3])) done++;
    else left.push(e);
  }
  reshapeQueue = left;
}

/** Keep the free seats filled with bots (each a civ nobody's taken), up to `count` (all of them, until the host says). */
function setBots(count: number) {
  const max = MAP_SIZES[settings.size].players;
  const people = seats.filter((s) => !s.bot);
  if (autoBots) count = max;
  const want = Math.max(0, Math.min(count, max - people.length));
  // Bots keep their civs while no person takes them (the lobby doesn't reshuffle at every change);
  // a new bot gets a civ nobody has, at random, so it isn't the same rivals every game.
  const bots = seats.filter((s) => s.bot && !people.some((p) => p.civ === s.civ)).slice(0, want);
  seats = [...people, ...bots];
  while (bots.length < want) {
    const free = CIV_LIST.filter((c) => !seats.some((s) => s.civ === c.id));
    if (!free.length) break;
    const civ = free[Math.floor(Math.random() * free.length)];
    const seat: LobbySeat = { key: `bot:${civ.id}`, name: civ.leader, civ: civ.id, bot: true, here: true };
    bots.push(seat);
    seats.push(seat);
  }
}

/**
 * Everyone here without a seat is given one while the map has room (someone who came when it was
 * full, once a seat's come free); `leaving` isn't, as they go.
 */
function seatPeople(game: GameContext, leaving?: Player) {
  for (const p of humans(game)) {
    const key = keyOf(p);
    if (p === leaving || seats.some((s) => s.key === key) || seats.filter((s) => !s.bot).length >= MAP_SIZES[settings.size].players) continue;
    seats.unshift({ key, name: p.name, civ: null, bot: false, here: true });
  }
}

/** Teams set up at once (`TeamPreset`). */
function presetTeams(preset: TeamPreset) {
  const people = seats.filter((s) => !s.bot);
  const bots = seats.filter((s) => s.bot);
  if (preset === 'none') for (const s of seats) s.team = null;
  else if (preset === 'people') for (const s of seats) s.team = s.bot ? 1 : 0;
  else {
    // Each person with a bot, then whoever's left two by two (as many teams as there's room for).
    const order = [...people.flatMap((p, i) => (bots[i] ? [p, bots[i]] : [p])), ...bots.slice(people.length)];
    order.forEach((s, i) => (s.team = Math.min(TEAMS - 1, Math.floor(i / 2))));
  }
}

/** Begin: the world's built from the new game's map, and the game starts once it's done. */
function begin(game: GameContext, g: Game, withSeats: LobbySeat[]) {
  civGame = g;
  // (The room's clock starts again with each world.)
  saves.reset();
  demographics.clear();
  researchAdvice.clear();
  seats = withSeats;
  settings = g.settings;
  edits = terrainEdits(g.grid, g.tiles);
  woods = new Set(g.tiles.flatMap((t, i) => (t.feature === 'forest' || t.feature === 'jungle' ? [i] : [])));
  const land = extent(g.grid);
  ground = new Ground(Math.ceil(land.w), Math.ceil(land.d), edits, period(g.grid));
  decor.clear();
  decorQueue = [];
  // The world as its season shows it (snow on the hills in winter...), and its land as it's built.
  seasonSpots = seasonalSpots(g.grid, g.tiles, edits, ground);
  shownSeason = seasonNow(g);
  seasonQueue = [];
  reshapeQueue = [];
  shaped = g.tiles.map(landKey);
  const look = new Map(seasonSpots.map(([x, y, z, base]) => [`${x},${y},${z}`, seasonal(base, shownSeason)]));
  if (look.size) for (const e of edits) e[3] = look.get(`${e[0]},${e[1]},${e[2]}`) ?? e[3];
  // A saved game's improvements and roads are set with the rest of the world, while the screens look
  // away (set afterwards, every screen would draw each of their chunks again for each batch).
  for (let t = 0; t < g.tiles.length; t++) {
    const placed = decorOf(g, ground, t);
    decor.set(t, { key: decorKey(g, t), placed });
    for (const [x, y, z, block] of placed) edits.push([x, y, z, block]);
  }
  editsTotal = edits.length;
  // (The room's clock starts again with each world.)
  decorChecked = -Infinity;
  lastProgress = -Infinity;
  phase = 'building';
  stage = 'gather';
  // Everyone looks on from the middle of the map (the server loads the world round them).
  const size = extent(g.grid);
  for (const p of humans(game)) {
    p.teleport({ x: size.w / 2, y: SEA_Y + 40, z: size.d / 2 });
    lookAt(p, { x: size.w / 2, z: size.d / 2 });
  }
  game.world.spawn = { x: size.w / 2, y: SEA_Y + 70, z: size.d / 2 + 40, yaw: 0 };
  sendLobby(game);
}

/** The map's ground is loaded on the server: a point every chunk across it (an unloaded one collides). */
function mapLoaded(game: GameContext, g: Game): boolean {
  const size = extent(g.grid);
  // (Its last column is just inside: a world that wraps ends at a chunk's edge.)
  for (let x = 0; x < size.w + 16; x += 16) for (let z = 0; z < size.d + 16; z += 16) if (game.world.collisionHeight(Math.min(x, size.w - 0.5), SEA_Y + 100, Math.min(z, size.d)) > 0) return false;
  return true;
}

/** Somewhere far off: screens looking there let the map's ground go. */
const awayFrom = (p: { x: number; y: number; z: number }) => ({ x: p.x + 4000, y: p.y, z: p.z });

/**
 * Where a player's screen loads the world: round their camera, which follows where they look on the
 * map (their screen says, `look`). The screen draws its own view; this only says where to load.
 */
function lookAt(p: Player, at: { x: number; z: number }) {
  p.camera.set({ x: at.x, y: SEA_Y + 60, z: at.z + 37 }, { x: at.x, y: SEA_Y, z: at.z });
}

function startNew(game: GameContext) {
  // Seats: each person with a civ (a random one for anyone who didn't pick), then the bots.
  for (const s of seats) if (!s.civ) s.civ = CIV_LIST.find((c) => !seats.some((o) => o.civ === c.id))?.id ?? 'egypt';
  const g = createGame(
    settings,
    seats.map((s) => ({ user: s.bot ? null : s.key, name: s.bot ? s.name : `${s.name}`, civ: s.civ!, bot: s.bot, team: teamsOn && typeof s.team === 'number' ? s.team : undefined })),
    chosenSeed ?? (Math.random() * 2 ** 31) >>> 0,
  );
  g.started = new Date().toISOString();
  pending = { game: g, seats: seats.map((s) => ({ ...s })) };
  clearAutosaves(game);
  // A world already built (an earlier game in this room): put it back first.
  game.restart();
}

/** Saves at once for what matters, the orders in between at most every few seconds (`saves.ts`). */
const SAVE_EVERY = 5;
const saves = new SaveThrottle(SAVE_EVERY);

/** The game saved now (a turn's end, the game begun, the last person gone). */
function save(game: GameContext) {
  if (!civGame) return;
  game.store.set(saveKey(game), { game: civGame, seats });
  saves.saved(game.clock.now);
}

/** Something changed (an order, a pin): saved now, or with what comes in the next few seconds. */
function saveSoon(game: GameContext) {
  if (saves.changed(game.clock.now)) save(game);
}

/**
 * Autosaves, for a game with one person in it (with more, one can't take a turn back for all): the
 * game as each of the last few turns began, any of which they can go back to from the game's menu.
 * A late game's save is a few hundred kilobytes (about 410 KB at turn 330 on a large map), so a
 * few are kept, not more; they go when the game's over, a new one starts or the save's discarded.
 */
const AUTOSAVES = 3;
const autoKey = (game: GameContext, turn: number) => `autosave:${game.room}:${turn}`;
/** The turns kept, newest first. */
const autosaveTurns = (game: GameContext) =>
  game.store
    .keys(`autosave:${game.room}:`)
    .map((k) => Number(k.slice(k.lastIndexOf(':') + 1)))
    .filter(Number.isFinite)
    .sort((a, b) => b - a);
/** Whether one person (no more) plays the game on. */
const alone = () => !!civGame && civGame.players.filter((p) => p.user).length === 1;

function autosave(game: GameContext) {
  if (!civGame) return;
  if (!alone()) return clearAutosaves(game);
  game.store.set(autoKey(game, civGame.turn), { game: civGame, seats });
  for (const t of autosaveTurns(game).slice(AUTOSAVES)) game.store.delete(autoKey(game, t));
}

/** The autosaves gone (those after `after`, if given: a future no longer, once an earlier turn's taken up again). */
function clearAutosaves(game: GameContext, after = -Infinity) {
  for (const t of autosaveTurns(game)) if (t > after) game.store.delete(autoKey(game, t));
}

/** The turn's over for everyone: the world moves on, the bots play their turn, and it's saved. */
/** The bots to play the turn now begun, in order. */
function queueBots() {
  botQueue = civGame ? civGame.players.filter((p) => p.bot && p.alive).map((p) => p.index) : [];
}

function nextTurn(game: GameContext) {
  if (!civGame) return;
  endTurn(civGame);
  startClock(game);
  // People's automated units go about their work as the turn begins.
  for (const p of civGame.players) if (!p.bot && p.alive) automate(civGame, p);
  queueBots();
  save(game);
  autosave(game);
  markAll(game);
}

/**
 * The game's been won: at a turn's end, or by an order (a last capital taken, by a person or a bot).
 * It's over: no more turns, its save goes, and the host can set up the next.
 */
function finish(game: GameContext) {
  // (Each person here: what they've done, the victory if it's theirs, and the game in their Hall of Fame.)
  if (civGame)
    for (const pl of humans(game)) {
      const p = civGame.players[indexOf(pl)];
      if (!p) continue;
      for (const id of [...feats(civGame, p), ...victories(civGame, p)]) award(pl, p, id);
      recordFame(game, pl, p);
    }
  phase = 'over';
  game.store.delete(saveKey(game));
  clearAutosaves(game);
  markAll(game);
  sendLobby(game);
}

/** When each person who's away left (by key, on this match's clock). */
const leftAt = new Map<string, number>();
/** Seconds a person who's just left is waited for (a reload, a dropped connection) before their turn counts as done. */
const AWAY_GRACE = 20;

/**
 * People who've left count as ready (their units wait), so the turn can end without them, once
 * they've been gone a little while (back sooner, from a reload or a dropped connection, the turn's
 * still theirs to end); but with nobody at all here, the game waits (the bots don't play it out alone).
 */
function everyoneReady(game: GameContext): boolean {
  if (!civGame || botQueue.length || !anyonePlaying(game) || !sequenceDone(civGame)) return false;
  const gone = goneFrom(game);
  return civGame.players.every((p) => !p.alive || p.bot || p.ready || gone(p.index));
}

/** Who's been gone long enough that their turn counts as done (by their civ's index): left, and not back within the grace. */
function goneFrom(game: GameContext): (i: number) => boolean {
  const here = new Set(humans(game).map(keyOf));
  return (i) => {
    const key = civGame?.players[i]?.user;
    return !!key && !here.has(key) && game.clock.now - (leftAt.get(key) ?? -Infinity) >= AWAY_GRACE;
  };
}

/**
 * People at war with each other take their turns one side at a time (`rules/turns.ts`): the side
 * playing hands on once it's done (or gone), or when its clock runs out; each side's segment has a
 * clock of its own. Whether it handed on.
 */
function handOn(game: GameContext, timeUp: boolean): boolean {
  if (!civGame || sequenceDone(civGame) || !advanceSequence(civGame, goneFrom(game), timeUp)) return false;
  if (!sequenceDone(civGame)) startClock(game);
  saveSoon(game);
  markAll(game);
  return true;
}

/**
 * Someone watching takes a bot's place: its civilization is theirs to play from now on (with its
 * team, its research, all it has), as Civilization V lets a person join a game under way. The
 * autosaves go: with another person in it, no one takes a turn back for all.
 */
function takeOver(game: GameContext, player: Player, data: unknown) {
  if (!civGame || phase !== 'playing' || indexOf(player) >= 0) return;
  const t = civGame.players[(data as { player?: unknown } | null)?.player as number];
  if (!t?.bot || !t.alive || t.cityState || t.civ === 'barbarian') return;
  const key = keyOf(player);
  const was = t.name;
  t.user = key;
  t.bot = false;
  t.name = player.name;
  t.ready = false;
  botQueue = botQueue.filter((b) => b !== t.index);
  // (At war with another person now: they take their turns in order, from this one.)
  warBegun(civGame, -1);
  const seat = seats.find((s) => s.bot && s.civ === t.civ);
  const mine: LobbySeat = { key, name: player.name, civ: t.civ, bot: false, here: true, team: seat?.team ?? t.team ?? null };
  seats = seat ? seats.map((s) => (s === seat ? mine : s)) : [...seats, mine];
  clearAutosaves(game);
  noteAll(civGame, (r) => (r === t ? { text: `You have taken ${was}'s place: the ${CIVS[t.civ]?.name ?? t.civ} are yours to lead.`, kind: 'good' } : { text: `${player.name} has taken ${knowsOf(r, t) ? `${was}'s place, leading the ${CIVS[t.civ]?.name ?? t.civ}` : 'the place of a leader you haven’t met'}.`, kind: 'info' }));
  yieldsSent.delete(key);
  tilesSent.delete(key);
  save(game);
  markAll(game);
  sendLobby(game);
}

function lobbyAction(game: GameContext, p: Player, a: LobbyAction) {
  const key = keyOf(p);
  const seat = seatOf(p);
  const isHost = host === key;
  // A game over: the host can set up the next one.
  if (a.a === 'newGame' && phase === 'over' && isHost) {
    const here = new Set(humans(game).map(keyOf));
    seats = seats.filter((s) => s.bot || here.has(s.key));
    pending = null;
    game.restart();
    return;
  }
  if (phase !== 'lobby') return;
  switch (a.a) {
    case 'civ':
      // (Only the playable civs: not the barbarians, not a city-state's.)
      // A person may take a bot's civ (the bot picks another), not another person's.
      if (seat && CIV_LIST.some((c) => c.id === a.civ) && !seats.some((s) => s !== seat && !s.bot && s.civ === a.civ)) {
        seat.civ = a.civ;
        // A bot that had it picks another.
        setBots(seats.filter((s) => s.bot).length);
      }
      break;
    case 'settings':
      if (!isHost) return;
      // (Not a map too small for the people seated.)
      if (a.size && a.size in MAP_SIZES && MAP_SIZES[a.size].players >= seats.filter((s) => !s.bot).length) settings.size = a.size;
      if (a.type && ['continents', 'pangaea', 'archipelago', 'fractal'].includes(a.type)) settings.type = a.type;
      if (a.speed && ['quick', 'standard'].includes(a.speed)) {
        settings.speed = a.speed;
        // (The turn limit goes with the speed, unless it's set in the same breath.)
        if (a.turnLimit === undefined) settings.turnLimit = TURN_LIMITS[a.speed];
      }
      if (a.timer !== undefined && [0, 60, 90, 120, 180, 300].includes(a.timer)) settings.timer = a.timer;
      if (typeof a.dynamicTimer === 'boolean') settings.dynamicTimer = a.dynamicTimer;
      if (a.turnLimit !== undefined && [150, 250, 330, 500].includes(a.turnLimit)) settings.turnLimit = a.turnLimit;
      if (typeof a.barbarians === 'boolean') settings.barbarians = a.barbarians;
      if (typeof a.wrap === 'boolean') settings.wrap = a.wrap;
      if (typeof a.disasters === 'boolean') settings.disasters = a.disasters;
      if (a.cityStates !== undefined && [0, 2, 4, 6, 8, 12].includes(a.cityStates)) settings.cityStates = a.cityStates;
      if (typeof a.difficulty === 'string' && Object.hasOwn(DIFFICULTIES, a.difficulty)) settings.difficulty = a.difficulty;
      seatPeople(game);
      setBots(seats.filter((s) => s.bot).length);
      break;
    case 'victories':
      if (!isHost || !a.victories || typeof a.victories !== 'object') return;
      // (A new object: the defaults' own isn't changed.)
      settings.victories = { ...settings.victories };
      for (const k of Object.keys(settings.victories) as (keyof Settings['victories'])[]) if (typeof a.victories[k] === 'boolean') settings.victories[k] = a.victories[k]!;
      break;
    case 'seed':
      if (!isHost) return;
      if (a.seed === null) chosenSeed = null;
      else if (Number.isInteger(a.seed) && a.seed >= 0 && a.seed < 2 ** 31) chosenSeed = a.seed;
      break;
    case 'bots':
      if (!isHost || !Number.isFinite(a.count)) return;
      autoBots = false;
      setBots(Math.max(0, Math.min(7, Math.floor(a.count))));
      break;
    case 'teams':
      if (!isHost || typeof a.on !== 'boolean') return;
      teamsOn = a.on;
      // (On: people against bots if there are both, else in twos; off: every civ for itself.)
      presetTeams(!teamsOn ? 'none' : seats.some((s) => s.bot) && seats.some((s) => !s.bot) ? 'people' : 'pairs');
      break;
    case 'team': {
      // A person picks their own team; the host anyone's.
      const which = seats.find((s) => s.key === a.seat);
      if (!teamsOn || !which || (!isHost && which !== seat)) return;
      if (a.team === null || (Number.isInteger(a.team) && a.team >= 0 && a.team < TEAMS)) which.team = a.team;
      break;
    }
    case 'teamPreset':
      if (!isHost || !teamsOn || !['people', 'pairs', 'none'].includes(a.preset)) return;
      presetTeams(a.preset);
      break;
    case 'start':
      // (With teams, two sides at least: a game of one team is won before it begins.)
      if (!isHost || seats.length < 1 || (teamsOn && lobbySides(seats) < 2)) return;
      startNew(game);
      return;
    case 'resume': {
      if (!isHost) return;
      const saved = game.store.get<{ game: Game; seats: LobbySeat[] }>(saveKey(game));
      if (!saved) return;
      pending = { game: saved.game, seats: saved.seats };
      game.restart();
      return;
    }
    case 'discard':
      if (!isHost) return;
      game.store.delete(saveKey(game));
      clearAutosaves(game);
      break;
  }
  sendLobby(game);
}

/**
 * A map pin put down, changed or taken up (`client/pins.ts`): a living player's, on a tile they know,
 * one a tile, with one of the pin icons and a short label. It's seen by them and their team.
 */
function pin(game: GameContext, player: Player, data: unknown) {
  const i = indexOf(player);
  const me = civGame?.players[i];
  if (!civGame || phase !== 'playing' || !me?.alive || !data || typeof data !== 'object') return;
  const { tile, icon, label, remove } = data as { tile?: unknown; icon?: unknown; label?: unknown; remove?: unknown };
  if (typeof tile !== 'number' || !Number.isInteger(tile) || !me.explored[tile]) return;
  const pins = (civGame.pins ??= []);
  const at = pins.findIndex((x) => x.owner === i && x.tile === tile);
  if (remove === true) {
    if (at < 0) return;
    pins.splice(at, 1);
  } else {
    const kind = PIN_ICONS.find((x) => x === icon);
    if (!kind) return;
    // (One line of plain text: no control characters.)
    const text = typeof label === 'string' ? label.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, PIN_LABEL) : '';
    if (at >= 0) Object.assign(pins[at], { icon: kind, label: text });
    else if (pins.filter((x) => x.owner === i).length < MAX_PINS) pins.push({ id: pins.reduce((n, x) => Math.max(n, x.id), 0) + 1, owner: i, tile, icon: kind, label: text });
    else return;
  }
  saveSoon(game);
  markAll(game);
}

// -------------------------------------------------------------------------------------------------
// Achievements and the Hall of Fame
// -------------------------------------------------------------------------------------------------

type CivPlayer = Game['players'][number];

/**
 * One of the game's achievements (`meta.ts`) for a person, where the platform keeps them (an older
 * build may not): once a game, the civ remembering it (a guest's are kept only for the visit, so
 * one coming back, after a reload or the server's restart, isn't given them all again).
 */
function award(pl: Player, p: CivPlayer, id: string) {
  if (!meta.achievements?.[id] || typeof pl.achieve !== 'function' || p.awarded?.includes(id)) return;
  (p.awarded ??= []).push(id);
  pl.achieve(id);
}

/** Whether a city is a civilization's original capital: its founder's first city still standing (as domination counts them). */
const originalCapital = (game: Game, c: Game['cities'][number]) => game.cities.filter((x) => x.founder === c.founder).sort((a, b) => a.id - b.id)[0] === c;

/** The achievements a person's empire has earned so far, as the game stands (the victories come at its end). */
function feats(game: Game, p: CivPlayer): string[] {
  const mine = citiesOf(game, p.index);
  const out: string[] = [];
  if (mine.some((c) => c.founder === p.index)) out.push('first_city');
  const wonders = Object.entries(game.wonders).filter(([id, by]) => by === p.index && BUILDINGS[id]?.kind === 'world').length;
  if (wonders >= 1) out.push('wonder');
  if (wonders >= 5) out.push('wonders_5');
  // (Taken from another: a civilization's or a city-state's, not the barbarians'.)
  const taken = mine.filter((c) => c.founder !== p.index && game.players[c.founder] && game.players[c.founder].civ !== 'barbarian');
  if (taken.length) out.push('conqueror');
  if (taken.some((c) => !game.players[c.founder].cityState && originalCapital(game, c))) out.push('capital');
  if (mine.some((c) => c.pop >= 20)) out.push('city_20');
  if (Object.values(game.religions).some((r) => r.founder === p.index)) out.push('religion');
  if (Object.values(game.found ?? {}).some((f) => f.by.includes(p.index))) out.push('natural_wonder');
  if (game.players.some((o) => o.cityState && o.alive && allyOf(game, o.index) === p.index)) out.push('ally');
  if (p.goldenAges > 0) out.push('golden_age');
  return out;
}

/** A game's end, for a person: the victory if it's theirs (or their team's): its kind, the difficulty, their civ. */
function victories(game: Game, p: CivPlayer): string[] {
  const over = game.over;
  if (!over || !p.alive || (over.winner !== p.index && !teammates(game, over.winner, p.index))) return [];
  const out = ['victory', over.how === 'time' ? 'win_score' : `win_${over.how}`, `win_${p.civ}`];
  const level = game.settings.difficulty ?? 'prince';
  if (level === 'king' || level === 'emperor' || level === 'deity') out.push('win_king');
  if (level === 'deity') out.push('win_deity');
  return out;
}

/** Seconds between looks at what the people here have achieved. */
const FEATS_EVERY = 1;
let featsAt = 0;

/** What the people here have achieved, looked at now and then: and a fallen civilization's game kept in its person's Hall of Fame. */
function rewardFeats(game: GameContext) {
  if (!civGame) return;
  for (const pl of humans(game)) {
    const p = civGame.players[indexOf(pl)];
    if (!p) continue;
    for (const id of feats(civGame, p)) award(pl, p, id);
    if (!p.alive) recordFame(game, pl, p);
  }
}

/** The most games a Hall of Fame keeps (the newest). */
const FAME_KEPT = 50;

/** A person's game, as it ends for them, kept in their Hall of Fame (once), and the list sent to their screen. */
function recordFame(game: GameContext, pl: Player, p: CivPlayer) {
  if (!civGame) return;
  // (Which game: its seed and when it began, so a fixed seed played again is another; a save from before games kept their start, its seed alone.)
  const id = civGame.started ? `${civGame.seed}@${civGame.started}:${p.index}` : `${civGame.seed}:${p.index}`;
  // (Kept once; but a civ fallen and since brought back, its game's end replaces its fall.)
  const all = pl.store.get<FameEntry[]>('fame') ?? [];
  const was = all.find((e) => e.id === id);
  if (was && !(was.fell && p.alive)) return;
  const list = all.filter((e) => e !== was);
  const g = civGame;
  const over = g.over;
  const wins = (i: number) => !!over && (i === over.winner || teammates(g, over.winner, i));
  const majors = g.players.filter((o) => !o.cityState && o.civ !== 'barbarian');
  const ranked = majors.map((o) => ({ o, won: wins(o.index), score: score(g, o) })).sort((a, b) => Number(b.won) - Number(a.won) || b.score - a.score);
  const s = g.settings;
  const won = wins(p.index) && p.alive;
  const entry: FameEntry = {
    id,
    civ: p.civ,
    map: s.type,
    size: s.size,
    difficulty: s.difficulty ?? 'prince',
    speed: s.speed,
    won,
    how: over?.how,
    winner: over && !won ? g.players[over.winner]?.civ : undefined,
    fell: !p.alive || undefined,
    place: ranked.findIndex((x) => x.o === p) + 1,
    of: majors.length,
    score: score(g, p),
    turn: g.turn,
    date: new Date().toISOString().slice(0, 10),
    people: g.players.filter((o) => o.user).length,
  };
  const kept = [entry, ...list].slice(0, FAME_KEPT);
  pl.store.set('fame', kept);
  game.clients.send(pl, 'fame', kept);
}

const fightWire = (c: CombatResult): FightWire => ({ attacker: c.attacker, at: c.at, dealt: c.dealt, taken: c.taken, killed: c.killed, died: c.died, captured: c.captured });

/**
 * A fight, whoever ordered it (a person, a bot), shown on each screen that sees where it was: the
 * defender's, anyone else's in sight of it, anyone watching (the one who ordered it has it in their
 * order's result).
 */
function showFights(game: GameContext, by: number, combat: CombatResult[]) {
  if (!civGame) return;
  for (const p of humans(game)) {
    const i = indexOf(p);
    if (i === by) continue;
    const me = i >= 0 && civGame.players[i].alive ? civGame.players[i] : null;
    const seen = combat.filter((c) => !me || me.visible[c.at] > 0);
    if (seen.length) game.clients.send(p, 'fights', seen.map(fightWire));
  }
}

function order(game: GameContext, p: Player, o: Order) {
  if (!civGame || phase !== 'playing') return;
  const i = indexOf(p);
  if (i < 0) return;
  const result = apply(civGame, i, o);
  const reply: OrderResult = { ok: result.ok, error: result.error, combat: result.combat?.map(fightWire) };
  game.clients.send(p, 'result', reply);
  // Anything can change what others see (a unit moving into sight, a city taken).
  markAll(game);
  if (o.t !== 'ready' && result.ok) saveSoon(game);
}

export default defineServer(shared, {
  setup(game) {
    // (For the headless tests, in development: the game as it stands, and its phase.)
    if (import.meta.env.DEV) (globalThis as unknown as { __civ: unknown }).__civ = { game: () => civGame, phase: () => phase };
    fightHooks.fought = (g, by, combat) => {
      if (g === civGame) showFights(game, by, combat);
    };
    // The voxel models (units, towns, camps): items no one holds, that each screen draws (`client/models3d.ts`).
    for (const id of MODEL_IDS) game.items.define(`civm_${id}`, { kind: 'misc', name: id });
    // The board: a modal widget over the whole screen that frees the mouse for the map and the panels
    // (each screen draws everything itself, `client/`). Closed (Esc), it's put back.
    game.hud.define('board', {
      at: 'center',
      modal: true,
      html: '<div class="board"></div>',
      css: '.board { width: 1px; height: 1px; }',
      onClose: (p) => game.clock.after(0.05, () => p.hud.widget('board', {})),
    });

    game.events.on('playerJoin', ({ player }) => {
      if (player.bot) return;
      const key = keyOf(player);
      const seat = seats.find((s) => s.key === key);
      leftAt.delete(key);
      if (seat) seat.here = true;
      else if (phase === 'lobby') {
        seatPeople(game);
        setBots(seats.filter((s) => s.bot).length);
      }
      host ??= key;
      if (civGame) {
        const size = extent(civGame.grid);
        const middle = { x: size.w / 2, y: SEA_Y + 40, z: size.d / 2 };
        player.teleport(middle);
        lookAt(player, phase === 'building' && stage !== 'gather' ? awayFrom(middle) : middle);
        // (The others' screens show who's here.)
        markAll(game);
      }
      sendLobby(game);
    });
    game.events.on('playerReady', ({ player }) => {
      player.hud.widget('board', {});
      game.clients.send(player, 'prefs', player.store.get('prefs') ?? {});
      game.clients.send(player, 'fame', player.store.get('fame') ?? []);
      game.clients.send(player, 'lobby', lobbyView(game, player));
      if (civGame && phase !== 'building' && phase !== 'lobby') {
        game.clients.send(player, 'map', mapWire(civGame));
        dirty.add(keyOf(player));
        yieldsSent.delete(keyOf(player));
        tilesSent.delete(keyOf(player));
      }
    });
    game.events.on('playerLeave', ({ player }) => {
      const key = keyOf(player);
      const seat = seats.find((s) => s.key === key);
      if (civGame) leftAt.set(key, game.clock.now);
      if (seat) {
        seat.here = false;
        // (In the lobby, a bot takes the seat back.)
        if (phase === 'lobby') {
          seats = seats.filter((s) => s !== seat);
          seatPeople(game, player);
          setBots(seats.filter((s) => s.bot).length);
        }
      }
      if (host === key) host = humans(game).find((p) => p !== player) ? keyOf(humans(game).find((p) => p !== player)!) : null;
      // (The last person gone: what waited to be saved is, before the room stops.)
      if (phase === 'playing' && saves.pending && !humans(game).some((p) => p !== player)) save(game);
      // (The others' screens show who's away: their turn counts as done.)
      if (civGame) markAll(game);
      sendLobby(game);
    });

    game.events.on('clientMessage', ({ player, name, data }) => {
      if (name === 'lobby' && data && typeof data === 'object') lobbyAction(game, player, data as LobbyAction);
      else if (name === 'order' && data && typeof data === 'object' && typeof (data as { t?: unknown }).t === 'string') order(game, player, data as Order);
      else if (name === 'city' && civGame) {
        const i = indexOf(player);
        const c = civGame.cities.find((x) => x.id === (data as { id?: number })?.id);
        if (i >= 0 && c && c.owner === i) game.clients.send(player, 'city', cityInfo(civGame, civGame.players[i], c));
      } else if (name === 'reload' && civGame && phase === 'playing') {
        // Back to an autosave (the one person playing): the game as that turn began, the world rebuilt from it.
        const turn = Number((data as { turn?: unknown } | null)?.turn);
        if (indexOf(player) < 0 || !alone()) return;
        const saved = game.store.get<{ game: Game; seats: LobbySeat[] }>(autoKey(game, turn));
        if (!saved) return;
        clearAutosaves(game, turn);
        pending = { game: saved.game, seats: saved.seats };
        game.restart();
      } else if (name === 'advice' && civGame) {
        // The advisor's research advice, worked out once a turn for each player.
        const i = indexOf(player);
        if (i < 0) return;
        const key = keyOf(player);
        let info = researchAdvice.get(key);
        if (info?.turn !== civGame.turn) researchAdvice.set(key, (info = { turn: civGame.turn, techs: adviseResearch(civGame, civGame.players[i]) }));
        game.clients.send(player, 'advice', info);
      } else if (name === 'stats' && civGame) {
        // The demographics, worked out once a turn for each player (they're the turn's, as Civ V's are).
        const i = indexOf(player);
        if (i < 0) return;
        const key = keyOf(player);
        let info = demographics.get(key);
        if (info?.turn !== civGame.turn) demographics.set(key, (info = statsFor(civGame, civGame.players[i])));
        game.clients.send(player, 'stats', info);
      } else if (name === 'workAdvice' && civGame) {
        // The advisor's recommended work round a worker of theirs (asked for while it's selected).
        const i = indexOf(player);
        const id = (data as { unit?: unknown } | null)?.unit;
        const u = civGame.units.find((x) => x.id === id);
        if (i < 0 || !u || u.owner !== i || !UNITS[u.type]?.abilities?.includes('build')) return;
        const advice: WorkAdvice = { unit: u.id, ...adviseWork(civGame, civGame.players[i], u) };
        game.clients.send(player, 'workAdvice', advice);
      } else if (name === 'pin') pin(game, player, data);
      else if (name === 'takeOver') takeOver(game, player, data);
      else if (name === 'preview') preview(game, player, data);
      else if (name === 'dealCheck') checkDeal(game, player, data);
      else if (name === 'dealHelp') dealHelp(game, player, data);
      else if (name === 'look' && civGame && phase !== 'building' && data && typeof data === 'object') {
        const { x, z } = data as { x?: unknown; z?: unknown };
        if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) return;
        const size = extent(civGame.grid);
        lookAt(player, { x: Math.max(0, Math.min(size.w, x)), z: Math.max(0, Math.min(size.d, z)) });
      } else if (name === 'prefs' && data && typeof data === 'object') {
        // A player's preferences (sound, tips and the tip on show, the next unit after a move, quick movement and combat, the interface's size and colours, the news quietened), kept for them: only what's known, and not much of it.
        const d = data as { muted?: unknown; tips?: unknown; seen?: unknown; autoNext?: unknown; shown?: unknown; moves?: unknown; combat?: unknown; uiSize?: unknown; palette?: unknown; quiet?: unknown };
        const pace = (x: unknown) => (x === 'fast' || x === 'skip' ? x : 'normal');
        player.store.set('prefs', {
          muted: d.muted === true,
          tips: d.tips !== false,
          seen: Array.isArray(d.seen) ? d.seen.filter((x): x is string => typeof x === 'string' && x.length < 40).slice(0, 60) : [],
          autoNext: d.autoNext !== false,
          shown: typeof d.shown === 'string' ? d.shown.slice(0, 40) : '',
          moves: pace(d.moves),
          combat: pace(d.combat),
          uiSize: d.uiSize === 'small' || d.uiSize === 'large' || d.uiSize === 'larger' ? d.uiSize : 'normal',
          palette: d.palette === 'colourblind' ? 'colourblind' : 'standard',
          quiet: Array.isArray(d.quiet) ? NOTE_TOPICS.filter((t) => (d.quiet as unknown[]).includes(t)) : [],
        });
      } else if (name === 'exit') game.exit();
    });

    game.commands.register('civ', {
      help: 'Blockilization tools',
      cheat: true,
      usage: 'turn | turns [n] | gold [n] | tech [id] | spawn <unit> [player] | reveal | wonders [fog] | improve [pillaged] | grow [n] | decor | unit <type> [foe] [hp] [embarked] | take | win [how] [player] | revolt',
      run(args) {
        const out = civCommand(args);
        // What a command changed is kept as an order's is: a restart, or a game carried on, still has it.
        if (phase === 'playing') saveSoon(game);
        return out;
      },
    });
    /** A /civ command: what it says it did. */
    function civCommand(args: string[]): string {
      if (!civGame) throw new Error('No game yet');
      const [cmd, arg] = args;
      if (cmd === 'turn') {
        nextTurn(game);
        return `Turn ${civGame.turn}`;
      }
      if (cmd === 'turns') {
        // Turns played at once: the bots play theirs, people's units wait.
        const n = Math.max(1, Math.min(300, Math.floor(Number(arg)) || 10));
        for (let i = 0; i < n && !civGame.over; i++) {
          for (const b of botQueue.splice(0)) if (civGame.players[b]?.alive) botTurn(civGame, civGame.players[b]);
          nextTurn(game);
        }
        return `Turn ${civGame.turn}`;
      }
      if (cmd === 'gold') {
        for (const p of civGame.players) if (!p.bot) p.gold += Number(arg ?? 1000) || 0;
        markAll(game);
        return 'Rich';
      }
      if (cmd === 'tech') {
        // A tech for everyone playing (the one named, or what each is researching).
        if (arg && !TECHS[arg]) throw new Error(`No tech ${arg}`);
        for (const p of civGame.players) if (!p.bot && (arg ?? p.researching)) learn(civGame, p, arg ?? p.researching!);
        markAll(game);
        return 'Learned';
      }
      if (cmd === 'spawn') {
        // A unit (a barbarian's, unless a player's index is given) next to the first person's first fighting unit.
        const [, type, who] = args;
        const owner = who !== undefined ? Number(who) : civGame.players.findIndex((p) => p.civ === 'barbarian');
        if (!type || !UNITS[type] || !civGame.players[owner]) throw new Error('Try: spawn <unit> [player]');
        const human = civGame.players.find((p) => !p.bot);
        const near = civGame.units.find((u) => u.owner === human?.index && isMilitary(UNITS[u.type]));
        // (Aircraft in the owner's first city with room, where they're based.)
        const spot = UNITS[type].domain === 'air'
          ? civGame.cities.find((c) => c.owner === owner && airBase(civGame!, owner, c.tile))?.tile
          : near && neighbours(civGame.grid, near.tile).find((t) => canStand(civGame!, type, t) && !civGame!.units.some((u) => u.tile === t) && !cityAt(civGame!, t));
        if (spot === undefined) throw new Error('No room by your units');
        spawnUnit(civGame, type, owner, spot);
        updateAllVisibility(civGame);
        markAll(game);
        return `A ${UNITS[type].name} for ${civGame.players[owner].name}`;
      }
      if (cmd === 'reveal') {
        for (const p of civGame.players) p.explored.fill(1);
        updateAllVisibility(civGame);
        markAll(game);
        return 'Revealed';
      }
      if (cmd === 'wonders') {
        // Each natural wonder and the land round it shown to everyone playing (so found, each a note to jump to): to look
        // at; or, with `fog`, only the land round it (to see the cloud still hide it).
        const at = civGame.tiles.flatMap((tile, t) => (tile.wonder ? [t] : []));
        for (const p of civGame.players) if (!p.bot) for (const t of at) for (const x of within(civGame.grid, t, 2)) if (x !== t || arg !== 'fog') p.explored[x] = 1;
        updateAllVisibility(civGame);
        markAll(game);
        return at.map((t) => `${NATURAL_WONDERS[civGame!.tiles[t].wonder!]?.name} at ${t}`).join(', ');
      }
      if (cmd === 'improve') {
        // Every kind of improvement on the land round your first unit (fishing boats and platforms on its water), a ring of road and one of rail: to look at.
        const u = civGame.units.find((x) => civGame!.players[x.owner]?.user && !civGame!.players[x.owner].bot);
        if (!u) throw new Error('No unit of yours');
        const land: ImprovementId[] = ['farm', 'mine', 'pasture', 'plantation', 'camp', 'quarry', 'lumber_mill', 'trading_post', 'fort', 'citadel', 'oil_well', 'academy', 'customs_house', 'manufactory', 'holy_site', 'landmark'];
        const resources: Partial<Record<ImprovementId, string[]>> = { mine: ['iron', 'gold_ore', 'gems'], pasture: ['cattle', 'sheep', 'horses'], plantation: ['wine', 'cotton'], quarry: ['marble', 'stone'], camp: ['deer', 'furs', 'ivory'] };
        let i = 0;
        for (const t of within(civGame.grid, u.tile, 4)) {
          const tile = civGame.tiles[t];
          if (civGame.cities.some((c) => c.tile === t)) continue;
          tile.pillaged = arg === 'pillaged';
          if (TERRAINS[tile.terrain].water) {
            tile.improvement = i++ % 2 ? 'fishing_boats' : 'offshore_platform';
            continue;
          }
          const imp = land[i++ % land.length];
          tile.improvement = imp;
          const r = resources[imp];
          if (r) tile.resource = r[i % r.length];
          const ring = distance(civGame.grid, u.tile, t);
          tile.road = ring === 2 ? 'road' : ring === 4 ? 'rail' : undefined;
        }
        markAll(game);
        return 'Improved';
      }
      if (cmd === 'grow') {
        // Every city n more people (6) and a wall more, and every capital the next two wonders nobody has built: to look at.
        for (const c of civGame.cities) {
          c.pop += Number(arg ?? 6) || 0;
          const next = ['walls', 'castle', 'arsenal', 'military_base'].find((b) => !c.buildings.includes(b));
          if (next) c.buildings.push(next);
          if (!c.capital) continue;
          for (const w of Object.values(BUILDINGS).filter((b) => b.kind === 'world' && civGame!.wonders[b.id] === undefined).slice(0, 2)) {
            c.buildings.push(w.id);
            civGame.wonders[w.id] = c.owner;
          }
        }
        markAll(game);
        return 'Grown';
      }
      if (cmd === 'decor') {
        // How the improvements' blocks are getting on: tiles showing something, and blocks waiting (their chunks not loaded) to be set or taken back.
        const showing = [...decor.values()].filter((d) => d.placed.length).length;
        return `${showing} tiles improved, ${decorQueue.length} blocks waiting`;
      }
      if (cmd === 'unit') {
        // A unit of yours (or the barbarians', `foe`) on a free tile by your first unit, as hurt as `hp` says, on the water if `embarked`: to try fights and looks.
        const u = civGame.units.find((x) => civGame!.players[x.owner]?.user && !civGame!.players[x.owner].bot);
        if (!u || !arg || !UNITS[arg]) throw new Error('Name a unit type, with a unit of yours on the map');
        const owner = args.includes('foe') ? barbarianIndex(civGame) : u.owner;
        if (owner < 0) throw new Error('No barbarians in this game');
        const embarked = args.includes('embarked') && UNITS[arg].domain === 'land';
        const water = UNITS[arg].domain === 'sea' || embarked;
        const t = within(civGame.grid, u.tile, 2).find((x) => x !== u.tile && !!TERRAINS[civGame!.tiles[x].terrain].water === water && civGame!.tiles[x].elevation !== 'mountain' && !civGame!.units.some((o) => o.tile === x));
        if (t === undefined) throw new Error('No room');
        const hp = Number(args.find((a) => /^\d+$/.test(a)) ?? 100);
        const made = spawnUnit(civGame, arg, owner, t, { hp: Math.max(1, Math.min(100, hp)), embarked });
        updateAllVisibility(civGame);
        markAll(game);
        return `A ${arg} (unit ${made.id}) at tile ${t}`;
      }
      if (cmd === 'revolt') {
        // The first person given Freedom and three of its tenets, and two civs they know on Order, their culture
        // over them (dissent 4): a revolution to offer, to try its screens.
        const you = civGame.players.find((p) => !p.bot && p.alive);
        const freedom = IDEOLOGIES.find((i) => i.id === 'freedom');
        const others = civGame.players.filter((p) => p !== you && p.alive && !p.cityState && p.civ !== 'barbarian').slice(0, 2);
        if (!you || !freedom || others.length < 2) throw new Error('A person and two other civilizations are needed');
        you.ideology = 'freedom';
        for (const t of freedom.tenets[0].slice(0, 3)) if (!you.policies.includes(t.id)) you.policies.push(t.id);
        you.lifetimeCulture = Math.max(1, you.lifetimeCulture);
        for (const o of others) {
          o.ideology = 'order';
          o.tourism[you.index] = you.lifetimeCulture;
        }
        markAll(game);
        return `Dissent ${dissent(civGame, you)} for ${you.name}`;
      }
      if (cmd === 'win') {
        // The game won now (by the first person, unless a player's index is given; science, unless another way is named): to try its end.
        const how = (['domination', 'science', 'culture', 'diplomatic', 'score'] as const).find((x) => x === arg) ?? 'science';
        const who = Number(args[2] ?? civGame.players.findIndex((p) => !p.bot));
        if (!civGame.players[who]) throw new Error('Try: win [how] [player]');
        civGame.over = { winner: who, how };
        markAll(game);
        return `${civGame.players[who].name} wins (${how})`;
      }
      if (cmd === 'take') {
        // The civ's city nearest your first city, taken by you as if conquered (a puppet, its choice to make): to try the puppet's screen.
        const you = civGame.players.find((p) => !p.bot);
        const home = you && citiesOf(civGame, you.index)[0];
        const c = home && civGame.cities.filter((x) => x.owner !== you!.index && !civGame!.players[x.owner].cityState).sort((a, b) => distance(civGame!.grid, a.tile, home.tile) - distance(civGame!.grid, b.tile, home.tile))[0];
        if (!you || !c) throw new Error('No city of another civ to take');
        cityHooks.captured(civGame, c, you.index);
        updateAllVisibility(civGame);
        markAll(game);
        return `${c.name} taken`;
      }
      throw new Error('Try: turn, turns [n], gold [n], tech [id], spawn <unit> [player], reveal, wonders [fog], improve [pillaged], grow [n], decor, unit <type> [foe] [hp] [embarked], take');
    }
  },

  start(game) {
    // A restart (a new game, a saved one carried on) clears everyone's HUD: the board goes back up,
    // or the platform takes the mouse (and a finger) for itself as in any other game.
    for (const p of humans(game)) p.hud.widget('board', {});
    if (pending) {
      const next = pending;
      pending = null;
      begin(game, next.game, next.seats);
      return;
    }
    phase = 'lobby';
    civGame = null;
    leftAt.clear();
    seatPeople(game);
    setBots(seats.filter((s) => s.bot).length);
    for (const p of humans(game)) host ??= keyOf(p);
    sendLobby(game);
  },

  update(game, dt) {
    if (phase === 'building' && civGame) {
      const size = extent(civGame.grid);
      const middle = { x: size.w / 2, y: SEA_Y + 40, z: size.d / 2 };
      if (stage === 'gather') {
        if (!mapLoaded(game, civGame)) return;
        stage = 'away';
        stageAt = game.clock.now;
        for (const p of humans(game)) lookAt(p, awayFrom(middle));
        return;
      }
      if (stage === 'away') {
        if (game.clock.now - stageAt < 1.5) return;
        stage = 'edit';
      }
      // Set the world's blocks, a few thousand a tick (any whose chunk isn't loaded yet wait).
      const left: Edit[] = [];
      let done = 0;
      for (const e of edits) {
        if (done < 6000 && game.world.setBlock(e[0], e[1], e[2], e[3])) done++;
        else left.push(e);
      }
      edits = left;
      if (game.clock.now - lastProgress > 0.5) {
        lastProgress = game.clock.now;
        sendLobby(game);
      }
      if (!edits.length) {
        phase = civGame.over ? 'over' : 'playing';
        startClock(game);
        // (The game begun, or carried on: saved as it starts.)
        if (phase === 'playing') save(game);
        yieldsSent.clear();
        tilesSent.clear();
        for (const p of humans(game)) {
          lookAt(p, middle);
          game.clients.send(p, 'map', mapWire(civGame));
        }
        sendLobby(game);
        queueBots();
        markAll(game);
      }
      return;
    }
    // The land's improvements and roads, in blocks: looked over twice a second, set a few at a time.
    if ((phase === 'playing' || phase === 'over') && civGame) {
      if (game.clock.now - decorChecked > 0.5) {
        decorChecked = game.clock.now;
        reshape(game, civGame);
        turnSeason(civGame);
        refreshDecor(civGame);
      }
      if (reshapeQueue.length) setReshape(game);
      if (seasonQueue.length) setSeason(game);
      if (decorQueue.length) setDecor(game);
    }
    // (A restarted room's clock begins again.)
    if (phase === 'playing' && civGame && (game.clock.now - featsAt > FEATS_EVERY || game.clock.now < featsAt)) {
      featsAt = game.clock.now;
      rewardFeats(game);
    }
    if (phase === 'playing' && civGame?.over) finish(game);
    // A game over: whoever comes back still sees how it ended.
    if (phase === 'over' && civGame) return void sendViews(game);
    if (phase !== 'playing' || !civGame) return;
    // What waited to be saved (orders a moment ago), once it's been long enough since the last save.
    if (saves.tick(game.clock.now)) save(game);
    // The bots play, one a tick; once they all have, everyone sees what they did.
    const bot = botQueue.shift();
    if (bot !== undefined) {
      const p = civGame.players[bot];
      if (p?.alive) botTurn(civGame, p);
      if (!botQueue.length) markAll(game);
    }
    if (onlyWatched(game)) {
      // Only watched (its people all fallen): the bots play on, a turn every few seconds.
      if (!botQueue.length && game.clock.now - civGame.turnStarted >= WATCHED_TURN) nextTurn(game);
    } else {
      // With nobody playing here, the turn's clock stands still (the bots don't play the game out alone).
      if (!anyonePlaying(game)) civGame.turnStarted += dt;
      // (Each screen counts the clock down itself from the time left it was last told.)
      const timer = timerLeft(game);
      const timeUp = timer !== null && timer <= 0 && !botQueue.length;
      // (A side at war done with its segment, or out of time: the next side's begins, on a clock of its own.)
      if (handOn(game, timeUp && !sequenceDone(civGame))) return void sendViews(game);
      if (everyoneReady(game) || (timeUp && sequenceDone(civGame))) nextTurn(game);
    }
    sendViews(game);
  },
});
