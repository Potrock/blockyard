import type { Facing, GameContext, Player, RayHit, Vec3 } from '@platform';
import type { Part } from '../part';
import { ITEMS } from '../items';
import { addXp, give } from '../survival/bag';
import { bedOf, calls, openContainer, registerRecipes, setBedSpawn, spillContainer, toolOf } from './adapters';
import { BUILD_ITEMS, PIECES, blocks, itemOf, structureTier, type Piece } from './def';
import { FORAGE_REST, harvestOf, type Harvest, type Tool } from './harvest';
import { LIMIT, Ownership } from './ownership';
import { recipeOf, recipes } from './recipes';
import { QUIET, Regrowth } from './regrowth';
import { resetSiege, updateSiege } from './siege';
import { Tribes } from './tribes';

/**
 * Gathering and building, for every survivor at once.
 *
 * Hold left-click on the island's own blocks to harvest them: what comes off, how fast, and
 * whether anything does depends on the tool in hand (`harvest.ts`). Resources come away and grow
 * back; the ground is only foraged, never dug. Right-click with a structure piece places it;
 * every piece remembers who placed it (`ownership.ts`), and only they (and whoever `setAllies`
 * says is with them) may take it down, open its door or use its stations. E on a door, a gate, a
 * station, a box or a bed uses it.
 *
 * It's the platform's `building` kit rewritten for these rules (the kit's own file invites it):
 * a harvest that doesn't remove its block, hints, and yields have no place in the kit's hooks.
 */

/** How far a survivor reaches to harvest, build and use, in blocks: shorter than the platform's. */
export const REACH = 4.5;
/** Nobody builds within this many cells of someone else's structure. */
export const PROTECT = 3;
/** A storage box's slots. */
export const BOX_SLOTS = 24;
/** The most logs one felled tree brings down, and the most of its crown that goes with them. */
const FELL_LOGS = 28;
const FELL_LEAVES = 160;

let own: Ownership;
let regrowth: Regrowth;
let tribes: Tribes | null = null;
let ctx: GameContext | null = null;
let allies: (owner: string, player: Player) => boolean = () => false;

/** Foraged cells and when each has something again (game seconds): bounded, and not worth keeping. */
const foraged = new Map<string, number>();
const MAX_FORAGED = 4000;

interface Hands {
  key: string;
  progress: number;
  swingT: number;
  placeT: number;
  ringShown: boolean;
  hint: string;
  hintT: number;
  /** Whether the button has come up since a piece was last taken down (the next piece wants a click of its own). */
  lifted: boolean;
  /** The prompt last sent for what they're aiming at ('' for none). */
  aim: string;
}
const hands = new Map<string, Hands>();
/** Players who've just joined, until the ground where they stand has loaded. */
const arriving = new Set<string>();
let saveT = 0;
let loaded = false;
let growT = 0;

// ---- What other parts may ask ----

/** Who a player is to the ownership map: their account, or (a guest, a bot) their id for this visit. */
export function ownerKey(player: Player): string {
  return player.account ? `a:${player.account.id}` : `g:${player.id}`;
}

/**
 * More allies than a survivor's tribe (which already counts: see `tribes.ts`) plug in here:
 * `withOwner(ownerKey, player)` says whether `player` builds as one with that owner, so they may
 * break, open and build beside each other's pieces.
 */
export function setAllies(withOwner: (owner: string, player: Player) => boolean): void {
  allies = withOwner;
}

/** Whether two survivors are in the same tribe (never true of someone with no tribe, nor of bots without one). */
export function sameTribe(a: Player, b: Player): boolean {
  return !!tribes && a !== b && tribes.same(ownerKey(a), ownerKey(b));
}

/** The name of a survivor's tribe, or null if they have none. */
export function tribeOf(player: Player): string | null {
  return tribes?.tribeOfKey(ownerKey(player))?.name ?? null;
}

/** What `/tribe` does, for a given survivor (`args` as typed after it: `['create', 'Ridge Runners']`); throws an Error with words for them when it can't. */
export function tribeCommand(game: GameContext, player: Player, args: string[]): string | void {
  return tribes?.command(args, game, player);
}

/** The owner (an `ownerKey`) of the structure block at a cell, or null: nobody's, or not a structure. */
export function ownerOf(at: Vec3): string | null {
  const owner = own?.ownerOf(Math.floor(at.x), Math.floor(at.y), Math.floor(at.z)) ?? null;
  return owner && !abandoned(owner) ? owner : null;
}

