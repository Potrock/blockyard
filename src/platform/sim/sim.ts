import * as engine from '@engine/voxel_engine.js';
import type { Actor, BlockRef, GameContext, GameDefinition, GameEvents, Rng, Vec3 } from '../api/types';
import { Commands } from '../commands';
import type { Content } from '../content';
import { IDLE_INPUT, type ClientMessage, type PlayerInput } from '../net/protocol';
import type { Registry } from '../world/registry';
import { CreativeBuild } from './creative';
import { EntitySim, type EntityFrame, type ProjectileFrame } from './entities';
import { ItemSim, type PickupFrame } from './items';
import { PlayerSim, type PlayerFrame } from './player';
import { Presentation, type Sink } from './present';
import { PropSim, type PropFrame } from './props';
import type { WorldHost } from './world';

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
  };
}

interface Timer {
  at: number;
  every: number;
  fn: () => void;
  dead: boolean;
}

/** Everything the clients need to show one tick. */
export interface SimFrame {
  /** Game clock (seconds since `start`). */
  clock: number;
  /** Time of day, 0..1. */
  time: number;
  players: PlayerFrame[];
  entities: EntityFrame[];
  projectiles: ProjectileFrame[];
  pickups: PickupFrame[];
  props: PropFrame[];
  /** Creative building's hotbar (`player.build`). */
  creative: { hotbar: number[]; selected: number } | null;
}

export interface SimOptions {
  def: GameDefinition;
  seed: number;
  registry: Registry;
  world: WorldHost;
  content: Content;
  /** Presentation calls out to the clients. */
  sink: Sink;
  /** `game.exit()`: back to the launcher. */
  exit(): void;
  /** The built-in cheat commands (development builds, or the game allows them). */
  cheats: boolean;
}

/**
 * The simulation: the game's rules and its world, headless. It owns the blocks (through its
 * `WorldHost`), the players, entities, items, props, clock, events and commands, runs the game's
 * lifecycle hooks against the `GameContext`, and describes each tick to the clients as a
 * `SimFrame` plus presentation calls. It never touches the DOM or WebGL, so it can run in a
 * page, a worker or on a server.
 */
export class Sim {
  readonly def: GameDefinition;
  readonly registry: Registry;
  readonly host: WorldHost;
  readonly content: Content;
  readonly presentation: Presentation;
  readonly entities: EntitySim;
  readonly items: ItemSim;
  readonly props: PropSim;
  readonly players: PlayerSim[] = [];
  /** The player on this machine (the engine's built-in body). */
  readonly local: PlayerSim;
  readonly creative: CreativeBuild | null = null;
  readonly commands: Commands;
  readonly ctx: GameContext;
  readonly rng: Rng;
  /** Time of day and how it moves. */
  readonly env = { time: 0.3, frozen: false, dayLength: 1200 };
  /** Where `restart` puts the players back. */
  spawn = { x: 0.5, y: 80, z: 0.5, yaw: 0 };
  started = false;
  private listeners = new Map<string, Set<(e: unknown) => void>>();
  private timers: Timer[] = [];
  private clockNow = 0;

  constructor(private o: SimOptions) {
    this.def = o.def;
    this.registry = o.registry;
    this.host = o.world;
    this.content = o.content;
    this.rng = mulberry32(o.seed ^ 0x9e3779b9);
    const world = o.world.world;
    const emit = <K extends keyof GameEvents>(k: K, e: GameEvents[K]) => this.emit(k, e);
    this.presentation = new Presentation(o.sink, o.content);
    this.entities = new EntitySim({
      world,
      content: o.content,
      fx: this.presentation.fx(null),
      audio: this.presentation.audio(null),
      hud: this.presentation.hud(null),
      ctx: () => this.ctx,
      emit,
      dropItem: (item, at, count) => {
        if (this.items.get(item)) this.items.spawnPickup(item, at, { count, velocity: { x: this.rng.range(-2, 2), y: 4, z: this.rng.range(-2, 2) } });
      },
      localPlayer: () => this.local.api,
      players: () => this.ctx.players,
    });
    this.items = new ItemSim({
      ctx: () => this.ctx,
      emit,
      players: () => this.ctx.players,
      isSolid: (x, y, z) => {
        const id = world.get_block(x, y, z);
        return id !== 255 && (this.registry.blocks[id]?.solid ?? false);
      },
      content: o.content,
      present: this.presentation,
    });
    this.props = new PropSim(this.registry, (b) => this.blockId(b), o.content);
    this.local = new PlayerSim({
      id: 'local',
      name: 'Player',
      world,
      options: o.def.player ?? {},
      present: this.presentation,
      entities: this.entities,
      items: this.items,
      ctx: () => this.ctx,
      emit,
    });
    this.players.push(this.local);
    if (o.def.player?.build) this.creative = new CreativeBuild(o.world, world, this.registry, this.presentation, this.local, (x, y, z) => this.breakBlockAt(x, y, z, this.local.api));
    this.env.time = o.def.world?.time ?? 0.3;
    this.env.frozen = o.def.world?.freezeTime ?? false;
    this.commands = new Commands(() => this.ctx);
    this.ctx = this.createContext();
    this.registerCommands();
  }

