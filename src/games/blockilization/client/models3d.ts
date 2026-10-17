import { HeldModels } from '@platform';
import type { Client, Node } from '@platform/client';
import { baseX, centreNear, HEX, HEX_W, SEA_Y, UNIT_SPOTS } from '../geometry';
import { SURFACE_BLOCKS } from '../improvements';
import { MODEL_IDS, MODEL_SIZE, type ModelId } from '../modelids';
import type { CityWire, UnitWire } from '../protocol';
import { line, neighbour } from '../rules/hex';
import { isGreatPerson, UNITS } from '../rules/units';
import { light } from './budget';
import { fightsDrawn, flinch, landed } from './combatfx';
import { cam, centreHere, homeShift, toScreen } from './camera';
import { handoverStaging, lingers, stageHandover } from './handover';
import { combatSpeed, marchSpeed } from './pace';
import { wonderPicture } from './icons';
import { MODEL_FILES } from './modelfiles';
import { tileY } from './overlay';
import { previewPath } from './path';
import { play, type Cue } from './sound';
import { me, store } from './store';
import { resetRises, riseWonders, startRise, watchWonders, type WonderShown } from './wonderrise';

/**
 * The world's own models, on this screen: each unit it can see as a little voxel squad (or rider,
 * engine, ship, plane) standing on its tile, marching tile by tile along its way as it moves
 * (stepping, trotting, rolling, sailing, flying an arc), striking and falling; each city it
 * knows of as a town of houses that grows with its people and changes with its owner's era (huts,
 * then stone, brick, tower blocks), a palace in a capital; barbarian camps and ruins. Drawn only
 * from this player's view, so the fog hides what it should. The models are items (`civm_<id>`,
 * `tools/models.mjs`), placed with `client.scene`. Round a world that wraps, each is placed at the
 * copy of its tile nearest the camera, and kept there as the camera goes (`rehome`).
 */

export const modelItem = (id: ModelId) => `civm_${id}`;
const isModel = (id: string): id is ModelId => (MODEL_IDS as readonly string[]).includes(id);

/** Each model's look, from its file: once, as the screen starts. */
export function defineModelLooks(client: Client) {
  for (const id of MODEL_IDS) client.items.look(modelItem(id), { icon: { gltf: MODEL_FILES[id] }, hold: { model: HeldModels.gltf(MODEL_FILES[id]) } });
}

// -------------------------------------------------------------------------------------------------
// Which model

const BY_TYPE: Partial<Record<string, ModelId>> = {
  settler: 'u_settler', worker: 'u_worker', work_boat: 'u_boat', caravan: 'u_caravan', cargo_ship: 'u_cargo', missionary: 'u_missionary', inquisitor: 'u_inquisitor', archaeologist: 'u_worker',
  great_prophet: 'u_prophet', great_general: 'u_general', great_admiral: 'u_sail',
  scout: 'u_scout', explorer: 'u_scout', warrior: 'u_warrior', jaguar: 'u_warrior', mohawk_warrior: 'u_warrior', archer: 'u_bow', bowman: 'u_bow', composite_bowman: 'u_bow',
  crossbowman: 'u_crossbow', chu_ko_nu: 'u_crossbow', spearman: 'u_spear', immortal: 'u_spear', pikeman: 'u_pike', landsknecht: 'u_pike', swordsman: 'u_sword', longswordsman: 'u_longsword',
  musketman: 'u_musket', musketeer: 'u_musket', rifleman: 'u_rifle', great_war_infantry: 'u_infantry', infantry: 'u_infantry', paratrooper: 'u_infantry', anti_tank_gun: 'u_infantry',
  bazooka: 'u_infantry', anti_aircraft_gun: 'u_infantry', mobile_sam: 'u_mech', mechanized_infantry: 'u_mech', xcom_squad: 'u_mech',
  horseman: 'u_horse', cossack: 'u_cavalry', cavalry: 'u_cavalry', lancer: 'u_cavalry', knight: 'u_knight', camel_archer: 'u_camel', war_elephant: 'u_elephant', chariot_archer: 'u_chariot', war_chariot: 'u_chariot',
  catapult: 'u_catapult', trebuchet: 'u_trebuchet', cannon: 'u_cannon', artillery: 'u_artillery', rocket_artillery: 'u_rocket', gatling_gun: 'u_gatling', machine_gun: 'u_gatling',
  landship: 'u_landship', tank: 'u_tank', modern_armor: 'u_armor', giant_death_robot: 'u_robot', helicopter_gunship: 'u_heli',
  triplane: 'u_triplane', great_war_bomber: 'u_oldbomber', fighter: 'u_fighter', jet_fighter: 'u_fighter', bomber: 'u_bomber', stealth_bomber: 'u_stealth', guided_missile: 'u_missile', nuclear_missile: 'u_nuke', atomic_bomb: 'u_nuke',
  trireme: 'u_galley', galleass: 'u_galley', turtle_ship: 'u_turtle', caravel: 'u_sail', frigate: 'u_sail', privateer: 'u_sail', ironclad: 'u_ironclad',
  destroyer: 'u_warship', battleship: 'u_warship', missile_cruiser: 'u_warship', submarine: 'u_sub', nuclear_submarine: 'u_sub', carrier: 'u_carrier',
};

export function unitModel(type: string): ModelId {
  const m = BY_TYPE[type];
  if (m) return m;
  if (isGreatPerson(type)) return 'u_great';
  const u = UNITS[type];
  if (u?.domain === 'sea') return 'u_sail';
  if (u?.domain === 'air') return 'u_fighter';
  return 'u_warrior';
}

/** A city's houses by its owner's era: what most of them are, and what's mixed in. */
function houseKinds(era: number): ModelId[] {
  if (era <= 0) return ['c_hut', 'c_hut', 'c_house'];
  if (era <= 2) return ['c_house', 'c_stone', 'c_house'];
  if (era <= 4) return ['c_brick', 'c_stone', 'c_brick', 'c_factory'];
  return ['c_block', 'c_brick', 'c_tower', 'c_block'];
}