/**
 * Whether `player` may build at, break or use the cell `at`: an owned structure block is its
 * owner's (and their allies'); a free cell is anyone's unless it crowds someone else's structure
 * (within `PROTECT` cells).
 */
export function canBuild(player: Player, at: Vec3): boolean {
  return builderProblem(player, Math.floor(at.x), Math.floor(at.y), Math.floor(at.z)) === null;
}

export { structureTier };

/** Put back everything due to regrow now, whoever is near (tests, and a `/regrow` for whoever runs the server). */
export function regrowAll(game: GameContext): number {
  let n = 0;
  for (let i = 0; i < 2000 && regrowth.pending > 0; i++) {
    const got = regrowth.update(Infinity, game.world, () => true, (x, y, z) => own.near(x, y, z, PROTECT + 1) !== null, 50);
    n += got;
    if (got === 0 && i > 2) break;
  }
  return n;
}

/** How many harvested blocks are waiting to grow back. */
export function regrowPending(): number {
  return regrowth.pending;
}

/** Write what changed to `game.store` now (it's done every few seconds anyway). */
export function saveNow(game: GameContext): void {
  own.flush();
  regrowth.save(game.clock.total);
  tribes?.save();
}

/** Read ownership and regrowth back from `game.store` (what `start` does; a test's round trip). */
export function loadNow(game: GameContext): void {
  own.load();
  // A guest's key (their player id) goes to whoever joins next, and starts again after a restart:
  // what a guest who isn't here built is nobody's, before someone else turns up under their key.
  const here = new Set(game.players.map(ownerKey));
  own.releaseOwners((owner) => owner.startsWith('g:') && !here.has(owner));
  regrowth.load(game.clock.total);
  tribes?.load(new Set(game.players.map(ownerKey)));
}

// ---- Ownership ----

/** A guest's pieces are theirs while they're here; once they've gone (their id with them) they're anybody's. */
function abandoned(owner: string): boolean {
  if (!owner.startsWith('g:') || !ctx) return false;
  return !ctx.players.some((p) => ownerKey(p) === owner);
}

function mine(owner: string, player: Player): boolean {
  return owner === ownerKey(player) || abandoned(owner) || !!tribes?.same(owner, ownerKey(player)) || allies(owner, player);
}

/** Why `player` may not build at, break or use a cell, in words for them; null if they may. */
function builderProblem(player: Player, x: number, y: number, z: number): string | null {
  const owner = own.ownerOf(x, y, z);
  if (owner) return mine(owner, player) ? null : `Not yours: ${whose(owner)} built this`;
  const crowded = own.near(x, y, z, PROTECT, (o) => !mine(o, player));
  return crowded ? `Too close to ${whose(crowded)}'s base` : null;
}

/** An owner in words: their name, and their tribe's if they have one ("Ann (Ridge Runners)"). */
function whose(owner: string): string {
  const tribe = tribes?.tribeOfKey(owner);
  return tribe ? `${own.nameOf(owner)} (${tribe.name})` : own.nameOf(owner);
}

// ---- Hints and yields on the survivor's screen ----

function hint(game: GameContext, player: Player, text: string): void {
  const h = handsOf(player);
  if (h.hint === text && h.hintT > 0) return;
  h.hint = text;
  h.hintT = 1.5;
  game.clients.send(player, 'bt.hint', { text });
}

function handsOf(player: Player): Hands {
  let h = hands.get(player.id);
  if (!h) hands.set(player.id, (h = { key: '', progress: 0, swingT: 0, placeT: 0, ringShown: false, hint: '', hintT: 0, lifted: true, aim: '' }));
  return h;
}

/** Roll a harvest's yields and hand them over; the survivor's screen shows what they got. */
function award(game: GameContext, player: Player, harvests: Harvest[]): void {
  const got = new Map<string, number>();
  let xp = 0;
  for (const h of harvests) {
    xp += h.xp;
    for (const line of h.yields) {
      if (line.chance !== undefined && !game.rng.chance(line.chance)) continue;
      const n = line.min >= line.max ? line.min : game.rng.int(line.min, line.max);
      if (n > 0) got.set(line.item, (got.get(line.item) ?? 0) + n);
    }
  }
  for (const [item, n] of got) give(player, item, n);
  if (xp > 0) addXp(player, xp);
  if (got.size) game.clients.send(player, 'bt.yield', { items: [...got].map(([item, n]) => [item, n, ITEMS[item as keyof typeof ITEMS]?.name ?? item]) });
}

// ---- Harvesting ----

const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

