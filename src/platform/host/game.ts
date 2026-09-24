import { TerrainGen, VoxelWorld } from '@engine/voxel_engine.js';
import type { BlockRef, GameDefinition } from '../api/types';
import { Content } from '../content';
import { loadEngineSync } from '../engine/wasm';
import { IDLE_INPUT, type ClientCommand, type HostBatch, type HostEvent, type SaveState } from '../net/protocol';
import { Sim } from '../sim/sim';
import type { WorldHost } from '../sim/world';
import { applyWorldConfig } from '../workers/config';
import type { WorldGenConfig } from '../workers/protocol';
import { loadRegistry } from '../world/registry';
import { groundSpawn, startSpawn, worldGenConfig } from './spawn';

/** Columns generated straight away around the spawn, before the first tick. */
const CORE = 4;
/** Columns kept past the radius before they're dropped (so walking back and forth is free). */
const SLACK = 2;

/**
 * The simulation's own copy of the world: columns generated on the spot around the players (no
 * workers, no meshes), nearest first and a few per tick, and dropped when everyone is far away.
 * Edits survive dropping (the engine keeps them per column).
 */
export class GeneratedWorld {
  readonly world = new VoxelWorld();
  private gen: TerrainGen;
  private loaded = new Map<string, [number, number]>();
  private settled = '';
  private sweep = 0;

  constructor(seed: number, cfg: WorldGenConfig) {
    this.gen = new TerrainGen(seed);
    applyWorldConfig(this.gen, cfg);
  }

  /**
   * Generate up to `budget` missing columns within `radius` of the given points, nearest first,
   * and now and then drop those beyond reach. Returns how many were generated.
   */
  update(points: { x: number; z: number }[], radius: number, budget: number): number {
    const centres = points.map((p) => [Math.floor(p.x / 16), Math.floor(p.z / 16)] as const);
    const key = `${radius}|${centres.join(';')}`;
    let n = 0;
    if (key !== this.settled) {
      let missing = false;
      for (let r = 0; r <= radius && n < budget; r++) {
        for (const [cx, cz] of centres) {
          for (let dz = -r; dz <= r && n < budget; dz++) {
            for (let dx = -r; dx <= r && n < budget; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
              if (this.world.has_column(cx + dx, cz + dz)) continue;
              this.world.insert_column(cx + dx, cz + dz, this.gen.generate(cx + dx, cz + dz));
              this.loaded.set(`${cx + dx},${cz + dz}`, [cx + dx, cz + dz]);
              n++;
            }
          }
        }
      }
      for (const [cx, cz] of centres) {
        for (let dz = -radius; dz <= radius && !missing; dz++) {
          for (let dx = -radius; dx <= radius && !missing; dx++) missing = !this.world.has_column(cx + dx, cz + dz);
        }
      }
      if (!missing) this.settled = key;
    }
    if (++this.sweep >= 120) {
      this.sweep = 0;
      for (const [k, [cx, cz]] of this.loaded) {
        if (centres.some(([px, pz]) => Math.max(Math.abs(cx - px), Math.abs(cz - pz)) <= radius + SLACK)) continue;
        this.world.remove_column(cx, cz);
        this.loaded.delete(k);
      }
    }
    return n;
  }
}

export interface GameHostOptions {
  /** The engine: its compiled module (a worker gets the page's) or the `.wasm` bytes (Node). */
  engine: WebAssembly.Module | BufferSource;
  seed: number;
  /** A saved world to continue. */
  save?: SaveState | null;
  /** Chat commands like `/give`. */
  cheats?: boolean;
  /** Columns kept around each player (the client's view distance). */
  radius?: number;
  /** Columns generated per tick past the first few (`Infinity`: all at once, for tests). */
  budget?: number;
  /** Seconds per in-game day (the player's setting), unless the game freezes time. */
  dayLength?: number | null;
  /** Field of view a game-driven camera starts with (the player's setting). */
  fov?: number;
}

/**
 * Hosts one game: its simulation, on a world of its own, driven by `ClientCommand`s and
 * answering with `HostBatch`es. Where it runs is up to the transport: a worker in the page,
 * the page itself, Node for tests, a server.
 */
export class GameHost {
  readonly sim: Sim;
  readonly world: GeneratedWorld;
  radius: number;
  private budget: number;
  private events: HostEvent[] = [];

