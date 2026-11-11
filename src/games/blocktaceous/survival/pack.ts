import type { Player } from '@platform';
import { ARMOUR, BAG_SLOTS, carryLimit, entryOf, HOTBAR_SLOTS, loadSpeed, nameOf, weightOf, WORN_SLOTS, type WornSlot } from './data';
import { survivorOf, theGame, touch, type Slot, type Stack, type Survivor } from './state';

/**
 * What a survivor carries: the platform's nine-slot hotbar (their belt: what's in hand comes from
 * it), a backpack of forty slots, and three worn pieces. Everything here works on both the belt
 * and the pack, by slot references: `h0`..`h8` the belt, `b0`..`b39` the pack, `w0`..`w2` what's
 * worn (head, body, feet), `c0`.. the open container.
 */

// -----------------------------------------------------------------------------------------------
// Stack sizes
// -----------------------------------------------------------------------------------------------

/** How many of an item fit in one slot of the pack or a container. */
export function stackLimit(item: string): number {
  const entry = entryOf(item);
  if (entry) return entry.stack;
  return theGame().items.get(item)?.stack ?? 64;
}

/** How many fit in one slot of the belt: the platform holds its own slots to the item's (or its kind's) stack size. */
function beltLimit(item: string): number {
  const game = theGame();
  const def = game.items.get(item);
  const platform = def?.stack ?? (def ? game.items.kind(def.kind)?.stack : undefined) ?? 64;
  return Math.min(stackLimit(item), platform);
}

/** Whether an item is something to hold (a tool, a weapon, food, a block to place): given, it goes to the belt before the pack. */
function handy(item: string): boolean {
  const def = theGame().items.get(item);
  if (!def) return false;
  return def.kind !== 'misc' || (typeof def.icon === 'object' && 'block' in def.icon);
}

// -----------------------------------------------------------------------------------------------
// Containers
// -----------------------------------------------------------------------------------------------

/** A container that's been opened since the server started: its slots, and what the screens call it. */
export interface Container {
  id: string;
  slots: Slot[];
  title: string;
  /** Emptied, it's gone (a lost pack): the hook that removes it from the world. */
  onEmpty?: () => void;
}

const containers = new Map<string, Container>();
const boxKey = (id: string) => `box:${id}`;

/** A container by id, loaded from `game.store` (`box:<id>`) the first time, made empty with `size` slots if it's new. */
export function container(id: string, size: number, title = 'Storage'): Container {
  let c = containers.get(id);
  if (!c) {
    const kept = theGame().store.get<([string, number] | 0)[]>(boxKey(id));
    const slots: Slot[] = Array.from({ length: size }, () => null);
    if (Array.isArray(kept)) {
      kept.forEach((s, i) => {
        if (!Array.isArray(s) || typeof s[0] !== 'string' || !(s[1] > 0)) return;
        // Kept in a bigger box than this one: nothing is lost, the slots just run on.
        while (i >= slots.length) slots.push(null);
        slots[i] = { item: s[0], count: s[1] };
      });
    }
    c = { id, slots, title };
    containers.set(id, c);
  }
  c.title = title;
  return c;
}

export const containerIfOpen = (id: string): Container | undefined => containers.get(id);

/** Keep a container's slots (after every change to them). */
export function saveContainer(c: Container): void {
  const game = theGame();
  if (c.slots.every((s) => !s)) game.store.delete(boxKey(c.id));
  else game.store.set(boxKey(c.id), c.slots.map((s) => (s ? [s.item, s.count] : 0)));
}

/** Forget a container and what it held. */
export function dropContainer(id: string): void {
  containers.delete(id);
  theGame().store.delete(boxKey(id));
}

/** Forget every open container without keeping anything (a new game in the same process: tests). */
export function forgetContainers(): void {
  containers.clear();
}

// -----------------------------------------------------------------------------------------------
// Slots by reference
// -----------------------------------------------------------------------------------------------

export interface SlotRef {
  kind: 'h' | 'b' | 'w' | 'c';
  index: number;
}

export function parseRef(ref: string, s: Survivor): SlotRef | null {
  const kind = ref[0];
  const index = Number(ref.slice(1));
  if (!Number.isInteger(index) || index < 0) return null;
  if (kind === 'h' && index < HOTBAR_SLOTS) return { kind, index };
  if (kind === 'b' && index < BAG_SLOTS) return { kind, index };
  if (kind === 'w' && index < WORN_SLOTS.length) return { kind, index };
  if (kind === 'c') {
    const c = s.ui.container ? containers.get(s.ui.container) : undefined;
    if (c && index < c.slots.length) return { kind, index };
  }
  return null;
}

