import type { GameContext, Player, Vec3 } from '@platform';
import { biomeAt, groundAt, SPAWNS } from '../island/index';
import type { BiomeId } from '../species';
import type { Meal } from './data';
import { STAMINA, type StaminaState } from './def';
import { addItems, applyArmour, container, containerIfOpen, dropContainer, everything, protection, refsOf, saveContainer, slotAt, strip, weigh } from './pack';
import { save, survivorOf, theGame, touch, type Slot, type Survivor } from './state';
import { deed } from './goals';

/**
 * A survivor's body: hunger and thirst that run down, the weather on their skin, what eating and
 * drinking do, and what happens when it all goes wrong (a lost pack where they fell, and waking
 * at their bed or on a beach).
 */

/** Hunger and thirst lost a second at rest: a full belly lasts about half an hour, a full skin of water twenty minutes. */
const HUNGER_RATE = 100 / (30 * 60);
const THIRST_RATE = 100 / (20 * 60);

/** Seconds between a point of harm from starving, thirst, cold or heat (each on its own). */
const HARM_EVERY = 4;

/** Breath a swing takes, and how long after it before breath starts coming back. */
const SWING_COST = 2;
const SWING_REST = 0.3;

/** Seconds dead before waking. */
const WAKE_AFTER = 4;

/** A lost pack lies this long (milliseconds of real time) before the island takes it. */
const PACK_LASTS = 30 * 60 * 1000;

// -----------------------------------------------------------------------------------------------
// Weather
// -----------------------------------------------------------------------------------------------

/** How a biome feels at noon and at midnight: below 0 cold, above 0 hot, on the scale exposure is kept in. */
const CLIMATE: Partial<Record<BiomeId, [day: number, night: number]>> = {
  snow: [-50, -90],
  mountain: [-28, -68],
  badlands: [60, -12],
  volcano: [80, 55],
  jungle: [14, 4],
  swamp: [12, 0],
};

/** The exposure a survivor is heading for where they stand, wearing what they wear. */
function ambient(game: GameContext, player: Player, s: Survivor, wet: boolean): number {
  const p = player.position;
  const [day, night] = CLIMATE[biomeAt(p.x, p.z)] ?? [0, -8];
  const dark = (Math.cos(game.env.time * Math.PI * 2) + 1) / 2;
  let a = day + (night - day) * dark;
  // Water takes the heat out of anyone, welcome or not.
  if (wet) a -= 18;
  if (s.warm && a < 5) a = Math.min(5, a + 75);
  const worn = protection(s);
  if (a < 0) a = Math.min(0, a + Math.max(0, worn.cold));
  else if (a > 0) a = Math.max(0, a - worn.heat);
  return Math.max(-100, Math.min(100, a));
}

export type TempState = 'ok' | 'cold' | 'freezing' | 'hot' | 'scorching';

export function tempState(temp: number): TempState {
  return temp <= -55 ? 'freezing' : temp <= -28 ? 'cold' : temp >= 55 ? 'scorching' : temp >= 28 ? 'hot' : 'ok';
}

/** Blocks that give warmth to anyone near (the building part's): by name, remembered by id. */
const WARM_BLOCKS = ['bt_campfire', 'bt_forge'];
const warmIds = new Map<number, boolean>();
const liquidIds = new Map<number, { liquid: boolean; solid: boolean }>();

function isWarm(game: GameContext, id: number): boolean {
  if (id <= 0) return false;
  let w = warmIds.get(id);
  if (w === undefined) {
    const name = game.world.blockName(id);
    w = WARM_BLOCKS.some((b) => name.startsWith(b));
    warmIds.set(id, w);
  }
  return w;
}

function blockKind(game: GameContext, id: number): { liquid: boolean; solid: boolean } {
  let k = liquidIds.get(id);
  if (!k) {
    const info = id > 0 ? game.world.blockInfo(id) : null;
    k = { liquid: !!info?.liquid, solid: !!info?.solid };
    liquidIds.set(id, k);
  }
  return k;
}

