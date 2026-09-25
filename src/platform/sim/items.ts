import type { AtlasPixels, GameContext, GameEvents, ItemApi, ItemDefinition, ItemStack, InventoryApi, Pickup, Player, Vec3 } from '../api/types';
import type { Content } from '../content';
import type { Presentation } from './present';
import { freshGun, isGun, type GunState } from './guns';

export interface ItemServices {
  ctx(): GameContext;
  emit<K extends keyof GameEvents>(event: K, e: GameEvents[K]): void;
  players(): readonly Player[];
  isSolid(x: number, y: number, z: number): boolean;
  /**
   * A solid prop just under a point (within `depth`): which, and the height of its surface there;
   * and where a point on one is now (null once it's gone or no longer solid).
   */
  propUnder(p: Vec3, depth: number): { id: number; surface: number } | null;
  onProp(id: number, at: Vec3, out: Vec3): Vec3 | null;
  /** A world point in a prop's own space (to ride on it). */
  propLocal(id: number, at: Vec3): Vec3 | null;
  /** Item definitions and atlases, for the client's icons and meshes. */
  content: Content;
  /** Sounds and toasts for the player who picks something up. */
  present: Presentation;
}

/** One pickup as the client draws it. */
export interface PickupFrame {
  id: number;
  item: string;
  x: number;
  y: number;
  z: number;
  /** Resting on the ground (it bobs). */
  settled: boolean;
  beam?: string;
}

export class Inventory implements InventoryApi {
  readonly slots: (ItemStack | null)[] = new Array(9).fill(null);
  selected = 0;
  onChange: (() => void) | null = null;
  /** Each gun carried: its rounds and what it's doing (a fresh one comes full). */
  readonly guns = new Map<string, GunState>();

  constructor(private defs: Map<string, ItemDefinition>) {}

  get held(): ItemStack | null {
    return this.slots[this.selected];
  }

  private max(item: string): number {
    const d = this.defs.get(item);
    return d?.stack ?? (d && (d.kind === 'melee' || d.kind === 'bow' || d.kind === 'gun') ? 1 : 64);
  }

  /** A gun's state, if it's carried. */
  gunState(item: string): GunState | null {
    const def = this.defs.get(item);
    if (!isGun(def) || this.count(item) === 0) return null;
    let g = this.guns.get(item);
    if (!g) this.guns.set(item, (g = freshGun(def)));
    return g;
  }

  ammo(item: string): { magazine: number; reserve: number } | null {
    const g = this.gunState(item);
    return g && { magazine: g.mag, reserve: g.reserve };
  }

  setAmmo(item: string, a: { magazine?: number; reserve?: number }) {
    const g = this.gunState(item);
    const def = this.defs.get(item);
    if (!g || !isGun(def)) return;
    if (a.magazine !== undefined) g.mag = Math.max(0, Math.min(def.magazine, Math.floor(a.magazine)));
    if (a.reserve !== undefined) g.reserve = Math.max(0, Math.floor(a.reserve));
  }

  /** Guns no longer carried lose their state (given again, they come full). */
  private forget() {
    for (const item of [...this.guns.keys()]) if (this.count(item) === 0) this.guns.delete(item);
  }