// -------------------------------------------------------------------------------------------------
// The ground

const groundCache = new Map<number, number>();

/** The top of the ground (or the water) at a point: the first block down that's the land's surface (not a tree's, nor a crop, fence or hut standing on it). */
export function groundAt(client: Client, t: number, x: number, z: number): number {
  // (Round a world that wraps, the column where it's built: a copy's are only drawn.)
  const bx = store.grid ? baseX(store.grid, Math.floor(x)) : Math.floor(x);
  const bz = Math.floor(z);
  const key = bx * 4096 + bz;
  const hit = groundCache.get(key);
  if (hit !== undefined) return hit;
  for (let y = SEA_Y + 16; y >= SEA_Y - 1; y--) {
    const b = client.world.blockAt(bx, y, bz);
    if (!SURFACE_BLOCKS.has(b)) continue;
    const top = y + 1;
    groundCache.set(key, top);
    return top;
  }
  // Not loaded yet (or nothing there): roughly where the land is.
  return tileY(t) + 0.4;
}

// -------------------------------------------------------------------------------------------------
// Placing

/** Units stand this big (a voxel is 1/16 block at 1), and no wider across than this (blocks). */
const UNIT_SCALE = 3;
const UNIT_FIT = 5.4;

const scaleFor = (id: ModelId, base: number, fit: number) => {
  const s = MODEL_SIZE[id];
  const across = Math.max(s.hi[0] - s.lo[0], s.hi[2] - s.lo[2]) / 16;
  return Math.min(base, fit / Math.max(0.1, across));
};

type Vec3 = { x: number; y: number; z: number };

interface Shown {
  node: Node;
  model: ModelId;
  /** In a boat (a land unit embarked). */
  boat: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  seen: number;
  /** Its tile when last drawn, and its owner. */
  tile: number;
  owner: number;
  /** A strike under way: toward where, since when, and how (a melee lunge, or a shot's recoil). */
  strike?: { x: number; z: number; t: number; ranged: boolean };
  /**
   * A march: the points it walks through (blocks), how far along it is, how fast it goes (blocks a
   * second), when it sets off (another civ's, in the turn's hand-over, may wait for its civ's turn on
   * the screen) and whether it has.
   */
  march?: { pts: { x: number; z: number }[]; at: number; len: number; speed: number; start: number; begun: boolean };
  /** At work: whether this swing's blow has landed (its dust thrown up) and the swing is yet to come round again. */
  landed?: boolean;
  /** Hit: when the blow landed, and the way it came (a unit flinches back along it). */
  hit?: { t: number; dx: number; dz: number };
}

/** How a unit goes when it marches: on foot (stepping), mounted (a trot), rolling (wheels, tracks), sailing, flying. */
type Gait = 'foot' | 'mounted' | 'rolling' | 'sailing' | 'flying';

const MOUNTED = new Set<ModelId>(['u_horse', 'u_knight', 'u_cavalry', 'u_camel', 'u_elephant', 'u_chariot', 'u_general', 'u_caravan', 'u_settler']);
const ROLLING = new Set<ModelId>(['u_catapult', 'u_trebuchet', 'u_cannon', 'u_artillery', 'u_rocket', 'u_gatling', 'u_landship', 'u_tank', 'u_armor', 'u_robot']);

function gaitOf(u: UnitWire, model: ModelId, boat: boolean): Gait {
  const domain = UNITS[u.type]?.domain;
  if (domain === 'air') return 'flying';
  if (domain === 'sea' || boat) return 'sailing';
  return MOUNTED.has(model) ? 'mounted' : ROLLING.has(model) ? 'rolling' : 'foot';
}

/** What a march sounds like, by its gait. */
const MARCH_SOUND: Record<Gait, Cue> = { foot: 'step', mounted: 'hoof', rolling: 'roll', sailing: 'oar', flying: 'fly' };

/** A march's pace: seconds a tile, the most a march takes however far (a move never holds up play), and the most tiles walked (further, it's simply there). */
const MARCH_TILE = 0.3;
const MARCH_MOST = 1.1;
const MARCH_TILES = 10;
/** How fast a worker swings at its work (radians a second). */
const WORK_PACE = 4.5;
/** An aircraft's arc over its flight (blocks at its top). */
const FLIGHT = 6;

const units = new Map<number, Shown>();
/** Towns on show: the node, what it was built for, last seen, its far look's houses, whether it has that look on, and its middle. */
const cities = new Map<number, { node: Node; key: string; seen: number; detail: Node[]; far: boolean; at: Vec3; smoke: Smoke[]; puff: number; wonders: Map<string, WonderShown> }>();
const sites = new Map<string, { node: Node; seen: number }>();
/** Units gone that are seen to go (killed, or spent): sinking and shrinking away, since when. */
let dying: { node: Node; t: number; scale: number; y: number; topple: boolean }[] = [];
/** A fight as this screen has it (`store.fights`). */
type Fight = (typeof store.fights)[number];
/**
 * Fights already shown, and hits still to land (a blow's: when the lunge reaches its furthest): where,
 * when, how, the fight, its tile and where the blow comes from (the defender flinches away from it).
 */
const struck = new WeakSet<object>();
interface Hit {
  at: Vec3;
  t: number;
  heavy: boolean;
  sound: Cue | null;
  fight: Fight;
  tile: number;
  from: Vec3;
}
let hits: Hit[] = [];
/** Shots in the air: what flies (a model), from where to where over an arc so high, since when and for how long (and the hit it makes). */
let flights: { node: Node; pitch: Node; from: Vec3; to: Vec3; top: number; t: number; time: number; hit: Hit }[] = [];
let frame = 0;
/** Where units stand this frame (not those on the march), by tile: what else is drawn on a tile keeps clear of them. */
const standing = new Map<number, { x: number; z: number }[]>();