export function slotAt(player: Player, s: Survivor, ref: SlotRef): Slot {
  if (ref.kind === 'h') {
    const x = player.inventory.slots[ref.index];
    return x ? { item: x.item, count: x.count } : null;
  }
  if (ref.kind === 'b') return s.bag[ref.index];
  if (ref.kind === 'w') {
    const item = s.worn[WORN_SLOTS[ref.index]];
    return item ? { item, count: 1 } : null;
  }
  return containers.get(s.ui.container!)?.slots[ref.index] ?? null;
}

function putAt(player: Player, s: Survivor, ref: SlotRef, stack: Slot): void {
  const clean = stack && stack.count > 0 ? { item: stack.item, count: stack.count } : null;
  if (ref.kind === 'h') player.inventory.set(ref.index, clean);
  else if (ref.kind === 'b') s.bag[ref.index] = clean;
  else if (ref.kind === 'w') s.worn[WORN_SLOTS[ref.index]] = clean?.item ?? null;
  else {
    const c = containers.get(s.ui.container!);
    if (c) c.slots[ref.index] = clean;
  }
}

/** How many of `item` a slot can hold in all (0: it can't go there). */
function roomAt(ref: SlotRef, item: string): number {
  if (ref.kind === 'w') return ARMOUR[item]?.slot === WORN_SLOTS[ref.index] ? 1 : 0;
  // A lost pack is a thing in the world, never something to carry.
  if (item === 'lost_pack') return 0;
  return ref.kind === 'h' ? beltLimit(item) : stackLimit(item);
}

/** After a change to what's carried or stored: weigh it again, keep it, redraw. */
function changed(player: Player, s: Survivor, refs: SlotRef[]): void {
  if (refs.some((r) => r.kind === 'c')) {
    const c = containers.get(s.ui.container!);
    if (c) {
      saveContainer(c);
      if (c.onEmpty && c.slots.every((x) => !x)) c.onEmpty();
    }
  }
  if (refs.some((r) => r.kind === 'w')) applyArmour(player, s);
  weigh(player, s);
  touch(s);
}

/**
 * Move what's in one slot to another: onto an empty slot or a stack of the same thing (as much as
 * fits), else the two swap, if each can go where the other was. `amount` moves only that many.
 * False if nothing moved.
 */
export function moveSlot(player: Player, s: Survivor, fromRef: SlotRef, toRef: SlotRef, amount?: number): boolean {
  if (fromRef.kind === toRef.kind && fromRef.index === toRef.index) return false;
  const from = slotAt(player, s, fromRef);
  if (!from) return false;
  const to = slotAt(player, s, toRef);
  const want = Math.min(from.count, amount ?? from.count);
  if (!to || to.item === from.item) {
    const room = roomAt(toRef, from.item) - (to?.count ?? 0);
    const n = Math.min(want, room);
    if (n <= 0) return false;
    putAt(player, s, toRef, { item: from.item, count: (to?.count ?? 0) + n });
    putAt(player, s, fromRef, from.count > n ? { item: from.item, count: from.count - n } : null);
  } else {
    // A swap: all of each, and only if each fits whole where the other was.
    if (want < from.count || roomAt(toRef, from.item) < from.count || roomAt(fromRef, to.item) < to.count) return false;
    putAt(player, s, toRef, from);
    putAt(player, s, fromRef, to);
  }
  changed(player, s, [fromRef, toRef]);
  return true;
}

/** The slots of one place, in order. */
export function refsOf(s: Survivor, kind: SlotRef['kind']): SlotRef[] {
  const n = kind === 'h' ? HOTBAR_SLOTS : kind === 'b' ? BAG_SLOTS : kind === 'w' ? WORN_SLOTS.length : (containers.get(s.ui.container ?? '')?.slots.length ?? 0);
  return Array.from({ length: n }, (_, index) => ({ kind, index }));
}

/**
 * Put a slot's stack wherever it fits among `places`, in order: stacks of the same thing first,
 * then empty slots. Returns how many moved.
 */
export function stow(player: Player, s: Survivor, fromRef: SlotRef, places: SlotRef['kind'][], amount?: number): number {
  const from = slotAt(player, s, fromRef);
  if (!from) return 0;
  let left = Math.min(from.count, amount ?? from.count);
  const start = left;
  const targets = places.flatMap((k) => refsOf(s, k)).filter((r) => !(r.kind === fromRef.kind && r.index === fromRef.index));
  for (const pass of ['same', 'empty'] as const) {
    for (const r of targets) {
      if (left <= 0) break;
      const there = slotAt(player, s, r);
      if (pass === 'same' ? there?.item !== from.item : there !== null) continue;
      const n = Math.min(left, roomAt(r, from.item) - (there?.count ?? 0));
      if (n <= 0) continue;
      putAt(player, s, r, { item: from.item, count: (there?.count ?? 0) + n });
      left -= n;
    }
  }
  const moved = start - left;
  if (moved > 0) {
    putAt(player, s, fromRef, from.count > moved ? { item: from.item, count: from.count - moved } : null);
    changed(player, s, [fromRef, ...places.map((kind) => ({ kind, index: 0 }))]);
  }
  return moved;
}