  blockId(b: BlockRef): number {
    if (typeof b === 'number') return b;
    const def = this.registry.byName.get(b);
    if (!def) throw new Error(`unknown block "${b}"`);
    return def.id;
  }

  emit<K extends keyof GameEvents>(event: K, e: GameEvents[K]) {
    const set = this.listeners.get(event);
    if (set) for (const fn of [...set]) fn(e);
  }

  // ---------------------------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------------------------

  /** The game's `setup`: it defines its content and subscribes to events. */
  setup() {
    this.def.setup?.(this.ctx);
  }

  /** Play begins. */
  start() {
    if (this.started) return;
    this.started = true;
    this.def.start?.(this.ctx);
  }

  /**
   * One tick: time of day, players move with their controls, then (while running) timers and the
   * game's `update`, health, entities, items and props, and finally the built-in hands.
   */
  tick(dt: number, running: boolean, inputs: Record<string, PlayerInput>) {
    if (!this.env.frozen) this.env.time = (this.env.time + dt / this.env.dayLength) % 1;
    for (const p of this.players) {
      p.input.set(inputs[p.id] ?? IDLE_INPUT);
      p.move(dt);
    }
    if (running) {
      this.tickTimers(dt);
      this.def.update?.(this.ctx, dt);
      for (const p of this.players) p.updateHealth(dt);
    }
    this.entities.update(dt, running);
    this.items.update(dt, running);
    this.props.update(dt);
    for (const p of this.players) p.updateHands(dt, running);
    this.creative?.update(dt);
  }

  frame(): SimFrame {
    const e = this.entities.frame();
    return {
      clock: this.clockNow,
      time: this.env.time,
      players: this.players.map((p) => p.frame()),
      entities: e.entities,
      projectiles: e.projectiles,
      pickups: this.items.frame(),
      props: this.props.frame(),
      creative: this.creative ? { hotbar: [...this.creative.hotbar], selected: this.creative.selected } : null,
    };
  }

  /** Something a player did on their client (menus, callbacks, the block picker). */
  receive(m: ClientMessage) {
    if (m.t === 'creativePick') this.creative?.pick(m.block);
    else this.presentation.receive(m);
  }

  /** A command typed by a player. */
  exec(line: string, player = this.local) {
    return this.commands.exec(line, player.api);
  }

  /** Reset game state and call `start` again. The clients clear their HUDs and views. */
  restart() {
    this.entities.clear();
    this.props.clear();
    // Put the world back the way it was generated (craters, broken blocks), unless the game
    // saves the world (Sandbox keeps your builds).
    if (!this.def.world?.persist) this.host.revert();
    this.items.clearPickups();
    this.timers = [];
    this.clockNow = 0;
    this.presentation.reset();
    this.presentation.send(null, 'client', 'reset', []);
    const world = this.host.world;
    for (const p of this.players) {
      p.inventory.clear();
      p.reset();
      p.health.configure(this.def.player ?? {});
      p.health.revive();
    }
    world.player_reset(this.spawn.x, this.spawn.y, this.spawn.z);
    this.local.syncState();
    this.local.setView(this.spawn.yaw, 0);
    this.env.time = this.def.world?.time ?? this.env.time;
    this.def.start?.(this.ctx);
  }

  // ---------------------------------------------------------------------------------------------
  // Timers
  // ---------------------------------------------------------------------------------------------

  private addTimer(delay: number, every: number, fn: () => void): () => void {
    const t: Timer = { at: this.clockNow + delay, every, fn, dead: false };
    this.timers.push(t);
    return () => {
      t.dead = true;
    };
  }

