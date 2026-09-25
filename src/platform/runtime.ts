import * as THREE from 'three';
import { engine, loadEngine } from './engine/wasm';
import { WorkerPool } from './workers/pool';
import { worldGenConfig } from './host/spawn';
import { PageLink, SocketLink, WorkerLink, type SimLink } from './host/link';
import { MemoryStore } from './host/store';
import { FrameBuffer } from './client/interp';
import { Predictor } from './client/predict';
import { VehicleView } from './client/vehicle';
import { worldQuery } from './sim/worldquery';
import { Models, Skins } from './api/models';
import { LAYER_CHUNKS, Renderer, type FrameHooks } from './render/pipeline';
import { Environment } from './render/environment';
import { BiomeMap, createBlockTextures, createNoiseTexture, type TextureSet } from './render/textures';
import { Particles } from './render/particles';
import { BlockHighlight } from './render/highlight';
import { ViewModel } from './render/viewmodel';
import { EntityGraphics } from './render/entities';
import { ChunkManager } from './world/chunks';
import { blockIdOf, DEFAULT_TINT, loadRegistry, variant, type Registry } from './world/registry';
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
import type { Sim, SimFrame } from './sim/sim';
import type { PlayerFrame } from './sim/player';
import type { HostBatch, SaveState, TimedBatch } from './net/protocol';
import type { EntityFrame } from './sim/entities';
import { Inventory as BlockPicker, PauseMenu, TitleScreen } from './ui/screens';
import { blockIcon } from './ui/icons';
import { loadSettings, saveSettings, toRenderSettings, type Settings } from './settings';
import type { BlockRef, GameContext, GameDefinition, ItemDefinition, ItemStack, Vec3 } from './api/types';

type Mode = 'title' | 'playing' | 'paused' | 'picker' | 'console';

/**
 * What a game's runtime hands the next when switching games in place: the home page, and the
 * renderer with its textures (the WebGL context and compiled shaders don't need redoing).
 */
interface Carry {
  title: TitleScreen;
  renderer: Renderer;
  textures: TextureSet;
  biome: BiomeMap;
}