/** A unit's model in a holder, as big as units stand (for what else goes about the map like one: trade's caravans and ships). */
export const unitHolder = (client: Client, id: ModelId) => make(client, id, scaleFor(id, UNIT_SCALE, UNIT_FIT));

/** One model's mesh in a holder (null until its file is here). */
function make(client: Client, id: ModelId, scale: number): Node | null {
  const made = client.scene.item(modelItem(id));
  if (!made) return null;
  const holder = client.scene.node();
  made.node.scale.setScalar(scale);
  holder.add(made.node);
  return holder;
}

/** Each frame: the units, cities and sites this player sees, put (or moved) where they are. */
export function drawModels(client: Client, dt: number) {
  const v = store.view;
  const g = store.grid;
  frame++;
  if (!thrownReady) thrownReady = THROWN.every((id) => client.scene.item(modelItem(id)));
  if (!v || !g) {
    if (handoverStaging()) stageHandover([], client.time);
    clearAll(client);
    return;
  }
  rehome();
  watchWonders(v, client.time);
  // The bots' moves have just come: what's seen of others' marches waits for each civ's turn on the screen.
  const staging = handoverStaging();
  const staged: { s: Shown; owner: number }[] = [];
  // Units: one per tile on show (a civilian and a soldier together stand aside of each other).
  standing.clear();
  const byTile = new Map<number, UnitWire[]>();
  for (const u of v.units) {
    if (!store.known[u.tile]?.visible && u.owner !== me()) continue;
    const list = byTile.get(u.tile) ?? [];
    list.push(u);
    byTile.set(u.tile, list);
  }
  for (const [t, list] of byTile) {
    const nearest = centreHere(g, t);
    list.forEach((u, i) => {
      let s = units.get(u.id);
      // (One on show: its tile at the copy nearest where it stands, so a move over the seam goes the short way.)
      const c = s ? centreNear(g, t, s.x) : nearest;
      const two = list.length > 1;
      const spot = UNIT_SPOTS[two ? 1 + Math.min(i, 1) : 0];
      const tx = c.x + spot[0];
      const tz = c.z + spot[1];
      const model = unitModel(u.type);
      const boat = !!u.embarked && UNITS[u.type]?.domain !== 'sea';
      if (s && (s.model !== model || s.boat !== boat)) {
        // A new look (upgraded, embarked, landed): the new model where the old one was, marching on.
        const node = boat ? inBoat(client, model) : make(client, model, scaleFor(model, UNIT_SCALE, UNIT_FIT) * (two ? 0.75 : 1));
        if (!node) return;
        client.scene.remove(s.node);
        client.scene.add(node);
        Object.assign(s, { node, model, boat });
      }
      if (!s) {
        const node = boat ? inBoat(client, model) : make(client, model, scaleFor(model, UNIT_SCALE, UNIT_FIT) * (two ? 0.75 : 1));
        if (!node) return;
        client.scene.add(node);
        s = { node, model, boat, x: tx, y: 0, z: tz, yaw: owner_yaw(u.owner), seen: frame, tile: t, owner: u.owner };
        s.y = unitY(client, u, t, tx, tz);
        units.set(u.id, s);
      }
      s.seen = frame;
      // Moved: it marches there, tile by tile.
      if (s.tile !== t) {
        march(s, u, s.tile, t, tx, tz, client.time);
        if (staging && s.march && u.owner !== me()) staged.push({ s, owner: u.owner });
        s.tile = t;
      }
      const gait = gaitOf(u, model, boat);
      let lift = 0;
      let rock = 0;
      if (s.march && client.time >= s.march.start) {
        const m = s.march;
        if (!m.begun) {
          m.begun = true;
          play(MARCH_SOUND[gait], 0.8);
        }
        m.at = Math.min(m.len, m.at + m.speed * dt);
        const p = pointAlong(m.pts, m.at);
        if (Math.hypot(p.x - s.x, p.z - s.z) > 0.01) s.yaw = turnToward(s.yaw, Math.atan2(p.x - s.x, p.z - s.z), dt * 14);
        s.x = p.x;
        s.z = p.z;
        // Its gait: steps, a trot, a rumble; an aircraft's arc over the whole flight.
        const phase = m.at * (gait === 'mounted' ? 1.6 : 2.2) * Math.PI;
        if (gait === 'foot') lift = Math.abs(Math.sin(phase)) * 0.22;
        else if (gait === 'mounted') {
          lift = Math.abs(Math.sin(phase)) * 0.16;
          rock = Math.sin(phase * 2) * 0.07;
        } else if (gait === 'rolling') lift = Math.abs(Math.sin(phase * 2.5)) * 0.04;
        else if (gait === 'flying') lift = Math.sin((m.at / m.len) * Math.PI) * FLIGHT;
        if (m.at >= m.len) s.march = undefined;
      } else if (!s.march) {
        // Settle where it stands (another unit came onto its tile and it stepped aside, or a march's end).
        const dx = tx - s.x;
        const dz = tz - s.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.05) {
          const step = Math.min(d, dt * Math.max(6, d * 3));
          s.x += (dx / d) * step;
          s.z += (dz / d) * step;
          if (d > 0.5) s.yaw = turnToward(s.yaw, Math.atan2(dx, dz), dt * 8);
        }
      }
      if (!s.march) {
        const here = standing.get(t);
        if (here) here.push({ x: s.x, z: s.z });
        else standing.set(t, [{ x: s.x, z: s.z }]);
        // At work (building a farm, a road): bending to it, dust kicked up as each blow lands.
        if (u.work) {
          const swing = Math.sin(client.time * WORK_PACE + u.id);
          rock = Math.max(0, swing) * 0.24;
          if (swing > 0.9 && !s.landed && store.known[t]?.visible)
            client.fx.particles({ x: s.x + Math.sin(s.yaw) * 0.7, y: s.y + 0.2, z: s.z + Math.cos(s.yaw) * 0.7 }, [0.5, 0.42, 0.3], { count: 6, speed: 0.9, size: 0.14, gravity: 3, life: 0.5, spread: 0.3, up: 0.8, collide: false });
          s.landed = swing > 0.9;
        }
      }
      const gy = unitY(client, u, t, s.x, s.z);
      s.y += (gy - s.y) * Math.min(1, dt * 10);
      // A boat rocks on the water.
      const bob = gait === 'sailing' ? Math.sin(client.time * 1.7 + u.id) * 0.06 : 0;
      const [ox, oz] = strikeOffset(client, s);
      // Hit: flinching back from the blow (and leaning away from it).
      const back = s.hit ? flinch(client.time - s.hit.t) : 0;
      if (s.hit && !back && client.time - s.hit.t > 0.1) s.hit = undefined;
      s.node.position.set(s.x + ox + (s.hit?.dx ?? 0) * back, s.y + bob + lift, s.z + oz + (s.hit?.dz ?? 0) * back);
      rock -= back * 0.35;
      // (Off the screen, not drawn at all: nor in the shadows' pass, which reaches well past the screen.)
      s.node.visible = nearScreen(s, UNIT_REACH);
      s.node.rotation.set(bob * 0.6 + rock, s.yaw, 0);
    });
  }
  if (staging) {
    const starts = stageHandover(
      staged.map(({ s, owner }) => ({ owner, time: s.march!.speed > 0 ? s.march!.len / s.march!.speed : 0 })),
      client.time,
    );
    for (const { s, owner } of staged) s.march!.start = starts.get(owner) ?? client.time;
  }
  for (const [id, s] of units)
    if (s.seen !== frame) {
      // In a fight still to be shown (the bots' turn handed over): it stays for its blow, or its fall.
      if (lingers(id, s.tile, client.time) || blowComing(s.tile)) {
        const [ox, oz] = strikeOffset(client, s);
        s.node.position.set(s.x + ox, s.y, s.z + oz);
        continue;
      }
      client.scene.remove(s.node);
      units.delete(id);
      // Seen to go (one of ours, or one we killed, its tile in sight): it sinks away where it stood.
      const killed = store.fights.some((f) => ((f.killed && f.at === s.tile) || (f.died && f.attacker === id)) && client.time - f.t < 3);
      if ((s.owner === me() || killed) && store.known[s.tile]?.visible) {
        client.scene.add(s.node);
        s.node.visible = true;
        dying.push({ node: s.node, t: client.time, scale: s.node.scale.x, y: s.y, topple: killed && fightsDrawn() });
        client.fx.particles({ x: s.x, y: s.y + 0.6, z: s.z }, [0.55, 0.5, 0.42], { count: 18, speed: 1.6, size: 0.18, gravity: -1, life: 0.9, spread: 0.8, up: 0.8 });
      }
    }
  // Fights of ours just begun: the attacker strikes (a lunge, or a shot flying to its target), and the blows land.
  for (const f of store.fights) {
    if (struck.has(f) || f.attacker === undefined) continue;
    struck.add(f);
    // (No blow to land, its attacker not on the screen: what it did shows now.)
    if (!strike(client, f)) {
      const c = centreHere(g, f.at);
      landed(client, f, { x: c.x, y: tileY(f.at) + 0.8, z: c.z }, !!store.view?.cities.some((c) => c.tile === f.at));
    }
  }
  fly(client);
  hits = hits.filter((h) => {
    if (client.time < h.t) return true;
    land(client, h);
    return false;
  });
  dying = dying.filter((d) => {
    const k = (client.time - d.t) / 0.8;
    if (k >= 1) {
      client.scene.remove(d.node);
      return false;
    }
    // Killed: it topples over first, then sinks away.
    if (d.topple) d.node.rotation.x = -Math.min(1, k * 2.5) * (Math.PI / 2) * 0.9;
    const sink = d.topple ? Math.max(0, (k - 0.4) / 0.6) : k;
    d.node.scale.setScalar(d.scale * (1 - sink * sink));
    d.node.position.y = d.y - sink * 0.8;
    return true;
  });

  // Cities: a town, rebuilt when it grows, changes hands or its owner's era turns.
  // (On a phone, sooner.)
  const nearer = light() ? TOWN_LIGHT : 1;
  townsFar = townsFar ? cam.dist > TOWN_NEAR * nearer : cam.dist > TOWN_FAR * nearer;
  for (const city of v.cities) {
    if (!store.known[city.tile]) continue;
    const era = v.players[city.owner]?.era ?? 0;
    const key = `${city.owner}|${era}|${Math.min(TOWN_MAX, city.pop)}|${city.capital}|${city.religion ?? ''}|${city.razing ?? ''}|${city.wonders?.join(',') ?? ''}|${city.walls ?? 0}`;
    let shown = cities.get(city.id);
    if (shown && shown.key !== key) {
      client.scene.remove(shown.node);
      cities.delete(city.id);
      shown = undefined;
    }
    if (!shown) {
      const made = town(client, city, era);
      if (!made) continue;
      client.scene.add(made.node);
      const c = centreHere(g, city.tile);
      shown = { node: made.node, key, seen: frame, detail: made.detail, far: false, at: { x: c.x, y: tileY(city.tile), z: c.z }, smoke: made.smoke, puff: 0, wonders: made.wonders };
      cities.set(city.id, shown);
      // A wonder just finished rises out of the ground (`wonderrise.ts`).
      for (const w of made.wonders.keys()) startRise(city.id, w, client.time);
    }
    shown.seen = frame;
    shown.node.visible = nearScreen(shown.at, TOWN_REACH);
    // Smoke from its chimneys, where it's in sight and near enough to see.
    if (shown.node.visible && !townsFar && shown.smoke.length && client.time >= shown.puff && store.known[city.tile]?.visible) {
      shown.puff = client.time + SMOKE_EVERY * (light() ? 2 : 1) * (0.6 + Math.random() * 0.8);
      const f = shown.smoke[Math.floor(Math.random() * shown.smoke.length)];
      if (f.factory) client.fx.particles(f, [0.16, 0.16, 0.18], { count: 2, speed: 0.2, size: 0.8, gravity: -0.9, life: 3.5, spread: 0.15, up: 0.5, drag: 0.4, collide: false });
      else client.fx.particles(f, [0.3, 0.3, 0.32], { count: 2, speed: 0.12, size: 0.55, gravity: -0.7, life: 3, spread: 0.1, up: 0.4, drag: 0.4, collide: false });
    }
    // Far off, its far look: most of its houses and its walls' towers put away (many towns on the screen are many draws).
    if (shown.far !== townsFar) {
      shown.far = townsFar;
      for (const n of shown.detail) n.visible = !townsFar;
    }
  }
  for (const [id, s] of cities)
    if (s.seen !== frame) {
      client.scene.remove(s.node);
      cities.delete(id);
    }
  riseWonders(client, (id, w) => {
    const s = cities.get(id);
    const shown = s?.wonders.get(w);
    return s && shown ? { w: shown, town: s.node } : null;
  });

  // Barbarian camps and ancient ruins, where they're known.
  for (let t = 0; t < store.known.length; t++) {
    const k = store.known[t];
    if (!k) continue;
    const what: ModelId | null = k.ruin ? 'm_ruin' : k.camp ? 'm_camp' : null;
    if (!what) continue;
    const key = `${t}|${what}`;
    let s = sites.get(key);
    if (!s) {
      const c = centreHere(g, t);
      const node = make(client, what, 1.8);
      if (!node) continue;
      node.position.set(c.x, groundAt(client, t, c.x, c.z), c.z);
      node.rotation.set(0, (t % 4) * (Math.PI / 2), 0);
      client.scene.add(node);
      s = { node, seen: frame };
      sites.set(key, s);
    }
    s.seen = frame;
  }
  for (const [key, s] of sites)
    if (s.seen !== frame) {
      client.scene.remove(s.node);
      sites.delete(key);
    }
}