/** A fire within a few blocks (only looked for where it's cold: it's a few hundred blocks to read). */
function fireNear(game: GameContext, p: Vec3): boolean {
  const [x0, y0, z0] = [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)];
  for (let dy = -1; dy <= 2; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) if (isWarm(game, game.world.getBlock(x0 + dx, y0 + dy, z0 + dz))) return true;
    }
  }
  return false;
}

/** Standing or swimming in water. */
function inWater(game: GameContext, p: Vec3): boolean {
  return blockKind(game, game.world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.4), Math.floor(p.z))).liquid;
}

/** Water within reach of where they look (nothing solid, and no creature, in the way), or round their feet. */
function waterInReach(game: GameContext, player: Player): boolean {
  const eye = player.eye;
  const dir = player.look;
  // Wading, any press drinks, unless it's meant for a creature in front of them (E mounts and feeds too).
  if (inWater(game, player.position)) return !game.entities.raycast(eye, dir, 4.5, { margin: 0.3 });
  for (let d = 0.4; d <= 3.6; d += 0.3) {
    const k = blockKind(game, game.world.getBlock(Math.floor(eye.x + dir.x * d), Math.floor(eye.y + dir.y * d), Math.floor(eye.z + dir.z * d)));
    if (k.liquid) {
      const creature = game.entities.raycast(eye, dir, d);
      return !creature;
    }
    if (k.solid) return false;
  }
  return false;
}

// -----------------------------------------------------------------------------------------------
// Eating and drinking
// -----------------------------------------------------------------------------------------------

/** What a meal does to whoever finished it. True: one was used up. */
export function eat(player: Player, item: string, meal: Meal): boolean {
  const s = survivorOf(player);
  const game = theGame();
  if (meal.food) s.hunger = Math.min(100, s.hunger + meal.food);
  if (meal.water) s.thirst = Math.min(100, s.thirst + meal.water);
  if (meal.heal) player.heal(meal.heal);
  if (meal.mend) player.heal(meal.mend.amount, { over: meal.mend.over });
  if (meal.risk && game.rng.next() < meal.risk) {
    // A bad stomach: it costs more than it gave.
    player.damage(2);
    s.thirst = Math.max(0, s.thirst - 12);
    player.hud.toast('That did not sit well');
  }
  player.audio.play(meal.drink ? 'bt_drink' : 'bt_eat');
  if (meal.leaves) {
    // What's left takes the eaten one's place in the hand: the kit takes one away after this, so the
    // swap waits until it has.
    const slot = player.inventory.selected;
    const leaves = meal.leaves;
    game.clock.after(0, () => {
      if (!player.inventory.slots[slot]) player.inventory.set(slot, { item: leaves, count: 1 });
      else addItems(player, leaves, 1, true);
    });
  }
  touch(s);
  void item;
  return true;
}

/** Whether there's any point starting on one now. */
export function canEat(player: Player, meal: Meal): boolean {
  const s = survivorOf(player);
  if (meal.food && s.hunger < 99) return true;
  if (meal.water && s.thirst < 99) return true;
  if ((meal.heal || meal.mend) && player.health < player.maxHealth) return true;
  return false;
}

/** Drink from the water in reach, and fill every empty waterskin they carry. */
function drink(game: GameContext, player: Player, s: Survivor): void {
  s.thirst = Math.min(100, s.thirst + 30);
  deed(s, 'drank');
  let filled = 0;
  for (const kind of ['h', 'b'] as const) {
    for (const ref of refsOf(s, kind)) {
      if (slotAt(player, s, ref)?.item !== 'waterskin') continue;
      if (kind === 'h') player.inventory.set(ref.index, { item: 'waterskin_full', count: 1 });
      else s.bag[ref.index] = { item: 'waterskin_full', count: 1 };
      filled++;
    }
  }
  if (filled) {
    player.hud.toast(filled > 1 ? `Filled ${filled} waterskins` : 'Filled your waterskin');
    weigh(player, s);
  }
  player.audio.play('bt_drink');
  game.fx.burst({ x: player.eye.x + player.look.x * 0.6, y: player.eye.y - 0.35, z: player.eye.z + player.look.z * 0.6 }, { color: '#7fc4ff', count: 6, speed: 1.4, gravity: 12, size: 0.05, life: 0.5 });
  touch(s);
}

// -----------------------------------------------------------------------------------------------
// Every step
// -----------------------------------------------------------------------------------------------

