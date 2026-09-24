import * as THREE from 'three';
import { TerrainGen } from '@engine/voxel_engine.js';
import { engine, loadEngine } from './engine/wasm';
import { WorkerPool } from './workers/pool';
import { applyWorldConfig } from './workers/config';
import type { WorldGenConfig } from './workers/protocol';
import { LAYER_CHUNKS, Renderer, type FrameHooks } from './render/pipeline';
import { Environment } from './render/environment';
import { BiomeMap, createBlockTextures, createNoiseTexture, type TextureSet } from './render/textures';
import { Particles } from './render/particles';
import { BlockHighlight } from './render/highlight';
import { ViewModel } from './render/viewmodel';
import { EntityGraphics } from './render/entities';
import { ChunkManager } from './world/chunks';
import { DEFAULT_TINT, loadRegistry, type Registry } from './world/registry';
import { Input } from './player/input';
import { PlayerController } from './player/controller';
import { Interaction } from './player/interaction';
import { PlayerHealth } from './player/health';
import { Combat } from './player/combat';
import { EntitySim } from './sim/entities';
import { EntityView } from './client/entities';
import { ItemSim } from './sim/items';
import { PickupView } from './client/pickups';
import { Effects } from './fx/effects';
import { Sfx } from './audio/sfx';
import { Hud } from './ui/hud';
import { GameHud } from './ui/hudkit';
import { DebugOverlay } from './ui/debug';
import { CommandBar } from './ui/commandbar';
import { Commands } from './commands';
import { Content } from './content';
import { Presentation } from './sim/present';
import { Presenter } from './client/present';
import { PropSim } from './sim/props';
import { PropView } from './client/props';
import { Inventory as BlockPicker, PauseMenu, TitleScreen } from './ui/screens';
import { blockIcon } from './ui/icons';
import { loadSettings, saveSettings, toRenderSettings, type Settings } from './settings';
import type { Actor, BlockRef, CameraApi, GameContext, GameDefinition, GameEvents, InputApi, ItemDefinition, Player, Rng, Vec3 } from './api/types';

type Mode = 'title' | 'playing' | 'paused' | 'picker' | 'console';

interface SaveData {
  edits: string;
  player: [number, number, number, number, number];
  flying: boolean;
  time: number;
}

const toB64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

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

/**
 * The platform runtime: engine, streaming world, renderer, player, entities, items, UI and the
 * game lifecycle. One `GameDefinition` runs per page.
 */