/**
 * A unit moved from one tile to another: it marches there through the tiles between (its own the
 * way this screen would route it, anyone else's the straight line; an aircraft flies straight), at
 * a pace that's quick however far. A march nobody would see (both ends off the screen) or too
 * long to watch is skipped: it's simply there.
 */
function march(s: Shown, u: UnitWire, from: number, to: number, tx: number, tz: number, now: number) {
  const g = store.grid!;
  const air = UNITS[u.type]?.domain === 'air';
  const own = u.owner === me() && !air ? previewPath({ ...u, tile: from }, to)?.tiles : undefined;
  const tiles = air ? [from, to] : own ? [from, ...own] : line(g, from, to);
  const seen = (t: number) => {
    const c = centreHere(g, t);
    const p = toScreen(c.x, tileY(t), c.z);
    return !!p && p.x > -60 && p.x < window.innerWidth + 60 && p.y > -60 && p.y < window.innerHeight + 60;
  };
  if (tiles.length < 2 || tiles.length > MARCH_TILES + 1 || (!seen(from) && !seen(to)) || !marchSpeed()) {
    s.march = undefined;
    s.x = tx;
    s.z = tz;
    return;
  }
  // (Each tile's middle at the copy nearest the one before: over the seam, the short way.)
  const pts = [{ x: s.x, z: s.z }];
  for (const t of tiles.slice(1, -1)) pts.push(centreNear(g, t, pts[pts.length - 1].x));
  pts.push({ x: tx, z: tz });
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  s.march = { pts, at: 0, len, speed: (len / Math.min(MARCH_MOST, MARCH_TILE * (tiles.length - 1))) * marchSpeed(), start: now, begun: false };
}