/** The 26 cells round a cell. */
const AROUND: [number, number, number][] = [];
for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) if (dx || dy || dz) AROUND.push([dx, dy, dz]);

/** What mining the block aimed at would be: a time and what to do when it's done, or why not. */
type Plan = { time: number; sound: string; done(): void } | { refuse: string };

function planBreak(game: GameContext, player: Player, hit: RayHit, block: string, tool: Tool): Plan {
  const { world } = game;
  const piece = PIECES[block];
  if (piece) {
    const problem = builderProblem(player, hit.x, hit.y, hit.z);
    if (problem) return { refuse: problem };
    const hardness = blocks[block]?.hardness ?? 1;
    // The right tool takes a piece down faster: a hatchet for thatch and wood, a pick for stone and metal.
    const suited = piece.tier <= 1 ? tool.kind === 'hatchet' : tool.kind === 'pick';
    return {
      // Never at a touch: a stray click mustn't cost a wall, even a thatch one.
      time: (0.6 + hardness * 1.2) * (suited ? (tool.tier >= 2 ? 0.4 : 0.6) : 1),
      sound: piece.tier <= 1 ? 'bt_chop' : 'bt_pick',
      done: () => {
        demolish(game, player, hit.x, hit.y, hit.z, block, piece);
        // One piece a click: holding on doesn't start on the wall behind it.
        handsOf(player).lifted = false;
      },
    };
  }

  const info = world.blockInfo(hit.block);
  if (!info || info.liquid || !info.breakable) return { refuse: '' };
  const harvest = harvestOf(block, info.plant, tool);
  if (!harvest) return { refuse: '' };
  if ('refuse' in harvest) return harvest;
  // The wild things beside someone's base are theirs to clear, not a neighbour's to strip.
  if (harvest.removes) {
    const crowded = own.near(hit.x, hit.y, hit.z, 1, (o) => !mine(o, player));
    if (crowded) return { refuse: `Too close to ${whose(crowded)}'s base` };
  }
  if (!harvest.removes) {
    const ready = foraged.get(cellKey(hit.x, hit.y, hit.z));
    if (ready !== undefined && ready > game.clock.total) return { refuse: 'Picked clean: try another spot' };
  }
  return { time: harvest.time, sound: harvest.sound, done: () => (harvest.removes ? gather(game, player, hit, block, harvest, tool) : forage(game, player, hit, harvest)) };
}

/** A patch of ground or a boulder gives something up and stays where it is. */
function forage(game: GameContext, player: Player, hit: RayHit, harvest: Harvest): void {
  if (foraged.size >= MAX_FORAGED) {
    const now = game.clock.total;
    for (const [k, t] of foraged) if (t <= now) foraged.delete(k);
    // Still full (a great many survivors foraging at once): the oldest give way.
    for (const k of foraged.keys()) {
      if (foraged.size < MAX_FORAGED) break;
      foraged.delete(k);
    }
  }
  foraged.set(cellKey(hit.x, hit.y, hit.z), game.clock.total + FORAGE_REST);
  game.fx.burst({ x: hit.point.x + hit.normal.x * 0.1, y: hit.point.y + hit.normal.y * 0.1, z: hit.point.z + hit.normal.z * 0.1 }, { color: '#8c8478', count: 8, speed: 2.2, size: 0.08, life: 0.5 });
  award(game, player, [harvest]);
}