/** One step of a living survivor's body. Returns true if E was used here (a drink, a lost pack opened). */
export function stepVitals(game: GameContext, player: Player, s: Survivor, dt: number, openPack: (id: string) => void): void {
  const st = player.abilities.stamina as StaminaState | undefined;
  const state = tempState(s.temp);

  // Hunger and thirst: faster out of breath, in the cold (hunger) and in the heat (thirst).
  const working = st && st.rest > 0 ? 1.5 : 1;
  s.hunger = Math.max(0, s.hunger - HUNGER_RATE * dt * working * (state === 'freezing' ? 1.7 : state === 'cold' ? 1.3 : 1));
  s.thirst = Math.max(0, s.thirst - THIRST_RATE * dt * working * (state === 'scorching' ? 2.2 : state === 'hot' ? 1.5 : 1));

  // Swings cost breath: one at the click, and one for every half second the button stays down.
  // Standing still to chop or dig, breath comes back between swings as fast as they spend it; on
  // the move in a fight it doesn't, and a long scrap leaves them winded.
  if (st && !s.ui.open) {
    if (player.input.buttonPressed(0)) s.swing = 0.5;
    else if (player.input.button(0)) s.swing += dt;
    else s.swing = 0;
    if (s.swing >= 0.5) {
      s.swing -= 0.5;
      st.s = Math.max(0, st.s - SWING_COST);
      st.rest = Math.max(st.rest, SWING_REST);
      if (st.s <= 0) st.winded = true;
    }
  }

  // E: a lost pack in reach first, else a drink (in the saddle, E is the mount's: it gets down).
  if (player.input.pressed('KeyE') && !player.vehicle) {
    const pack = packInReach(player, s);
    if (pack) {
      player.input.consume('KeyE');
      openPack(pack);
    } else if (waterInReach(game, player)) {
      player.input.consume('KeyE');
      drink(game, player, s);
    }
  }

  // Want and weather hurt, a point at a time.
  s.hurtIn -= dt;
  if (s.hurtIn <= 0) {
    s.hurtIn = HARM_EVERY;
    let harm = 0;
    if (s.hunger <= 0) harm++;
    if (s.thirst <= 0) harm++;
    if (state === 'freezing' || state === 'scorching') harm++;
    if (harm > 0) player.damage(harm, { knockback: 0, cause: 'world' });
    else if (s.hunger > 50 && s.thirst > 50 && player.health < player.maxHealth) {
      // Well fed and watered, wounds close slowly, at food's expense.
      player.heal(1);
      s.hunger = Math.max(0, s.hunger - 0.8);
    }
  }

  s.slowIn -= dt;
  if (s.slowIn > 0) return;
  s.slowIn = 1;
  slowStep(game, player, s, st);
}

/** Once a second: the weather, the fire, the weight of the belt, arrows to hand, and what's kept. */
function slowStep(game: GameContext, player: Player, s: Survivor, st: StaminaState | undefined): void {
  const p = player.position;
  const wet = inWater(game, p);
  const cold = (CLIMATE[biomeAt(p.x, p.z)] ?? [0, -8])[1] < -20 || s.temp < -10;
  s.warm = cold && fireNear(game, p);
  const target = ambient(game, player, s, wet);
  // Exposure creeps: about twenty seconds from comfortable to dangerous in the worst of it, and warming by a fire is quicker.
  const rate = s.warm || Math.abs(target) < Math.abs(s.temp) ? 6 : 4;
  s.temp += Math.max(-rate, Math.min(rate, target - s.temp));

  // Starving or parched, there's less breath to spend.
  if (st) {
    const want = Math.min(s.hunger, s.thirst);
    const cap = Math.round(STAMINA.max * (0.4 + 0.6 * Math.min(1, want / 25)));
    if (st.cap !== cap) st.cap = cap;
  }

  // The belt changes without the pack hearing of it (a pickup, an arrow shot, a meal): weigh it again.
  weigh(player, s);
  refillAmmo(game, player, s);
  s.dirty = true;
}