  private tickTimers(dt: number) {
    this.clockNow += dt;
    for (let i = 0; i < this.timers.length; i++) {
      const t = this.timers[i];
      if (t.dead) continue;
      if (this.clockNow >= t.at) {
        if (t.every > 0) t.at += t.every;
        else t.dead = true;
        t.fn();
      }
    }
    this.timers = this.timers.filter((t) => !t.dead);
  }

  // ---------------------------------------------------------------------------------------------
  // World edits
  // ---------------------------------------------------------------------------------------------

  /** Debris flying off a broken block (the client draws it from the block's texture). */
  private debris(x: number, y: number, z: number, id: number) {
    this.presentation.send(null, 'client', 'debris', [x, y, z, id]);
  }

  /** Carve a ragged sphere (bedrock and liquids survive), scatter debris, set off an explosion. */
  explode(c: Vec3, radius: number, opts: { effect?: boolean; filter?: (at: Vec3, block: string) => boolean; by?: Actor } = {}): number {
    const world = this.host.world;
    const r = Math.max(0.5, radius);
    const ri = Math.ceil(r + 1);
    const cx = Math.floor(c.x);
    const cy = Math.floor(c.y);
    const cz = Math.floor(c.z);
    const cells: [number, number, number, number][] = [];
    const removed: [number, number, number, number][] = [];
    for (let dy = -ri; dy <= ri; dy++)
      for (let dz = -ri; dz <= ri; dz++)
        for (let dx = -ri; dx <= ri; dx++) {
          const d = Math.hypot(dx + 0.5 + cx - c.x, dy + 0.5 + cy - c.y, dz + 0.5 + cz - c.z);
          if (d > r + (Math.random() - 0.5) * 1.2) continue;
          const x = cx + dx;
          const y = cy + dy;
          const z = cz + dz;
          const id = world.get_block(x, y, z);
          if (id === 0 || id === 255) continue;
          const def = this.registry.blocks[id];
          if (!def || def.name === 'bedrock' || def.shape === 'liquid') continue;
          if (opts.filter && !opts.filter({ x, y, z }, def.name)) continue;
          cells.push([x, y, z, 0]);
          removed.push([x, y, z, id]);
        }
    const n = this.host.editMany(cells);
    for (const [x, y, z, id] of removed) this.emit('blockBreak', { x, y, z, block: this.registry.blocks[id].name, by: opts.by ?? 'world' });
    // Debris from a sample of what was destroyed.
    for (let i = 0; i < Math.min(12, removed.length); i++) {
      const [x, y, z, id] = removed[Math.floor(Math.random() * removed.length)];
      this.debris(x, y, z, id);
    }
    if (opts.effect !== false) this.ctx.fx.explosion(c, { size: Math.max(1, r / 2) });
    return n;
  }