/** A resource block comes away: it's remembered to grow back, and a tree cut at the foot comes down whole. */
function gather(game: GameContext, player: Player, hit: RayHit, block: string, harvest: Harvest, tool: Tool): void {
  const { world } = game;
  const { x, y, z } = hit;
  const gone = [{ x, y, z, variant: world.blockInfo(hit.block)?.variant ?? block }];
  const harvests = [harvest];

  const isLog = block.endsWith('_log');
  const below = world.blockName(world.getBlock(x, y - 1, z));
  const above = world.blockName(world.getBlock(x, y + 1, z));
  const felled: Vec3[] = [];
  if (isLog && below !== block && above === block) {
    // Timber: every log standing on this one, with the yield each would have given.
    const seen = new Set([cellKey(x, y, z)]);
    const queue: Vec3[] = [{ x, y, z }];
    while (queue.length && felled.length < FELL_LOGS) {
      const at = queue.shift()!;
      for (let dy = 0; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            const n = { x: at.x + dx, y: at.y + dy, z: at.z + dz };
            const k = cellKey(n.x, n.y, n.z);
            if (seen.has(k)) continue;
            seen.add(k);
            const id = world.getBlock(n.x, n.y, n.z);
            if (world.blockName(id) !== block || own.ownerOf(n.x, n.y, n.z)) continue;
            if (felled.length >= FELL_LOGS) continue;
            felled.push(n);
            queue.push(n);
            gone.push({ ...n, variant: world.blockInfo(id)?.variant ?? block });
          }
        }
      }
    }
  }

  // The crown goes with a felled trunk: leaves reached from the fallen logs that no standing log holds up.
  const leaves: Vec3[] = [];
  if (felled.length) {
    const down = new Set(gone.map((g) => cellKey(g.x, g.y, g.z)));
    const heldUp = (at: Vec3) => {
      for (let dx = -2; dx <= 2; dx++)
        for (let dy = -2; dy <= 2; dy++)
          for (let dz = -2; dz <= 2; dz++) {
            if (down.has(cellKey(at.x + dx, at.y + dy, at.z + dz))) continue;
            if (world.blockName(world.getBlock(at.x + dx, at.y + dy, at.z + dz)).endsWith('_log')) return true;
          }
      return false;
    };
    const seen = new Set<string>();
    const queue: Vec3[] = [{ x, y, z }, ...felled];
    while (queue.length && leaves.length < FELL_LEAVES) {
      const at = queue.shift()!;
      // (Corner to corner counts as joined: a palm's fronds touch only at their corners.)
      for (const [dx, dy, dz] of AROUND) {
        const n = { x: at.x + dx, y: at.y + dy, z: at.z + dz };
        const k = cellKey(n.x, n.y, n.z);
        if (seen.has(k)) continue;
        seen.add(k);
        if (Math.abs(n.x - x) > 5 || Math.abs(n.z - z) > 5) continue;
        const id = world.getBlock(n.x, n.y, n.z);
        if (!world.blockName(id).endsWith('_leaves') || heldUp(n)) continue;
        leaves.push(n);
        queue.push(n);
        gone.push({ ...n, variant: world.blockInfo(id)?.variant ?? 'air' });
      }
    }
  }

  regrowth.add(gone, harvest.regrow, game.clock.total);
  world.breakBlock(x, y, z, { by: player });
  for (const log of felled) {
    world.breakBlock(log.x, log.y, log.z, { by: player });
    harvests.push(harvest);
  }
  if (leaves.length) {
    const leaf = harvestOf('oak_leaves', false, tool);
    for (const at of leaves) {
      // Quietly: a whole crown's debris and sounds at once would be a wall of noise.
      world.setBlock(at.x, at.y, at.z, 'air');
      if (leaf && !('refuse' in leaf)) harvests.push({ ...leaf, xp: 0 });
    }
    game.fx.burst({ x: x + 0.5, y: y + 4, z: z + 0.5 }, { color: '#4f8a3a', count: 40, speed: 3, size: 0.12, gravity: 6, life: 1.2 });
  }
  if (felled.length) {
    game.audio.play('bt_timber', { at: { x: x + 0.5, y: y + 1, z: z + 0.5 } });
    player.hud.pop('Timber!', { sub: `${felled.length + 1} logs` });
  }
  award(game, player, harvests);
}

// ---- Structures: taking down, placing, using ----

const containerId = (at: Vec3) => `box:${at.x},${at.y},${at.z}`;

/** An owner takes a piece down and gets about half of what it was made of back. */
function demolish(game: GameContext, player: Player, x: number, y: number, z: number, block: string, piece: Piece): void {
  if (!game.world.breakBlock(x, y, z, { by: player })) return;
  // A box taken down spills what it held where it stood.
  if (piece.use === 'storage') spillContainer(containerId({ x, y, z }), { x: x + 0.5, y: y + 0.2, z: z + 0.5 });
  if (piece.use === 'bed') forgetBed(game, { x, y, z });
  const item = itemOf(block);
  const recipe = item ? recipeOf(item) : undefined;
  if (!recipe) return;
  const back: [string, number, string][] = [];
  for (const [need, n] of Object.entries(recipe.needs)) {
    const share = (n / (recipe.count ?? 1)) * 0.5;
    const whole = Math.floor(share) + (game.rng.chance(share - Math.floor(share)) ? 1 : 0);
    if (whole <= 0) continue;
    give(player, need, whole);
    back.push([need, whole, ITEMS[need as keyof typeof ITEMS]?.name ?? need]);
  }
  if (back.length) game.clients.send(player, 'bt.yield', { items: back });
}