/** Drop some of a slot's stack on the ground in front of them. */
export function dropSlot(player: Player, s: Survivor, ref: SlotRef, amount?: number): boolean {
  const from = slotAt(player, s, ref);
  if (!from) return false;
  const n = Math.min(from.count, amount ?? from.count);
  putAt(player, s, ref, from.count > n ? { item: from.item, count: from.count - n } : null);
  spill(player, from.item, n, true);
  changed(player, s, [ref]);
  return true;
}

/** Items onto the ground by a survivor: tossed ahead of them (a drop), or at their feet (what didn't fit). */
export function spill(player: Player, item: string, count: number, tossed = false): void {
  const game = theGame();
  if (!game.items.get(item)) return;
  const eye = player.eye;
  const look = player.look;
  let left = count;
  // The platform's pickups hold one belt slot's worth each.
  const per = Math.max(1, beltLimit(item));
  for (let piles = 0; left > 0 && piles < 12; piles++) {
    const n = Math.min(left, per);
    left -= n;
    game.items.spawnPickup(item, tossed ? { x: eye.x + look.x * 0.5, y: eye.y - 0.3, z: eye.z + look.z * 0.5 } : { x: player.position.x, y: player.position.y + 0.6, z: player.position.z }, {
      count: n,
      velocity: tossed ? { x: look.x * 5, y: 2.5 + look.y * 3, z: look.z * 5 } : { x: 0, y: 2, z: 0 },
      delay: 1,
      from: player,
      despawn: 600,
    });
  }
}

// -----------------------------------------------------------------------------------------------
// Giving, taking, counting
// -----------------------------------------------------------------------------------------------

/** How many more of `item` they could take, belt and pack together. */
export function roomFor(player: Player, item: string): number {
  const s = survivorOf(player);
  let room = 0;
  for (const kind of ['h', 'b'] as const) {
    for (const r of refsOf(s, kind)) {
      const there = slotAt(player, s, r);
      if (!there) room += roomAt(r, item);
      else if (there.item === item) room += Math.max(0, roomAt(r, item) - there.count);
    }
  }
  return room;
}

/**
 * Put items in a survivor's inventory: onto stacks they already have first (belt, then pack), then
 * into empty slots (the belt first for something to hold, the pack first for materials). Returns
 * how many they kept; `spillRest` drops what didn't fit at their feet.
 */
export function addItems(player: Player, item: string, count: number, spillRest: boolean): number {
  if (!(count > 0)) return 0;
  const s = survivorOf(player);
  let left = Math.floor(count);
  const order: SlotRef['kind'][] = handy(item) ? ['h', 'b'] : ['b', 'h'];
  const targets = [...refsOf(s, 'h'), ...refsOf(s, 'b')];
  const empties = order.flatMap((k) => refsOf(s, k));
  for (const [pass, refs] of [['same', targets], ['empty', empties]] as const) {
    for (const r of refs) {
      if (left <= 0) break;
      const there = slotAt(player, s, r);
      if (pass === 'same' ? there?.item !== item : there !== null) continue;
      const n = Math.min(left, roomAt(r, item) - (there?.count ?? 0));
      if (n <= 0) continue;
      putAt(player, s, r, { item, count: (there?.count ?? 0) + n });
      left -= n;
    }
  }
  const kept = Math.floor(count) - left;
  if (left > 0 && spillRest) spill(player, item, left);
  if (kept > 0) {
    noteGain(s, item, kept);
    weigh(player, s);
    touch(s);
  }
  return kept;
}

/** How many of an item they carry, belt and pack together (what's worn isn't counted). */
export function countItems(player: Player, item: string): number {
  const s = survivorOf(player);
  let n = player.inventory.count(item);
  for (const slot of s.bag) if (slot?.item === item) n += slot.count;
  return n;
}

/** Take items if they have that many: from the pack first (the belt stays stocked), then the belt. */
export function removeItems(player: Player, item: string, count: number): boolean {
  if (!(count > 0)) return true;
  if (countItems(player, item) < count) return false;
  const s = survivorOf(player);
  let left = Math.floor(count);
  // From the last slots back, so the stacks at the front stay whole.
  for (let i = s.bag.length - 1; i >= 0 && left > 0; i--) {
    const slot = s.bag[i];
    if (slot?.item !== item) continue;
    const n = Math.min(left, slot.count);
    left -= n;
    s.bag[i] = slot.count > n ? { item, count: slot.count - n } : null;
  }
  if (left > 0) player.inventory.take(item, left);
  weigh(player, s);
  touch(s);
  return true;
}