/** A bow in hand with no arrows on the belt takes a stack from the pack, if there's a free slot for it. */
function refillAmmo(game: GameContext, player: Player, s: Survivor): void {
  const held = player.inventory.held;
  const def = held ? (game.items.get(held.item) as { kind: string; ammo?: string } | undefined) : undefined;
  if (def?.kind !== 'bow' || !def.ammo || player.inventory.count(def.ammo) > 0) return;
  const from = s.bag.findIndex((x) => x?.item === def.ammo);
  const free = player.inventory.slots.findIndex((x) => !x);
  if (from < 0 || free < 0) return;
  player.inventory.set(free, s.bag[from]);
  s.bag[from] = null;
  touch(s);
}

// -----------------------------------------------------------------------------------------------
// Beds
// -----------------------------------------------------------------------------------------------

/** The bed block's name starts with this (the building part's). */
const BED_BLOCK = 'bt_bed';

/** Where a survivor wakes: their bed if it still stands, else a beach. */
function wakePlace(game: GameContext, player: Player, s: Survivor): { at: Vec3; name: string } {
  if (s.bed) {
    const id = game.world.getBlock(Math.floor(s.bed.x), Math.floor(s.bed.y), Math.floor(s.bed.z));
    // An unloaded column says nothing either way: trust the bed.
    if (id < 0 || game.world.blockName(id).startsWith(BED_BLOCK)) return { at: { x: Math.floor(s.bed.x) + 0.5, y: Math.floor(s.bed.y) + 1, z: Math.floor(s.bed.z) + 0.5 }, name: 'your bed' };
    s.bed = null;
    player.hud.toast('Your bed is gone');
  }
  const beach = SPAWNS[Math.floor(game.rng.next() * SPAWNS.length) % SPAWNS.length] ?? { x: game.world.spawn.x, z: game.world.spawn.z, name: 'the shore' };
  const loaded = game.world.surfaceY(Math.floor(beach.x), Math.floor(beach.z));
  const ground = loaded >= 0 ? loaded : Math.max(groundAt(beach.x, beach.z), game.world.seaLevel);
  return { at: { x: beach.x + 0.5, y: ground + 1.2, z: beach.z + 0.5 }, name: beach.name };
}

// -----------------------------------------------------------------------------------------------
// Dying, and the pack left behind
// -----------------------------------------------------------------------------------------------

/** A lost pack as it's kept in `game.store` (`lostpack:<id>`); its contents are the container `pack-<id>`. */
interface LostPack {
  owner: string;
  name: string;
  x: number;
  y: number;
  z: number;
  /** When it fell (milliseconds, real time). */
  at: number;
}

const packs = new Map<string, LostPack & { pickup: { remove(): void; readonly alive?: boolean } | null }>();
const packKey = (id: string) => `lostpack:${id}`;
const boxOf = (id: string) => `pack-${id}`;
const PACK_SLOTS = 54;

/** Who a pack belongs to: their account, or for a guest their visit. */
const ownerOf = (player: Player): string => player.account?.id ?? `guest:${player.id}`;

function showPack(game: GameContext, id: string, pack: LostPack): void {
  const pickup = game.items.spawnPickup('lost_pack', { x: pack.x, y: pack.y + 0.5, z: pack.z }, { delay: 1e9, despawn: 1e9, beam: '#ffd36b' });
  packs.set(id, { ...pack, pickup });
}

function removePack(id: string): void {
  const game = theGame();
  const pack = packs.get(id);
  pack?.pickup?.remove();
  packs.delete(id);
  game.store.delete(packKey(id));
  dropContainer(boxOf(id));
  for (const player of game.players) {
    const s = survivorOf(player);
    if (s.cache !== id) continue;
    s.cache = null;
    player.hud.marker('bt-lost-pack', null);
    touch(s);
  }
}

/** Put the lost packs kept from before back in the world (at `start`), and drop the ones that have lain too long. */
export function restorePacks(game: GameContext): void {
  for (const pack of packs.values()) pack.pickup?.remove();
  packs.clear();
  for (const key of game.store.keys('lostpack:')) {
    const id = key.slice('lostpack:'.length);
    const pack = game.store.get<LostPack>(key);
    if (!pack || typeof pack.x !== 'number' || Date.now() - pack.at > PACK_LASTS) {
      game.store.delete(key);
      dropContainer(boxOf(id));
      continue;
    }
    showPack(game, id, pack);
  }
}