/** The way a survivor is looking, as one of the four sides. */
function lookFacing(player: Player): Facing {
  const { x, z } = player.look;
  return Math.abs(x) > Math.abs(z) ? (x > 0 ? 'east' : 'west') : z > 0 ? 'south' : 'north';
}
const OPPOSITE: Record<Facing, Facing> = { north: 'south', south: 'north', east: 'west', west: 'east' };

/** The cell a piece placed against what's aimed at would fill: the plant aimed at, or the cell in front of the face. */
function placeCell(game: GameContext, hit: RayHit): Vec3 {
  const into = game.world.blockInfo(hit.block)?.replaceable;
  return into ? { x: hit.x, y: hit.y, z: hit.z } : { x: hit.x + hit.normal.x, y: hit.y + hit.normal.y, z: hit.z + hit.normal.z };
}

function place(game: GameContext, player: Player, hit: RayHit, item: string, block: string, first: boolean): boolean {
  const { world } = game;
  const { x, y, z } = placeCell(game, hit);
  const piece = PIECES[block];
  if (piece) {
    // A slab laid on its other half fills the cell aimed at, which may be someone else's.
    const problem = builderProblem(player, x, y, z) ?? (own.ownerOf(hit.x, hit.y, hit.z) ? builderProblem(player, hit.x, hit.y, hit.z) : null);
    if (problem) {
      if (first) hint(game, player, problem);
      return false;
    }
    if (own.countOf(ownerKey(player)) >= LIMIT) {
      if (first) hint(game, player, `You've built all you can (${LIMIT} pieces): take something down first`);
      return false;
    }
  }
  let what = block;
  let facing: Facing | undefined;
  if (piece?.turn === 'away') facing = lookFacing(player);
  if (piece?.use === 'door') {
    // A door stands across its builder's way, and a second leaf matches the one it's stacked on.
    const neighbour = [world.getBlock(x, y - 1, z), world.getBlock(x, y + 1, z)].map((id) => world.blockInfo(id)).find((i) => i?.name === block);
    what = `${block}[facing=${neighbour?.state.facing ?? OPPOSITE[lookFacing(player)]}]`;
  }
  if (!world.placeBlock(x, y, z, what, { by: player, against: hit, facing })) {
    if (first && piece) hint(game, player, "Can't build here: something's in the way");
    return false;
  }
  const inv = player.inventory;
  const held = inv.held;
  if (held && held.item === item) inv.set(inv.selected, held.count > 1 ? { item, count: held.count - 1 } : null);
  return true;
}

/** Whether anybody's body (a survivor's, a creature's) overlaps a box in the world. */
function bodyIn(game: GameContext, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  for (const p of game.players) {
    if (!p.alive || p.spectating) continue;
    const at = p.position;
    if (at.x + 0.3 > x0 && at.x - 0.3 < x1 && at.z + 0.3 > z0 && at.z - 0.3 < z1 && at.y + 1.8 > y0 && at.y < y1) return true;
  }
  for (const e of game.entities.near({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 }, 2.5)) {
    const at = e.position;
    if (at.x + 0.4 > x0 && at.x - 0.4 < x1 && at.z + 0.4 > z0 && at.z - 0.4 < z1 && at.y + 1 > y0 && at.y < y1) return true;
  }
  return false;
}

/** A door opens by turning a quarter on its hinge: the same block, facing the next way round. */
const SWING: Record<string, Facing> = { north: 'east', east: 'north', south: 'west', west: 'south' };
/** Where a door's leaf is in its cell, by the way it faces: [x0, z0, x1, z1]. */
const LEAF: Record<string, [number, number, number, number]> = {
  north: [0, 13 / 16, 1, 1],
  south: [0, 0, 1, 3 / 16],
  east: [0, 0, 3 / 16, 1],
  west: [13 / 16, 0, 1, 1],
};

function swingDoor(game: GameContext, player: Player, at: Vec3, block: string): void {
  const { world } = game;
  const was = world.blockInfo(world.getBlock(at.x, at.y, at.z))?.state.facing ?? 'north';
  const to = SWING[was] ?? 'north';
  // Both leaves of a tall door (and any stacked higher) move together.
  let y0 = at.y;
  let y1 = at.y;
  while (y0 - 1 > at.y - 4 && world.blockName(world.getBlock(at.x, y0 - 1, at.z)) === block) y0--;
  while (y1 + 1 < at.y + 4 && world.blockName(world.getBlock(at.x, y1 + 1, at.z)) === block) y1++;
  const leaf = LEAF[to];
  if (bodyIn(game, at.x + leaf[0], y0, at.z + leaf[1], at.x + leaf[2], y1 + 1, at.z + leaf[3])) {
    hint(game, player, "Someone's in the doorway");
    return;
  }
  for (let y = y0; y <= y1; y++) world.setBlock(at.x, y, at.z, `${block}[facing=${to}]`);
  game.audio.play('bt_door', { at: { x: at.x + 0.5, y: at.y + 0.5, z: at.z + 0.5 } });
}

