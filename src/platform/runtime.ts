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
import { Effects } from './fx/effects';
import { Sfx } from './audio/sfx';
import { Hud } from './ui/hud';
import { GameHud } from './ui/hudkit';
import { DebugOverlay } from './ui/debug';
import { CommandBar } from './ui/commandbar';
import { Content } from './content';
import { Presenter } from './client/present';
import { PlayerCamera } from './client/camera';
import { EntityView } from './client/entities';
import { PickupView } from './client/pickups';
import { PropView } from './client/props';
import { Sim, type SimFrame } from './sim/sim';
import type { PlayerFrame } from './sim/player';
import type { WorldHost } from './sim/world';
import { Inventory as BlockPicker, PauseMenu, TitleScreen } from './ui/screens';
import { blockIcon } from './ui/icons';
import { loadSettings, saveSettings, toRenderSettings, type Settings } from './settings';
import type { BlockRef, GameContext, GameDefinition, ItemDefinition, ItemStack, Vec3 } from './api/types';

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

/**
 * The browser runtime: the client (renderer, streaming world, HUD, audio, input, first-person
 * view) with the simulation (`Sim`) running in the same page. Each frame it sends the player's
 * controls to the simulation, ticks it, and draws the `SimFrame` it returns; presentation calls
 * arrive through the `Presenter`. One `GameDefinition` runs per page.
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
  /** Mouse look and the first-person camera (the client's side of the player). */
  private view!: PlayerCamera;
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
  private entityView!: EntityView;
  private pickupView!: PickupView;
  private propView!: PropView;
  private fx!: Effects;
  readonly sfx = new Sfx();
  /** The game's sounds, atlases, animations, entity and item types. */
  private content = new Content();
  private presenter!: Presenter;
  /** The simulation: the game's rules and world. */
  private sim!: Sim;
  private frameData: SimFrame | null = null;
  private commandBar!: CommandBar;
  private last = performance.now();
  private spawnPending = true;
  private hasSave = false;
  private worldReady = false;
  /** First-person walker (default) or a game-driven camera (`player.controller: 'none'`). */
  private walker = true;
  private itemMode: boolean;
  private hudVisible = true;
  private saveTimer = 0;
  private dir = new THREE.Vector3();
  private light = new THREE.Vector3();
  private probe = new THREE.Vector3(1, 1, 1);
  private probeFrame = 0;
  private titleSpin = 0;
  /** What's on screen, to redraw only on change. */
  private shown = { health: '', hotbar: '', creative: '', held: '' };
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
    this.walker = (def.player?.controller ?? 'walk') === 'walk';
    this.itemMode = this.walker && (def.player?.hotbar ?? (def.player?.build ? 'blocks' : 'items')) === 'items';
    this.title = new TitleScreen(ui, seed, () => this.play(), games, def.id, (id) => this.switchGame(id), def.controls, this.walker);
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
    this.entityView = new EntityView(this.graphics, this.renderer.entityScene, world, this.content);
    this.pickupView = new PickupView({
      graphics: this.graphics,
      scene: this.renderer.entityScene,
      fxScene: this.renderer.fxScene,
      content: this.content,
      blockModel: (block, size) => this.propView.localCube(block, size),
    });

    this.view = new PlayerCamera(this.camera);
    this.held = new ViewModel(this.textures.albedo, this.textures.material, this.graphics);
    this.renderer.overlay = { scene: this.held.scene, camera: this.held.camera };
    this.renderer.opaqueScene.add(this.highlight.object);

    // The game's content reaches the client's renderer and audio as it's defined.
    this.content.onSound((name, voice) => this.sfx.define(name, voice));
    this.content.onAnimation((name, anim) => this.held.define(name, anim));
    this.content.onAtlas((name, source) => {
      if ('pixels' in source) this.graphics.addAtlas(name, source.width, source.height, source.pixels, source.emissive);
      else this.graphics.addCanvasAtlas(name, source);
    });

    // The simulation, and the presentation boundary between it and this client. In this page the
    // calls go straight across; a worker or a server would carry the same messages.
    this.presenter = new Presenter('local', {
      hud: this.gameHud,
      fx: this.fx,
      sfx: this.sfx,
      view: this.held,
      send: (m) => this.sim.receive(m),
      client: (method, args) => this.clientCall(method, args),
    });
    const host: WorldHost = {
      world,
      edit: (x, y, z, id) => this.chunks.editBlock(x, y, z, id),
      editMany: (cells) => this.chunks.editBlocks(cells),
      revert: () => this.chunks.revertEdits(),
    };
    this.sim = new Sim({
      def,
      seed: this.seed,
      registry: this.registry,
      world: host,
      content: this.content,
      sink: (c) => this.presenter.apply(c),
      exit: () => this.exit(),
      cheats: import.meta.env.DEV || !!def.cheats,
    });

    if (def.player?.build) {
      this.picker = new BlockPicker(this.ui, this.registry, icons, () => this.closePicker());
      this.picker.onPick = (id) => {
        this.sim.receive({ t: 'creativePick', player: 'local', block: id });
        this.hud.showToast(this.registry.blocks[id]?.label ?? '');
      };
    }
    this.hud.setVisible(false);
    this.gameHud.setVisible(false);
    this.held.scene.visible = false;

    this.pause = new PauseMenu(this.ui, this.settings, (s) => this.applySettings(s), () => this.input.lock());
    this.pause.onTime = (t) => (this.sim.env.time = t);
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

    this.commandBar = new CommandBar(this.ui);
    this.commandBar.complete = (line) => this.sim.commands.complete(line);
    this.commandBar.onClose = () => {
      if (this.mode !== 'console') return;
      this.mode = 'playing';
      this.input.lock();
    };
    this.commandBar.onSubmit = (line) => {
      this.commandBar.print(`/${line.replace(/^\/+/, '')}`, 'echo');
      const r = this.sim.exec(line);
      this.commandBar.print(r.text, r.ok ? 'ok' : 'error');
    };

    this.sim.setup();
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

  /** Calls from the simulation for the client itself. */
  private clientCall(method: string, args: unknown[]) {
    if (method === 'debris') {
      const [x, y, z, id] = args as [number, number, number, number];
      const def = this.registry.blocks[id];
      if (!def) return;
      const face = def.tex[0];
      this.particles.burst(x, y, z, this.textures.albedoData.subarray(face * 1024, face * 1024 + 1024), def.tint ? DEFAULT_TINT : null);
    } else if (method === 'reset') {
      // A restart: everything the game put on screen goes.
      this.entityView.clear();
      this.pickupView.clear();
      this.propView.clear();
      this.presenter.reset();
      this.gameHud.clear();
      this.highlight.set(null);
      this.fx.clear();
    }
  }

  /** `hud.highlight`: outline a block, with break cracks at `progress`. */
  private setHighlight(at: Vec3 | null, progress?: number) {
    if (!at) return this.highlight.set(null);
    const id = this.chunks.world.get_block(Math.floor(at.x), Math.floor(at.y), Math.floor(at.z));
    this.highlight.set(at, this.registry.blocks[id]?.shape === 'cross', progress);
  }

  /** Reset game state and call `start` again. */
  restart() {
    this.sim.restart();
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
    const me = this.sim.local;
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
    let yaw = Math.PI * 0.25;
    let pitch = 0;
    if (save) {
      try {
        w.import_edits(fromB64(save.edits));
      } catch {
        // Corrupt edits are ignored.
      }
      const [x, y, z, sy, sp] = save.player;
      w.player_reset(x, y, z);
      w.set_flying(save.flying && (this.def.player?.fly ?? false));
      yaw = sy;
      pitch = sp;
      this.sim.env.time = save.time;
      this.sim.spawn = { x, y, z, yaw };
      this.hasSave = true;
    } else if (opts.spawn && opts.spawn !== 'auto') {
      yaw = opts.spawnYaw ?? 0;
      this.sim.spawn = { ...opts.spawn, yaw };
      w.player_reset(opts.spawn.x, opts.spawn.y, opts.spawn.z);
      this.hasSave = true;
    } else {
      const gen = new TerrainGen(this.seed);
      applyWorldConfig(gen, this.worldConfig());
      const s = gen.find_spawn();
      gen.free();
      this.sim.spawn = { x: s[0] + 0.5, y: s[1] + 2, z: s[2] + 0.5, yaw };
      w.player_reset(this.sim.spawn.x, this.sim.spawn.y, this.sim.spawn.z);
    }
    w.set_frozen(true);
    me.syncState();
    me.setView(yaw, pitch);
    // A game-driven camera starts where the player would have stood.
    const st = me.state;
    me.cam.pos.set(st.x, st.y + 1.62, st.z);
    me.cam.quat.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    me.cam.fov = this.settings.fov;
  }

  private save() {
    if (!this.chunks || !this.def.world?.persist) return;
    const s = this.sim.local.state;
    const data: SaveData = {
      edits: toB64(this.chunks.world.export_edits()),
      player: [s.x, s.y, s.z, this.view.yaw, this.view.pitch],
      flying: s.flying,
      time: this.sim.env.time,
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
    const sp = this.sim.spawn;
    const sx = Math.floor(sp.x);
    const sz = Math.floor(sp.z);
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
              const y = this.sim.surfaceY(x, z);
              const top = this.registry.blocks[w.get_block(x, y, z)];
              if (y > 0 && top && ground.has(top.name) && w.get_block(x, y + 1, z) !== 255) {
                this.sim.spawn = { ...sp, x: x + 0.5, y: y + 1.02, z: z + 0.5 };
                w.player_reset(this.sim.spawn.x, this.sim.spawn.y, this.sim.spawn.z);
                this.sim.local.syncState();
                placed = true;
              }
            }
          }
        }
      }
      this.spawnPending = false;
    }
    const s = this.sim.local.state;
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

  private beginPlay() {
    this.title.hide();
    this.hud.setVisible(this.hudVisible);
    this.gameHud.setVisible(this.hudVisible);
    this.held.scene.visible = this.hudVisible;
    this.chunks.world.set_frozen(this.sim.local.health.dead);
    this.mode = 'playing';
    this.sim.start();
  }

  private onLockChange(locked: boolean) {
    if (locked) {
      if (this.mode === 'title') this.beginPlay();
      this.pause.hide();
      this.picker?.hide();
      this.mode = 'playing';
    } else if (this.mode === 'playing' && !this.gameHud.screenOpen) {
      this.mode = 'paused';
      this.pause.show(this.sim.env.time);
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
      const env = this.sim.env;
      if (code === 'BracketLeft') env.time = (env.time - 1 / 24 + 1) % 1;
      if (code === 'BracketRight') env.time = (env.time + 1 / 24) % 1;
    }
  }

  private closePicker() {
    this.picker?.hide();
    this.mode = 'playing';
    this.input.lock();
  }

  // ---------------------------------------------------------------------------------------------
  // The local player's HUD and hand, from the frame
  // ---------------------------------------------------------------------------------------------

  /** The icon an item shows: its sprite, or its block. */
  private itemIcon(d: ItemDefinition, size: number): string {
    const icon = d.icon;
    if (typeof icon === 'object' && 'block' in icon) return this.blockIcons.get(this.blockId(icon.block)) ?? '';
    return this.graphics.spriteIcon(icon, size);
  }

  private showPlayer(me: PlayerFrame, creative: SimFrame['creative']) {
    const health = `${me.health}|${me.mortal ? me.maxHealth : 0}`;
    if (health !== this.shown.health) {
      this.shown.health = health;
      this.gameHud.setHealth(me.health, me.mortal ? me.maxHealth : 0);
    }
    if (creative) {
      const key = `${creative.hotbar.join(',')}|${creative.selected}`;
      if (key !== this.shown.creative) {
        const announce = this.shown.creative !== '' && !this.shown.creative.endsWith(`|${creative.selected}`);
        this.shown.creative = key;
        this.hud.setHotbar(creative.hotbar, creative.selected, announce);
        this.held.setBlock(this.registry.blocks[creative.hotbar[creative.selected]]);
      }
    }
    if (me.hotbar) this.showHotbar(me.hotbar.slots, me.hotbar.selected, me.hand);
  }

  private showHotbar(slots: (ItemStack | null)[], selected: number, hand: PlayerFrame['hand']) {
    const key = `${slots.map((s) => (s ? `${s.item}x${s.count}` : '')).join(',')}|${selected}`;
    if (key !== this.shown.hotbar) {
      const prevSelected = this.shown.hotbar.split('|')[1];
      this.shown.hotbar = key;
      this.hud.setSlots(
        slots.map((s) => {
          if (!s) return null;
          const d = this.content.items.get(s.item);
          return d ? { icon: this.itemIcon(d, 48), count: s.count, label: d.name } : null;
        }),
        selected,
        prevSelected !== undefined && prevSelected !== String(selected),
      );
    }
    // The held item: its 3D model, its sprite extruded, a block, or the bow's draw frame.
    const stack = slots[selected];
    const def = stack ? this.content.items.get(stack.item) : undefined;
    const drawn = def?.kind === 'bow' && hand.drawing && hand.charge > 0.25;
    const heldKey = `${stack?.item ?? ''}|${drawn}`;
    if (heldKey === this.shown.held) return;
    const sameItem = this.shown.held.split('|')[0] === (stack?.item ?? '');
    this.shown.held = heldKey;
    if (!def) {
      this.held.setEmpty();
      return;
    }
    if (typeof def.icon === 'object' && 'block' in def.icon) {
      // Looks like a block: held as a little cube of it.
      this.held.setBlock(this.registry.blocks[this.blockId(def.icon.block)]);
      return;
    }
    const icon = drawn && def.kind === 'bow' ? def.drawIcon ?? def.icon : def.icon;
    const model = def.hold?.model;
    const { geometry, atlas } = model && !drawn ? this.graphics.heldModelGeometry(model) : this.graphics.spriteGeometry(icon);
    if (def.kind === 'bow' && sameItem) {
      // Drawing or releasing: swap the frame without the lower-and-raise.
      this.held.swapItemGeometry(geometry);
      return;
    }
    const a = this.graphics.atlas(atlas);
    const style = def.kind === 'melee' ? 'sword' : def.kind === 'bow' ? 'bow' : 'item';
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
    this.view.sensitivity = s.sensitivity;
    this.view.baseFov = s.fov;
    this.view.viewBobbing = s.viewBobbing;
    if (!this.def.world?.freezeTime) this.sim.env.dayLength = s.dayMinutes * 60;
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
    const running = playing && this.sim.started;
    const dead = this.frameData?.players[0]?.dead ?? false;
    const active = playing && (this.input.locked || this.debugActive) && !dead && !this.gameHud.screenOpen;
    this.sfx.hold(this.sim.started && (this.mode === 'paused' || this.mode === 'console'));

    // Mouse look is the client's; the controls and the view go to the simulation.
    if (this.walker) {
      if (this.mode === 'title') {
        this.view.yaw += dt * 0.03;
        this.view.pitch = -0.18;
      } else {
        this.view.look(this.input, active);
      }
    }
    this.sim.tick(dt, running, { local: this.input.snapshot(active, this.view.yaw, this.view.pitch, this.view.viewSeq) });
    const f = this.sim.frame();
    this.frameData = f;
    const me = f.players[0];
    this.updateSpawn();

    this.env.time = f.time;
    this.env.paused = true;
    this.env.update(dt);
    if (this.walker) {
      this.view.follow(dt, me);
      if (this.mode === 'title') {
        this.camera.position.y += 22;
        this.camera.updateMatrixWorld();
      }
    } else {
      // The game's camera, as the simulation has it this tick (slowly turning on the title screen).
      if (this.mode === 'title') this.titleSpin += dt * 0.03;
      this.camera.position.set(me.camera.p[0], me.camera.p[1], me.camera.p[2]);
      this.camera.quaternion.set(me.camera.q[0], me.camera.q[1], me.camera.q[2], me.camera.q[3]);
      if (this.titleSpin) this.camera.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.titleSpin));
      if (this.camera.fov !== me.camera.fov) {
        this.camera.fov = me.camera.fov;
        this.camera.updateProjectionMatrix();
      }
      this.camera.updateMatrixWorld();
      if (this.mode !== 'title') this.titleSpin = 0;
    }
    this.entityView.sync(f.entities, f.projectiles, dt, running);
    this.pickupView.sync(f.pickups, dt);
    this.propView.sync(f.props, dt);
    this.showPlayer(me, f.creative);

    if (this.walker) {
      this.view.viewDirection(this.dir);
      this.chunks.update(me.x, me.z, this.dir.x, this.dir.z);
    } else {
      this.camera.getWorldDirection(this.dir);
      this.chunks.update(this.camera.position.x, this.camera.position.z, this.dir.x, this.dir.z);
    }

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
    if (this.walker) this.updateHand(dt, me);
    // Camera effects: shake and the death tilt.
    this.camera.position.add(this.fx.shakeOffset);
    if (this.walker && me.dead) {
      const k = Math.min(1, me.deathTime / 0.6);
      this.camera.position.y -= k * 1.2;
      this.camera.rotateZ(k * 0.45);
    }
    this.camera.updateMatrixWorld();
    this.sfx.setListener(this.camera.position, this.walker ? this.view.yaw : Math.atan2(-this.dir.x, -this.dir.z));
    this.present(dt, playing, t0);
  }

  private updateHand(dt: number, me: PlayerFrame) {
    this.held.draw = me.hand.drawing ? me.hand.charge : 0;
    const bobAmt = this.settings.viewBobbing && me.onGround && !me.flying ? Math.min(1, Math.hypot(me.vx, me.vz) / 4.3) : 0;
    this.held.update(dt, {
      aspect: this.camera.aspect,
      bobPhase: me.bob * Math.PI * 0.9,
      bobAmount: bobAmt,
      yaw: this.view.yaw,
      pitch: this.view.pitch,
      onGround: me.onGround,
      vy: me.vy,
      down: me.dead,
      strength: this.itemMode ? me.hand.strength : 1,
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
    const s = this.sim.local.state;
    const c = this.chunks.stats();
    const r = this.renderer;
    const yawDeg = ((((-this.view.yaw * 180) / Math.PI) % 360) + 360) % 360;
    const facing = ['north (-Z)', 'east (+X)', 'south (+Z)', 'west (-X)'][Math.round(yawDeg / 90) % 4];
    const rs = r.settings;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    this.debug.set([
      `VOXEL platform · ${this.def.title}`,
      `${Math.round(this.debug.fpsValue)} fps   cpu ${this.debug.cpu.toFixed(2)} ms`,
      '',
      `XYZ      ${s.x.toFixed(2)} / ${s.y.toFixed(2)} / ${s.z.toFixed(2)}`,
      `Chunk    ${Math.floor(s.x / 16)}, ${Math.floor(s.z / 16)}   section ${Math.floor(s.y / 16)}`,
      `Facing   ${facing}   pitch ${((this.view.pitch * 180) / Math.PI).toFixed(1)}°`,
      `Motion   ${s.flying ? 'flying' : s.inWater ? 'swimming' : s.onGround ? 'grounded' : 'airborne'}   ${Math.hypot(s.vx, s.vz).toFixed(2)} m/s`,
      `Time     ${this.env.clock()}   game clock ${(this.frameData?.clock ?? 0).toFixed(1)} s`,
      `Entities ${this.sim.entities.count()} alive`,
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
    this.beginPlay();
    this.chunks.world.set_frozen(false);
  }

  get context(): GameContext {
    return this.sim.ctx;
  }

  /** The first-person view (tests steer it through `yaw` / `pitch`). */
  get controller(): PlayerCamera {
    return this.view;
  }

  debugInfo() {
    return {
      game: this.def.id,
      mode: this.mode,
      ready: this.worldReady,
      state: { ...this.sim.local.state },
      health: this.sim.local.health.health,
      entities: this.sim.entities.count(),
      chunks: this.chunks.stats(),
      render: { ...this.renderer.stats },
      time: this.env.time,
      fps: this.debug.fpsValue,
      cpu: this.debug.cpu,
    };
  }

  debugView(yaw: number, pitch: number) {
    this.view.yaw = yaw;
    this.view.pitch = pitch;
  }

  debugSetTime(t: number) {
    this.sim.env.time = t;
  }

  debugToggle(key: string) {
    this.onKey(key);
  }

  debugInput(): Input {
    return this.input;
  }
}