  constructor(
    readonly def: GameDefinition,
    o: GameHostOptions,
  ) {
    loadEngineSync(o.engine);
    const registry = loadRegistry();
    const seed = (def.world?.seed ?? o.seed) >>> 0;
    this.radius = o.radius ?? 8;
    this.budget = o.budget ?? 4;
    const blockId = (b: BlockRef) => {
      if (typeof b === 'number') return b;
      const d = registry.byName.get(b);
      if (!d) throw new Error(`unknown block "${b}"`);
      return d.id;
    };
    const cfg = worldGenConfig(def, blockId);
    const gw = (this.world = new GeneratedWorld(seed, cfg));
    const w = gw.world;
    const edited = (cells: [number, number, number, number][]) => this.events.push({ t: 'edits', cells });
    const host: WorldHost = {
      world: w,
      edit: (x, y, z, id) => {
        if (!w.set_block(x, y, z, id)) return false;
        edited([[x, y, z, id]]);
        return true;
      },
      editMany: (cells) => {
        const done = cells.filter(([x, y, z, id]) => w.set_block(x, y, z, id));
        if (done.length) edited(done);
        return done.length;
      },
      revert: () => {
        this.events.push({ t: 'revert' });
        return w.revert_edits().length / 2;
      },
    };
    const content = new Content();
    content.forward = (def) => this.events.push({ t: 'content', def });
    this.sim = new Sim({
      def,
      seed,
      registry,
      world: host,
      content,
      sink: (call) => this.events.push({ t: 'call', call }),
      exit: () => this.events.push({ t: 'exit' }),
      cheats: o.cheats ?? false,
    });
    if (o.dayLength && !def.world?.freezeTime) this.sim.env.dayLength = o.dayLength;
    this.sim.setup();

    // Where the player starts: the save, the game's spawn, or open ground near the generator's pick.
    const me = this.sim.local;
    const save = o.save;
    if (save) {
      w.import_edits(save.edits);
      const [x, y, z, yaw, pitch] = save.player;
      this.sim.env.time = save.time;
      this.sim.spawn = { x, y, z, yaw };
      gw.update([{ x, z }], CORE, Infinity);
      w.set_flying(save.flying && (def.player?.fly ?? false));
      me.place(x, y, z, yaw, pitch);
    } else {
      const { fixed, ...sp } = startSpawn(def, seed, cfg);
      gw.update([sp], CORE, Infinity);
      const ground = fixed ? null : groundSpawn(w, registry, (x, z) => this.sim.surfaceY(x, z), sp.x, sp.z);
      this.sim.spawn = { ...sp, ...ground };
      me.place(this.sim.spawn.x, this.sim.spawn.y, this.sim.spawn.z, sp.yaw);
    }
    if (o.fov) me.cam.fov = o.fov;
    w.set_frozen(true);
    this.events.push({ t: 'ready' });
  }

  /**
   * Run one command; a tick answers with everything that happened since the last batch. If the
   * game throws, the error goes to the client as an event and the host carries on (a tick still
   * answers, so the client never waits on it).
   */
  handle(c: ClientCommand): HostBatch | null {
    try {
      return this.run(c);
    } catch (err) {
      this.events.push({ t: 'error', text: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) });
      return c.t === 'tick' ? { events: this.flush(), frame: this.sim.frame() } : null;
    }
  }

  private run(c: ClientCommand): HostBatch | null {
    const sim = this.sim;
    switch (c.t) {
      case 'tick': {
        this.world.update(
          sim.players.map((p) => p.state),
          this.radius,
          this.budget,
        );
        sim.tick(c.dt, c.running && sim.started, { [sim.local.id]: c.input ?? IDLE_INPUT });
        return { events: this.flush(), frame: sim.frame() };
      }
      case 'message':
        sim.receive(c.msg);
        return null;
      case 'start': {
        const me = sim.local;
        this.world.world.set_frozen(me.health.dead);
        // The client's camera turned on the title screen: face where the player was placed.
        me.setView(me.yaw, me.pitch);
        sim.start();
        return null;
      }
      case 'restart':
        sim.restart();
        return null;
      case 'env':
        if (c.time !== undefined) sim.env.time = c.time;
        if (c.dayLength !== undefined && !this.def.world?.freezeTime) sim.env.dayLength = c.dayLength;
        return null;
      case 'radius':
        this.radius = c.columns;
        return null;
      case 'exec':
        this.events.push({ t: 'reply', id: c.id, value: sim.exec(c.line) });
        return null;
      case 'complete':
        this.events.push({ t: 'reply', id: c.id, value: sim.commands.complete(c.line) });
        return null;
    }
  }

  /** The events since the last batch (and forget them). */
  flush(): HostEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}