/** A gate, and every gate joined to it (a wide one for big animals), opens or shuts as one. */
function swingGate(game: GameContext, player: Player, at: Vec3, block: string): void {
  const { world } = game;
  const to = block === 'bt_gate' ? 'bt_gate_open' : 'bt_gate';
  const cells: Vec3[] = [{ x: at.x, y: at.y, z: at.z }];
  const seen = new Set([cellKey(at.x, at.y, at.z)]);
  for (let i = 0; i < cells.length && cells.length < 16; i++) {
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
      const n = { x: cells[i].x + dx, y: cells[i].y + dy, z: cells[i].z + dz };
      const k = cellKey(n.x, n.y, n.z);
      if (seen.has(k) || cells.length >= 16) continue;
      seen.add(k);
      if (world.blockName(world.getBlock(n.x, n.y, n.z)) === block && builderProblem(player, n.x, n.y, n.z) === null) cells.push(n);
    }
  }
  if (to === 'bt_gate' && cells.some((c) => bodyIn(game, c.x + 0.3, c.y, c.z + 0.3, c.x + 0.7, c.y + 1, c.z + 0.7))) {
    hint(game, player, "Something's in the gateway");
    return;
  }
  for (const c of cells) world.setBlock(c.x, c.y, c.z, to);
  game.audio.play('bt_door', { at: { x: at.x + 0.5, y: at.y + 0.5, z: at.z + 0.5 }, pitch: 0.8 });
}

/** Whoever sleeps in a bed that's gone has no bed (those away find out when they next wake: the survival part looks for the block). */
function forgetBed(game: GameContext, at: Vec3): void {
  for (const p of game.players) {
    const bed = bedOf(p);
    if (bed && bed.x === at.x && bed.y === at.y && bed.z === at.z) setBedSpawn(p, null);
  }
}

/** E on a structure block: open, shut, craft, store, sleep. */
function use(game: GameContext, player: Player, hit: RayHit, block: string, piece: Piece): void {
  const problem = builderProblem(player, hit.x, hit.y, hit.z);
  if (problem) {
    hint(game, player, problem);
    return;
  }
  const at = { x: hit.x, y: hit.y, z: hit.z };
  switch (piece.use) {
    case 'door':
      swingDoor(game, player, at, block);
      break;
    case 'gate':
      swingGate(game, player, at, block);
      break;
    case 'storage':
      if (!openContainer(player, containerId(at), BOX_SLOTS)) player.hud.toast('An empty box (storage is on its way)');
      break;
    case 'bed': {
      if (!setBedSpawn(player, at)) player.hud.toast('A good place to sleep (beds are on their way)');
      game.audio.play('bt_rustle', { at: { x: at.x + 0.5, y: at.y + 0.3, z: at.z + 0.5 }, pitch: 0.7 });
      break;
    }
    default:
      if (piece.use) calls.openStation(player, piece.use);
  }
}

// ---- Each survivor, each step ----