/** Everything they carry and wear, as stacks (for a lost pack). */
export function everything(player: Player, s: Survivor): Stack[] {
  const all: Stack[] = [];
  for (const x of player.inventory.slots) if (x) all.push({ item: x.item, count: x.count });
  for (const x of s.bag) if (x) all.push({ ...x });
  for (const slot of WORN_SLOTS) if (s.worn[slot]) all.push({ item: s.worn[slot]!, count: 1 });
  return all;
}

/** Empty their belt, pack and worn slots. */
export function strip(player: Player, s: Survivor): void {
  player.inventory.clear();
  s.bag.fill(null);
  for (const slot of WORN_SLOTS) s.worn[slot] = null;
  applyArmour(player, s);
  weigh(player, s);
  touch(s);
}

/** Sort the pack: like things together, full stacks first, by name. */
export function sortBag(player: Player, s: Survivor): void {
  const totals = new Map<string, number>();
  for (const slot of s.bag) if (slot) totals.set(slot.item, (totals.get(slot.item) ?? 0) + slot.count);
  const items = [...totals.keys()].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  s.bag.fill(null);
  let i = 0;
  for (const item of items) {
    let left = totals.get(item)!;
    const per = stackLimit(item);
    while (left > 0 && i < s.bag.length) {
      const n = Math.min(left, per);
      s.bag[i++] = { item, count: n };
      left -= n;
    }
  }
  touch(s);
  void player;
}

// -----------------------------------------------------------------------------------------------
// Weight and armour
// -----------------------------------------------------------------------------------------------

/** Work out what they carry weighs, and let it slow them (through the stamina ability, so their own screen feels it at once). */
export function weigh(player: Player, s: Survivor): void {
  let w = 0;
  for (const x of player.inventory.slots) if (x) w += weightOf(x.item) * x.count;
  for (const x of s.bag) if (x) w += weightOf(x.item) * x.count;
  for (const slot of WORN_SLOTS) if (s.worn[slot]) w += weightOf(s.worn[slot]!);
  s.weight = w;
  s.limit = carryLimit(s.level);
  const { speed, pinned } = loadSpeed(w, s.limit);
  const st = player.abilities.stamina as { load: number; pinned: boolean } | undefined;
  if (st) {
    if (st.load !== speed) st.load = speed;
    if (st.pinned !== pinned) st.pinned = pinned;
  }
  if (speed < 1 && !s.toldHeavy) {
    s.toldHeavy = true;
    player.hud.toast('Your pack is too heavy: you can barely move');
  } else if (speed === 1) s.toldHeavy = false;
}

/** Their armour points, from what they wear. */
export function applyArmour(player: Player, s: Survivor): void {
  let points = 0;
  for (const slot of WORN_SLOTS) points += ARMOUR[s.worn[slot] ?? '']?.armor ?? 0;
  if (player.armor !== points) player.armor = points;
}

/** How much cold and heat what they wear keeps off. */
export function protection(s: Survivor): { cold: number; heat: number } {
  let cold = 0;
  let heat = 0;
  for (const slot of WORN_SLOTS) {
    const a = ARMOUR[s.worn[slot] ?? ''];
    if (a) {
      cold += a.cold;
      heat += a.heat;
    }
  }
  return { cold, heat };
}

/** Put on the armour in a slot (what was worn there goes back in its place). */
export function wear(player: Player, s: Survivor, ref: SlotRef): boolean {
  const stack = slotAt(player, s, ref);
  const armour = stack && ARMOUR[stack.item];
  if (!armour) return false;
  return moveSlot(player, s, ref, { kind: 'w', index: WORN_SLOTS.indexOf(armour.slot as WornSlot) });
}

// -----------------------------------------------------------------------------------------------
// What was gained
// -----------------------------------------------------------------------------------------------

/** A line for the corner of their screen: "+3 Wood", growing while more of the same comes in. */
function noteGain(s: Survivor, item: string, count: number): void {
  const last = s.gains.find((g) => g.item === item);
  if (last) {
    last.n += count;
    last.left = 3;
    last.text = `+${last.n} ${nameOf(item)}`;
  } else {
    s.gains.push({ item, n: count, left: 3, text: `+${count} ${nameOf(item)}` });
    if (s.gains.length > 5) s.gains.shift();
  }
}