export class Runtime {
  mode: Mode = 'title';
  private settings: Settings;
  private renderer!: Renderer;
  private env = new Environment();
  private camera: THREE.PerspectiveCamera;
  private pool!: WorkerPool;
  private chunks!: ChunkManager;
  private registry!: Registry;
  private textures!: TextureSet;
  private input: Input;
  private controller!: PlayerController;
  private interaction: Interaction | null = null;
  /** `hud.highlight`: the outline and break cracks on one block. */
  private highlight = new BlockHighlight();
  private blockIcons = new Map<number, string>();
  private particles!: Particles;
  private hud!: Hud;
  private gameHud!: GameHud;
  private debug!: DebugOverlay;
  private title: TitleScreen;
  private pause!: PauseMenu;
  private picker: BlockPicker | null = null;
  private hooks!: FrameHooks;
  private held!: ViewModel;
  private graphics!: EntityGraphics;
  private entities!: EntitySim;
  private entityView!: EntityView;
  private items!: ItemSim;
  private pickupView!: PickupView;
  private combat!: Combat;
  private health!: PlayerHealth;
  private fx!: Effects;
  readonly sfx = new Sfx();
  private ctx!: GameContext;
  /** The game's sounds, atlases and animations. */
  private content = new Content();
  /** Simulation side of presentation: the game's hud / fx / audio / viewModel calls as messages. */
  private presentation!: Presentation;
  /** Client side: shows them for the local player. */
  private presenter!: Presenter;
  private commands!: Commands;
  private commandBar!: CommandBar;
  private last = performance.now();
  private spawnPending = true;
  private spawn: Vec3 = { x: 0.5, y: 80, z: 0.5 };
  private spawnYaw = Math.PI * 0.25;
  private hasSave = false;
  private worldReady = false;
  private started = false;
  /** First-person walker (default) or a game-driven camera (`player.controller: 'none'`). */
  private walker = true;
  /** Controls reach the game this frame (playing, mouse captured, no modal). */
  private active = false;
  private gameCam = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 70 };
  private props!: PropSim;
  private propView!: PropView;
  private hudVisible = true;
  private saveTimer = 0;
  private dir = new THREE.Vector3();
  private light = new THREE.Vector3();
  private probe = new THREE.Vector3(1, 1, 1);
  private probeFrame = 0;
  private listeners = new Map<string, Set<(e: unknown) => void>>();
  private timers: Timer[] = [];
  private clockNow = 0;
  private rng: Rng;
  private itemMode: boolean;
  private drawFrame = false;
  /** Development: treat input as active without pointer lock (headless tests). */
  debugActive = false;

  private constructor(
    private canvas: HTMLCanvasElement,
    private ui: HTMLElement,
    private def: GameDefinition,
    games: GameDefinition[],
    private seed: number,
  ) {
    this.settings = loadSettings();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.1, 400);
    this.camera.layers.enable(LAYER_CHUNKS);
    this.input = new Input(canvas);
    this.rng = mulberry32(seed ^ 0x9e3779b9);
    this.walker = (def.player?.controller ?? 'walk') === 'walk';
    this.itemMode = this.walker && (def.player?.hotbar ?? (def.player?.build ? 'blocks' : 'items')) === 'items';
    this.title = new TitleScreen(ui, seed, () => this.play(), games, def.id, (id) => this.switchGame(id), def.controls, (def.player?.controller ?? 'walk') === 'walk');
  }

  /** Boot the game selected by `?game=` (default: the first registered game). */
  static async start(canvas: HTMLCanvasElement, ui: HTMLElement, games: GameDefinition[], hidden: GameDefinition[] = []): Promise<Runtime> {
    const url = new URL(location.href);
    const id = url.searchParams.get('game');
    // Hidden games (dev previews) open by id but aren't listed in the launcher.
    const def = [...games, ...hidden].find((g) => g.id === id) ?? games[0];
    const seed = Runtime.chooseSeed(def);
    const rt = new Runtime(canvas, ui, def, games, seed);
    await rt.init();
    return rt;
  }

  private static chooseSeed(def: GameDefinition): number {
    if (def.world?.seed !== undefined) return def.world.seed >>> 0;
    const p = new URL(location.href).searchParams.get('seed');
    if (p !== null && p !== '' && Number.isFinite(Number(p))) return Number(p) >>> 0;
    if (def.world?.persist) {
      try {
        const last = localStorage.getItem(`voxel.${def.id}.lastSeed`);
        if (last) return Number(last) >>> 0;
      } catch {
        // ignore
      }
    }
    return (Math.random() * 2 ** 32) >>> 0;
  }

  // ---------------------------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------------------------

  private worldConfig(): WorldGenConfig {
    const w = this.def.world ?? {};
    const resolve = (b: BlockRef) => this.blockId(b);
    return {
      flat: w.terrain === 'flat' ? (w.flatHeight ?? 64) : undefined,
      void: w.terrain === 'void',
      terraforms: w.terraform ?? [],
      blueprints: (w.structures ?? []).map((s) => s.build(resolve)),
    };
  }

  private blockId(b: BlockRef): number {
    if (typeof b === 'number') return b;
    const def = this.registry.byName.get(b);
    if (!def) throw new Error(`unknown block "${b}"`);
    return def.id;
  }

  private async init() {
    const def = this.def;
    this.title.progress(0.02, 'Compiling WebAssembly engine…');
    const module = await loadEngine();
    this.registry = loadRegistry();
    if (def.world?.persist) {
      try {
        localStorage.setItem(`voxel.${def.id}.lastSeed`, String(this.seed));
      } catch {
        // ignore
      }
    }

    this.title.progress(0.06, 'Generating textures…');
    const worldCfg = this.worldConfig();
    const workers = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 2));
    const poolPromise = WorkerPool.create(module, this.seed, workers, worldCfg);

    const noise = createNoiseTexture();
    const torchLayer = this.registry.byName.get('torch')?.tex[0] ?? 0;
    this.renderer = new Renderer(this.canvas, toRenderSettings(this.settings), noise, torchLayer);
    this.renderer.fxScene.matrixWorldAutoUpdate = true;
    this.textures = createBlockTextures(this.renderer.gl);
    const biome = new BiomeMap(this.renderer.gl);
    this.renderer.setTextures(this.textures.albedo, this.textures.material, biome.texture);
    this.renderer.uniforms.uVoid.value = def.world?.terrain === 'void' ? 1 : 0;
    this.graphics = new EntityGraphics(this.renderer.uniforms);
    this.loadEntityAtlas();

    this.pool = await poolPromise;
    this.chunks = new ChunkManager(this.pool, this.renderer, biome, this.viewDistance(this.settings));
    this.chunks.occlusion = this.settings.occlusion;
    const world = this.chunks.world;

    this.particles = new Particles((x, y, z) => {
      const id = world.get_block(x, y, z);
      return id !== 255 && (this.registry.blocks[id]?.solid ?? false);
    });
    this.renderer.opaqueScene.add(this.particles.points);

    const icons = new Map<number, string>();
    for (const b of this.registry.blocks) if (b.id !== 0) icons.set(b.id, blockIcon(b, this.textures.albedoData));
    this.blockIcons = icons;
    this.hud = new Hud(this.ui, this.registry, icons);
    this.gameHud = new GameHud(this.ui, (ref) => (typeof ref === 'object' && 'block' in ref ? this.blockIcons.get(this.blockId(ref.block)) ?? '' : this.graphics.spriteIcon(ref, 96)));
    this.gameHud.onHighlight = (at, progress) => this.setHighlight(at, progress);
    this.gameHud.onScreen = (open) => {
      if (open) this.input.unlock();
      // Closed by a button click: grab the mouse again (needs a user gesture).
      else if (this.mode === 'playing' && navigator.userActivation?.isActive) this.input.lock();
    };
    this.gameHud.onCrosshair = (v) => this.hud.setCrosshair(v);
    if (!this.walker) this.hud.setHotbarVisible(false);
    this.debug = new DebugOverlay(this.ui);
    this.fx = new Effects(this.particles, this.gameHud, this.renderer.fxScene, this.sfx, () => this.camera.position);
    this.props = new PropSim(this.registry, (b) => this.blockId(b), this.content);
    this.propView = new PropView({
      shared: this.renderer.uniforms,
      albedo: this.textures.albedo,
      material: this.textures.material,
      registry: this.registry,
      resolve: (b) => this.blockId(b),
      scene: this.renderer.entityScene,
      fxScene: this.renderer.fxScene,
      world,
      content: this.content,
    });

    this.controller = new PlayerController(world, this.camera, this.input);
    this.controller.allowFlight = def.player?.fly ?? false;
    this.held = new ViewModel(this.textures.albedo, this.textures.material, this.graphics);
    this.renderer.overlay = { scene: this.held.scene, camera: this.held.camera };

    // The presentation boundary. In this page the calls go straight across; a worker or a server
    // would carry the same messages.
    this.presenter = new Presenter('local', { hud: this.gameHud, fx: this.fx, sfx: this.sfx, view: this.held, send: (m) => this.presentation.receive(m) });
    this.presentation = new Presentation((c) => this.presenter.apply(c), this.content);
    this.content.onSound((name, voice) => this.sfx.define(name, voice));
    this.content.onAnimation((name, anim) => this.held.define(name, anim));
    this.content.onAtlas((name, source) => {
      if ('pixels' in source) this.graphics.addAtlas(name, source.width, source.height, source.pixels, source.emissive);
      else this.graphics.addCanvasAtlas(name, source);
    });

    const emit = <K extends keyof GameEvents>(k: K, e: GameEvents[K]) => this.emit(k, e);
    const healthEmit = <K extends keyof GameEvents>(k: K, e: GameEvents[K]) => {
      if (k === 'playerDamage') this.held.kick(0.6);
      this.emit(k, e);
    };
    this.health = new PlayerHealth(world, this.sfx, this.fx, this.gameHud, healthEmit, () => this.playerPos(), () => this.ctx.player);
    this.health.configure(def.player ?? {});

    this.entities = new EntitySim({
      world,
      content: this.content,
      fx: this.presentation.fx(null),
      audio: this.presentation.audio(null),
      hud: this.presentation.hud(null),
      ctx: () => this.ctx,
      emit,
      dropItem: (item, at, count) => {
        if (this.items.get(item)) this.items.spawnPickup(item, at, { count, velocity: { x: this.rng.range(-2, 2), y: 4, z: this.rng.range(-2, 2) } });
      },
      localPlayer: () => this.ctx.player,
      players: () => this.ctx.players,
    });
    this.entityView = new EntityView(this.graphics, this.renderer.entityScene, world, this.content);
    this.items = new ItemSim({
      ctx: () => this.ctx,
      emit,
      players: () => this.ctx.players,
      isSolid: (x, y, z) => {
        const id = world.get_block(x, y, z);
        return id !== 255 && (this.registry.blocks[id]?.solid ?? false);
      },
      content: this.content,
      present: this.presentation,
    });
    this.pickupView = new PickupView({
      graphics: this.graphics,
      scene: this.renderer.entityScene,
      fxScene: this.renderer.fxScene,
      content: this.content,
      blockModel: (block, size) => this.propView.localCube(block, size),
    });
    this.items.inventory.onChange = () => this.syncInventory(true);
    this.combat = new Combat(world, this.entities, this.items, this.camera, this.sfx, this.fx, this.gameHud, this.held, () => this.ctx, () => {
      const s = this.controller.state;
      return !s.onGround && s.vy < -1 && !s.inWater;
    });

    this.renderer.opaqueScene.add(this.highlight.object);

    if (def.player?.build) {
      this.interaction = new Interaction(this.chunks, world, this.registry, this.particles, this.textures.albedoData);
      this.renderer.opaqueScene.add(this.interaction.outline);
      this.interaction.onSwing = () => this.held.use();
      this.interaction.onHotbarChange = () => {
        this.hud.setHotbar(this.interaction!.hotbar, this.interaction!.selected, true);
        this.held.setBlock(this.registry.blocks[this.interaction!.selectedBlock]);
      };
      this.hud.setHotbar(this.interaction.hotbar, this.interaction.selected, false);
      this.held.setBlock(this.registry.blocks[this.interaction.selectedBlock]);
      this.picker = new BlockPicker(this.ui, this.registry, icons, () => this.closePicker());
      this.picker.onPick = (id) => {
        this.interaction!.setSlot(this.interaction!.selected, id);
        this.hud.showToast(this.registry.blocks[id]?.label ?? '');
      };
    } else {
      this.syncInventory(false);
    }
    this.hud.setVisible(false);
    this.gameHud.setVisible(false);
    this.held.scene.visible = false;

    this.pause = new PauseMenu(this.ui, this.settings, (s) => this.applySettings(s), () => this.input.lock());
    this.pause.onTime = (t) => (this.env.time = t);
    this.pause.onNewWorld = (seed) => this.newWorld(seed);
    this.pause.onRestart = () => {
      this.pause.hide();
      this.restart();
      this.input.lock();
    };
    this.pause.onExit = () => this.exit();

    this.hooks = {
      shadowCull: (vp) => this.chunks.applyShadowVisibility(vp, this.camera.position, this.renderer.settings.shadowDistance),
      mainCull: () => this.chunks.applyMainVisibility(this.camera),
    };

    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.input.onKey = (code, e) => this.onKey(code, e);
    this.canvas.addEventListener('click', () => {
      this.sfx.unlock();
      if (this.mode === 'console') {
        this.commandBar.close();
        return;
      }
      if (this.gameHud.screenOpen) return;
      const unlockedPlay = this.mode === 'playing' && !this.input.locked;
      if (this.mode === 'paused' || unlockedPlay || (this.mode === 'title' && this.worldReady)) this.input.lock();
    });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('beforeunload', () => this.save());
    document.addEventListener('visibilitychange', () => document.hidden && this.save());

    this.env.time = def.world?.time ?? 0.3;
    this.env.paused = def.world?.freezeTime ?? false;
    this.commands = new Commands(() => this.ctx);
    this.commandBar = new CommandBar(this.ui);
    this.commandBar.complete = (line) => this.commands.complete(line);
    this.commandBar.onClose = () => {
      if (this.mode !== 'console') return;
      this.mode = 'playing';
      this.input.lock();
    };
    this.commandBar.onSubmit = (line) => {
      this.commandBar.print(`/${line.replace(/^\/+/, '')}`, 'echo');
      const r = this.commands.exec(line);
      this.commandBar.print(r.text, r.ok ? 'ok' : 'error');
    };
    this.ctx = this.createContext();
    this.registerCommands();
    def.setup?.(this.ctx);
    // After setup: the skin may live in an atlas the game registers there.
    if (def.player?.skin) this.held.setSkin(def.player.skin, def.player.skinAtlas);

    this.applySettings(this.settings, false);
    this.resize();
    this.load();
    this.renderer.warmup(this.camera);
    this.title.progress(0.1, 'Generating terrain…');
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Built-in monster / item atlas generated in Rust (placeholder until the module exists). */
  private loadEntityAtlas() {
    const gen = (engine as unknown as { entity_textures?: () => Uint8Array }).entity_textures;
    const size = 256;
    if (gen) {
      const all = gen();
      this.graphics.addAtlas('builtin', size, size, all.slice(0, size * size * 4), all.slice(size * size * 4, size * size * 5));
    } else {
      const px = new Uint8Array(size * size * 4);
      for (let i = 0; i < size * size; i++) {
        const x = i % size;
        const y = Math.floor(i / size);
        const c = ((x >> 3) + (y >> 3)) & 1 ? 150 : 110;
        px.set([c, c + 20, c, 255], i * 4);
      }
      this.graphics.addAtlas('builtin', size, size, px);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Game context (public API implementation)
  // ---------------------------------------------------------------------------------------------

  private playerPos(): Vec3 {
    const s = this.controller.state;
    return { x: s.x, y: s.y, z: s.z };
  }

  private emit<K extends keyof GameEvents>(event: K, e: GameEvents[K]) {
    const set = this.listeners.get(event);
    if (set) for (const fn of [...set]) fn(e);
  }

  private createContext(): GameContext {
    const rt = this;
    const world = this.chunks.world;
    const reg = this.registry;
    const camera: CameraApi = {
      get position() {
        const p = rt.camera.position;
        return { x: p.x, y: p.y, z: p.z };
      },
      get forward() {
        const d = rt.camera.getWorldDirection(new THREE.Vector3());
        return { x: d.x, y: d.y, z: d.z };
      },
      set(pos, target, up) {
        const c = rt.gameCam;
        c.pos.set(pos.x, pos.y, pos.z);
        const m = new THREE.Matrix4().lookAt(c.pos, new THREE.Vector3(target.x, target.y, target.z), new THREE.Vector3(up?.x ?? 0, up?.y ?? 1, up?.z ?? 0));
        c.quat.setFromRotationMatrix(m);
      },
      setPose(pos, q) {
        rt.gameCam.pos.set(pos.x, pos.y, pos.z);
        rt.gameCam.quat.set(q.x, q.y, q.z, q.w).normalize();
      },
      get fov() {
        return rt.walker ? rt.camera.fov : rt.gameCam.fov;
      },
      set fov(v: number) {
        rt.gameCam.fov = Math.max(10, Math.min(150, v));
      },
    };
    const input: InputApi = {
      isDown: (c) => rt.active && rt.input.isDown(c),
      pressed: (c) => rt.active && rt.input.pressed(c),
      button: (b) => rt.active && rt.input.button(b),
      buttonPressed: (b) => rt.active && rt.input.buttonPressed(b),
      consume: (what) => rt.input.consume(what),
      get mouseX() {
        return rt.active ? rt.input.mouseDX : 0;
      },
      get mouseY() {
        return rt.active ? rt.input.mouseDY : 0;
      },
      get wheel() {
        return rt.active ? rt.input.wheel : 0;
      },
    };
    // The player on this machine. A server keeps one of these per connected player.
    const player: Player = {
      kind: 'player',
      id: 'local',
      name: 'Player',
      hud: this.presentation.hud('local'),
      input,
      camera,
      get position() {
        return rt.playerPos();
      },
      get eye() {
        const s = rt.controller.state;
        return { x: s.x, y: s.y + 1.62, z: s.z };
      },
      get velocity() {
        const s = rt.controller.state;
        return { x: s.vx, y: s.vy, z: s.vz };
      },
      get look() {
        const d = rt.camera.getWorldDirection(new THREE.Vector3());
        return { x: d.x, y: d.y, z: d.z };
      },
      get yaw() {
        return rt.controller.yaw;
      },
      get pitch() {
        return rt.controller.pitch;
      },
      get onGround() {
        return rt.controller.state.onGround;
      },
      get health() {
        return rt.health.health;
      },
      set health(v: number) {
        rt.health.health = Math.max(0, Math.min(rt.health.max, v));
        rt.health.refresh();
      },
      get maxHealth() {
        return rt.health.max;
      },
      set maxHealth(v: number) {
        rt.health.max = v;
        rt.health.health = Math.min(rt.health.health, v);
        rt.health.refresh();
      },
      get alive() {
        return !rt.health.dead;
      },
      inventory: this.items.inventory,
      teleport: (pos, yaw, pitch) => {
        world.player_reset(pos.x, pos.y, pos.z);
        if (yaw !== undefined) rt.controller.yaw = yaw;
        if (pitch !== undefined) rt.controller.pitch = pitch;
      },
      damage: (amount, opts) => rt.health.damage(amount, opts),
      heal: (amount) => rt.health.heal(amount),
      revive: () => rt.health.revive(),
      impulse: (x, y, z) => world.player_impulse(x, y, z),
      freeze: (f) => world.set_frozen(f),
      viewModel: this.presentation.view('local'),
      get armor() {
        return rt.health.armor;
      },
      set armor(v: number) {
        rt.health.armor = v;
      },
    };
    const ctx: GameContext = {
      world: {
        getBlock: (x, y, z) => {
          const id = world.get_block(Math.floor(x), Math.floor(y), Math.floor(z));
          return id === 255 ? -1 : id;
        },
        setBlock: (x, y, z, block) => rt.chunks.editBlock(Math.floor(x), Math.floor(y), Math.floor(z), rt.blockId(block)),
        blockId: (name) => rt.blockId(name),
        blockName: (id) => reg.blocks[id]?.name ?? 'unknown',
        raycast: (o, d, max) => {
          const r = world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, max);
          return r[0] ? { x: r[1], y: r[2], z: r[3], normal: { x: r[4], y: r[5], z: r[6] }, block: r[7] } : null;
        },
        lineOfSight: (a, b) => world.line_clear(a.x, a.y, a.z, b.x, b.y, b.z),
        surfaceY: (x, z) => rt.surfaceY(Math.floor(x), Math.floor(z)),
        explode: (c, r, opts) => rt.explode(c, r, opts),
        breakBlock: (x, y, z, opts) => rt.breakBlockAt(Math.floor(x), Math.floor(y), Math.floor(z), opts?.by ?? 'world'),
        blockInfo: (block) => {
          const d = rt.registry.blocks[typeof block === 'number' ? block : rt.registry.byName.get(block)?.id ?? -1];
          return d ? { id: d.id, name: d.name, label: d.label, solid: d.solid, liquid: d.shape === 'liquid', plant: d.shape === 'cross', replaceable: d.replaceable, light: d.emit } : null;
        },
        placeBlock: (x, y, z, block, opts) => rt.placeBlockAt(Math.floor(x), Math.floor(y), Math.floor(z), block, opts?.by ?? 'world'),
        seaLevel: engine.sea_level(),
      },
      players: [player],
      player,
      entities: this.entities,
      items: this.items,
      hud: this.presentation.hud(null),
      fx: this.presentation.fx(null),
      audio: this.presentation.audio(null),
      camera,
      input,
      props: this.props,
      env: {
        get time() {
          return rt.env.time;
        },
        set time(t: number) {
          rt.env.time = ((t % 1) + 1) % 1;
        },
        get frozen() {
          return rt.env.paused;
        },
        set frozen(f: boolean) {
          rt.env.paused = f;
        },
      },
      events: {
        on: (event, fn) => {
          let set = rt.listeners.get(event);
          if (!set) {
            set = new Set();
            rt.listeners.set(event, set);
          }
          const f = fn as (e: unknown) => void;
          set.add(f);
          return () => set!.delete(f);
        },
      },
      clock: {
        get now() {
          return rt.clockNow;
        },
        after: (seconds, fn) => rt.addTimer(seconds, 0, fn),
        every: (seconds, fn) => rt.addTimer(seconds, seconds, fn),
      },
      rng: this.rng,
      get commands() {
        return rt.commands;
      },
      restart: () => rt.restart(),
      exit: () => rt.exit(),
    };
    return ctx;
  }

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

  /** Carve a ragged sphere (bedrock and liquids survive), scatter debris, set off an explosion. */
  private explode(c: Vec3, radius: number, opts: { effect?: boolean; filter?: (at: Vec3, block: string) => boolean; by?: Actor } = {}): number {
    const world = this.chunks.world;
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
    const n = this.chunks.editBlocks(cells);
    for (const [x, y, z, id] of removed) this.emit('blockBreak', { x, y, z, block: this.registry.blocks[id].name, by: opts.by ?? 'world' });
    // Debris from a sample of what was destroyed.
    for (let i = 0; i < Math.min(12, removed.length); i++) {
      const [x, y, z, id] = removed[Math.floor(Math.random() * removed.length)];
      const def = this.registry.blocks[id];
      const face = def.tex[0];
      this.particles.burst(x, y, z, this.textures.albedoData.subarray(face * 1024, face * 1024 + 1024), null);
    }
    if (opts.effect !== false) this.fx.explosion(c, { size: Math.max(1, r / 2) });
    return n;
  }

  /** Break a block: debris, a sound, the plant on top, the event. */
  private breakBlockAt(x: number, y: number, z: number, by: Actor): boolean {
    const world = this.chunks.world;
    const id = world.get_block(x, y, z);
    if (id === 0 || id === 255) return false;
    const def = this.registry.blocks[id];
    if (!def || def.name === 'bedrock' || def.shape === 'liquid') return false;
    if (!this.chunks.editBlock(x, y, z, 0)) return false;
    const face = def.tex[0];
    this.particles.burst(x, y, z, this.textures.albedoData.subarray(face * 1024, face * 1024 + 1024), def.tint ? DEFAULT_TINT : null);
    this.sfx.play('hit', { at: { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, volume: 0.45, pitch: 1.6 });
    const above = world.get_block(x, y + 1, z);
    if (this.registry.blocks[above]?.shape === 'cross') this.chunks.editBlock(x, y + 1, z, 0);
    this.emit('blockBreak', { x, y, z, block: def.name, by });
    return true;
  }

  /** Place a block: a free cell nobody is standing in, ground under plants, a sound, the event. */
  private placeBlockAt(x: number, y: number, z: number, block: BlockRef, by: Actor): boolean {
    const world = this.chunks.world;
    const id = this.blockId(block);
    const def = this.registry.blocks[id];
    if (!def || y < 0 || y > 255) return false;
    const cur = world.get_block(x, y, z);
    if (cur === 255 || !(this.registry.blocks[cur]?.replaceable ?? false)) return false;
    if (def.solid) {
      if (this.walker && world.player_overlaps(x, y, z)) return false;
      for (const e of this.entities.near({ x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 3)) {
        const p = e.position;
        const box = this.entities.hitbox(e);
        const hw = box.width / 2;
        // A little slack so a body standing on the block's top face (or brushing its side) doesn't count.
        if (Math.abs(p.x - (x + 0.5)) < 0.49 + hw && Math.abs(p.z - (z + 0.5)) < 0.49 + hw && p.y < y + 0.98 && p.y + box.height > y + 0.02) return false;
      }
    }
    if (def.shape === 'cross' && !this.registry.blocks[world.get_block(x, y - 1, z)]?.solid) return false;
    if (!this.chunks.editBlock(x, y, z, id)) return false;
    this.sfx.play('click', { at: { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, volume: 0.5, pitch: 0.7 });
    this.emit('blockPlace', { x, y, z, block: def.name, by });
    return true;
  }

  /** `hud.highlight`: outline a block, with break cracks at `progress`. */
  private setHighlight(at: Vec3 | null, progress?: number) {
    if (!at) return this.highlight.set(null);
    const id = this.chunks.world.get_block(Math.floor(at.x), Math.floor(at.y), Math.floor(at.z));
    this.highlight.set(at, this.registry.blocks[id]?.shape === 'cross', progress);
  }

  private surfaceY(x: number, z: number): number {
    const w = this.chunks.world;
    for (let y = 255; y > 0; y--) {
      const id = w.get_block(x, y, z);
      if (id === 255) return -1;
      const d = this.registry.blocks[id];
      if (d && d.shape !== 'air' && d.shape !== 'cross') return y;
    }
    return 0;
  }

  /** Reset game state and call `start` again. */
  restart() {
    this.entities.clear();
    this.entityView.clear();
    this.props.clear();
    this.propView.clear();
    // Put the world back the way it was generated (craters, broken blocks), unless the game
    // saves the world (Sandbox keeps your builds).
    if (!this.def.world?.persist) this.chunks.revertEdits();
    this.items.clearPickups();
    this.pickupView.clear();
    this.items.inventory.clear();
    this.timers = [];
    this.clockNow = 0;
    this.presentation.reset();
    this.presenter.reset();
    this.gameHud.clear();
    this.highlight.set(null);
    this.fx.clear();
    this.combat.reset();
    this.health.configure(this.def.player ?? {});
    this.health.revive();
    this.chunks.world.player_reset(this.spawn.x, this.spawn.y, this.spawn.z);
    this.controller.yaw = this.spawnYaw;
    this.controller.pitch = 0;
    this.env.time = this.def.world?.time ?? this.env.time;
    this.def.start?.(this.ctx);
    this.syncInventory(false);
  }

  exit() {
    this.save();
    const url = new URL(location.href);
    url.searchParams.delete('game');
    url.searchParams.delete('seed');
    location.href = url.toString();
  }

  private switchGame(id: string) {
    this.save();
    const url = new URL(location.href);
    url.searchParams.set('game', id);
    url.searchParams.delete('seed');
    location.href = url.toString();
  }

  // ---------------------------------------------------------------------------------------------
  // Persistence & spawn
  // ---------------------------------------------------------------------------------------------

  private get saveKey() {
    return `voxel.${this.def.id}.world.${this.seed}`;
  }

  private load() {
    const w = this.chunks.world;
    const opts = this.def.world ?? {};
    let save: SaveData | null = null;
    if (opts.persist) {
      try {
        const raw = localStorage.getItem(this.saveKey);
        if (raw) save = JSON.parse(raw) as SaveData;
      } catch {
        save = null;
      }
    }
    if (save) {
      try {
        w.import_edits(fromB64(save.edits));
      } catch {
        // Corrupt edits are ignored.
      }
      const [x, y, z, yaw, pitch] = save.player;
      w.player_reset(x, y, z);
      w.set_flying(save.flying && (this.def.player?.fly ?? false));
      this.controller.yaw = yaw;
      this.controller.pitch = pitch;
      this.env.time = save.time;
      this.spawn = { x, y, z };
      this.hasSave = true;
    } else if (opts.spawn && opts.spawn !== 'auto') {
      this.spawn = { ...opts.spawn };
      this.spawnYaw = opts.spawnYaw ?? 0;
      w.player_reset(this.spawn.x, this.spawn.y, this.spawn.z);
      this.controller.yaw = this.spawnYaw;
      this.hasSave = true;
    } else {
      const gen = new TerrainGen(this.seed);
      applyWorldConfig(gen, this.worldConfig());
      const s = gen.find_spawn();
      gen.free();
      this.spawn = { x: s[0] + 0.5, y: s[1] + 2, z: s[2] + 0.5 };
      w.player_reset(this.spawn.x, this.spawn.y, this.spawn.z);
      this.controller.yaw = this.spawnYaw;
    }
    w.set_frozen(true);
    this.controller.update(0, false);
    // A game-driven camera starts where the player would have stood.
    this.gameCam.pos.copy(this.camera.position);
    this.gameCam.quat.copy(this.camera.quaternion);
    this.gameCam.fov = this.settings.fov;
  }

  private save() {
    if (!this.chunks || !this.def.world?.persist) return;
    const s = this.controller.state;
    const data: SaveData = {
      edits: toB64(this.chunks.world.export_edits()),
      player: [s.x, s.y, s.z, this.controller.yaw, this.controller.pitch],
      flying: s.flying,
      time: this.env.time,
    };
    try {
      localStorage.setItem(this.saveKey, JSON.stringify(data));
    } catch {
      // Quota exceeded: keep playing without persistence.
    }
  }

  private newWorld(seed: number | null) {
    this.save();
    const s = seed ?? (Math.random() * 2 ** 32) >>> 0;
    const url = new URL(location.href);
    url.searchParams.set('game', this.def.id);
    url.searchParams.set('seed', String(s));
    location.href = url.toString();
  }

  private updateSpawn() {
    const w = this.chunks.world;
    const sx = Math.floor(this.spawn.x);
    const sz = Math.floor(this.spawn.z);
    if (this.spawnPending && w.has_column(Math.floor(sx / 16), Math.floor(sz / 16))) {
      if (!this.hasSave) {
        const ground = new Set(['grass_block', 'dirt', 'sand', 'snowy_grass', 'podzol', 'stone', 'gravel']);
        let placed = false;
        for (let r = 0; r <= 12 && !placed; r++) {
          for (let dz = -r; dz <= r && !placed; dz++) {
            for (let dx = -r; dx <= r && !placed; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
              const x = sx + dx;
              const z = sz + dz;
              const y = this.surfaceY(x, z);
              const top = this.registry.blocks[w.get_block(x, y, z)];
              if (y > 0 && top && ground.has(top.name) && w.get_block(x, y + 1, z) !== 255) {
                this.spawn = { x: x + 0.5, y: y + 1.02, z: z + 0.5 };
                w.player_reset(this.spawn.x, this.spawn.y, this.spawn.z);
                placed = true;
              }
            }
          }
        }
      }
      this.spawnPending = false;
    }
    const s = this.controller.state;
    const ready = this.chunks.readiness(s.x, s.z, Math.min(this.settings.renderDistance, 6));
    if (!this.worldReady) {
      this.title.progress(0.1 + 0.9 * ready, ready < 1 ? `Generating terrain… ${Math.round(ready * 100)}%` : 'Ready');
      if (ready >= 0.999 && !this.spawnPending) {
        this.worldReady = true;
        this.title.setReady();
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Modes & input
  // ---------------------------------------------------------------------------------------------

  private play() {
    this.sfx.unlock();
    if (this.worldReady) this.input.lock();
  }

  private onLockChange(locked: boolean) {
    if (locked) {
      if (this.mode === 'title') {
        this.title.hide();
        this.hud.setVisible(this.hudVisible);
        this.gameHud.setVisible(this.hudVisible);
        this.held.scene.visible = this.hudVisible;
        this.chunks.world.set_frozen(this.health.dead);
      }
      this.pause.hide();
      this.picker?.hide();
      this.mode = 'playing';
      if (!this.started) {
        this.started = true;
        this.def.start?.(this.ctx);
        this.syncInventory(false);
      }
    } else if (this.mode === 'playing' && !this.gameHud.screenOpen) {
      this.mode = 'paused';
      this.pause.show(this.env.time);
      this.save();
    }
  }

  private onKey(code: string, e?: KeyboardEvent) {
    if (this.mode === 'console') return;
    // Match the character, not the key position: '/' is Shift+7 on many layouts.
    if ((e?.key === '/' || code === 'Slash' || code === 'KeyT') && this.mode === 'playing') {
      e?.preventDefault();
      this.mode = 'console';
      this.input.unlock();
      this.commandBar.open('/');
      return;
    }
    if (code === 'F3') this.debug.toggle();
    if (code === 'F1') {
      this.hudVisible = !this.hudVisible;
      if (this.mode !== 'title') {
        this.hud.setVisible(this.hudVisible);
        this.gameHud.setVisible(this.hudVisible);
        this.held.scene.visible = this.hudVisible;
      }
    }
    if (code === 'KeyE' && this.picker) {
      if (this.mode === 'playing') {
        this.mode = 'picker';
        this.picker.show();
        this.input.unlock();
      } else if (this.mode === 'picker') {
        this.closePicker();
      }
    }
    if (this.mode === 'playing' && this.def.player?.build) {
      if (code === 'BracketLeft') this.env.time = (this.env.time - 1 / 24 + 1) % 1;
      if (code === 'BracketRight') this.env.time = (this.env.time + 1 / 24) % 1;
    }
  }

  /** Built-in commands: `/help` always; the cheats in development or when the game allows them. */
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
    if (!import.meta.env.DEV && !this.def.cheats) return;
    const num = (v: string | undefined, name: string) => {
      const n = Number(v);
      if (v === undefined || v === '' || !Number.isFinite(n)) throw new Error(`Expected a number for ${name}`);
      return n;
    };
    c.register('give', {
      usage: '<item> [count]',
      help: 'Put an item in your hand',
      complete: (args) => (args.length <= 1 ? this.items.ids() : []),
      run: ([id, n], _g, player) => {
        if (!this.itemMode) throw new Error('This game has no item hotbar');
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
      run: () => {
        this.controller.allowFlight = !this.controller.allowFlight;
        if (!this.controller.allowFlight) this.chunks.world.set_flying(false);
        return this.controller.allowFlight ? 'Flight on' : 'Flight off';
      },
    });
  }

  private closePicker() {
    this.picker?.hide();
    this.mode = 'playing';
    this.input.lock();
  }

  /** Hotbar + held item for item mode. */
  private syncInventory(announce: boolean) {
    if (!this.itemMode || !this.hud) return;
    const inv = this.items.inventory;
    this.hud.setSlots(
      inv.slots.map((s) => {
        if (!s) return null;
        const d = this.items.get(s.item);
        return d ? { icon: this.itemIcon(d, 48), count: s.count, label: d.name } : null;
      }),
      inv.selected,
      announce,
    );
    this.updateHeldItem();
  }

  /** The icon an item shows: its sprite, or its block. */
  private itemIcon(d: ItemDefinition, size: number): string {
    const icon = d.icon;
    if (typeof icon === 'object' && 'block' in icon) return this.blockIcons.get(this.blockId(icon.block)) ?? '';
    return this.graphics.spriteIcon(icon, size);
  }

  /** Item games, per frame: the built-in weapons (after the game has had its say on the mouse). */
  private updateHands(dt: number, active: boolean) {
    this.combat.update(dt, this.input, active);
    this.held.draw = this.combat.isDrawing ? this.combat.charge : 0;
    this.updateHeldItem();
  }

  private updateHeldItem() {
    const stack = this.items.inventory.held;
    const def = stack ? this.items.get(stack.item) : undefined;
    if (!def) {
      this.held.setEmpty();
      return;
    }
    if (typeof def.icon === 'object' && 'block' in def.icon) {
      // Looks like a block: held as a little cube of it.
      this.held.setBlock(this.registry.blocks[this.blockId(def.icon.block)]);
      return;
    }
    const drawn = def.kind === 'bow' && this.combat.isDrawing && this.combat.charge > 0.25;
    const icon = drawn && def.kind === 'bow' ? def.drawIcon ?? def.icon : def.icon;
    // The item's 3D model if it names one (`hold.model`); otherwise its sprite, extruded.
    const model = def.hold?.model;
    const { geometry, atlas } = model && !drawn ? this.graphics.heldModelGeometry(model) : this.graphics.spriteGeometry(icon);
    const a = this.graphics.atlas(atlas);
    const style = def.kind === 'melee' ? 'sword' : def.kind === 'bow' ? 'bow' : 'item';
    if (def.kind === 'bow' && drawn !== this.drawFrame) {
      this.drawFrame = drawn;
      this.held.swapItemGeometry(geometry);
      return;
    }
    this.held.setItem(geometry, a.albedo, a.emissive, def.hold ?? {}, style);
  }

  /** The player's render distance, raised to the game's minimum (`world.viewDistance`). */
  private viewDistance(s: Settings): number {
    return Math.max(s.renderDistance, Math.min(24, this.def.world?.viewDistance ?? 0));
  }

  private applySettings(s: Settings, persist = true) {
    this.settings = { ...s };
    this.renderer.applySettings(toRenderSettings(s));
    const rd = this.viewDistance(s);
    if (this.chunks.renderDistance !== rd) this.chunks.setRenderDistance(rd);
    this.chunks.occlusion = s.occlusion;
    this.controller.sensitivity = s.sensitivity;
    this.controller.baseFov = s.fov;
    this.controller.viewBobbing = s.viewBobbing;
    if (!this.def.world?.freezeTime) this.env.dayLength = s.dayMinutes * 60;
    this.camera.far = Math.max(256, (rd + 1.5) * 16 * 1.08);
    this.camera.updateProjectionMatrix();
    this.renderer.fogEnd = (rd - 0.35) * 16;
    this.resize();
    if (persist) saveSettings(s);
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setSize(w, h, dpr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.particles?.setViewport(h * dpr * this.settings.renderScale, this.camera.fov);
  }

  // ---------------------------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------------------------

  private frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    const t0 = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const playing = this.mode === 'playing';
    const running = playing && this.started;
    const active = playing && (this.input.locked || this.debugActive) && !this.health.dead && !this.gameHud.screenOpen;
    this.active = active;
    this.sfx.hold(this.started && (this.mode === 'paused' || this.mode === 'console'));

    this.env.update(dt);
    if (this.walker) {
      if (this.mode === 'title') {
        this.controller.yaw += dt * 0.03;
        this.controller.pitch = -0.18;
      }
      this.controller.update(dt, active);
      if (this.mode === 'title') {
        this.camera.position.y += 22;
        this.camera.updateMatrixWorld();
      }
    } else {
      // No walking body: it stays put (games may teleport it, e.g. to follow a vehicle).
      this.chunks.world.set_frozen(true);
      if (this.mode === 'title') this.gameCam.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.03));
    }
    this.updateSpawn();

    const s = this.controller.state;
    if (running) {
      this.tickTimers(dt);
      this.def.update?.(this.ctx, dt);
      this.health.update(dt, s.onGround, s.vy);
    }
    if (!this.walker) {
      // After the game's update, so the camera it set this frame is the one we draw.
      const c = this.gameCam;
      this.camera.position.copy(c.pos);
      this.camera.quaternion.copy(c.quat);
      if (this.camera.fov !== c.fov) {
        this.camera.fov = c.fov;
        this.camera.updateProjectionMatrix();
      }
      this.camera.updateMatrixWorld();
    }
    this.entities.update(dt, running);
    const ef = this.entities.frame();
    this.entityView.sync(ef.entities, ef.projectiles, dt, running);
    this.items.update(dt, running);
    this.pickupView.sync(this.items.frame(), dt);
    this.props.update(dt);
    this.propView.sync(this.props.frame(), dt);
    if (this.itemMode) this.updateHands(dt, active);

    if (this.walker) {
      this.controller.viewDirection(this.dir);
      this.chunks.update(s.x, s.z, this.dir.x, this.dir.z);
    } else {
      this.camera.getWorldDirection(this.dir);
      this.chunks.update(this.camera.position.x, this.camera.position.z, this.dir.x, this.dir.z);
    }
    if (this.interaction) this.interaction.update(dt, this.camera, this.input, active);

    // Light probe at the player's eyes drives the held item and particles.
    if (++this.probeFrame % 4 === 0) {
      const p = this.camera.position;
      const l = this.chunks.world.light_probe(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      const sky = l[0] * l[0];
      const blk = Math.pow(l[1], 2.2);
      this.probe
        .copy(this.env.ambientSky)
        .multiplyScalar(0.9 * sky)
        .addScaledVector(this.env.lightColor, 0.55 * sky)
        .add(new THREE.Vector3(1.0, 0.6, 0.28).multiplyScalar(1.4 * blk))
        .addScalar(0.012);
    }
    this.light.copy(this.probe);
    this.particles.setLight(this.light);
    this.particles.update(dt);
    this.fx.update(dt);
    this.held.setLight(this.probe);
    if (this.walker) this.updateHand(dt, s);
    // Camera effects: shake and the death tilt.
    this.camera.position.add(this.fx.shakeOffset);
    if (this.walker && this.health.dead) {
      const k = Math.min(1, this.health.deathTime / 0.6);
      this.camera.position.y -= k * 1.2;
      this.camera.rotateZ(k * 0.45);
    }
    this.camera.updateMatrixWorld();
    this.sfx.setListener(this.camera.position, this.walker ? this.controller.yaw : Math.atan2(-this.dir.x, -this.dir.z));
    this.present(dt, playing, t0);
  }

  private updateHand(dt: number, s: PlayerController['state']) {
    const bobAmt = this.settings.viewBobbing && s.onGround && !s.flying ? Math.min(1, Math.hypot(s.vx, s.vz) / 4.3) : 0;
    this.held.update(dt, {
      aspect: this.camera.aspect,
      bobPhase: s.bob * Math.PI * 0.9,
      bobAmount: bobAmt,
      yaw: this.controller.yaw,
      pitch: this.controller.pitch,
      onGround: s.onGround,
      vy: s.vy,
      down: this.health.dead,
      strength: this.itemMode ? this.combat.strength : 1,
    });
  }

  /** Render, HUD, autosave, debug overlay, end of input frame. */
  private present(dt: number, playing: boolean, t0: number) {
    const medium = this.camera.position.y < 256 ? this.eyeMedium() : 'air';
    this.hud.setMedium(medium);
    this.renderer.render(this.camera, this.env, this.hooks, medium === 'water' ? 1 : medium === 'lava' ? 2 : 0);
    this.gameHud.update(dt, this.camera, window.innerWidth, window.innerHeight);

    this.saveTimer += dt;
    if (this.saveTimer > 15 && playing) {
      this.saveTimer = 0;
      this.save();
    }
    const cpu = performance.now() - t0;
    this.debug.tick(dt, cpu);
    if (this.debug.visible) this.updateDebug();
    this.input.endFrame();
  }

  private eyeMedium(): 'air' | 'water' | 'lava' {
    const p = this.camera.position;
    const w = this.chunks.world;
    const id = w.get_block(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    const name = this.registry.blocks[id]?.name;
    if (name === 'water') {
      const above = this.registry.blocks[w.get_block(Math.floor(p.x), Math.floor(p.y) + 1, Math.floor(p.z))]?.name;
      if (above === 'water' || p.y - Math.floor(p.y) < 0.875) return 'water';
    }
    if (name === 'lava') return 'lava';
    return 'air';
  }

  private updateDebug() {
    const s = this.controller.state;
    const c = this.chunks.stats();
    const r = this.renderer;
    const yawDeg = ((((-this.controller.yaw * 180) / Math.PI) % 360) + 360) % 360;
    const facing = ['north (-Z)', 'east (+X)', 'south (+Z)', 'west (-X)'][Math.round(yawDeg / 90) % 4];
    const rs = r.settings;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    this.debug.set([
      `VOXEL platform · ${this.def.title}`,
      `${Math.round(this.debug.fpsValue)} fps   cpu ${this.debug.cpu.toFixed(2)} ms`,
      '',
      `XYZ      ${s.x.toFixed(2)} / ${s.y.toFixed(2)} / ${s.z.toFixed(2)}`,
      `Chunk    ${Math.floor(s.x / 16)}, ${Math.floor(s.z / 16)}   section ${Math.floor(s.y / 16)}`,
      `Facing   ${facing}   pitch ${((this.controller.pitch * 180) / Math.PI).toFixed(1)}°`,
      `Motion   ${s.flying ? 'flying' : s.inWater ? 'swimming' : s.onGround ? 'grounded' : 'airborne'}   ${Math.hypot(s.vx, s.vz).toFixed(2)} m/s`,
      `Time     ${this.env.clock()}   game clock ${this.clockNow.toFixed(1)} s`,
      `Entities ${this.entities.count()} alive`,
      '',
      `Columns  ${c.loaded} loaded · ${c.meshed} meshed · ${c.pending} pending upload`,
      `Workers  ${this.pool.size} · gen ${c.generating} (${c.genMs.toFixed(2)} ms) · mesh ${c.meshing} (${c.meshMs.toFixed(2)} ms)`,
      `Draws    ${r.stats.calls} (shadow ${r.stats.shadowCalls}) · ${(r.stats.triangles / 1e6).toFixed(2)}M tris`,
      `Culling  ${c.visibleSections} sections visible · cave culling ${this.chunks.occlusion ? 'on' : 'off'}`,
      `Render   ${Math.round(r.width * rs.renderScale)}x${Math.round(r.height * rs.renderScale)} · MSAA ${rs.msaa}x · shadows ${rs.shadowRes || 'off'}`,
      mem ? `JS heap  ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : '',
    ]);
  }

  // ---------------------------------------------------------------------------------------------
  // Development hooks (automated browser tests)
  // ---------------------------------------------------------------------------------------------

  debugPlay() {
    this.title.hide();
    this.hud.setVisible(true);
    this.gameHud.setVisible(true);
    this.held.scene.visible = true;
    this.mode = 'playing';
    this.chunks.world.set_frozen(false);
    if (!this.started) {
      this.started = true;
      this.def.start?.(this.ctx);
      this.syncInventory(false);
    }
  }

  get context(): GameContext {
    return this.ctx;
  }

  debugInfo() {
    return {
      game: this.def.id,
      mode: this.mode,
      ready: this.worldReady,
      state: { ...this.controller.state },
      health: this.health.health,
      entities: this.entities.count(),
      chunks: this.chunks.stats(),
      render: { ...this.renderer.stats },
      time: this.env.time,
      fps: this.debug.fpsValue,
      cpu: this.debug.cpu,
    };
  }

  debugView(yaw: number, pitch: number) {
    this.controller.yaw = yaw;
    this.controller.pitch = pitch;
  }

  debugSetTime(t: number) {
    this.env.time = t;
  }

  debugToggle(key: string) {
    this.onKey(key);
  }

  debugInput(): Input {
    return this.input;
  }
}