function updatePlayer(game: GameContext, player: Player, dt: number): void {
  const { world } = game;
  const h = handsOf(player);
  const input = player.input;
  h.swingT -= dt;
  h.placeT = Math.max(0, h.placeT - dt);
  h.hintT = Math.max(0, h.hintT - dt);

  let hit: RayHit | null = null;
  if (player.alive && !player.spectating && !player.vehicle) {
    // A creature in the crosshair (the ray stops at blocks, so it's in front) is for weapons and for the creatures' own E.
    if (!game.entities.raycast(player.eye, player.look, REACH)) hit = world.raycast(player.eye, player.look, REACH);
  }
  const held = player.inventory.held;
  const block = hit ? world.blockName(hit.block) : '';
  const piece = hit ? PIECES[block] : undefined;

  if (hit && piece?.use && input.pressed('KeyE')) {
    input.consume('KeyE');
    use(game, player, hit, block, piece);
  }

  // Harvesting and taking down: progress builds while left-click is held on the same block.
  let mining = false;
  const canMine = !!hit && game.items.get(held?.item ?? '')?.kind !== 'bow';
  if (!input.button(0)) h.lifted = true;
  if (hit && canMine && input.button(0)) {
    const plan = planBreak(game, player, hit, block, toolOf(held?.item ?? null));
    if (piece && !h.lifted) {
      // Still holding from the piece just taken down: this one waits for its own click.
      input.consume(0);
    } else if ('refuse' in plan) {
      // Nothing to be had: say why once, and leave the click to whatever's in their hand.
      if (plan.refuse && input.buttonPressed(0)) hint(game, player, plan.refuse);
    } else {
      input.consume(0);
      mining = true;
      const k = cellKey(hit.x, hit.y, hit.z);
      if (k !== h.key) {
        h.key = k;
        h.progress = 0;
      }
      h.progress += plan.time <= 0 ? 1 : dt / plan.time;
      if (h.swingT <= 0) {
        h.swingT = 0.3;
        player.viewModel.play(held ? 'swing' : 'punch');
        game.audio.play(plan.sound, { at: hit.point, volume: 0.7, pitch: 0.92 + game.rng.next() * 0.16 });
      }
      if (h.progress >= 1) {
        plan.done();
        mining = false;
        h.swingT = 0.15;
      }
    }
  }
  if (!mining) {
    h.key = '';
    h.progress = 0;
  }

  // Placing against the face aimed at (or into a plant's cell), repeating while held.
  const places = held ? blockOfItem(held.item) : null;
  const first = input.buttonPressed(2);
  if (hit && places && held && (first || (input.button(2) && h.placeT <= 0))) {
    input.consume(2);
    h.placeT = first ? 0.25 : 0.18;
    if (place(game, player, hit, held.item, places, first)) player.viewModel.play('swing');
  }

  // The outline: on the block being worked at; with a piece in hand, round the cell it would fill
  // (the nearest thing to a ghost of the piece the platform draws).
  const ghost = hit && places && !mining ? placeCell(game, hit) : null;
  player.hud.highlight(ghost ?? (hit && canMine ? hit : null), { progress: mining ? h.progress : 0 });

  // What E would do here, and whose it is, under the crosshair.
  let aim = '';
  if (hit && piece) {
    const owner = own.ownerOf(hit.x, hit.y, hit.z);
    const theirs = owner && owner !== ownerKey(player) && !abandoned(owner) ? whose(owner) : '';
    const locked = !!owner && !mine(owner, player);
    const verb = piece.use && !locked ? USE_WORDS[piece.use] : '';
    aim = `${verb}|${blocks[block]?.label ?? ''}${theirs ? `: ${theirs}` : ''}${locked ? ' (locked)' : ''}`;
    if (!verb && !theirs) aim = '';
  }
  if (aim !== h.aim) {
    h.aim = aim;
    const [key, text] = aim ? aim.split('|') : ['', ''];
    game.clients.send(player, 'bt.aim', { key, text });
  }

  if (input.pressed('KeyG')) {
    input.consume('KeyG');
    if (!tribes?.closeMenu(player)) tribes?.menu(game, player);
  }
  if (mining || h.ringShown) {
    player.hud.progress(mining ? h.progress : null);
    h.ringShown = mining;
  }
}

/** What E does to each kind of usable piece, for the prompt under the crosshair. */
const USE_WORDS: Record<NonNullable<Piece['use']>, string> = {
  door: 'Open or shut',
  gate: 'Open or shut',
  storage: 'Open',
  bed: 'Make your bed',
  campfire: 'Cook',
  mortar: 'Grind',
  workbench: 'Craft',
  forge: 'Smelt',
  smithy: 'Forge',
};

/**
 * The block an item places: a structure piece places itself, and nothing else places anything.
 * (Other parts' items drawn as blocks are only drawn that way: placed, they'd be structures with
 * no owner, no cost and no limit.)
 */
function blockOfItem(item: string): string | null {
  return BUILD_ITEMS.includes(item) ? item : null;
}

/** A piece torn down by something other than its owner: a box spills, a bed is forgotten, nothing comes back. */
function wreck(game: GameContext, x: number, y: number, z: number, block: string): void {
  const piece = PIECES[block];
  if (!piece || !game.world.breakBlock(x, y, z)) return;
  if (piece.use === 'storage') spillContainer(containerId({ x, y, z }), { x: x + 0.5, y: y + 0.2, z: z + 0.5 });
  if (piece.use === 'bed') forgetBed(game, { x, y, z });
}

/** Tell whoever owns the piece at a cell (and their tribe), if they're on the island. */
function warnOwner(game: GameContext, x: number, y: number, z: number, text: string): void {
  const owner = own.ownerOf(x, y, z);
  if (!owner) return;
  for (const p of game.players) if (mine(owner, p) && !abandoned(owner)) p.hud.toast(text);
}

