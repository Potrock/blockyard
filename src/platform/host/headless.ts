import { TerrainGen, VoxelWorld } from '@engine/voxel_engine.js';
import type { BlockRef, GameContext, GameDefinition } from '../api/types';
import { Content } from '../content';
import { loadEngineSync } from '../engine/wasm';
import { IDLE_INPUT, type ClientMessage, type PlayerInput, type PresentCall } from '../net/protocol';
import type { PlayerSim } from '../sim/player';
import { Sim } from '../sim/sim';
import type { WorldHost } from '../sim/world';
import { applyWorldConfig } from '../workers/config';
import type { WorldGenConfig } from '../workers/protocol';
import { loadRegistry } from '../world/registry';
import { groundSpawn, startSpawn, worldGenConfig } from './spawn';

/** A block store whose columns are generated on the spot around the players: no workers, no meshes. */
export class GeneratedWorld implements WorldHost {
  readonly world = new VoxelWorld();
  private gen: TerrainGen;

  constructor(seed: number, cfg: WorldGenConfig) {
    this.gen = new TerrainGen(seed);
    applyWorldConfig(this.gen, cfg);
  }

  /** Make sure every column within `radius` columns of (x, z) exists; returns how many were generated. */
  around(x: number, z: number, radius: number): number {
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    let n = 0;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (this.world.has_column(cx + dx, cz + dz)) continue;
        this.world.insert_column(cx + dx, cz + dz, this.gen.generate(cx + dx, cz + dz));
        n++;
      }
    }
    return n;
  }

  edit(x: number, y: number, z: number, id: number): boolean {
    return this.world.set_block(x, y, z, id);
  }

  editMany(cells: [number, number, number, number][]): number {
    let n = 0;
    for (const [x, y, z, id] of cells) if (this.world.set_block(x, y, z, id)) n++;
    return n;
  }

  revert(): number {
    return this.world.revert_edits().length / 2;
  }
}

export interface HeadlessOptions {
  /** The engine's compiled `.wasm` (engine/pkg/voxel_engine_bg.wasm). */
  wasm: BufferSource;
  seed?: number;
  /** Columns kept generated around each player (default 4: a 144 × 144 block square). */
  radius?: number;
  /** Chat commands like `/give` (default on). */
  cheats?: boolean;
}

/** What drives the local player each tick: any part of `PlayerInput` (keys held, clicks, view). */
export type Pilot = (h: Headless) => Partial<PlayerInput> | null;

/**
 * A game with no browser: its simulation, a world generated on the spot, and a record of the
 * presentation calls it makes, stepped as fast as the CPU allows. Tests and bots drive it; a
 * server hosts games the same way, with clients instead of a pilot.
 */
export class Headless {
  readonly sim: Sim;
  readonly world: GeneratedWorld;
  /** Every presentation call so far, in order (banners, screens, sounds…). */
  readonly calls: PresentCall[] = [];
  /** Simulated seconds since `start`. */
  time = 0;
  /** The game called `exit()`. */
  exited = false;
  private radius: number;

  constructor(def: GameDefinition, o: HeadlessOptions) {
    loadEngineSync(o.wasm);
    const registry = loadRegistry();
    const seed = (def.world?.seed ?? o.seed ?? 1) >>> 0;
    this.radius = o.radius ?? 4;
    const blockId = (b: BlockRef) => {
      if (typeof b === 'number') return b;
      const d = registry.byName.get(b);
      if (!d) throw new Error(`unknown block "${b}"`);
      return d.id;
    };
    const cfg = worldGenConfig(def, blockId);
    this.world = new GeneratedWorld(seed, cfg);
    this.sim = new Sim({
      def,
      seed,
      registry,
      world: this.world,
      content: new Content(),
      sink: (c) => this.calls.push(c),
      exit: () => (this.exited = true),
      cheats: o.cheats ?? true,
    });
    this.sim.setup();

    const { fixed, ...sp } = startSpawn(def, seed, cfg);
    this.world.around(sp.x, sp.z, this.radius);
    const ground = fixed ? null : groundSpawn(this.world.world, registry, (x, z) => this.sim.surfaceY(x, z), sp.x, sp.z);
    this.sim.spawn = { ...sp, ...ground };
    this.sim.local.place(this.sim.spawn.x, this.sim.spawn.y, this.sim.spawn.z, sp.yaw);
  }

  get ctx(): GameContext {
    return this.sim.ctx;
  }

  get me(): PlayerSim {
    return this.sim.local;
  }

  /** Play begins (the browser's click on the title screen). */
  start() {
    this.world.world.set_frozen(false);
    this.sim.start();
  }

  /** One tick. `input` is the local player's controls (idle when absent). */
  step(dt: number, input?: Partial<PlayerInput> | null) {
    for (const p of this.sim.players) this.world.around(p.state.x, p.state.z, this.radius);
    const me = this.sim.local;
    const full: PlayerInput = input
      ? { ...IDLE_INPUT, active: true, yaw: me.yaw, pitch: me.pitch, viewSeq: me.viewSeq, ...input }
      : IDLE_INPUT;
    this.sim.tick(dt, this.sim.started, { [me.id]: full });
    this.time += dt;
  }

  /**
   * Run for up to `seconds` of game time at `dt` per tick with `pilot` at the controls, stopping
   * early when `until` says so. Returns the simulated seconds that passed.
   */
  run(seconds: number, opts: { pilot?: Pilot; until?: (h: Headless) => boolean; dt?: number } = {}): number {
    const dt = opts.dt ?? 1 / 60;
    const t0 = this.time;
    while (this.time - t0 < seconds) {
      this.step(dt, opts.pilot?.(this));
      if (opts.until?.(this)) break;
    }
    return this.time - t0;
  }

  /** Something the player did on their client (a menu entry, a button). */
  send(m: ClientMessage) {
    this.sim.receive(m);
  }

  /** The calls to one `target.method` so far, newest last. */
  find(target: PresentCall['target'], method: string): PresentCall[] {
    return this.calls.filter((c) => c.target === target && c.method === method);
  }
}