/** Where the units on a tile stand this frame (none on the march), if any. */
export const standingOn = (tile: number) => standing.get(tile);

/** Where a unit on the march (or waiting to set off) stands now, for its flag; null if it's where its tile says. */
export function marchingAt(id: number): Vec3 | null {
  const s = units.get(id);
  return s?.march ? { x: s.x, y: s.y, z: s.z } : null;
}

/** The point `at` blocks along a line through points. */
function pointAlong(pts: { x: number; z: number }[], at: number): { x: number; z: number } {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (at <= l || i === pts.length - 1) {
      const k = l > 0 ? Math.min(1, at / l) : 1;
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
    }
    at -= l;
  }
  return pts[pts.length - 1];
}

/** A land unit embarked: its squad (smaller) on the deck of a boat. */
function inBoat(client: Client, model: ModelId): Node | null {
  const boat = make(client, 'u_transport', scaleFor('u_transport', UNIT_SCALE, UNIT_FIT));
  const crew = make(client, model, scaleFor(model, UNIT_SCALE, UNIT_FIT) * 0.6);
  if (!boat || !crew) return null;
  // (On the deck: 3 voxels up the boat.)
  crew.position.set(0, (3 / 16) * scaleFor('u_transport', UNIT_SCALE, UNIT_FIT), 0.3);
  boat.add(crew);
  return boat;
}

/** Seconds a strike takes: the lunge out and back, or the shot's recoil (quick combat: less). */
const STRIKE_TIME = 0.5;
const strikeTime = () => STRIKE_TIME / Math.max(1, combatSpeed());

/**
 * A fight: its attacker turns to its target and strikes (a city's or a ranged unit's shot flies to
 * it), and the blow lands later. False if there's nothing on the screen to strike with.
 */