/** Free a finished game's meshes: geometry and materials (shared block textures stay). */
function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) mat.dispose();
  });
}

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
 * view). The game itself runs in a `GameHost`, in a worker (or in this page with `?host=page`).
 * Each frame the client sends the player's controls as a tick and draws the newest `SimFrame`;
 * the host's content, presentation calls and block edits arrive in the same batches. One
 * `GameDefinition` runs per page.
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
  private biome!: BiomeMap;
  /** Every listener this game adds goes when it's aborted (switching games). */
  private life = new AbortController();
  private disposed = false;
  private switching = false;
  /** Set by the app: told of each new runtime (a switch makes one). */
  static onStart: ((rt: Runtime) => void) | null = null;
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
  /** Where the game runs (its rules, its world): a worker, or this page with `?host=page`. */
  private link!: SimLink;
  /** The newest frame from the host. */
  private frameData: SimFrame | null = null;
  /** A tick is on its way to the host; frame time adds up until it answers. */
  private ticking = false;
  private tickDt = 0;
  /** The host has set the game up and placed the player. */
  private hostReady = false;
  private requests = new Map<number, (value: unknown) => void>();
  /** Which player in the frames is this client's (null: watching a server's game, not in it yet). */
  private playerId: string | null;
  /** A server's frames, played back smoothly (a server only). */
  private playback: FrameBuffer | null = null;
  /** This client's own movement, predicted ahead of the server (a server, walking games). */
  private predictor: Predictor | null = null;
  /** This client's own vehicle (`player.drive`): predicted on a server, its camera and model's pose. */
  private vehicles!: VehicleView;
  /** Inputs sent to a server, numbered (prediction replays what the server hasn't applied). */
  private inputSeq = 0;
  /** When each recent input was applied here (local seconds): our own shots fly from then. */
  private inputTimes = new Map<number, number>();
  /** Other players drawn as figures: their stable entity ids, hurt flashes, and name tags shown. */
  private avatarIds = new Map<string, number>();
  private avatarHurt = new Map<string, { health: number; flash: number }>();
  private tags = new Set<string>();
  private nextRequest = 1;
  private commandBar!: CommandBar;
  private last = performance.now();
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
  private shown = { health: '', hotbar: '', creative: '', held: '', arm: '' };
  /** Development: treat input as active without pointer lock (headless tests). */
  debugActive = false;

  private constructor(
    private canvas: HTMLCanvasElement,
    private ui: HTMLElement,
    private def: GameDefinition,
    private games: GameDefinition[],
    private hidden: GameDefinition[],
    private seed: number,
    private makeWorker: (() => Worker) | null,
    /** Joined a game server (`?server=`): the host is there, not here. */
    private server: SocketLink | null = null,
    /** What the previous game left for this one (switching in place). */
    private carried: Carry | null = null,
  ) {
    this.playerId = server ? server.welcome.player : 'local';
    this.settings = loadSettings();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.1, 400);
    this.camera.layers.enable(LAYER_CHUNKS);
    this.input = new Input(canvas, this.life.signal);
    this.walker = (def.player?.controller ?? 'walk') === 'walk';
    this.itemMode = this.walker && (def.player?.hotbar ?? (def.player?.build ? 'blocks' : 'items')) === 'items';
    // On a server, the title screen asks for a name (and says who's on).
    const online = server ? { server: server.url.replace(/\/[^/]*$/, ''), game: def.id } : null;
    this.title = carried?.title ?? new TitleScreen(ui, games);
    this.title.show({ current: def.id, title: def.title, onPlay: () => this.play(), onPick: (id) => this.switchGame(id), controls: def.controls, walks: this.walker, online });
  }

  /**
   * Boot the game selected by `?game=` (default: the first registered game). A build with a game
   * server (`VITE_GAME_SERVER`, e.g. wss://voxel-games.fly.dev) plays online only: it connects to
   * that server's game at once, watching behind the title screen, and joins on Play. `?server=`
   * picks a server for any build (`ws://localhost:8787/sandbox`). Otherwise the game runs here:
   * in the app's worker (`worker`), or in this page (`?host=page`).
   */
  static async start(canvas: HTMLCanvasElement, ui: HTMLElement, games: GameDefinition[], hidden: GameDefinition[] = [], worker?: () => Worker, carried: Carry | null = null): Promise<Runtime> {
    const url = new URL(location.href);
    const online = (import.meta.env.VITE_GAME_SERVER as string | undefined)?.replace(/\/+$/, '');
    const picked = url.searchParams.get('game');
    const address = url.searchParams.get('server') ?? (online ? `${online}/${(games.find((g) => g.id === picked) ?? games[0]).id}` : null);
    const server = address ? await SocketLink.connect(address) : null;
    const id = server?.welcome.game ?? picked;
    // Hidden games (dev previews) open by id but aren't listed in the launcher.
    const def = [...games, ...hidden].find((g) => g.id === id) ?? games[0];
    if (server && def.id !== server.welcome.game) throw new Error(`The server is running "${server.welcome.game}", which this client doesn't have.`);
    const seed = server?.welcome.seed ?? Runtime.chooseSeed(def);
    const rt = new Runtime(canvas, ui, def, games, hidden, seed, worker ?? null, server, carried);
    await rt.init();
    Runtime.onStart?.(rt);
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

  private blockId(b: BlockRef): number {
    return blockIdOf(this.registry, b);
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
    const worldCfg = worldGenConfig(def, (b) => this.blockId(b));
    const workers = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 2));
    const poolPromise = WorkerPool.create(module, this.seed, workers, worldCfg);

    // The renderer and block textures carry over from the previous game, if there was one.
    const c = this.carried;
    if (c) {
      this.renderer = c.renderer;
      this.textures = c.textures;
      this.biome = c.biome;
    } else {
      const noise = createNoiseTexture();
      const torchLayer = this.registry.byName.get('torch')?.tex[0] ?? 0;
      this.renderer = new Renderer(this.canvas, toRenderSettings(this.settings), noise, torchLayer);
      this.renderer.fxScene.matrixWorldAutoUpdate = true;
      this.textures = createBlockTextures(this.renderer.gl);
      this.biome = new BiomeMap(this.renderer.gl);
      this.renderer.setTextures(this.textures.albedo, this.textures.material, this.biome.texture);
    }
    const biome = this.biome;
    this.renderer.uniforms.uVoid.value = def.world?.terrain === 'void' ? 1 : 0;
    this.graphics = new EntityGraphics(this.renderer.uniforms);
    this.graphics.gltf.renderer = this.renderer.gl;
    // Model files the game names (glTF props and figures): fetched at once, so they're here by play.
    this.content.onModelFile((url) => this.graphics.gltf.load(url));
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
    for (const b of this.registry.blocks) {
      if (b.id === 0) continue;
      // A bed's icon shows it whole: the head too.
      const head = b.model === 'bed' ? variant(this.registry, b, { part: 'head' }) ?? undefined : undefined;
      icons.set(b.id, blockIcon(b, this.textures.albedoData, head));
    }
    this.blockIcons = icons;
    this.hud = new Hud(this.ui, this.registry, icons);
    this.gameHud = new GameHud(this.ui, (ref) => (typeof ref === 'object' && 'block' in ref ? this.blockIcons.get(this.blockId(ref.block)) ?? '' : this.graphics.icon(ref, 96)));
    this.gameHud.onHighlight = (at, progress) => this.setHighlight(at, progress);
    // Markers and radar blips that follow things: where this screen draws them, every frame.
    this.gameHud.locate = {
      at: (a, offset, out) => {
        if ('x' in a) {
          out.set(a.x + (offset?.x ?? 0), a.y + (offset?.y ?? 0), a.z + (offset?.z ?? 0));
          return true;
        }
        if ('$prop' in a) return this.propView.locate(a.$prop, offset, out);
        if ('$entity' in a) return this.entityView.locate(a.$entity, offset, out);
        const p = this.frameData?.players.find((x) => x.id === a.$player);
        if (!p) return false;
        if (p.vehicle?.prop != null) return this.propView.locate(p.vehicle.prop, offset, out);
        const avatar = this.avatarIds.get(p.id);
        if (p.id !== this.playerId && avatar !== undefined && this.entityView.locate(avatar, offset, out)) return true;
        out.set(p.x + (offset?.x ?? 0), p.y + (offset?.y ?? 0), p.z + (offset?.z ?? 0));
        return true;
      },
      heading: (a) => {
        if ('$prop' in a) return this.propView.heading(a.$prop);
        if ('$player' in a) {
          const p = this.frameData?.players.find((x) => x.id === a.$player);
          if (p?.vehicle?.prop != null) return this.propView.heading(p.vehicle.prop);
          return p ? p.view.yaw : null;
        }
        return null;
      },
    };
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
      gltf: this.graphics.gltf,
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

    // The presentation calls the host sends run here; callbacks go back as messages.
    this.presenter = new Presenter(this.playerId, {
      hud: this.gameHud,
      fx: this.fx,
      sfx: this.sfx,
      view: this.held,
      send: (m) => this.link.send({ t: 'message', msg: m }),
      client: (method, args) => this.clientCall(method, args),
    });

    // The game's host: a server we joined, a worker by default, or this page for development and
    // tests (`?host=page`). It sets the game up, places the player and sends batches.
    const save = this.server ? null : this.load();
    const opts = {
      seed: this.seed,
      save,
      cheats: import.meta.env.DEV || !!def.cheats,
      radius: this.hostRadius(this.settings),
      dayLength: this.settings.dayMinutes * 60,
      fov: this.settings.fov,
    };
    const inPage = new URL(location.href).searchParams.get('host') === 'page';
    // `game.store` in single-player: this device's localStorage.
    const kept = this.loadStore();
    const keep = (key: string, value: unknown) => this.keepStore(kept, key, value);
    if (this.server) {
      this.link = this.server;
      // Two steps behind the newest frame: smooth, and about 70 ms behind the server at 30 steps a second.
      this.playback = new FrameBuffer(2 / this.server.welcome.tickRate);
      this.server.onClose = () => this.disconnected();
      if (this.walker) this.predictor = new Predictor(this.chunks.world);
    } else {
      if (inPage || !this.makeWorker) {
        this.link = new PageLink(def, { ...opts, engine: module, budget: 2, store: new MemoryStore(kept, keep) });
      } else {
        const link = new WorkerLink(this.makeWorker(), { t: 'init', module, game: def.id, ...opts, store: kept });
        link.onStore = keep;
        this.link = link;
      }
    }

    this.vehicles = new VehicleView(def.vehicles ?? {}, worldQuery(this.chunks.world, this.registry), !!this.server);
    this.link.onBatch = (b) => this.receive(b);

    if (def.player?.build) {
      this.picker = new BlockPicker(this.ui, this.registry, icons, () => this.closePicker());
      this.picker.onPick = (id) => {
        this.link.send({ t: 'message', msg: { t: 'creativePick', player: this.playerId ?? '', block: id } });
        this.hud.showToast(this.registry.blocks[id]?.label ?? '');
      };
    }
    this.hud.setVisible(false);
    this.gameHud.setVisible(false);
    this.held.scene.visible = false;

    this.pause = new PauseMenu(this.ui, this.settings, (s) => this.applySettings(s), () => this.input.lock());
    this.pause.onTime = (t) => this.link.send({ t: 'env', time: t });
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
    const life = { signal: this.life.signal };
    this.canvas.addEventListener('click', () => {
      this.sfx.unlock();
      if (this.mode === 'console') {
        this.commandBar.close();
        return;
      }
      if (this.gameHud.screenOpen) return;
      const unlockedPlay = this.mode === 'playing' && !this.input.locked;
      if (this.mode === 'paused' || unlockedPlay || (this.mode === 'title' && this.worldReady)) this.input.lock();
    }, life);
    window.addEventListener('resize', () => this.resize(), life);
    window.addEventListener('beforeunload', () => this.save(), life);
    document.addEventListener('visibilitychange', () => document.hidden && this.save(), life);

    this.commandBar = new CommandBar(this.ui);
    this.commandBar.complete = (line) => this.request<{ start: number; options: string[] }>({ t: 'complete', line });
    this.commandBar.onClose = () => {
      if (this.mode !== 'console') return;
      this.mode = 'playing';
      this.input.lock();
    };
    this.commandBar.onSubmit = (line) => {
      this.commandBar.print(`/${line.replace(/^\/+/, '')}`, 'echo');
      void this.request<{ ok: boolean; text: string }>({ t: 'exec', line }).then((r) => this.commandBar.print(r.text, r.ok ? 'ok' : 'error'));
    };

    this.applySettings(this.settings, false);
    this.resize();
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

  /** Show a block in the hand (a bed whole: its head too). */
  private holdBlock(id: number) {
    const def = this.registry.blocks[id];
    this.held.setBlock(def, def?.model === 'bed' ? (variant(this.registry, def, { part: 'head' }) ?? undefined) : undefined);
  }

  /** `hud.highlight`: outline a block, with break cracks at `progress`. */
  private setHighlight(at: Vec3 | null, progress?: number) {
    if (!at) return this.highlight.set(null);
    const id = this.chunks.world.get_block(Math.floor(at.x), Math.floor(at.y), Math.floor(at.z));
    const def = this.registry.blocks[id];
    this.highlight.set(at, def?.shape === 'cross' ? 'cross' : (def?.boxes ?? null), progress);
  }

  /** Reset game state and call `start` again. */
  restart() {
    this.link.send({ t: 'restart' });
  }

  /** A batch from the host: what happened, in order, then the frame to draw. */
  private receive(b: HostBatch) {
    for (const e of b.events) {
      switch (e.t) {
        case 'content':
          this.content.apply(e.def);
          break;
        case 'call':
          this.presenter.apply(e.call);
          break;
        case 'edits':
          this.chunks.mirrorEdits(e.cells);
          break;
        case 'revert':
          this.chunks.revertEdits();
          break;
        case 'joined':
          // In the game now, as this player.
          this.playerId = e.player;
          this.presenter.player = e.player;
          break;
        case 'ready':
          this.hostReady = true;
          // The skin may live in an atlas the game registered in `setup`, which has arrived by now.
          if (this.def.player?.skin) this.held.setSkin(this.def.player.skin, this.def.player.skinAtlas);
          break;
        case 'exit':
          this.exit();
          break;
        case 'reply':
          this.requests.get(e.id)?.(e.value);
          this.requests.delete(e.id);
          break;
        case 'error':
          console.error(`[game] ${e.text}`);
          break;
      }
    }
    if (b.frame) {
      this.frameData = b.frame;
      this.ticking = false;
      this.playback?.push(b.frame, (b as TimedBatch).time);
      const me = this.playerId !== null ? b.frame.players.find((p) => p.id === this.playerId) : undefined;
      if (me) {
        this.predictor?.reconcile(me);
        this.vehicles.reconcile(me);
      }
    }
  }

  /**
   * The figure type for a player: a humanoid in their skin (`player.setSkin`), else the game's
   * player skin, else the default. Defined the first time it's needed.
   */
  private avatarType(p: PlayerFrame): string {
    const d = this.def.player;
    // A model (theirs, or the game's for everyone): one figure type per model.
    const model = p.model ?? d?.model;
    if (model) {
      const type = `$player:model:${JSON.stringify(model)}`;
      if (!this.content.entities.has(type)) this.content.defineEntity(type, { name: 'Player', model, hitbox: { width: 0.6, height: 1.8 }, health: 20, speed: 4.3 });
      return type;
    }
    const skin = p.skin ?? (d?.skin ? { uv: d.skin, atlas: d.skinAtlas } : { uv: Skins.player, atlas: undefined });
    const type = `$player:${skin.atlas ?? 'builtin'}:${skin.uv.join(',')}`;
    if (!this.content.entities.has(type)) {
      this.content.defineEntity(type, { name: 'Player', model: Models.humanoid({ skin: skin.uv, atlas: skin.atlas }), hitbox: { width: 0.6, height: 1.8 }, health: 20, speed: 4.3 });
    }
    return type;
  }

  /**
   * This client's player in a frame. Watching a server's game before joining, a stand-in at the
   * spawn, for the camera (circling above it on the title screen) and the terrain around it.
   */
  private mine(f: SimFrame | null): PlayerFrame | undefined {
    const me = f?.players.find((p) => p.id === this.playerId);
    if (me || !f || !this.server || this.playerId) return me;
    const sp = this.server.welcome.spawn;
    return {
      id: '',
      name: '',
      x: sp.x,
      y: sp.y,
      z: sp.z,
      vx: 0,
      vy: 0,
      vz: 0,
      onGround: true,
      inWater: false,
      eyesInWater: false,
      inLava: false,
      flying: false,
      bob: 0,
      sneaking: false,
      sprinting: false,
      view: { seq: 0, yaw: sp.yaw, pitch: 0 },
      health: 20,
      maxHealth: 20,
      mortal: false,
      dead: false,
      deathTime: 0,
      hotbar: null,
      hand: { drawing: false, charge: 0, strength: 1 },
      camera: { p: [sp.x, sp.y + 1.62, sp.z], q: [0, 0, 0, 1], fov: this.settings.fov, follow: false },
      vehicle: null,
      creative: null,
      frozen: true,
      canFly: false,
      swings: 0,
      ack: -1,
      move: { time: 0, lastJumpTap: -1, lastForwardTap: -1, sprintLatched: false },
      lead: 0,
      skin: null,
      model: null,
      color: null,
    };
  }

  /** The server went away: say so, and stop sending. */
  private disconnected() {
    this.input.unlock();
    this.gameHud.screen({ title: 'Disconnected', subtitle: 'The connection to the game server was lost.', tone: 'defeat', buttons: [{ label: 'Reload', primary: true, onClick: () => location.reload() }] });
  }

  /** Other players as figures (entities of the built-in `$player` type), with their names above. */
  private avatars(f: SimFrame): EntityFrame[] {
    const out: EntityFrame[] = [];
    const seen = new Set<string>();
    for (const p of f.players) {
      // Only people on foot get a figure: a driver is their vehicle's model.
      if (p.id === this.playerId || !this.walker || p.vehicle) continue;
      const type = this.avatarType(p);
      let id = this.avatarIds.get(p.id);
      if (id === undefined) this.avatarIds.set(p.id, (id = -1 - this.avatarIds.size));
      const cp = Math.cos(p.view.pitch);
      const eye = { x: p.x, y: p.y + 1.62, z: p.z };
      // A red flash when their health drops.
      const h = this.avatarHurt.get(p.id) ?? { health: p.health, flash: 0 };
      if (p.health < h.health) h.flash = 1;
      h.health = p.health;
      h.flash = Math.max(0, h.flash - 0.05);
      this.avatarHurt.set(p.id, h);
      out.push({
        id,
        type,
        x: p.x,
        y: p.y,
        z: p.z,
        vx: p.vx,
        vz: p.vz,
        yaw: p.view.yaw,
        look: { x: eye.x - Math.sin(p.view.yaw) * cp * 4, y: eye.y + Math.sin(p.view.pitch) * 4, z: eye.z - Math.cos(p.view.yaw) * cp * 4 },
        attacks: p.swings,
        raised: false,
        casting: false,
        glow: null,
        hurt: h.flash,
        dying: p.dead ? p.deathTime : -1,
        held: p.hotbar?.slots[p.hotbar.selected]?.item ?? null,
      });
      const tag = `$name:${p.id}`;
      seen.add(tag);
      this.tags.add(tag);
      this.gameHud.marker(tag, { x: p.x, y: p.y + 2.25, z: p.z }, { label: p.name, shape: 'dot', size: 3, color: p.color ?? '#ffffff' });
    }
    for (const tag of this.tags) {
      if (seen.has(tag)) continue;
      this.gameHud.marker(tag, null);
      this.tags.delete(tag);
    }
    return out;
  }

  /** Ask the host something; the answer comes in a later batch. */
  private request<T>(cmd: { t: 'exec' | 'complete'; line: string }): Promise<T> {
    const id = this.nextRequest++;
    return new Promise<T>((resolve) => {
      this.requests.set(id, resolve as (v: unknown) => void);
      this.link.send({ ...cmd, id });
    });
  }

  /** Back to the home page (this game's, fresh): `game.exit()`, the pause menu's Switch game. */
  exit() {
    this.switchGame(this.def.id);
  }

  /**
   * Another game, in place: the home page stays (showing it picked at once), the world fades
   * out, this game shuts down and the next starts, fading in when its world is ready.
   */
  private switchGame(id: string) {
    if (this.switching) return;
    this.switching = true;
    this.save();
    this.canvas.classList.add('fading');
    window.setTimeout(() => {
      const carry = this.shutdown();
      Runtime.switchTo(id, this.canvas, this.ui, this.games, this.hidden, this.makeWorker, carry);
    }, 260);
    this.title.select(id);
  }

  /** Start another game on the page the last one left (the home page stays up throughout). */
  private static switchTo(id: string, canvas: HTMLCanvasElement, ui: HTMLElement, games: GameDefinition[], hidden: GameDefinition[], worker: (() => Worker) | null, carry: Carry) {
    const url = new URL(location.href);
    url.searchParams.set('game', id);
    for (const p of ['seed', 'server', 'name']) url.searchParams.delete(p);
    history.replaceState(null, '', url);
    carry.title.select(id);
    Runtime.start(canvas, ui, games, hidden, worker ?? undefined, carry).catch((err: unknown) => {
      console.error(err);
      carry.title.failed(err instanceof Error ? err.message : String(err), (next) => Runtime.switchTo(next, canvas, ui, games, hidden, worker, carry));
    });
  }

  /**
   * This game is over: stop its loop, its host (worker, page or server connection), its terrain
   * workers, its listeners and sound; free its meshes, textures and HUD. The home page, renderer
   * and block textures go to the next game.
   */
  private shutdown(): Carry {
    this.disposed = true;
    this.life.abort();
    if (document.pointerLockElement) document.exitPointerLock();
    this.link?.close();
    this.pool?.dispose();
    this.chunks?.dispose();
    this.entityView?.clear();
    this.pickupView?.clear();
    this.propView?.clear();
    this.fx?.clear();
    const r = this.renderer;
    for (const o of [this.particles?.points, this.highlight.object]) {
      if (!o) continue;
      o.removeFromParent();
      disposeTree(o);
    }
    for (const scene of [r.entityScene, r.fxScene]) {
      for (const o of [...scene.children]) {
        scene.remove(o);
        disposeTree(o);
      }
    }
    if (r.overlay) {
      disposeTree(r.overlay.scene);
      r.overlay = null;
    }
    this.graphics?.dispose();
    this.sfx.close();
    this.gameHud?.closeScreens();
    // The HUD, menus and overlays this game put up; the home page stays.
    for (const el of [...this.ui.children]) if (el !== this.title.root) el.remove();
    return { title: this.title, renderer: r, textures: this.textures, biome: this.biome };
  }

  // ---------------------------------------------------------------------------------------------
  // Persistence & spawn
  // ---------------------------------------------------------------------------------------------

  private get saveKey() {
    return `voxel.${this.def.id}.world.${this.seed}`;
  }

  private get storeKey() {
    return `voxel.${this.def.id}.store`;
  }

  /** What the game kept in `game.store` on this device. */
  private loadStore(): Record<string, unknown> {
    try {
      return JSON.parse(localStorage.getItem(this.storeKey) ?? '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private keepStore(data: Record<string, unknown>, key: string, value: unknown) {
    if (value === undefined) delete data[key];
    else data[key] = value;
    try {
      localStorage.setItem(this.storeKey, JSON.stringify(data));
    } catch {
      // Full or blocked: the game carries on, unsaved.
    }
  }

  /** The saved world, if the game keeps one. Its edits go into this client's world too. */
  private load(): SaveState | null {
    if (!this.def.world?.persist) return null;
    let save: SaveData | null = null;
    try {
      const raw = localStorage.getItem(this.saveKey);
      if (raw) save = JSON.parse(raw) as SaveData;
    } catch {
      save = null;
    }
    if (!save) return null;
    let edits = new Uint8Array(0);
    try {
      edits = fromB64(save.edits);
      this.chunks.world.import_edits(edits);
    } catch {
      // Corrupt edits are ignored.
      edits = new Uint8Array(0);
    }
    return { edits, player: save.player, flying: save.flying, time: save.time };
  }

  private save() {
    const f = this.frameData;
    const s = this.mine(f);
    // On a server, the server keeps the world.
    if (!this.chunks || !this.def.world?.persist || this.server || !f || !s) return;
    // This client's world has every edit the host made (mirrored), loaded or not.
    const data: SaveData = {
      edits: toB64(this.chunks.world.export_edits()),
      player: [s.x, s.y, s.z, this.view.yaw, this.view.pitch],
      flying: s.flying,
      time: f.time,
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

  /** The title screen's progress: the terrain around the player (the host placed them) meshed. */
  private updateReadiness() {
    const s = this.mine(this.frameData);
    if (this.worldReady || !s || !this.hostReady) return;
    const ready = this.chunks.readiness(s.x, s.z, Math.min(this.settings.renderDistance, 6));
    const models = this.graphics.gltf.pending;
    this.title.progress(0.1 + 0.9 * ready * (models ? 0.97 : 1), ready < 1 ? `Generating terrain… ${Math.round(ready * 100)}%` : models ? `Loading models… ${models} to go` : 'Ready');
    if (ready >= 0.999 && !models) {
      this.worldReady = true;
      this.title.setReady();
      this.canvas.classList.remove('fading');
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
    this.mode = 'playing';
    // On a server this is joining: as the name on the title screen.
    this.link.send(this.server ? { t: 'start', name: this.title.name() } : { t: 'start' });
  }

  private onLockChange(locked: boolean) {
    if (locked) {
      if (this.mode === 'title') this.beginPlay();
      this.pause.hide();
      this.picker?.hide();
      this.mode = 'playing';
    } else if (this.mode === 'playing' && !this.gameHud.screenOpen) {
      this.mode = 'paused';
      this.pause.show(this.frameData?.time ?? 0);
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
      const t = this.frameData?.time ?? 0;
      if (code === 'BracketLeft') this.link.send({ t: 'env', time: (t - 1 / 24 + 1) % 1 });
      if (code === 'BracketRight') this.link.send({ t: 'env', time: (t + 1 / 24) % 1 });
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

  /** The icon an item shows: its sprite, its block, or a picture of its model. */
  private itemIcon(d: ItemDefinition, size: number): string {
    const icon = d.icon;
    if (typeof icon === 'object' && 'block' in icon) return this.blockIcons.get(this.blockId(icon.block)) ?? '';
    return this.graphics.icon(icon, size);
  }

  private showPlayer(me: PlayerFrame) {
    // A player model with a hand: their first-person arm is that part of it (once its file is here).
    const model = me.model ?? this.def.player?.model;
    const hand = model?.gltf?.hand;
    const arm = model?.gltf && hand ? `${model.gltf.url}|${hand}` : '';
    if (arm !== this.shown.arm) {
      if (!arm) {
        this.held.setArm(null);
        this.shown.arm = '';
      } else {
        const look = this.graphics.gltf.limb(model!.gltf!.url, hand!, 12 / 16);
        if (look) {
          this.held.setArm(look);
          this.shown.arm = arm;
        }
      }
    }
    const creative = me.creative;
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
        this.holdBlock(creative.hotbar[creative.selected]);
      }
    }
    if (me.hotbar) this.showHotbar(me.hotbar.slots, me.hotbar.selected, me.hand);
  }

  private showHotbar(slots: (ItemStack | null)[], selected: number, hand: PlayerFrame['hand']) {
    // (Redrawn as model files arrive: an icon can be a picture of one.)
    const key = `${slots.map((s) => (s ? `${s.item}x${s.count}` : '')).join(',')}|${selected}|${this.graphics.gltf.version}`;
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
      this.holdBlock(this.blockId(def.icon.block));
      return;
    }
    const look = this.graphics.itemLook(def, drawn);
    if (!look) {
      // Its model's file is still coming: nothing in hand yet, and look again next frame.
      this.shown.held = '';
      this.held.setEmpty();
      return;
    }
    if (def.kind === 'bow' && sameItem) {
      // Drawing or releasing: swap the frame without the lower-and-raise.
      this.held.swapItemGeometry(look.geometry);
      return;
    }
    const style = def.kind === 'melee' ? 'sword' : def.kind === 'bow' ? 'bow' : 'item';
    // Held as a model (boxes or glTF), posed by its grip; else as its sprite.
    const hold = look.model ? { ...def.hold, model: look.model } : def.hold ?? {};
    this.held.setItem(look.geometry, look.albedo, look.emissive, hold, style);
  }

  /** Columns the host keeps around the player: what this client shows, within reason. */
  private hostRadius(s: Settings): number {
    return Math.min(12, this.viewDistance(s));
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
    this.link.send({ t: 'env', dayLength: s.dayMinutes * 60 });
    this.link.send({ t: 'radius', columns: this.hostRadius(s) });
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
    if (this.disposed) return;
    requestAnimationFrame((t) => this.frame(t));
    const t0 = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const playing = this.mode === 'playing';
    const started = this.frameData?.started ?? false;
    const running = playing && started;
    const dead = this.mine(this.frameData)?.dead ?? false;
    const active = playing && (this.input.locked || this.debugActive) && !dead && !this.gameHud.screenOpen;
    this.sfx.hold(started && (this.mode === 'paused' || this.mode === 'console'));

    // Mouse look is the client's; the controls and the view go to the host.
    if (this.walker) {
      if (this.mode === 'title') {
        this.view.yaw += dt * 0.03;
        this.view.pitch = -0.18;
      } else {
        this.view.look(this.input, active);
      }
    }
    // A server keeps its own clock: it gets the controls every frame. Otherwise one tick at a time:
    // while one is on its way, frame time (and input) adds up for the next. In this page the
    // answer is immediate; from a worker it arrives before the next frame.
    this.tickDt += dt;
    if (this.server) {
      const input = this.input.snapshot(active, this.view.yaw, this.view.pitch, this.view.viewSeq);
      // Numbered, with how long it lasted: walking and vehicles move at once here (prediction),
      // and the server moves them input by input, the same way.
      const seq = ++this.inputSeq;
      this.inputTimes.set(seq, now / 1000);
      this.inputTimes.delete(seq - 600);
      this.predictor?.step(input, dt, seq);
      this.vehicles.step(input, dt, seq);
      this.link.send({ t: 'input', input, seq, dt });
    } else if (!this.ticking) {
      this.ticking = true;
      const input = this.input.snapshot(active, this.view.yaw, this.view.pitch, this.view.viewSeq);
      const tickDt = Math.min(0.1, this.tickDt);
      this.tickDt = 0;
      try {
        this.link.send({ t: 'tick', dt: tickDt, running, input });
      } catch (err) {
        this.ticking = false;
        throw err;
      }
    }
    const f = this.playback?.sample() ?? this.frameData;
    this.updateReadiness();
    const played = this.mine(f);
    // Our own player where prediction has them (a server), else as the frame says.
    const predicted = this.predictor?.shown();
    const me = played && predicted ? { ...played, ...predicted } : played;
    if (!f || !me) {
      // The host is still starting: nothing to draw yet but the sky.
      this.present(dt, playing, t0);
      return;
    }

    this.env.time = f.time;
    this.env.paused = true;
    this.env.update(dt);
    // Driving: the vehicle's camera, worked out here every frame from its (predicted) state.
    const ride = me.camera.follow && this.vehicles.active ? this.vehicles.camera(dt) : null;
    if (ride) {
      this.camera.position.copy(ride.position);
      this.camera.up.copy(ride.up);
      this.camera.lookAt(ride.target);
      this.camera.up.set(0, 1, 0);
      if (this.camera.fov !== ride.fov) {
        this.camera.fov = ride.fov;
        this.camera.updateProjectionMatrix();
      }
      this.camera.updateMatrixWorld();
    } else if (this.walker) {
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
    // A server's game runs on while this client is paused: its figures keep walking.
    this.entityView.sync(f.players.length > 1 ? [...f.entities, ...this.avatars(f)] : f.entities, f.projectiles, dt, this.server ? started : running);
    this.pickupView.sync(f.pickups, dt);
    // Our own vehicle's model where prediction has it, not where the (older) frame does.
    const own = this.vehicles.active && this.vehicles.prop !== null ? new Map([[this.vehicles.prop, this.vehicles.pose()]]) : undefined;
    this.propView.sync(f.props, dt, { clock: f.clock, me: this.playerId, inputTime: (seq) => this.inputTimes.get(seq) ?? null, now: now / 1000, camera: this.camera.position }, own);
    this.showPlayer(me);

    if (this.walker && !ride) {
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
    // Camera effects: shake and the death tilt (which rights itself after a moment, for someone
    // out of the game a while to watch).
    this.camera.position.add(this.fx.shakeOffset);
    if (this.walker && me.dead) {
      const k = Math.min(1, me.deathTime / 0.6) * Math.min(1, Math.max(0, (2.8 - me.deathTime) / 0.8));
      this.camera.position.y -= k * 1.2;
      this.camera.rotateZ(k * 0.45);
    }
    this.camera.updateMatrixWorld();
    this.sfx.setListener(this.camera.position, this.walker ? this.view.yaw : Math.atan2(-this.dir.x, -this.dir.z));
    this.present(dt, playing, t0);
  }

  private updateHand(dt: number, me: PlayerFrame) {
    // Nothing in hand while dead (someone out of the game watching sees only the game).
    this.held.scene.visible = !me.dead && !me.vehicle;
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
    const f = this.frameData;
    const s = this.mine(f);
    if (!f || !s) return;
    const c = this.chunks.stats();
    const r = this.renderer;
    const yawDeg = ((((-this.view.yaw * 180) / Math.PI) % 360) + 360) % 360;
    const facing = ['north (-Z)', 'east (+X)', 'south (+Z)', 'west (-X)'][Math.round(yawDeg / 90) % 4];
    const rs = r.settings;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    this.debug.set([
      `Blockyard · ${this.def.title}`,
      `${Math.round(this.debug.fpsValue)} fps   cpu ${this.debug.cpu.toFixed(2)} ms`,
      '',
      `XYZ      ${s.x.toFixed(2)} / ${s.y.toFixed(2)} / ${s.z.toFixed(2)}`,
      `Chunk    ${Math.floor(s.x / 16)}, ${Math.floor(s.z / 16)}   section ${Math.floor(s.y / 16)}`,
      `Facing   ${facing}   pitch ${((this.view.pitch * 180) / Math.PI).toFixed(1)}°`,
      `Motion   ${s.flying ? 'flying' : s.inWater ? 'swimming' : s.onGround ? 'grounded' : 'airborne'}   ${Math.hypot(s.vx, s.vz).toFixed(2)} m/s`,
      `Time     ${this.env.clock()}   game clock ${(this.frameData?.clock ?? 0).toFixed(1)} s`,
      `Entities ${f.entities.length} alive   host ${this.server ? `server (${f.players.length} playing)` : this.link.local ? 'in page' : 'worker'}`,
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
  }

  /** The simulation, when the game runs in this page (`?host=page`). */
  get sim(): Sim | undefined {
    return this.link.local?.sim;
  }

  /** The game's context, when it runs in this page (`?host=page`). */
  get context(): GameContext {
    const sim = this.sim;
    if (!sim) throw new Error('the game runs in a worker: open with ?host=page to reach its context');
    return sim.ctx;
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
      host: this.server ? 'server' : this.link.local ? 'page' : 'worker',
      player: this.playerId,
      state: this.mine(this.frameData) ?? null,
      health: this.mine(this.frameData)?.health ?? 0,
      entities: this.frameData?.entities.length ?? 0,
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
    this.link.send({ t: 'env', time: t });
  }

  debugToggle(key: string) {
    this.onKey(key);
  }

  debugInput(): Input {
    return this.input;
  }
}