  give(item: string, count = 1): number {
    let left = count;
    const max = this.max(item);
    for (const s of this.slots) {
      if (left <= 0) break;
      if (s && s.item === item && s.count < max) {
        const n = Math.min(max - s.count, left);
        s.count += n;
        left -= n;
      }
    }
    // Full inventory: a better weapon replaces the weakest weapon of lower rank.
    const def = this.defs.get(item);
    if (left > 0 && def && (def.kind === 'melee' || def.kind === 'bow') && !this.slots.includes(null)) {
      let worst = -1;
      let worstRank = def.rank ?? 0;
      this.slots.forEach((s, i) => {
        const d = s ? this.defs.get(s.item) : undefined;
        if (d && d.kind === def.kind && (d.rank ?? 0) < worstRank) {
          worstRank = d.rank ?? 0;
          worst = i;
        }
      });
      if (worst >= 0) this.slots[worst] = null;
    }
    for (let i = 0; i < 9 && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(max, left);
        this.slots[i] = { item, count: n };
        left -= n;
        // Auto-equip strictly better weapons.
        const def = this.defs.get(item);
        const cur = this.held ? this.defs.get(this.held.item) : undefined;
        if (def && (def.kind === 'melee' || def.kind === 'bow') && (!cur || (def.rank ?? 0) > (cur.rank ?? 0))) this.selected = i;
      }
    }
    this.onChange?.();
    return left;
  }

  take(item: string, count = 1): boolean {
    if (this.count(item) < count) return false;
    let left = count;
    // From the stack in hand first (placing blocks, eating), then from the end of the hotbar.
    const order = [this.selected, 8, 7, 6, 5, 4, 3, 2, 1, 0].filter((v, i, a) => a.indexOf(v) === i);
    for (const i of order) {
      if (left <= 0) break;
      const s = this.slots[i];
      if (s && s.item === item) {
        const n = Math.min(s.count, left);
        s.count -= n;
        left -= n;
        if (s.count === 0) this.slots[i] = null;
      }
    }
    this.forget();
    this.onChange?.();
    return true;
  }

  count(item: string): number {
    let n = 0;
    for (const s of this.slots) if (s && s.item === item) n += s.count;
    return n;
  }

  select(slot: number) {
    this.selected = ((slot % 9) + 9) % 9;
    this.onChange?.();
  }

  clear() {
    this.slots.fill(null);
    this.selected = 0;
    this.guns.clear();
    this.onChange?.();
  }
}

class PickupImpl implements Pickup {
  readonly vel: Vec3;
  age = 0;
  settled = false;
  /** Resting on a solid prop: which, and where on it. */
  ride: { id: number; local: Vec3 } | null = null;
  removed = false;
  collectT = -1;
  constructor(
    readonly id: number,
    readonly item: string,
    readonly count: number,
    readonly pos: Vec3,
    readonly despawn: number,
    readonly beam: string | undefined,
    velocity: Vec3 | undefined,
    private onRemove: (p: PickupImpl) => void,
    /** The only player who can take it (their id), if it's theirs. */
    readonly owner: string | null = null,
  ) {
    this.vel = { x: velocity?.x ?? 0, y: velocity?.y ?? 0, z: velocity?.z ?? 0 };
  }
  get position(): Vec3 {
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z };
  }
  get alive(): boolean {
    return !this.removed;
  }
  remove() {
    if (!this.removed) {
      this.removed = true;
      this.onRemove(this);
    }
  }
}

/**
 * Items on the simulation side: definitions, pickups falling, settling, pulling toward the
 * nearest player and being collected. The client draws them from `frame()`.
 */
export class ItemSim implements ItemApi {
  readonly defs = new Map<string, ItemDefinition>();
  private pickups: PickupImpl[] = [];
  private nextId = 1;

  constructor(private s: ItemServices) {}

  define(id: string, def: ItemDefinition) {
    this.defs.set(id, def);
    this.s.content.defineItem(id, def);
  }

  get(id: string): ItemDefinition | undefined {
    return this.defs.get(id);
  }

  /** Ids of the defined items. */
  ids(): string[] {
    return [...this.defs.keys()];
  }

  atlas(name: string, source: HTMLCanvasElement | OffscreenCanvas | AtlasPixels) {
    this.s.content.defineAtlas(name, source);
  }

  spawnPickup(item: string, at: Vec3, opts: { count?: number; velocity?: Vec3; beam?: string; despawn?: number; for?: Player } = {}): Pickup {
    if (!this.defs.has(item)) throw new Error(`items.spawnPickup: unknown item "${item}"`);
    const p = new PickupImpl(
      this.nextId++,
      item,
      opts.count ?? 1,
      { x: at.x, y: at.y, z: at.z },
      opts.despawn ?? 90,
      opts.beam,
      opts.velocity,
      (x) => this.pickups.splice(this.pickups.indexOf(x), 1),
      opts.for?.id ?? null,
    );
    this.pickups.push(p);
    return p;
  }