function strike(client: Client, f: Fight): boolean {
  const attacker = f.attacker!;
  const at = f.at;
  const g = store.grid!;
  // (Its target at the copy nearest the attacker: below, once it's known.)
  let target = centreHere(g, at);
  const ty = tileY(at) + 0.8;
  let from: Vec3;
  let ranged = true;
  let heavy = false;
  /** What it throws: arrows, a boulder (a catapult's, a trebuchet's), a shell (guns'). */
  let shot: ModelId = 'p_arrows';
  if (attacker >= 0) {
    const s = units.get(attacker);
    const u = store.view?.units.find((x) => x.id === attacker);
    if (!s) return false;
    target = centreNear(g, at, s.x);
    const type = UNITS[u?.type ?? ''];
    ranged = !!type?.range && (type.ranged ?? 0) > 0;
    heavy = type?.class === 'siege' || type?.class === 'naval_ranged' || type?.class === 'armor' || type?.class === 'bomber';
    if (heavy) shot = s.model === 'u_catapult' || s.model === 'u_trebuchet' ? 'p_stone' : 'p_shell';
    s.strike = { x: target.x, z: target.z, t: client.time, ranged };
    s.yaw = Math.atan2(target.x - s.x, target.z - s.z);
    from = { x: s.x, y: s.y + 1.4, z: s.z };
  } else {
    const city = store.view?.cities.find((c) => c.id === -attacker);
    if (!city) return false;
    const c = centreNear(g, city.tile, target.x);
    from = { x: c.x, y: tileY(city.tile) + 3, z: c.z };
    // (A city's archers, until it has guns.)
    if ((store.view?.players[city.owner]?.era ?? 0) >= 3) {
      heavy = true;
      shot = 'p_shell';
    }
  }
  // A city's walls crack where they're hit; a blade rings on a unit; a shell or a stone blasts where it lands.
  const city = store.view?.cities.some((c) => c.tile === at);
  const hit = (t: number, heavy: boolean, sound: Cue | null): Hit => ({ at: { x: target.x, y: ty, z: target.z }, t, heavy, sound, fight: f, tile: at, from });
  // (Quick combat off altogether: no lunge, no volley; the blow lands now.)
  if (!combatSpeed()) {
    if (attacker >= 0) units.get(attacker)!.strike = undefined;
    hits.push(hit(client.time, heavy, city ? 'cityhit' : ranged ? (heavy ? 'blast' : null) : 'clash'));
    return true;
  }
  if (!ranged) {
    // The blow lands as the lunge reaches its furthest.
    hits.push(hit(client.time + strikeTime() * 0.45, false, city ? 'cityhit' : 'clash'));
    return true;
  }
  play(heavy ? 'boom' : 'volley');
  if (heavy) client.fx.flare(from, 1.2);
  // A volley of arrows (or a boulder, or a shell) arcs over the land to the target (if its model's
  // file is still coming, it lands all the same).
  const to = { x: target.x, y: ty, z: target.z };
  const len = Math.hypot(to.x - from.x, to.z - from.z);
  const time = Math.max(0.35, len / (heavy ? 22 : 26) + 0.15) / combatSpeed();
  const sound = city ? 'cityhit' : heavy ? 'blast' : null;
  const model = make(client, shot, 3);
  if (!model) {
    hits.push(hit(client.time + time, heavy, sound));
    return true;
  }
  const holder = client.scene.node();
  holder.add(model);
  client.scene.add(holder);
  flights.push({ node: holder, pitch: model, from, to, top: (heavy ? 5 : 3.5) + len * 0.15, t: client.time, time, hit: hit(client.time + time, heavy, sound) });
  return true;
}

/**
 * A blow landing: its sound, sparks or a blast where it lands, the defender flinching back from it,
 * and what the fight does there (`combatfx.ts`: its figures, a flash, a city's stones, a kill).
 */
function land(client: Client, h: Hit) {
  if (h.sound) play(h.sound);
  if (h.heavy) client.fx.explosion(h.at, { size: 0.9 });
  else client.fx.particles(h.at, [0.9, 0.8, 0.6], { count: 14, speed: 2.4, size: 0.12, gravity: 4, life: 0.5, spread: 0.4, up: 1.2 });
  const city = !!store.view?.cities.some((c) => c.tile === h.tile);
  landed(client, h.fight, h.at, city);
  if (h.fight.killed) play('fell');
  // The unit there that took it (not the attacker's own).
  const by = h.fight.attacker !== undefined && h.fight.attacker >= 0 ? units.get(h.fight.attacker)?.owner : undefined;
  for (const s of units.values()) {
    if (s.tile !== h.tile || s.owner === by) continue;
    const dx = s.x - h.from.x;
    const dz = s.z - h.from.z;
    const d = Math.hypot(dx, dz) || 1;
    s.hit = { t: client.time, dx: dx / d, dz: dz / d };
  }
}

/** Whether a blow that kills is still to land on a tile (its defender stands till it does). */
const blowComing = (tile: number) => hits.some((h) => h.tile === tile && h.fight.killed) || flights.some((f) => f.hit.tile === tile && f.hit.fight.killed);

/** What's thrown in fights: asked for from the start, so their files are here by the first shot. */
const THROWN: ModelId[] = ['p_arrows', 'p_stone', 'p_shell'];
let thrownReady = false;

/** Each frame: the shots in the air fly on along their arcs (turned the way they're going), and land. */
function fly(client: Client) {
  flights = flights.filter((f) => {
    const k = Math.min(1, (client.time - f.t) / f.time);
    const at = (q: number) => ({ x: f.from.x + (f.to.x - f.from.x) * q, y: f.from.y + (f.to.y - f.from.y) * q + f.top * 4 * q * (1 - q), z: f.from.z + (f.to.z - f.from.z) * q });
    const p = at(k);
    const ahead = at(Math.min(1, k + 0.02));
    const behind = at(Math.max(0, k - 0.02));
    f.node.position.set(p.x, p.y, p.z);
    f.node.rotation.set(0, Math.atan2(ahead.x - behind.x, ahead.z - behind.z), 0);
    f.pitch.rotation.set(-Math.atan2(ahead.y - behind.y, Math.hypot(ahead.x - behind.x, ahead.z - behind.z)), 0, 0);
    if (f.hit.heavy && Math.random() < 0.5) client.fx.particles(p, [0.5, 0.48, 0.45], { count: 1, speed: 0.2, size: 0.25, gravity: -0.5, life: 0.6 });
    if (k < 1) return true;
    client.scene.remove(f.node);
    hits.push({ ...f.hit, t: client.time });
    return false;
  });
}