  /** Break a block: debris, a sound, the plant on top, the event. */
  breakBlockAt(x: number, y: number, z: number, by: Actor): boolean {
    const world = this.host.world;
    const id = world.get_block(x, y, z);
    if (id === 0 || id === 255) return false;
    const def = this.registry.blocks[id];
    if (!def || def.name === 'bedrock' || def.shape === 'liquid') return false;
    if (!this.host.edit(x, y, z, 0)) return false;
    this.debris(x, y, z, id);
    this.ctx.audio.play('hit', { at: { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, volume: 0.45, pitch: 1.6 });
    const above = world.get_block(x, y + 1, z);
    if (this.registry.blocks[above]?.shape === 'cross') this.host.edit(x, y + 1, z, 0);
    this.emit('blockBreak', { x, y, z, block: def.name, by });
    return true;
  }

  /** Place a block: a free cell nobody is standing in, ground under plants, a sound, the event. */
  placeBlockAt(x: number, y: number, z: number, block: BlockRef, by: Actor): boolean {
    const world = this.host.world;
    const id = this.blockId(block);
    const def = this.registry.blocks[id];
    if (!def || y < 0 || y > 255) return false;
    const cur = world.get_block(x, y, z);
    if (cur === 255 || !(this.registry.blocks[cur]?.replaceable ?? false)) return false;
    if (def.solid) {
      if (this.local.walker && world.player_overlaps(x, y, z)) return false;
      for (const e of this.entities.near({ x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 3)) {
        const p = e.position;
        const box = this.entities.hitbox(e);
        const hw = box.width / 2;
        // A little slack so a body standing on the block's top face (or brushing its side) doesn't count.
        if (Math.abs(p.x - (x + 0.5)) < 0.49 + hw && Math.abs(p.z - (z + 0.5)) < 0.49 + hw && p.y < y + 0.98 && p.y + box.height > y + 0.02) return false;
      }
    }
    if (def.shape === 'cross' && !this.registry.blocks[world.get_block(x, y - 1, z)]?.solid) return false;
    if (!this.host.edit(x, y, z, id)) return false;
    this.ctx.audio.play('click', { at: { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, volume: 0.5, pitch: 0.7 });
    this.emit('blockPlace', { x, y, z, block: def.name, by });
    return true;
  }

  surfaceY(x: number, z: number): number {
    const w = this.host.world;
    for (let y = 255; y > 0; y--) {
      const id = w.get_block(x, y, z);
      if (id === 255) return -1;
      const d = this.registry.blocks[id];
      if (d && d.shape !== 'air' && d.shape !== 'cross') return y;
    }
    return 0;
  }

  // ---------------------------------------------------------------------------------------------
  // The game context (the public API)
  // ---------------------------------------------------------------------------------------------

  private createContext(): GameContext {
    const sim = this;
    const world = this.host.world;
    const reg = this.registry;
    const local = this.local.api;
    const players = this.players.map((p) => p.api);
    return {
      world: {
        getBlock: (x, y, z) => {
          const id = world.get_block(Math.floor(x), Math.floor(y), Math.floor(z));
          return id === 255 ? -1 : id;
        },
        setBlock: (x, y, z, block) => sim.host.edit(Math.floor(x), Math.floor(y), Math.floor(z), sim.blockId(block)),
        blockId: (name) => sim.blockId(name),
        blockName: (id) => reg.blocks[id]?.name ?? 'unknown',
        raycast: (o, d, max) => {
          const r = world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, max);
          return r[0] ? { x: r[1], y: r[2], z: r[3], normal: { x: r[4], y: r[5], z: r[6] }, block: r[7] } : null;
        },
        lineOfSight: (a, b) => world.line_clear(a.x, a.y, a.z, b.x, b.y, b.z),
        surfaceY: (x, z) => sim.surfaceY(Math.floor(x), Math.floor(z)),
        explode: (c, r, opts) => sim.explode(c, r, opts),
        breakBlock: (x, y, z, opts) => sim.breakBlockAt(Math.floor(x), Math.floor(y), Math.floor(z), opts?.by ?? 'world'),
        placeBlock: (x, y, z, block, opts) => sim.placeBlockAt(Math.floor(x), Math.floor(y), Math.floor(z), block, opts?.by ?? 'world'),
        blockInfo: (block) => {
          const d = reg.blocks[typeof block === 'number' ? block : reg.byName.get(block)?.id ?? -1];
          return d ? { id: d.id, name: d.name, label: d.label, solid: d.solid, liquid: d.shape === 'liquid', plant: d.shape === 'cross', replaceable: d.replaceable, light: d.emit } : null;
        },
        seaLevel: engine.sea_level(),
      },
      players,
      player: local,
      entities: this.entities,
      items: this.items,
      hud: this.presentation.hud(null),
      fx: this.presentation.fx(null),
      audio: this.presentation.audio(null),
      camera: local.camera,
      input: local.input,
      props: this.props,
      env: {
        get time() {
          return sim.env.time;
        },
        set time(t: number) {
          sim.env.time = ((t % 1) + 1) % 1;
        },
        get frozen() {
          return sim.env.frozen;
        },
        set frozen(f: boolean) {
          sim.env.frozen = f;
        },
      },
      events: {
        on: (event, fn) => {
          let set = sim.listeners.get(event);
          if (!set) {
            set = new Set();
            sim.listeners.set(event, set);
          }
          const f = fn as (e: unknown) => void;
          set.add(f);
          return () => set!.delete(f);
        },
      },
      clock: {
        get now() {
          return sim.clockNow;
        },
        after: (seconds, fn) => sim.addTimer(seconds, 0, fn),
        every: (seconds, fn) => sim.addTimer(seconds, seconds, fn),
      },
      rng: this.rng,
      commands: this.commands,
      restart: () => sim.restart(),
      exit: () => sim.o.exit(),
    };
  }

  /** Built-in commands: `/help` always; the cheats when allowed. */
  private registerCommands() {
    const c = this.commands;
    c.register('help', {
      help: 'List commands',
      run: () =>
        c
          .list()
          .map(([n, s]) => `/${n}${s.usage ? ` ${s.usage}` : ''}${s.help ? `  ${s.help}` : ''}`)
          .join('\n'),
    });
    if (!this.o.cheats) return;
    const num = (v: string | undefined, name: string) => {
      const n = Number(v);
      if (v === undefined || v === '' || !Number.isFinite(n)) throw new Error(`Expected a number for ${name}`);
      return n;
    };
    const simOf = (id: string) => this.players.find((p) => p.id === id) ?? this.local;
    c.register('give', {
      usage: '<item> [count]',
      help: 'Put an item in your hand',
      complete: (args) => (args.length <= 1 ? this.items.ids() : []),
      run: ([id, n], _g, player) => {
        if (!simOf(player.id).itemMode) throw new Error('This game has no item hotbar');
        if (!id) throw new Error('Which item? Tab lists them');
        const def = this.items.get(id);
        if (!def) throw new Error(`Unknown item "${id}"`);
        const count = n === undefined ? 1 : Math.max(1, Math.floor(num(n, 'count')));
        const inv = player.inventory;
        const left = inv.give(id, count);
        if (left === count) throw new Error('Your hotbar is full');
        const slot = inv.slots.findIndex((st) => st?.item === id);
        if (slot >= 0) inv.select(slot);
        return `Gave ${count - left} ${def.name}`;
      },
    });
    c.register('heal', {
      help: 'Full health (revives you if dead)',
      run: (_, _g, player) => {
        if (!player.alive) player.revive();
        else player.health = player.maxHealth;
        return 'Healed';
      },
    });
    const times: Record<string, number> = { midnight: 0, dawn: 0.26, day: 0.35, noon: 0.5, dusk: 0.74, night: 0.85 };
    c.register('time', {
      usage: '<day|noon|dusk|night|midnight|0..1>',
      help: 'Set the time of day',
      complete: () => Object.keys(times),
      run: ([t], g) => {
        const v = t !== undefined && t in times ? times[t] : num(t, 'time');
        g.env.time = ((v % 1) + 1) % 1;
        return `Time set to ${t}`;
      },
    });
    c.register('tp', {
      usage: '<x> <y> <z>',
      help: 'Teleport (~ for relative, e.g. ~ ~10 ~)',
      run: (args, _g, player) => {
        if (args.length !== 3) throw new Error('Need x, y and z');
        const p = player.position;
        const [x, y, z] = args.map((a, i) => {
          const base = [p.x, p.y, p.z][i];
          return a.startsWith('~') ? base + (a.length > 1 ? num(a.slice(1), 'offset') : 0) : num(a, 'xyz'[i]);
        });
        player.teleport({ x, y, z });
        return `Teleported to ${x.toFixed(1)} ${y.toFixed(1)} ${z.toFixed(1)}`;
      },
    });
    c.register('spawn', {
      usage: '<entity> [count]',
      help: 'Spawn creatures in front of you',
      complete: (args) => (args.length <= 1 ? this.entities.typeNames() : []),
      run: ([type, n], g, player) => {
        if (!type || !this.entities.typeNames().includes(type)) throw new Error(type ? `Unknown entity "${type}"` : 'Which entity? Tab lists them');
        const count = n === undefined ? 1 : Math.min(50, Math.max(1, Math.floor(num(n, 'count'))));
        const p = player.position;
        const l = player.look;
        const len = Math.hypot(l.x, l.z) || 1;
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2;
          const x = p.x + (l.x / len) * 5 + (count > 1 ? Math.cos(a) * 1.5 : 0);
          const z = p.z + (l.z / len) * 5 + (count > 1 ? Math.sin(a) * 1.5 : 0);
          g.entities.spawn(type, { x, y: g.world.surfaceY(x, z) + 1, z });
        }
        return `Spawned ${count} ${type}`;
      },
    });
    c.register('kill', {
      help: 'Kill every creature',
      run: (_, g) => {
        const all = g.entities.all();
        for (const e of all) e.damage(1e9, { source: 'world', knockback: 0 });
        return `Killed ${all.length}`;
      },
    });
    c.register('fly', {
      help: 'Toggle flight (double-tap Space)',
      run: (_, _g, player) => {
        const p = simOf(player.id);
        p.allowFlight = !p.allowFlight;
        if (!p.allowFlight) this.host.world.set_flying(false);
        return p.allowFlight ? 'Flight on' : 'Flight off';
      },
    });
  }
}