/** Once in a while: packs that have lain too long are gone. */
export function expirePacks(): void {
  for (const [id, pack] of packs) if (Date.now() - pack.at > PACK_LASTS) removePack(id);
}

/** Their own lost pack, if they stand by it. */
function packInReach(player: Player, s: Survivor): string | null {
  const pack = s.cache ? packs.get(s.cache) : undefined;
  if (!pack || pack.owner !== ownerOf(player)) return null;
  const p = player.position;
  return Math.hypot(pack.x - p.x, pack.y - p.y, pack.z - p.z) < 3.5 ? s.cache : null;
}

/** The container a lost pack's contents are in, for the pack screen's transfer view. */
export function packContainer(id: string) {
  const c = container(boxOf(id), PACK_SLOTS, 'Lost pack');
  c.onEmpty = () => removePack(id);
  return c;
}

/** Point a survivor at their lost pack, if it still lies somewhere. */
export function markPack(player: Player, s: Survivor): void {
  const pack = s.cache ? packs.get(s.cache) : undefined;
  if (!pack) {
    if (s.cache) {
      s.cache = null;
      touch(s);
    }
    player.hud.marker('bt-lost-pack', null);
    return;
  }
  player.hud.marker('bt-lost-pack', { x: pack.x, y: pack.y + 1, z: pack.z }, { label: 'Your lost pack', color: '#ffd36b', shape: 'diamond', edge: true });
}

/** They died: everything they carried and wore lies where they fell, and they wake soon. */
export function onDeath(game: GameContext, player: Player): void {
  const s = survivorOf(player);
  const stacks = everything(player, s);
  // An older pack is given up for the new one: only one lies waiting at a time.
  if (s.cache) removePack(s.cache);
  if (stacks.length > 0) {
    const id = `${Date.now().toString(36)}${Math.floor(game.rng.next() * 1296).toString(36)}`;
    const p = player.position;
    const pack: LostPack = { owner: ownerOf(player), name: player.name, x: p.x, y: Math.max(p.y, game.world.seaLevel), z: p.z, at: Date.now() };
    const c = packContainer(id);
    const slots: Slot[] = stacks.slice(0, PACK_SLOTS);
    c.slots = Array.from({ length: PACK_SLOTS }, (_, i) => slots[i] ?? null);
    saveContainer(c);
    game.store.set(packKey(id), pack);
    showPack(game, id, pack);
    s.cache = id;
  }
  strip(player, s);
  s.queue = [];
  s.wake = WAKE_AFTER;
  s.ui.sel = null;
  const place = s.bed ? 'your bed' : 'the shore';
  player.hud.banner('YOU DIED', stacks.length ? `Your pack lies where you fell. Waking at ${place}…` : `Waking at ${place}…`, { duration: WAKE_AFTER, color: '#ff6b5b' });
  save(player, s);
}

/** Count down to waking, then wake: alive, fed enough to get going, at their bed or a beach. */
export function stepDead(game: GameContext, player: Player, s: Survivor, dt: number): void {
  if (s.wake <= 0) s.wake = WAKE_AFTER;
  s.wake -= dt;
  if (s.wake > 0) return;
  s.wake = 0;
  const place = wakePlace(game, player, s);
  player.revive();
  player.teleport(place.at);
  player.protect(5);
  s.hunger = 60;
  s.thirst = 60;
  s.temp = 0;
  s.hurtIn = HARM_EVERY;
  const st = player.abilities.stamina as StaminaState | undefined;
  if (st) {
    st.s = STAMINA.max;
    st.winded = false;
  }
  applyArmour(player, s);
  weigh(player, s);
  markPack(player, s);
  player.hud.toast(`You wake at ${place.name}`);
  touch(s);
  save(player, s);
}

/** A container's contents, if it's a lost pack's and open: used by the screen to title it. */
export const lostPackOpen = (containerId: string): boolean => containerId.startsWith('pack-') && !!containerIfOpen(containerId);

/** Forget every lost pack here (a new game in the same process: tests). */
export function forgetPacks(): void {
  packs.clear();
  warmIds.clear();
  liquidIds.clear();
}