/** How far a striking unit is from where it stands: a lunge toward its target and back, or a shot's small kick back. */
function strikeOffset(client: Client, s: Shown): [number, number] {
  const k = s.strike ? (client.time - s.strike.t) / strikeTime() : 1;
  if (!s.strike || k >= 1) {
    s.strike = undefined;
    return [0, 0];
  }
  const dx = s.strike.x - s.x;
  const dz = s.strike.z - s.z;
  const d = Math.hypot(dx, dz) || 1;
  const reach = s.strike.ranged ? -0.35 * Math.sin(Math.min(1, k * 3) * Math.PI) : Math.min(2.2, d * 0.45) * Math.sin(k * Math.PI);
  return [(dx / d) * reach, (dz / d) * reach];
}

/** Where a unit stands: on the ground, a ship on the water, an embarked one too. */
function unitY(client: Client, u: UnitWire, t: number, x: number, z: number): number {
  const sea = UNITS[u.type]?.domain === 'sea' || u.embarked;
  if (sea) return SEA_Y + 0.75;
  return groundAt(client, t, x, z);
}

/** New units face the map's middle, a little different for each civ. */
const owner_yaw = (owner: number) => Math.PI + (owner % 4) * 0.4 - 0.6;

function turnToward(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, k);
}

/** How far the camera is when towns put on their far look, and take it off again (apart, so they don't flicker); and the houses a town keeps in its far look. */
const TOWN_FAR = 70;
/** On a phone, towns put on their far look this much nearer. */
const TOWN_LIGHT = 0.65;
/** How far a town (with its districts and wonders round it) and a unit reach from their middles (blocks), for whether they're near the screen. */
const TOWN_REACH = 14;
const UNIT_REACH = 4;

/**
 * Whether a point is near enough the screen for what stands there to be drawn: a margin of about
 * `reach` blocks round it (its size and its shadow), in pixels at the camera's distance.
 */
function nearScreen(p: Vec3, reach: number): boolean {
  const s = toScreen(p.x, p.y, p.z);
  const margin = 40 + (reach * 1.2 * window.innerHeight) / cam.dist;
  return !!s && s.x > -margin && s.x < window.innerWidth + margin && s.y > -margin && s.y < window.innerHeight + margin;
}
const TOWN_NEAR = 62;
const FAR_HOUSES = 3;
/** Towns are showing their far look. */
let townsFar = false;

/** People in a city past which its town grows no more. */
const TOWN_MAX = 19;
/** A town's houses stand this big, and its wonders this big and no wider than this (blocks). */
const TOWN_SCALE = 2.6;

/** Where a house's smoke comes from (voxels, in its model): a hut's smoke hole, a house's roof, a chimney, a factory's stack. */
const FLUES: Partial<Record<ModelId, [number, number, number]>> = { c_hut: [0, 12, 0], c_house: [0, 12, 0], c_stone: [0, 14, 0], c_brick: [3, 23, -1], c_factory: [4.5, 25, -1.5] };
/** A town's smoke: a few of its flues, a puff from one of them every so often (seconds, give or take). */
interface Smoke {
  x: number;
  y: number;
  z: number;
  factory: boolean;
}
const SMOKE_MOST = 4;
const SMOKE_EVERY = 0.6;
const WONDER_SCALE = 2.6;
const WONDER_FIT = 4.8;
/** The neighbours a city spreads onto (wonders first, then districts of houses), the ones behind it first: north-west, north-east, west, east, south-west, south-east. */
const SPREAD = [2, 1, 3, 0, 4, 5];

/**
 * A city's town. On its own tile: a palace in a capital (a keep in a big city) and houses round it,
 * more as it grows, of its owner's era (huts, then stone, brick, tower blocks), a temple if it has a
 * faith, walls round it if it has them (a castle's higher, an arsenal's of concrete). Beside it, on
 * the land round it (the tiles behind it first): each world wonder built in it, and once its own
 * tile is full, districts of more houses. Its detail (the houses past the first few, the walls'
 * towers) is listed apart: put away in its far look.
 */