  clearPickups() {
    for (const p of [...this.pickups]) p.remove();
  }

  update(dt: number, running: boolean) {
    if (!running) return;
    const ctx = this.s.ctx();
    const players = this.s.players();
    for (const p of [...this.pickups]) {
      p.age += dt;
      if (p.age > p.despawn) {
        p.remove();
        continue;
      }
      // Resting on a solid prop: where it's gone (or falling, once it's gone).
      if (p.settled && p.ride && !this.s.onProp(p.ride.id, p.ride.local, p.pos)) {
        p.ride = null;
        p.settled = false;
      }
      // Fall and settle 0.3 above the ground (or a solid prop's deck, riding it).
      if (!p.settled) {
        const was = p.pos.y;
        p.vel.y -= 22 * dt;
        p.pos.x += p.vel.x * dt;
        p.pos.y += p.vel.y * dt;
        p.pos.z += p.vel.z * dt;
        p.vel.x *= Math.exp(-2 * dt);
        p.vel.z *= Math.exp(-2 * dt);
        const deck = this.s.propUnder({ x: p.pos.x, y: Math.max(was, p.pos.y), z: p.pos.z }, Math.max(was, p.pos.y) - p.pos.y + 0.3);
        if (deck) {
          p.pos.y = deck.surface + 0.3;
          const local = this.s.propLocal(deck.id, p.pos);
          p.ride = local && { id: deck.id, local };
          p.vel.x = p.vel.y = p.vel.z = 0;
          p.settled = true;
        } else if (this.s.isSolid(Math.floor(p.pos.x), Math.floor(p.pos.y - 0.3), Math.floor(p.pos.z))) {
          p.pos.y = Math.floor(p.pos.y - 0.3) + 1.3;
          p.vel.x = p.vel.y = p.vel.z = 0;
          p.settled = true;
        }
      }
      if (p.age <= 0.5 || p.collectT >= 0) continue;
      // Pulled toward the nearest living player in reach (its owner, if it has one here), then
      // collected.
      const owner = p.owner !== null && players.some((pl) => pl.id === p.owner) ? p.owner : null;
      let who: Player | null = null;
      let d = 3.2;
      let dx = 0;
      let dy = 0;
      let dz = 0;
      for (const pl of players) {
        if (!pl.alive || (owner !== null && pl.id !== owner)) continue;
        const q = pl.position;
        const ex = q.x - p.pos.x;
        const ey = q.y + 0.9 - p.pos.y;
        const ez = q.z - p.pos.z;
        const e = Math.hypot(ex, ey, ez);
        if (e < d) {
          d = e;
          who = pl;
          dx = ex;
          dy = ey;
          dz = ez;
        }
      }
      if (!who) continue;
      const step = Math.min(d, dt * 9);
      p.pos.x += (dx / d) * step;
      p.pos.y += (dy / d) * step;
      p.pos.z += (dz / d) * step;
      p.settled = false;
      p.ride = null;
      p.vel.x = p.vel.y = p.vel.z = 0;
      if (d < 1.1) this.collect(p, ctx, who);
    }
  }

  private collect(p: PickupImpl, ctx: GameContext, player: Player) {
    const def = this.defs.get(p.item);
    if (!def) return p.remove();
    // Consumed on touch: the item's `onPickup` does its own thing (and sound).
    if (!def.onPickup?.(ctx, p.count, player)) {
      const left = player.inventory.give(p.item, p.count);
      if (left === p.count) return; // inventory full: leave it
      this.s.present.audio(player.id).play('pickup');
      player.hud.toast(`+${p.count > 1 ? `${p.count} ` : ''}${def.name}`);
    }
    this.s.emit('pickup', { player, item: p.item, count: p.count });
    p.remove();
  }

  frame(): PickupFrame[] {
    return this.pickups.map((p) => ({ id: p.id, item: p.item, x: p.pos.x, y: p.pos.y, z: p.pos.z, settled: p.settled, beam: p.beam }));
  }
}