const tell = (game: GameContext) => (to: string, text: string) => game.players.find((p) => ownerKey(p) === to)?.hud.toast(text);

export const building: Part = {
  setup(game) {
    ctx = game;
    own = new Ownership(game.store);
    regrowth = new Regrowth(game.store);

    // The pieces, and (if no other part has defined them yet) the resources harvesting gives.
    for (const id of [...BUILD_ITEMS, 'wood', 'thatch', 'fiber', 'stone', 'flint', 'berries', 'seeds', 'sap', 'metal_ore', 'crystal', 'obsidian']) {
      if (game.items.get(id)) continue;
      const entry = ITEMS[id as keyof typeof ITEMS];
      // A piece looks like the block it places, wherever an item is shown.
      game.items.define(id, { kind: 'misc', name: entry?.name ?? blocks[id]?.label ?? id, stack: entry?.stack ?? 100, ...(id in PIECES ? { icon: { block: id } } : {}) });
    }
    registerRecipes(recipes);

    tribes = new Tribes(game.store, ownerKey);
    game.commands.register('tribe', {
      help: 'Your tribe: survivors who share structures, stations and boxes (G opens the menu)',
      usage: '[create <name> | invite <player> | accept | leave | info]',
      run: (args, g, player) => tribes!.command(args, g, player),
      complete: (args, g) => (args.length <= 1 ? ['create', 'invite', 'accept', 'leave', 'info'] : args[0] === 'invite' ? g.players.map((p) => p.name) : []),
    });

    // Whoever places a piece owns it; whatever takes one away (its owner, a creature, a blast) frees the cell.
    game.events.on('blockPlace', ({ x, y, z, block, by }) => {
      regrowth.forget(x, y, z);
      if (block in PIECES && by !== 'world' && by.kind === 'player') own.claim(x, y, z, ownerKey(by), by.name);
    });
    game.events.on('blockChange', ({ x, y, z, block }) => {
      if (!(block in PIECES) && own.ownerOf(x, y, z)) own.release(x, y, z);
    });
    game.events.on('playerLeave', ({ player }) => {
      hands.delete(player.id);
      arriving.delete(player.id);
      tribes?.left(player, tell(game));
      // A guest's pieces are nobody's once they've gone: the next guest gets their id, and mustn't get their walls.
      const key = ownerKey(player);
      if (key.startsWith('g:')) own.releaseOwners((owner) => owner === key);
    });
    game.events.on('playerJoin', ({ player }) => {
      arriving.add(player.id);
      tribes?.seen(player);
    });
  },

  start(game) {
    ctx = game;
    hands.clear();
    foraged.clear();
    arriving.clear();
    saveT = 0;
    growT = 0;
    resetSiege();
    // A restart: what changed since the last save (the world put back, say) is written before it's read again.
    if (loaded) saveNow(game);
    loaded = true;
    loadNow(game);
  },

  update(game, dt) {
    for (const player of game.players) updatePlayer(game, player, dt);
    updateSiege(game, dt, (x, y, z, block) => wreck(game, x, y, z, block), (x, y, z, text) => warnOwner(game, x, y, z, text));

    // Someone who left from inside a dug-out hollow may come back to find the rock regrown round
    // them: once their ground has loaded, anyone standing in solid rock is lifted to the surface.
    if (arriving.size) {
      for (const player of game.players) {
        if (!arriving.has(player.id)) continue;
        const at = player.position;
        if (game.world.getBlock(at.x, at.y, at.z) < 0) continue;
        arriving.delete(player.id);
        const inRock = [0.1, 1.2].some((dy) => {
          const info = game.world.blockInfo(game.world.getBlock(at.x, at.y + dy, at.z));
          return !!info && info.solid && info.shape === 'cube';
        });
        if (inRock) player.teleport({ x: at.x, y: game.world.surfaceY(at.x, at.z) + 1, z: at.z });
      }
    }

    growT += dt;
    if (growT >= 2) {
      growT = 0;
      const quiet = (x: number, y: number, z: number) =>
        !game.players.some((p) => Math.abs(p.position.x - x) < QUIET && Math.abs(p.position.z - z) < QUIET && Math.abs(p.position.y - y) < QUIET);
      regrowth.update(game.clock.total, game.world, quiet, (x, y, z) => own.near(x, y, z, PROTECT + 1) !== null);
    }
    saveT += dt;
    if (saveT >= 5) {
      saveT = 0;
      saveNow(game);
    }
  },
};