function town(client: Client, city: CityWire, era: number): { node: Node; detail: Node[]; smoke: Smoke[]; wonders: Map<string, WonderShown> } | null {
  const g = store.grid!;
  const c = centreHere(g, city.tile);
  const group = client.scene.node();
  const kinds = houseKinds(era);
  const rand = (i: number) => {
    const h = Math.imul(city.id * 7919 + i * 104729, 2654435761) >>> 0;
    return h / 4294967296;
  };
  const detail: Node[] = [];
  let last: Node | null = null;
  const put = (id: ModelId, t: number, x: number, z: number, scale: number, yaw: number, isDetail = false) => {
    const n = make(client, id, scale);
    if (!n) return false;
    n.position.set(x, groundAt(client, t, x, z), z);
    n.rotation.set(0, yaw, 0);
    group.add(n);
    if (isDetail) detail.push(n);
    last = n;
    return true;
  };
  const smoke: Smoke[] = [];
  const house = (i: number, t: number, x: number, z: number, size = 1) => {
    // A temple among the first, in a city with a religion; a factory in a big modern one.
    const id: ModelId = i === 1 && city.religion ? 'c_temple' : i === 2 && era >= 4 && city.pop >= 6 ? 'c_factory' : kinds[Math.floor(rand(i) * kinds.length)];
    const scale = (id === 'c_tower' ? 1.6 : id === 'c_block' ? 1.9 : TOWN_SCALE) * size;
    const [hx, hz, yaw] = [x + (rand(i + 50) - 0.5) * 0.3, z + (rand(i + 90) - 0.5) * 0.3, Math.floor(rand(i + 7) * 4) * (Math.PI / 2)];
    if (!put(id, t, hx, hz, scale, yaw, i >= FAR_HOUSES)) return false;
    // Its chimney (or smoke hole), if it has one: where the smoke comes from.
    const flue = FLUES[id];
    if (flue && smoke.length < SMOKE_MOST) {
      const [fx, fy, fz] = flue.map((v) => (v * scale) / 16);
      smoke.push({ x: hx + fx * Math.cos(yaw) + fz * Math.sin(yaw), y: groundAt(client, t, hx, hz) + fy, z: hz - fx * Math.sin(yaw) + fz * Math.cos(yaw), factory: id === 'c_factory' });
    }
    return true;
  };
  // The middle, then a ring of houses toward the hex's corners.
  const middle: ModelId | null = city.capital ? 'c_palace' : city.pop >= 6 ? 'c_keep' : null;
  if (middle && !put(middle, city.tile, c.x, c.z, middle === 'c_palace' ? 2.4 : 2.2, 0)) return null;
  const spots: [number, number][] = middle ? [] : [[0, 0]];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (-90 + 60 * i);
    spots.push([Math.cos(a) * 2.15, Math.sin(a) * 2.15]);
  }
  const houses = Math.min(TOWN_MAX, city.pop) + 1;
  let placed = 0;
  for (const [ox, oz] of spots) {
    if (placed >= houses) break;
    if (!house(placed, city.tile, c.x + ox, c.z + oz)) return null;
    placed++;
  }
  // Walls: a stretch along each edge of the hex, a tower at each corner.
  if (city.walls) {
    const level = Math.min(3, city.walls) as 1 | 2 | 3;
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      const x = c.x + Math.cos(a) * HEX_W * 0.48;
      const z = c.z + Math.sin(a) * HEX_W * 0.48;
      if (!put(`c_wall${level}`, city.tile, x, z, 2.8, -(a + Math.PI / 2))) return null;
      const b = a - Math.PI / 2;
      if (!put(`c_tower${level}`, city.tile, c.x + Math.cos(b) * HEX * 0.96, c.z + Math.sin(b) * HEX * 0.96, 2.8, 0, true)) return null;
    }
  }
  // Beside it: its wonders, then districts of the houses its own tile hasn't room for (four to a tile).
  const beside = SPREAD.map((d) => neighbour(g, city.tile, d)).filter((t) => {
    const s = store.terrain[t];
    return t >= 0 && s && !(s.terrain === 'ocean' || s.terrain === 'coast' || s.terrain === 'lake') && s.elevation !== 'mountain' && !store.view!.cities.some((x) => x.tile === t);
  });
  const wonders = new Map<string, WonderShown>();
  for (const w of city.wonders ?? []) {
    const id = wonderPicture(w);
    if (!id || !isModel(id)) continue;
    const t = beside.shift();
    if (t === undefined) break;
    const at = centreNear(g, t, c.x);
    const scale = scaleFor(id, WONDER_SCALE, WONDER_FIT);
    if (!put(id, t, at.x, at.z, scale, 0) || !last) return null;
    const s = MODEL_SIZE[id];
    const n: Node = last;
    wonders.set(w, { node: n, x: n.position.x, y: n.position.y, z: n.position.z, height: ((s.hi[1] - s.lo[1]) * scale) / 16, across: (Math.max(s.hi[0] - s.lo[0], s.hi[2] - s.lo[2]) * scale) / 16 });
  }
  for (const t of beside) {
    if (placed >= houses) break;
    const at = centreNear(g, t, c.x);
    for (let i = 0; i < 4 && placed < houses; i++) {
      const a = (Math.PI / 2) * i + Math.PI / 4;
      if (!house(placed, t, at.x + Math.cos(a) * 1.5, at.z + Math.sin(a) * 1.5, 0.9)) return null;
      placed++;
    }
  }
  return { node: group, detail, smoke, wonders };
}

/**
 * Round a world that wraps: everything on show kept at its copy nearest the camera (it pans without
 * end, and jumps back a whole period as it leaves the world as built), each moved as one piece, its
 * march, its strike, a shot's arc and its blow with it. Nothing moves on a flat world.
 */
function rehome() {
  if (!store.grid?.wrap) return;
  const moved = new Set<object>();
  const move = (p: { x: number }, k: number) => {
    if (moved.has(p)) return;
    moved.add(p);
    p.x += k;
  };
  for (const s of units.values()) {
    const k = homeShift(s.x);
    if (!k) continue;
    s.x += k;
    if (s.march) for (const p of s.march.pts) move(p, k);
    if (s.strike) s.strike.x += k;
  }
  // (A town's houses stand in its node, which is moved.)
  for (const c of cities.values()) {
    const k = homeShift(c.at.x);
    if (!k) continue;
    c.at.x += k;
    c.node.position.x += k;
    for (const f of c.smoke) f.x += k;
  }
  for (const s of sites.values()) s.node.position.x += homeShift(s.node.position.x);
  for (const d of dying) d.node.position.x += homeShift(d.node.position.x);
  for (const f of flights) {
    const k = homeShift(f.from.x);
    if (!k) continue;
    for (const p of [f.from, f.to, f.hit.at, f.hit.from]) move(p, k);
    f.node.position.x += k;
  }
  for (const h of hits) {
    const k = homeShift(h.at.x);
    if (k) for (const p of [h.at, h.from]) move(p, k);
  }
}

function clearAll(client: Client) {
  for (const s of units.values()) client.scene.remove(s.node);
  for (const d of dying) client.scene.remove(d.node);
  for (const f of flights) client.scene.remove(f.node);
  dying = [];
  hits = [];
  flights = [];
  for (const s of cities.values()) client.scene.remove(s.node);
  for (const s of sites.values()) client.scene.remove(s.node);
  units.clear();
  cities.clear();
  sites.clear();
  groundCache.clear();
  resetRises();
}

/** A new map: the old one's ground heights go. */
export function resetModels(client: Client) {
  clearAll(client);
}
