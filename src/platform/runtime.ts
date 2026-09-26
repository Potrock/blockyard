import * as THREE from 'three';
import { engine, loadEngine } from './engine/wasm';
import { WorkerPool } from './workers/pool';
import { worldGenConfig } from './workers/config';
import { SocketLink } from './client/link';
import { FrameBuffer } from './client/interp';
import { ReplayPlayback } from './client/replay';
import { Predictor } from './client/predict';
import { GunController, type FiredShot } from './client/guns';
import { Flights, ThrowController } from './client/throwables';
import { flightWorld, fuseSteps, isThrowable, throwable } from './sim/throwables';
import { Rubble, damageTaken } from './render/rubble';
import { freshMemory, resolveMovement, type MoveTune } from './sim/movement';
import { assistOf, gun as gunOf, isGun, moveMods, playerBoxes, rayBox, resolveGunRules, spreadDeg, type Assist, type Gun, type GunRules } from './sim/guns';
import { bulletPath, type WallPass } from './sim/hitscan';
import type { ShotWire } from './sim/combat';
import { ClientMovers, propPose } from './client/movers';
import { heading, toWorld } from './sim/movers';
import { VehicleView } from './client/vehicle';
import { worldQuery } from './sim/worldquery';
import { Models, Skins } from './api/models';
import { LAYER_CHUNKS, Renderer, type FrameHooks } from './render/pipeline';
import { Environment } from './render/environment';
import { BiomeMap, builtinTextures, createBlockTextures, createNoiseTexture, type TextureSet } from './render/textures';
import { paintGameTextures } from './render/blocktextures';
import { Particles } from './render/particles';
import { BlockHighlight } from './render/highlight';
import { EntityGraphics } from './render/entities';
import { ChunkManager } from './world/chunks';
import { firstGameBlock, gameBlocks, useGameBlocks, type GameBlocks } from './world/blocks';
import { blockIdOf, DEFAULT_TINT, destructibleIds, loadRegistry, variant, type Registry } from './world/registry';
import { Input } from './player/input';
import { padBindings, padHints, rumble } from './player/gamepad';
import { PadNav } from './ui/padnav';
import { Effects } from './fx/effects';
import { Sfx } from './audio/sfx';
import { Hud } from './ui/hud';
import { applyTheme, GameHud } from './ui/hudkit';
import { plainRecord, type PlainData } from './ui/markup';
import { DebugOverlay } from './ui/debug';
import { CommandBar } from './ui/commandbar';
import { Content } from './content';
import { PLACEHOLDER_ICON, resolveIcon } from './looks';
import { Presenter, soundOf } from './client/present';
import { PlayerCamera } from './client/camera';
import { EntityView, type FigureFrame } from './client/entities';
import { PickupView } from './client/pickups';
import { PropView } from './client/props';
import type { SimFrame } from './sim/sim';
import type { PlayerFrame } from './sim/player';
import { MESSAGE_MAX, newRoomCode, ROOM_CODE, type DevReply, type HostBatch, type PlayerInput, type PresentCall, type ReplayEvent, type ReplayWire, type TimedBatch } from './net/protocol';
import { sanitizeGameMessage } from './net/validate';
import { clipFrame, type ClipFrame } from './sim/entities';
import { Inventory as BlockPicker, PauseMenu, TitleScreen } from './ui/screens';
import { blockIcon } from './ui/icons';
import { GRAPHICS, loadSettings, saveSettings, toRenderSettings, type Settings } from './settings';
import { AutoQuality, savedQuality, saveQuality, type Look } from './quality';
import type { BlockRef, GunItem, IconRef, ItemDefinition, ItemStack, PadAction, PadButton, SharedDefinition, Vec3 } from './api/types';
import type { Client, ClientBullet, ClientDefinition, ClientEvent, ClientGame, ClientReplay, GameEntry, Me } from './api/client';
import { ClientRuntime } from './client/api/client';
import { FirstPersonLayer } from './client/api/view';
import { ClientHudService } from './client/api/hud';
import { SceneService } from './client/api/scene';

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

/** The screen's pixels per point, up to 2 (more costs a lot and shows little). */
const deviceDpr = () => Math.min(window.devicePixelRatio || 1, 2);

/**
 * The browser runtime: the client (renderer, streaming world, HUD, audio, input, first-person
 * view). The game itself runs on a game server, in a `GameHost` there. Each frame the client
 * sends the player's controls and draws the newest `SimFrame` (played back smoothly, its own
 * player predicted ahead); the host's content, presentation calls and block edits arrive in the
 * same batches. It runs one game at a time from the catalog (`GameEntry`), with that game's
 * shared definition, loaded when it's picked.
 */
export class Runtime {
  mode: Mode = 'title';
  private settings: Settings;
  /** Graphics lowered while frames are slow, and the settings as they're drawn. */
  private quality = new AutoQuality();
  private look: Look | null = null;
  private renderer!: Renderer;
  private env = new Environment();
  private camera: THREE.PerspectiveCamera;
  private pool!: WorkerPool;
  private chunks!: ChunkManager;
  private registry!: Registry;
  /** Which blocks bullets carve (`world.destructible`): the ids, and only above this height. */
  private carving: { ids: Uint8Array; above: number } | null = null;
  /** The game's own blocks (`def.blocks`). */
  private blocks!: GameBlocks;
  private textures!: TextureSet;
  private biome!: BiomeMap;
  /** Every listener this game adds goes when it's aborted (switching games). */
  private life = new AbortController();
  private disposed = false;
  /** The game's client code (its kits and frame) on this screen. */
  private client!: ClientRuntime;
  private clientStarted = false;
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
  /** The first-person layer (`client.view`): what's in hand and the player's arms, placed by the game's kits. */
  private held!: FirstPersonLayer;
  private graphics!: EntityGraphics;
  private entityView!: EntityView;
  private pickupView!: PickupView;
  private propView!: PropView;
  private fx!: Effects;
  readonly sfx = new Sfx();
  /** The game's sounds, atlases, animations, entity and item types. */
  private content = new Content();
  private presenter!: Presenter;
  /** The newest frame from the host. */
  private frameData: SimFrame | null = null;
  /** The host has set the game up and placed the player. */
  private hostReady = false;
  private requests = new Map<number, (value: unknown) => void>();
  /** Which player in the frames is this client's (null: watching the game, not in it yet). */
  private playerId: string | null;
  /** The server's frames, played back smoothly. */
  private playback!: FrameBuffer;
  /** This client's own movement, predicted ahead of the server (walking games). */
  private predictor: Predictor | null = null;
  /** The solid props prediction bumps into and stands on (walking games). */
  private movers: ClientMovers | null = null;
  /** The prop this player rides and which way it was drawn facing: their view turns with it. */
  private rideHeading: { prop: number; heading: number } | null = null;
  /** This client's own vehicle (`player.drive`): predicted, its camera and model's pose. */
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
  private dir = new THREE.Vector3();
  private light = new THREE.Vector3();
  private probe = new THREE.Vector3(1, 1, 1);
  private probeFrame = 0;
  private titleSpin = 0;
  /** What's on screen, to redraw only on change. */
  private shown = { health: '', hotbar: '', creative: '', held: '', arm: '', humanoid: '' };
  /** Development: treat input as active without pointer lock (headless tests). */
  debugActive = false;
  /** In a room of a player's own: its code. */
  private room: string | null = null;
  /** The world's seed (the server's). */
  private seed: number;
  /** The held gun on this screen: it fires at once, and its shots go to the host with the controls. */
  private guns: GunController;
  /** The game's gun rules (`guns`), as the host plays them: movement, reloading, hitboxes. */
  private gunRules: GunRules;
  /** Shots fired and not yet sent (they go with the frame's controls). */
  private shotQueue: [number, number, number, number][] = [];
  /** Throwables: cooked and thrown on this screen at once; the throws not yet sent. */
  private throwsCtl!: ThrowController;
  private throwQueue: NonNullable<PlayerInput['throws']> = [];
  /** Throwables in the air (ours, and everyone's), flown here. */
  private flights!: Flights;
  /** `client.hud`: client code's layers and stylesheets. */
  private clientHud!: ClientHudService;
  /** Chips and chunks knocked out of blocks, settling as little cubes. */
  private rubble!: Rubble;
  /** Damage this batch brought (rubble is thrown once the batch's explosions are known), and those explosions. */
  private damageSeen: Uint8Array[] = [];
  private blasts: { at: Vec3; size: number; age: number }[] = [];
  /** This frame's shots, told to the client code once the camera's placed (their bullets go from the eye). */
  private ownShots: FiredShot[] = [];
  /** The host time of the frame last drawn (shots hit where others were then). */
  private shownT = 0;
  /** A clip our own movement abilities started (`trigger(name, { clip })`), shown on our figure until the host's word arrives. */
  private ownClip: ClipFrame | null = null;
  /** The game's movement, for prediction and a gun's spread. */
  private tune: MoveTune;
  /** Undo the game's HUD theme (switching games). */
  private unTheme: () => void = () => {};
  /** Average colours of blocks' textures (bullet chips), by block id. */
  private blockColors = new Map<number, [number, number, number]>();
  /** A controller in the menus: the highlighted control. */
  private padNav = new PadNav(document.body);
  /** Other players on show, where a controller's aim assist looks for them (chest height). */
  private targets: { id: string; x: number; y: number; z: number }[] = [];
  /** Aim assist: who it's on, and which way they were last frame (it turns with them). */
  private assistOn: { id: string; yaw: number; pitch: number } | null = null;
  /** The held gun's aim assist shape (its own over the game's). */
  private assist: { gun: Gun; shape: Assist } | null = null;
  /** How long the right stick has been pushed all the way sideways (turning round speeds up). */
  private fullTilt = 0;
  /** Our health last frame (the controller rumbles when it drops). */
  private lastHealth = -1;
  /**
   * A replay playing on this screen (`game.replay.show`): its frames are drawn in place of the live
   * game's, through its player's eyes (their own camera, `replayView`) or from its camera.
   */
  private replay: ReplayPlayback | null = null;
  private replayView!: PlayerCamera;
  /** The followed player's shots this frame: their bullets go out once the hand's placed (as our own do). */
  private replayShots: ShotWire[] = [];
  /** The followed player's gun coming down for a sprint (0..1, eased as the gun controller eases ours). */
  private replaySprint = 0;
  /**
   * When the replay last moved on (ms, the page's clock): it plays on the wall clock, as the server
   * times it, so a slow frame (whose `dt` is capped) doesn't leave it behind to be cut short.
   */
  private replayWall = 0;
  /** `client.replay.skip()` was called: the replay ends as the next frame starts (every kit sees `replay.end` in its `frame`). */
  private replaySkip = false;

  private constructor(
    private canvas: HTMLCanvasElement,
    private ui: HTMLElement,
    /** The game: its shared definition (what this screen reads of it). */
    private def: SharedDefinition,
    /** The game's code for this screen (its kits, its own frame). */
    private clientDef: ClientDefinition,
    private games: GameEntry[],
    private hidden: GameEntry[],
    /** The connection to the game's server, where the game runs. */
    private link: SocketLink,
    /** The home page (up already, showing the game loading). */
    title: TitleScreen,
    /** What the previous game left for this one (switching in place). */
    private carried: Carry | null = null,
  ) {
    this.playerId = link.welcome.player;
    this.seed = link.welcome.seed;
    this.settings = loadSettings();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.1, 400);
    this.camera.layers.enable(LAYER_CHUNKS);
    this.input = new Input(canvas, this.life.signal);
    this.walker = (def.player?.controller ?? 'walk') === 'walk';
    this.tune = resolveMovement(def.player?.movement);
    this.gunRules = resolveGunRules(def.guns);
    this.guns = new GunController(this.gunRules);
    this.itemMode = this.walker && (def.player?.hotbar ?? (def.player?.build ? 'blocks' : 'items')) === 'items';
    const padKeys = { jump: 'Space', crouch: this.tune.crouchKeys[0] ?? 'ShiftLeft', sprint: this.tune.sprintKeys[0] ?? 'ControlLeft' };
    this.input.padBindings = padBindings(def.gamepad);
    this.input.padKeysFor = padKeys;
    // The title screen asks for a name and says who's on; a game with rooms of players' own
    // offers one (or, in one, the link to it and the way back).
    const room = link.welcome.room && link.welcome.room !== 'public' ? link.welcome.room : null;
    this.room = room;
    const online = { server: new URL(link.url).origin, game: def.id, room, onRoom: def.instances ? (own: boolean) => this.switchGame(def.id, own ? newRoomCode() : null) : undefined };
    this.title = title;
    this.title.show({ current: def.id, title: def.title, onPlay: () => this.play(), onPick: (id) => this.switchGame(id), controls: def.controls, pad: padHints(def, this.walker, padKeys), walks: this.walker, keys: this.settings.keys, online });
  }

  /**
   * Boot the game selected by `?game=` (default: the first in the catalog) on its game server:
   * connect to it, watching behind the title screen, and join on Play. The server is `?server=`
   * (`ws://localhost:8787`, or one game on one: `ws://localhost:8787/sandbox`), else the build's
   * (`VITE_GAME_SERVER`, e.g. wss://voxel-games.fly.dev), else in development the local one that
   * `npm run dev` runs. `?room=` picks a room of a player's own there instead of the public one (a
   * game with `instances`). The game's client code (its own chunk) loads while the connection
   * opens; the home page shows it loading meanwhile.
   */
  static async start(canvas: HTMLCanvasElement, ui: HTMLElement, games: GameEntry[], hidden: GameEntry[] = [], carried: Carry | null = null): Promise<Runtime> {
    const url = new URL(location.href);
    const picked = url.searchParams.get('game');
    const given = url.searchParams.get('server');
    // A server (then as a build with one), or one game's address on it.
    const base = given ? (Runtime.gameAddress(given) ? null : given.replace(/\/+$/, '')) : Runtime.defaultServer();
    // Development games open by id but aren't listed in the launcher (a server names one too:
    // `?server=ws://host&game=highnoon`).
    const find = (id: string | null) => [...games, ...hidden].find((g) => g.meta.id === id);
    const listed = find(picked) ?? games[0];
    const room = url.searchParams.get('room');
    const own = room && listed.meta.instances && ROOM_CODE.test(room) ? room : null;
    const address = base ? `${base}/${listed.meta.id}${own ? `/${own}` : ''}` : given;
    if (!address) throw new Error('No game server to play on: open with ?server=ws://host:port, or build with VITE_GAME_SERVER.');
    // The home page at once, showing the game loading (it stays up when switching games).
    const title = carried?.title ?? new TitleScreen(ui, games.map((g) => g.meta));
    title.select(listed.meta.id);
    // Its client code loads while the connection opens (a server's own address names the game
    // only in its welcome).
    const early = base ? listed.load() : null;
    early?.catch(() => {});
    const link = await SocketLink.connect(address);
    let game: ClientGame;
    try {
      const entry = find(link.welcome.game);
      if (!entry) throw new Error(`The server is running "${link.welcome.game}", which this client doesn't have.`);
      game = await (entry === listed && early ? early : entry.load());
    } catch (err) {
      link.close();
      throw err;
    }
    const rt = new Runtime(canvas, ui, game.shared, game.client, games, hidden, link, title, carried);
    await rt.init();
    Runtime.onStart?.(rt);
    return rt;
  }

  /**
   * The server when the page doesn't name one: the build's (`VITE_GAME_SERVER`), else in
   * development the local one `npm run dev` runs (on this page's host; `VITE_DEV_GAME_PORT`).
   */
  private static defaultServer(): string | null {
    const built = (import.meta.env.VITE_GAME_SERVER as string | undefined)?.replace(/\/+$/, '');
    if (built) return built;
    if (!import.meta.env.DEV) return null;
    const port = (import.meta.env.VITE_DEV_GAME_PORT as string | undefined) ?? '8787';
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname || 'localhost'}:${port}`;
  }

  /** A `?server=` naming one game on a server (`ws://host/sandbox`), not the server. */
  private static gameAddress(server: string): boolean {
    try {
      return new URL(server).pathname.replace(/\/+$/, '') !== '';
    } catch {
      return false;
    }
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
    // The game's own blocks (with the ids a server gave them, if it said), before anything that
    // needs to know them: the registry, the terrain workers, the world.
    this.blocks = gameBlocks(def, this.link.welcome.blocks);
    useGameBlocks(this.blocks);
    this.registry = loadRegistry(this.blocks);
    const destructible = def.world?.destructible;
    this.carving = destructible ? { ids: destructibleIds(this.registry, destructible), above: destructible.above ?? -1 } : null;
    this.title.progress(0.06, 'Generating textures…');
    const worldCfg = worldGenConfig(def, (b) => this.blockId(b));
    const workers = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 2));
    const poolPromise = WorkerPool.create(module, this.seed, workers, worldCfg, this.blocks.json);
    // The game's own block textures after the built-in ones (images fetched meanwhile).
    const own = this.blocks.textures.length ? { ...(await paintGameTextures(this.blocks.textures, builtinTextures(), this.blocks.textureNames)), key: this.blocks.textureKey } : undefined;

    // The renderer and block textures carry over from the previous game, if there was one (the
    // textures only if its own blocks were this one's).
    const c = this.carried;
    if (c) {
      this.renderer = c.renderer;
      this.textures = c.textures;
      this.biome = c.biome;
      if (c.textures.key !== this.blocks.textureKey) {
        c.textures.albedo.dispose();
        c.textures.material.dispose();
        this.textures = createBlockTextures(this.renderer.gl, own);
        this.renderer.setTextures(this.textures.albedo, this.textures.material, this.biome.texture);
      }
    } else {
      const noise = createNoiseTexture();
      const torchLayer = this.registry.byName.get('torch')?.tex[0] ?? 0;
      this.renderer = new Renderer(this.canvas, toRenderSettings(this.settings), noise, torchLayer);
      this.renderer.fxScene.matrixWorldAutoUpdate = true;
      this.textures = createBlockTextures(this.renderer.gl, own);
      this.biome = new BiomeMap(this.renderer.gl);
      this.renderer.setTextures(this.textures.albedo, this.textures.material, this.biome.texture);
    }
    const biome = this.biome;
    // Over the void the sky goes on below the horizon, an abyss; a void world with ground has a horizon like any other.
    this.renderer.uniforms.uVoid.value = def.world?.terrain === 'void' && !def.world.ground ? 1 : 0;
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
    this.rubble = new Rubble((x, y, z) => world.point_solid(x, y, z), this.renderer.uniforms.uSunDir);
    this.renderer.opaqueScene.add(this.rubble.mesh);

    const icons = new Map<number, string>();
    for (const b of this.registry.blocks) {
      if (b.id === 0) continue;
      // A bed's icon shows it whole: the head too.
      const head = b.model === 'bed' ? variant(this.registry, b, { part: 'head' }) ?? undefined : undefined;
      // A game's block that faces a way shows its front (the icon's left is the south face).
      const shown = b.id >= firstGameBlock() && b.state.facing ? (variant(this.registry, b, { facing: 'south' }) ?? b) : b;
      icons.set(b.id, blockIcon(shown, this.textures.albedoData, head));
    }
    this.blockIcons = icons;
    this.hud = new Hud(this.ui, this.registry, icons);
    this.gameHud = new GameHud(this.ui, (ref) => this.iconOf(ref, 96));
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
      // Closed by a button click: grab the mouse again (needs a user gesture), or give the controller the game back.
      else if (this.mode === 'playing' && (this.input.device === 'pad' || navigator.userActivation?.isActive)) this.input.lock();
    };
    this.gameHud.onCrosshair = (v) => this.hud.setCrosshair(v);
    this.gameHud.player = this.playerId;
    this.gameHud.setHealthStyle(def.hud?.health ?? 'hearts');
    this.unTheme = applyTheme(this.ui, def.hud?.theme);
    if (!this.walker) this.hud.setHotbarVisible(false);
    this.debug = new DebugOverlay(this.ui);
    this.fx = new Effects(this.particles, this.gameHud, this.renderer.fxScene, this.sfx, () => this.camera.position);
    this.fx.onBlast = (at, size) => this.blasts.push({ at: { x: at.x, y: at.y, z: at.z }, size, age: 0 });
    this.throwsCtl = new ThrowController(this.content.items);
    // Throwables fly here as the host flies them; the client code draws them (see `client.thrown`).
    const flying = flightWorld(world, this.registry);
    this.flights = new Flights(this.content.items, flying, {
      bounce: (key, item, at, speed) => this.emit({ t: 'bounce', key, item, at, speed }),
      end: (key, item, at) => this.emit({ t: 'thrownEnd', key, item, at }),
    });

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
    this.view.clearance = (from, dir, max) => this.clearance(from, dir, max);
    this.replayView = new PlayerCamera(this.camera);
    this.held = new FirstPersonLayer(this.textures.albedo, this.textures.material, this.graphics, this.camera, this.content.animations, (e) => this.client?.emit(e));
    this.renderer.overlay = { scene: this.held.view.scene, camera: this.held.view.camera };
    this.renderer.opaqueScene.add(this.highlight.object);

    // The game's content reaches the client's renderer and audio as it's defined.
    this.content.onWidget((name, widget) => this.gameHud.defineWidget(name, widget));
    this.content.onAtlas((name, source) => {
      if ('pixels' in source) this.graphics.addAtlas(name, source.width, source.height, source.pixels, source.emissive);
      else this.graphics.addCanvasAtlas(name, source);
    });

    // The presentation calls the host sends run here; callbacks go back as messages.
    this.presenter = new Presenter(this.playerId, {
      hud: this.gameHud,
      fx: this.fx,
      sfx: this.sfx,
      view: (method, args) => this.viewCall(method, args),
      send: (m) => this.link.send({ t: 'message', msg: m }),
      message: (name, data) => this.message(name, data),
      item: (id) => this.content.items.get(id),
    });

    // The game's host is on the server: it set the game up and placed the spawn, and sends batches.
    // Two steps behind the newest frame: smooth, and about 70 ms behind the server at 30 steps a second.
    this.playback = new FrameBuffer(2 / this.link.welcome.tickRate);
    this.link.onClose = () => this.disconnected();
    if (this.walker) {
      // Movement as the server moves them: the game's tuning, and what they hold (a heavy gun, aiming).
      this.predictor = new Predictor(this.chunks.world, this.tune, (input) => moveMods(this.heldDef(), input.buttons, this.mine(this.frameData)?.speed ?? 1, this.gunRules), worldQuery(this.chunks.world, this.registry));
      this.movers = new ClientMovers(this.chunks.world, this.content, this.registry, (b) => this.blockId(b));
    }

    this.vehicles = new VehicleView(def.vehicles ?? {}, worldQuery(this.chunks.world, this.registry), true);
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
    this.held.visible = false;

    this.pause = new PauseMenu(this.ui, this.settings, (s) => this.applySettings(s), () => this.input.lock());
    this.pause.onTime = (t) => this.link.send({ t: 'env', time: t });
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
    this.input.onDevice = (d) => {
      document.body.classList.toggle('pad-mode', d === 'pad');
      if (d === 'mouse') this.padNav.clear();
    };
    this.input.onPadButton = (b, a) => this.onPadButton(b, a);
    document.body.classList.toggle('pad-mode', this.input.device === 'pad');
    this.pause.setPadHints(padHints(def, this.walker, this.input.padKeysFor));
    const life = { signal: this.life.signal };
    this.canvas.addEventListener('click', () => {
      this.sfx.unlock();
      if (this.mode === 'console') {
        this.commandBar.close();
        return;
      }
      if (this.gameHud.screenOpen) return;
      // (Clicking while a controller plays hands the game to the mouse.)
      const unlockedPlay = this.mode === 'playing' && !this.input.pointerLocked;
      if (this.mode === 'paused' || unlockedPlay || (this.mode === 'title' && this.worldReady)) this.input.lock();
    }, life);
    window.addEventListener('resize', () => this.resize(), life);
    // Leaving the page: leave the game, even if the browser keeps the page to come back to (its
    // connection would otherwise stay, and the player with it). Back again: a fresh start.
    window.addEventListener('pagehide', () => this.link.close(), life);
    window.addEventListener('pageshow', (e) => e.persisted && location.reload(), life);

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
    // The game's code for this screen: its kits and its own frame.
    const view = this.view;
    const input = this.input;
    const worldCamera = this.camera;
    this.clientHud = new ClientHudService(this.hud, this.gameHud, def.hud?.theme);
    this.client = new ClientRuntime(this.def, this.clientDef, {
      services: {
        // First person.
        view: this.held,
        // Figures.
        figures: this.entityView.figures,
        // HUD and effects.
        hud: this.clientHud,
        scene: new SceneService(this.renderer.entityScene, this.graphics, this.content.items),
        thrown: this.flights.list,
        // Replays.
        replay: this.replayService(),
        // Shared services.
        camera: {
          get zoom() {
            return view.aimZoom;
          },
          set zoom(z: number) {
            view.aimZoom = z;
          },
          get fov() {
            return worldCamera.fov;
          },
          get position() {
            const p = worldCamera.position;
            return { x: p.x, y: p.y, z: p.z };
          },
          toWorld: (local) => {
            const p = worldCamera.localToWorld(new THREE.Vector3(local.x, local.y, local.z));
            return { x: p.x, y: p.y, z: p.z };
          },
        } as Client['camera'],
        fx: this.fx,
        audio: { play: (name, opts) => this.sfx.play(name, opts), define: (name, voice) => this.sfx.define(name, voice) },
        items: { look: (id, look) => this.content.lookItem(id, look), get: (id) => this.content.items.get(id) },
        input: {
          isDown: (code) => input.isDown(code),
          button: (b) => input.button(b),
          get device() {
            return input.device;
          },
        },
        world: {
          blockAt: (x, y, z) => this.registry.blocks[this.chunks.world.get_block(Math.floor(x), Math.floor(y), Math.floor(z))]?.name ?? 'air',
          raycast: (from, dir, max) => {
            const h = flying.hit(from.x, from.y, from.z, dir.x, dir.y, dir.z, max);
            return h && { distance: h.t, normal: { x: h.nx, y: h.ny, z: h.nz } };
          },
        },
      },
      item: (id) => this.content.items.get(id),
      send: (name, data) => this.sendMessage(name, data),
      running: () => this.frameData?.started ?? false,
    });
    for (const e of this.early) this.client.emit(e);
    this.early = [];
    this.clientStarted = false;
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

  /**
   * A message from the host for the client code: the platform's own (`$` names: events the kits
   * draw from, or the engine's own doing), else the game's (`client.on`).
   */
  private message(name: string, data: unknown) {
    if (!name.startsWith('$')) return this.client ? this.client.message(name, data) : this.emit({ t: 'message', name, data });
    if (name === '$debris') {
      const [x, y, z, id] = data as [number, number, number, number];
      const def = this.registry.blocks[id];
      if (!def) return;
      const face = def.tex[0];
      this.particles.burst(x, y, z, this.textures.albedoData.subarray(face * 1024, face * 1024 + 1024), def.tint ? DEFAULT_TINT : null);
      this.rubbleFromBlock(x, y, z, id);
    } else if (name === '$shot') {
      this.othersShot(data as ShotWire);
    } else if (name === '$thrown') {
      // Someone else's throw (ours flies already): flown here from the host's word.
      const [key, item, , x, y, z, vx, vy, vz, fuse] = data as [string, string, string, number, number, number, number, number, number, number];
      if (this.flights.add(key, item, { x, y, z }, { x: vx, y: vy, z: vz }, fuse)) this.emit({ t: 'thrown', key, item, mine: false });
    } else if (name === '$thrownEnd') {
      const [key, at] = data as [string, [number, number, number] | null];
      this.flights.end(key, at);
    } else if (name === '$fire') {
      const [id, x, y, z, radius, duration, color] = data as [number, number, number, number, number, number, string];
      this.emit({ t: 'fire', id, at: { x, y, z }, radius, duration, color });
    } else if (name === '$reset') {
      // A restart: everything the game put on screen goes (a replay too).
      this.endReplay(false);
      this.guns.reset();
      this.entityView.clear();
      this.pickupView.clear();
      this.propView.clear();
      this.presenter.reset();
      this.gameHud.clear();
      this.highlight.set(null);
      this.fx.clear();
      this.flights.clear();
      this.throwsCtl.reset();
      this.rubble.clear();
      this.emit({ t: 'reset' });
    }
  }

  /**
   * The server's calls to this player's first-person view (`player.viewModel`, and the sim's own
   * uses, swings and kicks): events for the game's client code (its first-person kit plays them).
   */
  private viewCall(method: string, args: unknown[]) {
    const power = (args[0] as number | undefined) ?? 1;
    switch (method) {
      case 'visible':
        return this.emit({ t: 'view.visible', visible: args[0] as boolean });
      case 'setSkin':
        return this.emit({ t: 'view.setSkin', skin: args[0] as [number, number] | null, atlas: args[1] as string | undefined });
      case 'play': {
        const opts = args[1] as { power?: number; speed?: number } | undefined;
        return this.emit({ t: 'view.play', anim: args[0] as string, power: opts?.power ?? 1, speed: opts?.speed ?? 1 });
      }
      case 'kick':
        return this.emit({ t: 'kick', strength: power });
      case 'use':
        return this.emit({ t: 'use', power });
      case 'swing':
        return this.emit({ t: 'swing', power });
    }
  }

  /** Something happened for the client code (its kits see it this frame, or the first, if it hasn't started yet). */
  private emit(e: ClientEvent) {
    if (this.client) this.client.emit(e);
    else this.early.push(e);
  }
  /** Events from before the client code was made (the host's first batches come as the link's taken on). */
  private early: ClientEvent[] = [];

  /** `client.send`: a message from the client code to the game's server (`clientMessage` there), checked here as the server will. */
  private sendMessage(name: string, data: unknown) {
    const m = sanitizeGameMessage(name, data);
    if (!m) {
      console.warn(`client.send('${name}'): a message needs a name (a letter, then letters, digits, _ - . :) and plain data of at most ${MESSAGE_MAX.client} bytes as JSON`);
      return;
    }
    // (Watching, not in the game: there's no player to say it.)
    if (this.playerId) this.link.send({ t: 'message', msg: m });
  }

  // ---------------------------------------------------------------------------------------------
  // Replays (`game.replay.show`)
  // ---------------------------------------------------------------------------------------------

  /** `client.replay`: the replay playing here, as client code sees it. */
  private replayService(): ClientReplay {
    const rt = this;
    return {
      get playing() {
        return rt.replay !== null;
      },
      get id() {
        return rt.replay?.wire.id ?? 0;
      },
      get follow() {
        return rt.replay?.wire.follow ?? null;
      },
      get label() {
        return rt.replay?.wire.label ?? '';
      },
      get data() {
        return rt.replay?.wire.data ?? null;
      },
      get time() {
        return rt.replay?.time ?? 0;
      },
      get duration() {
        return rt.replay?.duration ?? 0;
      },
      get speed() {
        return rt.replay?.wire.speed ?? 1;
      },
      get skippable() {
        return rt.replay?.wire.skippable ?? false;
      },
      skip: () => {
        if (rt.replay?.wire.skippable) rt.replaySkip = true;
      },
    };
  }

  /** A replay for this screen: it plays from the next frame (one playing already gives way). */
  private startReplay(wire: ReplayWire) {
    if (wire.steps.length < 2) return;
    if (this.replay) this.endReplay(false);
    this.replay = new ReplayPlayback(wire);
    this.replayShots = [];
    this.replaySprint = 0;
    this.replayWall = performance.now();
    this.replaySkip = false;
    this.replayView.settleFrom(this.view);
    // Things in the air now are the live game's: the replay's own fly instead.
    this.flights.clear();
    this.ui.classList.add('replaying');
    this.emit({ t: 'replay.start', label: wire.label, follow: wire.follow, data: wire.data });
  }

  /** The replay's over here: played out, ended by the server, or skipped (the server hears). */
  private endReplay(skipped: boolean) {
    const r = this.replay;
    if (!r) return;
    this.replay = null;
    this.replayShots = [];
    this.replaySkip = false;
    if (skipped && this.playerId) this.link.send({ t: 'message', msg: { t: 'replaySkip', player: this.playerId, id: r.wire.id } });
    this.flights.clear();
    this.view.aimZoom = 1;
    this.ui.classList.remove('replaying');
    this.emit({ t: 'replay.end', label: r.wire.label, skipped });
  }

  /**
   * While a replay plays, what the live game shows in the world isn't: its effects, sounds out in
   * the world, shots, throws and fires, and calls to our own view (it's the replay's eyes now).
   * The HUD's calls, sounds of no place and the game's own messages still come.
   */
  private hiddenByReplay(c: PresentCall): boolean {
    switch (c.target) {
      case 'fx':
        return true;
      case 'audio':
        return c.method === 'play' && !!(c.args[1] as { at?: unknown } | undefined)?.at;
      case 'message':
        return c.method.startsWith('$') && c.method !== '$reset';
      case 'view':
        return c.method !== 'visible' && c.method !== 'setSkin';
      default:
        return false;
    }
  }

  /**
   * The replay on by this frame's time: what was shown in the steps it passed (the followed
   * player's own shots kick their hands; everyone else's fly from their figures), and the frame to
   * draw with whoever's eyes it follows in it. Null: it just ended (the live game is drawn).
   */
  private replayStep(): { frame: SimFrame; eyes: PlayerFrame | null; follow: string | null } | null {
    const r = this.replay!;
    if (r.done || this.replaySkip) {
      this.endReplay(this.replaySkip);
      return null;
    }
    const wall = performance.now();
    const due = r.advance(Math.min(0.5, Math.max(0, (wall - this.replayWall) / 1000)));
    this.replayWall = wall;
    const frame = r.sample();
    const follow = r.wire.follow;
    for (const e of due) this.replayEvent(e, follow, frame);
    const eyes = follow ? (frame.players.find((p) => p.id === follow) ?? null) : null;
    return { frame, eyes, follow };
  }

  /**
   * Something shown in a replay's step, as the followed player's screen showed it: calls to
   * everyone (but those their own screen made itself: their shots, their throws), and theirs.
   */
  private replayEvent(e: ReplayEvent, follow: string | null, frame: SimFrame) {
    if (e.t === 'damage') return this.rubbleFromDamage(e.data);
    const c = e.call;
    if (c.to !== null && c.to !== follow) return;
    if (c.target === 'message') {
      if (c.method !== '$shot') return this.message(c.method, c.args[0]);
      const w = c.args[0] as ShotWire;
      if (follow !== null && w.by === follow) {
        // Their own: their hand kicks now, the bullets go once it's placed.
        this.emit({ t: 'shot', item: w.item, power: 1 });
        this.replayShots.push(w);
      } else this.othersShot(w, frame.players);
      return;
    }
    // Their own screen made these itself (the sound of their shot): shown from their `$shot`.
    if (c.to === null && c.skip !== undefined && c.skip === follow) return;
    switch (c.target) {
      case 'fx':
        return (this.fx as unknown as Record<string, (...a: unknown[]) => void>)[c.method]?.(...c.args);
      case 'audio': {
        const sound = c.method === 'play' ? soundOf(c.args[0] as string, c.args[1] as Parameters<typeof soundOf>[1], (id) => this.content.items.get(id)) : null;
        if (sound) this.sfx.play(sound[0], sound[1]);
        return;
      }
      case 'view':
        return this.viewCall(c.method, c.args);
    }
  }

  /** Where a replay's camera is: the followed player's eyes (first person), else its own camera. */
  private replayCamera(dt: number, eyes: PlayerFrame | null) {
    const r = this.replay!;
    if (eyes) {
      const v = this.replayView;
      v.yaw = eyes.view.yaw;
      v.pitch = eyes.view.pitch;
      // (Aiming zooms as client code has it: `client.camera.zoom`.)
      v.aimZoom = this.view.aimZoom;
      v.follow(dt, eyes);
      return;
    }
    const cam = r.wire.camera;
    if (!cam) return;
    this.camera.position.set(cam.at[0], cam.at[1], cam.at[2]);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(cam.look[0], cam.look[1], cam.look[2]);
    const fov = cam.fov ?? this.settings.fov;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
  }

  /** The followed player's shots this frame, for the client code: from their hand as it's drawn (`bullets`, ours as far as the kits know). */
  private replayBullets() {
    const shots = this.replayShots;
    this.replayShots = [];
    for (const w of shots) this.emit({ t: 'bullets', item: w.item, by: w.by, mine: true, from: null, bullets: this.bulletsOf(w) });
  }

  /** `client.me` in a replay: the player it follows, as it shows them (their look, what they hold, their gun as it was). */
  private replayMe(p: PlayerFrame, dt: number): Me {
    const stack = p.hotbar?.slots[p.hotbar.selected] ?? null;
    this.replaySprint += ((p.sprinting ? 1 : 0) - this.replaySprint) * Math.min(1, dt * 10);
    return {
      id: p.id,
      position: { x: p.x, y: p.y, z: p.z },
      velocity: { x: p.vx, y: p.vy, z: p.vz },
      look: { yaw: p.view.yaw, pitch: p.view.pitch },
      onGround: p.onGround,
      flying: p.flying,
      crouching: p.sneaking,
      sprinting: p.sprinting,
      sliding: p.sliding,
      dead: p.dead,
      inVehicle: !!p.vehicle,
      health: p.health,
      maxHealth: p.maxHealth,
      bob: { phase: p.bob * Math.PI * 0.9, amount: this.settings.viewBobbing && p.onGround && !p.flying ? Math.min(1, Math.hypot(p.vx, p.vz) / 4.3) : 0 },
      thirdPerson: false,
      hand: { item: stack?.item ?? null, count: stack?.count ?? 0, strength: this.itemMode ? p.hand.strength : 1, drawing: p.hand.drawing, charge: p.hand.charge },
      held: this.replayHeld(p, stack?.item ?? null),
      abilities: {},
      quick: [],
      cooking: null,
    };
  }

  /** The followed player's held gun as the replay's frame has it (its rounds, reload, how far it's aimed). */
  private replayHeld(p: PlayerFrame, item: string | null): Me['held'] {
    const def = item ? this.content.items.get(item) : undefined;
    const h = p.hand.gun;
    if (!item || !isGun(def) || !h) return null;
    const g = gunOf(def);
    const shells = def.shells ? Math.max(0, Math.min(def.magazine - h.mag, h.reserve)) : 0;
    const reload = h.reload < 0 ? -1 : Math.max(0, Math.min(def.shells ? 0.999 : 1, 1 - h.reload / Math.max(0.01, def.reload)));
    const spread = spreadDeg(g, { aim: h.aim, moving: Math.hypot(p.vx, p.vz) / Math.max(1, this.tune.params[0]), air: !p.onGround, crouch: p.sneaking, bloom: 0 });
    return {
      item,
      def,
      state: { aim: h.aim, sprint: this.replaySprint, slide: p.sliding ? 1 : 0, reload, shells, sight: g.aim.sight, action: def.action, zoom: g.aim.zoom, mag: h.mag, reserve: h.reserve, spread, color: g.aim.color },
    };
  }

  /** Show a block in the hand (a bed whole: its head too), from the block picker or an item that looks like one. */
  private holdBlock(id: number, item: string | null = null, itemDef?: ItemDefinition) {
    const def = this.registry.blocks[id];
    this.held.holdBlock(def, def?.model === 'bed' ? (variant(this.registry, def, { part: 'head' }) ?? undefined) : undefined, item, itemDef);
  }

  /** `hud.highlight`: outline a block, with break cracks at `progress`. */
  private setHighlight(at: Vec3 | null, progress?: number) {
    if (!at) return this.highlight.set(null);
    const [x, y, z] = [Math.floor(at.x), Math.floor(at.y), Math.floor(at.z)];
    const def = this.registry.blocks[this.chunks.world.get_block(x, y, z)];
    // A fence or pane as it's joined there.
    let boxes = def?.boxes;
    if (def?.joins) {
      const flat = this.chunks.world.target_boxes(x, y, z);
      boxes = Array.from({ length: flat.length / 6 }, (_, i) => [...flat.subarray(i * 6, i * 6 + 6)]);
    }
    this.highlight.set(at, def?.shape === 'cross' ? 'cross' : (boxes ?? null), progress);
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
          // (A replay playing: what the live game shows in the world waits for nobody.)
          if (this.replay && this.hiddenByReplay(e.call)) break;
          this.presenter.apply(e.call);
          break;
        case 'edits':
          this.chunks.mirrorEdits(e.cells);
          break;
        case 'damage':
          this.chunks.applyDamage(e.data);
          if (this.worldReady && !this.replay) this.damageSeen.push(e.data);
          break;
        case 'replay':
          this.startReplay(e.replay);
          break;
        case 'replayEnd':
          if (this.replay?.wire.id === e.id) this.endReplay(false);
          break;
        case 'revert':
          this.chunks.revertEdits();
          break;
        case 'joined':
          // In the game now, as this player.
          this.playerId = e.player;
          this.presenter.player = e.player;
          this.gameHud.player = e.player;
          break;
        case 'ready':
          this.hostReady = true;
          // The skin may live in an atlas the game registered in `setup`, which has arrived by now.
          if (this.def.player?.skin) this.held.arms.setSkin(this.def.player.skin, this.def.player.skinAtlas);
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
    // The batch's shots show together, and the rubble they knocked out flies.
    this.chunks.flushDamage();
    for (const d of this.damageSeen) this.rubbleFromDamage(d);
    this.damageSeen = [];
    if (b.frame) {
      this.frameData = b.frame;
      // In a room of a player's own, the home page says who's in it.
      if (this.room && this.mode === 'title') this.title.present(b.frame.players.map((p) => p.name));
      this.playback.push(b.frame, (b as TimedBatch).time);
      const me = this.playerId !== null ? b.frame.players.find((p) => p.id === this.playerId) : undefined;
      // Prediction starts again from this frame: its solid props too.
      this.movers?.sync(b.frame.props, b.frame.clock);
      if (me) {
        this.predictor?.reconcile(me);
        this.vehicles.reconcile(me);
        if (me.dead) this.guns.reset();
        else this.guns.reconcile(me.hand.gun);
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
   * This client's player in a frame. Watching the game before joining, a stand-in at the spawn,
   * for the camera (circling above it on the title screen) and the terrain around it.
   */
  private mine(f: SimFrame | null): PlayerFrame | undefined {
    const me = f?.players.find((p) => p.id === this.playerId);
    if (me || !f || this.playerId) return me;
    const sp = this.link.welcome.spawn;
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
      sliding: false,
      speed: 1,
      bot: false,
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
      locked: false,
      canFly: false,
      swings: 0,
      ack: -1,
      move: freshMemory(),
      lead: 0,
      skin: null,
      model: null,
      color: null,
      throws: 0,
      ride: null,
      orbit: null,
    };
  }

  /** The server went away: say so, and stop sending. */
  private disconnected() {
    this.input.unlock();
    this.gameHud.screen({ title: 'Disconnected', subtitle: 'The connection to the game server was lost.', tone: 'defeat', buttons: [{ label: 'Reload', primary: true, onClick: () => location.reload() }] });
  }

  /**
   * Other players as figures (entities of the built-in `$player` type), with their names above.
   * `self` is whose eyes we see through (a replay's player, not `live`: never drawn), or none.
   */
  private avatars(f: SimFrame, me: PlayerFrame, self: string | null = this.playerId, live = true): FigureFrame[] {
    const out: FigureFrame[] = [];
    const seen = new Set<string>();
    this.targets = [];
    for (const other of f.players) {
      // Only people on foot get a figure: a driver is their vehicle's model. Our own shows in
      // third person, where we're shown (predicted) facing where we look.
      const mine = other.id === self;
      if ((mine && !(live && this.view.thirdPerson)) || !this.walker || other.vehicle) continue;
      const p = mine ? { ...me, view: { ...me.view, yaw: this.view.yaw, pitch: this.view.pitch } } : other;
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
      const held = p.hotbar?.slots[p.hotbar.selected]?.item ?? null;
      // The held item's mechanics, as the frame reports them (a gun's aim and reload): the dead aim nothing.
      const mech = p.dead ? undefined : p.hand.gun;
      out.push({
        id,
        player: p.id,
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
        held,
        aim: mech ? 1 : 0,
        posture: p.sliding ? 2 : p.sneaking ? 1 : 0,
        air: !p.onGround && !p.flying && !p.inWater,
        sprint: p.sprinting,
        reloading: (mech?.reload ?? -1) >= 0,
        sights: mech?.aim ?? 0,
        clip: (mine && this.ownClip) || p.clip || undefined,
      });
      if (mine) continue;
      if (live && !p.dead) this.targets.push({ id: p.id, x: p.x, y: p.y + (p.sliding ? 0.55 : p.sneaking ? 0.95 : 1.25), z: p.z });
      const tags = this.def.hud?.nameTags ?? 'always';
      if (tags === 'never' || p.dead) continue;
      const top = { x: p.x, y: p.y + (p.sliding ? 1.45 : p.sneaking ? 1.95 : 2.25), z: p.z };
      // In a shooter, names show only while nothing blocks the view (no finding people through walls).
      if (tags === 'sight') {
        const c = this.camera.position;
        if (!this.chunks.world.line_clear(c.x, c.y, c.z, top.x, top.y - 0.35, top.z)) continue;
      }
      const tag = `$name:${p.id}`;
      seen.add(tag);
      this.tags.add(tag);
      const bar = this.def.hud?.healthBars && p.maxHealth > 0 ? p.health / p.maxHealth : undefined;
      this.gameHud.marker(tag, top, { label: p.name, shape: 'dot', size: 3, color: p.color ?? '#ffffff', bar });
    }
    for (const tag of this.tags) {
      if (seen.has(tag)) continue;
      this.gameHud.marker(tag, null);
      this.tags.delete(tag);
    }
    return out;
  }

  /** Ask the host something; the answer comes in a later batch. */
  private request<T>(cmd: { t: 'exec' | 'complete'; line: string } | { t: 'dev'; js: string }): Promise<T> {
    const id = this.nextRequest++;
    return new Promise<T>((resolve) => {
      this.requests.set(id, resolve as (v: unknown) => void);
      this.link.send({ ...cmd, id });
    });
  }

  /** Back to the home page (this game's, fresh; the same room): `game.exit()`, the pause menu's Switch game. */
  exit() {
    this.switchGame(this.def.id, this.room);
  }

  /**
   * Another game, in place: the home page stays (showing it picked at once), the world fades
   * out, this game shuts down and the next starts, fading in when its world is ready.
   */
  private switchGame(id: string, room: string | null = null) {
    if (this.switching) return;
    this.switching = true;
    this.canvas.classList.add('fading');
    window.setTimeout(() => {
      const carry = this.shutdown();
      Runtime.switchTo(id, room, this.canvas, this.ui, this.games, this.hidden, carry);
    }, 260);
    this.title.select(id);
  }

  /** Start another game (or room) on the page the last one left (the home page stays up throughout). */
  private static switchTo(id: string, room: string | null, canvas: HTMLCanvasElement, ui: HTMLElement, games: GameEntry[], hidden: GameEntry[], carry: Carry) {
    const url = new URL(location.href);
    url.searchParams.set('game', id);
    if (room) url.searchParams.set('room', room);
    else url.searchParams.delete('room');
    for (const p of ['seed', 'name']) url.searchParams.delete(p);
    // A server stays (any game on it); one game's address doesn't.
    const server = url.searchParams.get('server');
    if (server && Runtime.gameAddress(server)) url.searchParams.delete('server');
    history.replaceState(null, '', url);
    carry.title.select(id);
    Runtime.start(canvas, ui, games, hidden, carry).catch((err: unknown) => {
      console.error(err);
      carry.title.failed(err instanceof Error ? err.message : String(err), (next) => Runtime.switchTo(next, null, canvas, ui, games, hidden, carry));
    });
  }

  /**
   * This game is over: stop its loop, its server connection, its terrain
   * workers, its listeners and sound; free its meshes, textures and HUD. The home page, renderer
   * and block textures go to the next game.
   */
  private shutdown(): Carry {
    this.disposed = true;
    this.client?.dispose();
    this.clientHud?.dispose();
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
    this.unTheme();
    this.gameHud?.closeScreens();
    // The HUD, menus and overlays this game put up; the home page stays.
    for (const el of [...this.ui.children]) if (el !== this.title.root) el.remove();
    return { title: this.title, renderer: r, textures: this.textures, biome: this.biome };
  }

  // ---------------------------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------------------------

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
    this.held.visible = this.hudVisible;
    this.mode = 'playing';
    // Joining the game: as the name on the title screen.
    this.link.send({ t: 'start', name: this.title.name() });
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
    }
  }

  private onKey(code: string, e?: KeyboardEvent) {
    if (this.mode === 'console') return;
    // Playing with a controller there's no pointer lock for Esc to leave: it pauses here.
    if (code === 'Escape' && this.mode === 'playing' && this.input.padCaptured && !this.gameHud.screenOpen) {
      this.input.unlock();
      return;
    }
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
        this.held.visible = this.hudVisible;
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

  /**
   * A controller button in the menus (or its pause button anywhere): the D-pad and stick move the
   * highlight, A presses, B goes back, Menu pauses and resumes.
   */
  private onPadButton(b: PadButton, a: PadAction) {
    if (this.mode === 'console') return;
    const back = () => {
      if (this.gameHud.back()) return;
      if (this.mode === 'paused') this.input.lock();
      else if (this.mode === 'picker') this.closePicker();
    };
    if (a === 'pause') {
      if (this.mode === 'playing' && this.input.locked && !this.gameHud.screenOpen) this.input.unlock();
      else if (this.mode === 'title') this.play();
      else if (this.mode === 'playing' && !this.gameHud.screenOpen) this.input.lock();
      else back();
      return;
    }
    if (b === 'Up' || b === 'Down' || b === 'Left' || b === 'Right') this.padNav.move(b);
    else if (b === 'A') this.padNav.press();
    else if (b === 'B') back();
  }

  /**
   * The right stick turns the view, as mouse movement would (so whatever reads the mouse, a
   * vehicle say, reads it too): faster with a longer push, faster still held all the way round,
   * slower aiming down the sights; with a gun, aim assist on the player in the crosshair.
   */
  private padAim(dt: number) {
    const [lx, ly] = this.input.padLook;
    this.fullTilt = Math.abs(lx) > 0.95 ? this.fullTilt + dt : 0;
    const boost = Math.min(1, Math.max(0, (this.fullTilt - 0.2) / 0.3));
    const s = this.settings.stickSensitivity / Math.pow(this.view.aimZoom, 0.85);
    const help = this.aimAssist();
    const yaw = lx * 3.6 * s * (1 + 0.8 * boost) * help.slow * dt - help.yaw;
    const pitch = ly * (this.settings.invertY ? -1 : 1) * 2.5 * s * help.slow * dt - help.pitch;
    // As mouse movement (the view turns by it, at the mouse's sensitivity).
    const k = 0.0022 * this.view.sensitivity;
    this.input.mouseDX += yaw / k;
    this.input.mouseDY += pitch / k;
  }

  /**
   * Aim assist (a controller, holding a gun, the setting on): over a player in sight near the
   * crosshair the stick turns slower, and while the sticks are moving the view turns a little
   * with them as they (or we) move. Its strength and shape are the gun's `aim.assist` over the
   * game's `guns.assist`. `yaw` and `pitch`: how far to turn the view with the target this frame
   * (radians).
   */
  private aimAssist(): { slow: number; yaw: number; pitch: number } {
    const none = { slow: 1, yaw: 0, pitch: 0 };
    const g = this.guns.g;
    if (g && this.assist?.gun !== g) this.assist = { gun: g, shape: assistOf(g, this.gunRules) };
    const a = this.assist?.shape;
    const strength = g && a && this.settings.aimAssist && this.walker && !this.view.thirdPerson ? a.strength : 0;
    if (strength <= 0 || !a) {
      this.assistOn = null;
      return none;
    }
    const c = this.camera.position;
    const cp = Math.cos(this.view.pitch);
    const fx = -Math.sin(this.view.yaw) * cp;
    const fy = Math.sin(this.view.pitch);
    const fz = -Math.cos(this.view.yaw) * cp;
    let best: { id: string; yaw: number; pitch: number } | null = null;
    let bestOff = Infinity;
    for (const t of this.targets) {
      const dx = t.x - c.x;
      const dy = t.y - c.y;
      const dz = t.z - c.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 0.8 || d > g!.range) continue;
      const off = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dy * fy + dz * fz) / d)));
      // About a block round them, a little more far off.
      const cone = Math.atan2(a.radius, d) + a.angle;
      if (off > cone || off / cone >= bestOff) continue;
      if (!this.chunks.world.line_clear(c.x, c.y, c.z, t.x, t.y, t.z)) continue;
      bestOff = off / cone;
      best = { id: t.id, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
    }
    const was = this.assistOn;
    this.assistOn = best;
    if (!best) return none;
    const aiming = (this.guns.state?.aim ?? 0) > 0.5;
    const slow = 1 - strength * (aiming ? a.slow.aim : a.slow.hip) * (1 - 0.4 * bestOff);
    if (!was || was.id !== best.id || !(this.input.padTilt > 0.05 || this.input.padMoving)) return { slow, yaw: 0, pitch: 0 };
    let turn = best.yaw - was.yaw;
    turn -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI;
    const tilt = best.pitch - was.pitch;
    // A jump (a respawn, a teleport) isn't followed.
    if (Math.abs(turn) > 0.15 || Math.abs(tilt) > 0.15) return { slow, yaw: 0, pitch: 0 };
    const k = strength * (aiming ? a.follow.aim : a.follow.hip);
    return { slow, yaw: turn * k, pitch: tilt * k };
  }

  private closePicker() {
    this.picker?.hide();
    this.mode = 'playing';
    this.input.lock();
  }

  // ---------------------------------------------------------------------------------------------
  // The local player's HUD and hand, from the frame
  // ---------------------------------------------------------------------------------------------

  /** The icon an item shows: its sprite, its block, or a picture of its model (as this screen has it: its look over the server's). */
  private itemIcon(d: ItemDefinition, size: number): string {
    return this.iconOf(d.icon ?? PLACEHOLDER_ICON, size);
  }

  /**
   * An icon as a picture: a sprite, a block's, a model's (blank until its file is here), or
   * `{ item }`, that item's as this screen has it (blank until the item is here).
   */
  private iconOf(ref: IconRef, size: number): string {
    const icon = resolveIcon(ref, (id) => this.content.items.get(id));
    if (!icon) return '';
    if (typeof icon === 'object' && 'block' in icon) return this.blockIcons.get(this.blockId(icon.block)) ?? '';
    return this.graphics.icon(icon, size);
  }

  /** The player's hands and what they hold, and (`hud`) their health and hotbar on the HUD. */
  private showPlayer(me: PlayerFrame, hud = true) {
    // A player model with a hand: their first-person arm is that part of it (once its file is here).
    const model = me.model ?? this.def.player?.model;
    const hand = model?.gltf?.hand;
    const arm = model?.gltf && hand ? `${model.gltf.url}|${hand}` : '';
    if (arm !== this.shown.arm) {
      if (!arm) {
        this.held.setModelArm(null);
        this.shown.arm = '';
      } else {
        const look = this.graphics.gltf.limb(model!.gltf!.url, hand!, 12 / 16);
        if (look) {
          this.held.setModelArm(look);
          this.shown.arm = arm;
        }
      }
    }
    // A humanoid model: their first-person arms are its forearms and fists (once its file is here), fitted by its `firstPerson`.
    const body = model?.gltf && (model.gltf.rig === 'humanoid' || model.gltf.joints || !model.gltf.clips) ? model.gltf.url : '';
    const fit = body ? model!.gltf!.firstPerson : undefined;
    const bodyKey = body ? `${body}|${JSON.stringify([fit ?? null, model!.gltf!.joints ?? null, model!.gltf!.poses?.heldScale ?? null])}` : '';
    if (bodyKey !== this.shown.humanoid) {
      const arms = body ? this.graphics.gltf.humanoidArms(model!.gltf!) : null;
      if (!body || arms) {
        this.held.setHumanoidArms(arms, fit);
        this.shown.humanoid = bodyKey;
      }
    }
    const creative = me.creative;
    const health = `${me.health}|${me.mortal ? me.maxHealth : 0}`;
    if (hud && health !== this.shown.health) {
      this.shown.health = health;
      this.gameHud.setHealth(me.health, me.mortal ? me.maxHealth : 0);
    }
    if (creative && hud) {
      const key = `${creative.hotbar.join(',')}|${creative.selected}`;
      if (key !== this.shown.creative) {
        const announce = this.shown.creative !== '' && !this.shown.creative.endsWith(`|${creative.selected}`);
        this.shown.creative = key;
        this.hud.setHotbar(creative.hotbar, creative.selected, announce);
        this.holdBlock(creative.hotbar[creative.selected]);
      }
    }
    if (me.hotbar) this.showHotbar(me.hotbar.slots, me.hotbar.selected, hud);
  }

  private showHotbar(slots: (ItemStack | null)[], selected: number, hud = true) {
    // (Redrawn as model files arrive: an icon can be a picture of one.)
    const key = `${slots.map((s) => (s ? `${s.item}x${s.count}` : '')).join(',')}|${selected}|${this.graphics.gltf.version}`;
    if (hud && key !== this.shown.hotbar) {
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
    // What's in hand (the first-person layer loads it; the game's kits hold it): the item
    // selected, or a throwable being thrown with its key over it.
    const quick = hud ? this.throwsCtl.inHand : null;
    const stack = quick ? { item: quick, count: 1 } : slots[selected];
    const def = stack ? this.content.items.get(stack.item) : undefined;
    const heldKey = stack?.item ?? '';
    if (heldKey === this.shown.held) return;
    this.shown.held = heldKey;
    if (!def) return this.held.holdNothing();
    // Looks like a block: held as a little cube of it.
    if (typeof def.icon === 'object' && 'block' in def.icon) return this.holdBlock(this.blockId(def.icon.block), stack!.item, def);
    if (!this.held.holdItem(stack!.item, def)) {
      // Its model's file is still coming: nothing in hand yet, and look again next frame.
      this.shown.held = '';
      this.held.holdNothing();
    }
  }

  /** Columns the host keeps around the player: what this client shows, within reason. */
  private hostRadius(s: Settings): number {
    return Math.min(12, this.viewDistance(s));
  }

  /** The player's render distance, raised to the game's minimum (`world.viewDistance`) and held to its maximum (`world.maxViewDistance`). */
  private viewDistance(s: Settings): number {
    const w = this.def.world;
    return Math.min(w?.maxViewDistance ?? 24, Math.max(s.renderDistance, Math.min(24, w?.viewDistance ?? 0)));
  }

  private applySettings(s: Settings, persist = true) {
    const was = this.look ? this.settings : null;
    this.settings = { ...s };
    this.quality.enabled = s.autoQuality;
    // Where this machine settled last time; the player changing their graphics starts it again from the top.
    if (!was) this.quality.reset(savedQuality());
    else if (GRAPHICS.some((k) => was[k] !== s[k])) {
      this.quality.reset();
      saveQuality(0);
    }
    this.look = this.quality.apply(s, deviceDpr());
    this.renderer.applySettings(toRenderSettings(this.look.settings));
    const rd = this.viewDistance(s);
    if (this.chunks.renderDistance !== rd) this.chunks.setRenderDistance(rd);
    this.chunks.occlusion = s.occlusion;
    this.view.sensitivity = s.sensitivity;
    this.view.baseFov = s.fov;
    this.view.viewBobbing = s.viewBobbing;
    this.input.setBindings(s.keys);
    this.replayView.baseFov = s.fov;
    this.replayView.viewBobbing = s.viewBobbing;
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
    const dpr = this.look?.dpr ?? deviceDpr();
    this.renderer.setSize(w, h, dpr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.particles?.setViewport(h * dpr * (this.look?.settings ?? this.settings).renderScale, this.camera.fov);
  }

  /** Auto quality moved a notch: draw the settings as it has them now. */
  private applyQuality() {
    saveQuality(this.quality.level);
    const was = this.look;
    this.look = this.quality.apply(this.settings, deviceDpr());
    this.renderer.applySettings(toRenderSettings(this.look.settings));
    if (!was || was.dpr !== this.look.dpr || was.settings.renderScale !== this.look.settings.renderScale) this.resize();
  }

  // ---------------------------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------------------------

  private frame(now: number) {
    if (this.disposed) return;
    requestAnimationFrame((t) => this.frame(t));
    const t0 = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    // Frames while playing (not a menu, not a hidden tab) tell auto quality how the graphics keep up.
    if (this.mode === 'playing' && this.worldReady && document.visibilityState === 'visible' && this.quality.frame(now - this.last)) this.applyQuality();
    this.last = now;
    // A controller: in the game (its buttons press keys, its sticks walk and look), else the menus.
    const drives = this.mode === 'playing' && this.input.locked && !this.gameHud.screenOpen;
    this.input.pollPad(drives);
    if (drives) {
      // (A menu opens with its highlight where it starts.)
      this.padNav.clear();
      if (this.input.device === 'pad') this.padAim(dt);
    } else if (this.input.device === 'pad' && this.mode !== 'console') this.padNav.sync();
    document.body.classList.toggle('pad-playing', this.input.padCaptured);
    const playing = this.mode === 'playing';
    const started = this.frameData?.started ?? false;
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
        // In third person (the game's `camera.orbit`) the wheel zooms rather than changing hotbar slots.
        if (this.view.zooms) {
          if (active) this.view.zoom(this.input.wheel);
          this.input.wheel = 0;
        }
      }
    }
    // The game's client code starts once we're in the game, before anything reads an item: its
    // `setup` gives items their looks (`client.items.look`), so the hotbar, the hand, the figures
    // and the gun's controller never see an item without its look.
    const first = this.clientStarted ? undefined : this.mine(this.frameData);
    if (first) this.startClient(first);
    // The held gun fires on this screen at once; its shots go with the next controls sent.
    const latest = this.walker && this.itemMode ? this.mine(this.frameData) : undefined;
    // (A weapons-locked freeze: the gun and throwables don't answer here either, so nothing is fired to be refused.)
    this.ownShots = latest ? this.gunFrame(dt, active && !latest.locked, latest) : [];
    if (latest) this.throwFrame(dt, active && !latest.locked, latest);
    for (const shot of this.ownShots) this.shotQueue.push([shot.serial, shot.yaw, shot.pitch, shot.spread]);
    // The server keeps its own clock: it gets the controls every frame, numbered, with how long
    // they lasted: walking and vehicles move at once here (prediction), and the server moves them
    // input by input, the same way.
    const input = this.withShots(this.input.snapshot(active, this.view.yaw, this.view.pitch, this.view.viewSeq));
    const seq = ++this.inputSeq;
    this.inputTimes.set(seq, now / 1000);
    this.inputTimes.delete(seq - 600);
    this.predictor?.step(input, dt, seq);
    this.vehicles.step(input, dt, seq);
    this.link.send({ t: 'input', input, seq, dt });
    const f = this.playback.sample() ?? this.frameData;
    if (f) this.shownT = f.t;
    this.updateReadiness();
    const played = this.mine(f);
    // A clip our own abilities started plays on our figure at once, numbered as the host will
    // number it (so its arrival doesn't start it again); gone once the host's word is in.
    const clips = this.predictor?.takeClips();
    if (clips?.length && f) {
      const c = clips[clips.length - 1];
      this.ownClip = clipFrame(Math.max(played?.clip?.seq ?? 0, this.ownClip?.seq ?? 0) + 1, c.name, c.opts, f.t);
    }
    if (this.ownClip && f && ((played?.clip?.seq ?? 0) >= this.ownClip.seq || f.t - this.ownClip.at > 3)) this.ownClip = null;
    // Our own player where prediction has them, else as the frame says.
    const predicted = this.predictor?.shown();
    let me = played && predicted ? { ...played, ...predicted } : played;
    if (f && me) me = this.onRide(f, me);
    if (!f || !me) {
      // The host is still starting: nothing to draw yet but the sky.
      this.present(dt, t0);
      return;
    }

    this.env.time = f.time;
    this.env.paused = true;
    this.env.update(dt);
    // A replay playing (`game.replay.show`): its frame is drawn in place of the live one, through
    // its player's eyes (`eyes`; null: its own camera). The live game goes on under it.
    const rp = this.replay ? this.replayStep() : null;
    const shown = rp?.frame ?? f;
    const eyes = rp ? rp.eyes : me;
    // Driving: the vehicle's camera, worked out here every frame from its (predicted) state.
    const ride = !rp && me.camera.follow && this.vehicles.active ? this.vehicles.camera(dt) : null;
    if (rp) {
      this.replayCamera(dt, rp.eyes);
    } else if (ride) {
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
      this.view.setOrbit(this.mode === 'title' ? null : me.orbit);
      // A movement ability's camera: as prediction has it, else the newest frame's.
      this.view.tilt = this.mode === 'title' || me.dead ? null : this.predictor ? this.predictor.tilt : (me.tilt ?? null);
      this.view.follow(dt, me, this.orbitPoint(f, me));
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
    // The game runs on while this client is paused: its figures keep walking.
    if (shown.players.length < 2) this.targets = [];
    const avatars = () => (rp ? this.avatars(shown, eyes ?? me, rp.follow, false) : this.avatars(f, me));
    this.entityView.sync(shown.players.length > 1 || (!rp && this.view.thirdPerson) ? [...shown.entities, ...avatars()] : shown.entities, shown.projectiles, dt, started, shown.t);
    // A controller rumbles when we're hurt.
    if (me.health < this.lastHealth && this.lastHealth > 0 && this.input.device === 'pad' && this.settings.vibration) rumble(0.55, 0.3, 170);
    this.lastHealth = me.health;
    this.pickupView.sync(shown.pickups, dt);
    this.flights.update(dt, started);
    // Our own vehicle's model where prediction has it, not where the (older) frame does.
    const own = !rp && this.vehicles.active && this.vehicles.prop !== null ? new Map([[this.vehicles.prop, this.vehicles.pose()]]) : undefined;
    this.propView.sync(shown.props, dt, { clock: shown.clock, me: rp ? null : this.playerId, inputTime: (seq) => this.inputTimes.get(seq) ?? null, now: now / 1000, camera: this.camera.position }, own);
    // (In a replay, its player's hands and what they hold; our own HUD stays ours.)
    this.showPlayer(eyes ?? me, !rp);

    if (this.walker && !ride && !rp) {
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
    this.held.setLight(this.probe);
    // The first-person layer: drawn only in first person (nothing in hand while dead, someone out
    // of the game watching sees only the game, or in third person).
    this.held.frame(this.camera.aspect, rp ? !!eyes && !eyes.dead && !eyes.vehicle : this.walker && this.mode !== 'title' && !me.dead && !me.vehicle && !this.view.thirdPerson);
    // The game's client code: its kits (the first-person view places the hand, the figures are
    // posed, ...), then its own frame. In a replay, `client.me` is the player it follows.
    if (!this.clientStarted) this.startClient(me);
    const mine = rp && eyes ? this.replayMe(eyes, dt) : this.meOf(me, dt);
    this.client.frame(dt, mine);
    // The figures as client code posed them (the figures kit), animated.
    this.entityView.finish();
    // The world's effects move on by the frame's time (what the client code made just now, too).
    this.particles.setLight(this.light);
    this.particles.update(dt);
    this.rubble.setLight(this.light);
    this.rubble.update(dt);
    for (let i = this.blasts.length - 1; i >= 0; i--) if ((this.blasts[i].age += dt) > 0.3) this.blasts.splice(i, 1);
    this.fx.update(dt);
    // This frame's own shots, their bullets worked out from where the eye is now, and the client
    // code's late work (they're drawn where they start: the tracers leave the muzzle as drawn).
    this.ownBullets();
    if (rp) this.replayBullets();
    this.client.late(dt);
    if (this.gameHud.wantsLocal) this.gameHud.setLocal(this.localState(me));
    this.gameHud.holdScoreboard(this.mode === 'playing' && this.input.isDown('Tab'));
    // Camera effects: shake and the death tilt (which rights itself after a moment, for someone
    // out of the game a while to watch).
    this.camera.position.add(this.fx.shakeOffset);
    // (In a replay, the eyes it follows fall as they did.)
    const fallen = rp ? eyes : me;
    if (this.walker && fallen?.dead) {
      const k = Math.min(1, fallen.deathTime / 0.6) * Math.min(1, Math.max(0, (2.8 - fallen.deathTime) / 0.8));
      this.camera.position.y -= k * 1.2;
      this.camera.rotateZ(k * 0.45);
    }
    this.camera.updateMatrixWorld();
    const heading = rp ? (eyes ? this.replayView.yaw : Math.atan2(-this.dir.x, -this.dir.z)) : this.walker ? this.view.yaw : Math.atan2(-this.dir.x, -this.dir.z);
    this.sfx.setListener(this.camera.position, heading);
    this.present(dt, t0);
  }

  /**
   * On a solid prop, this player is shown where it's drawn this frame (prediction runs ahead of
   * the frames the prop is drawn from), and their view turns as it turns.
   */
  private onRide(f: SimFrame, me: PlayerFrame): PlayerFrame {
    const ride = me.ride;
    const pose = ride && !me.vehicle ? propPose(f.props, ride.prop, f.clock) : null;
    if (!ride || !pose) {
      this.rideHeading = null;
      return me;
    }
    const h = heading(pose.q);
    if (this.walker && this.mode !== 'title' && this.rideHeading?.prop === ride.prop) {
      let d = h - this.rideHeading.heading;
      d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
      this.view.yaw += d;
    }
    this.rideHeading = { prop: ride.prop, heading: h };
    const at = toWorld(pose, { x: ride.p[0], y: ride.p[1], z: ride.p[2] });
    return { ...me, x: at.x, y: at.y, z: at.z };
  }

  /** The point the game's orbit circles (`camera.orbit`): on a prop as it's drawn, or a player. */
  private orbitPoint(f: SimFrame, me: PlayerFrame): THREE.Vector3 | null {
    const o = me.orbit;
    if (!o) return null;
    if (o.prop !== undefined) {
      const pose = propPose(f.props, o.prop, f.clock);
      const off = o.offset ?? [0, 0, 0];
      return pose && toWorld(pose, { x: off[0], y: off[1], z: off[2] });
    }
    const p = o.player === this.playerId ? me : f.players.find((x) => x.id === o.player);
    const off = o.offset ?? [0, 1.62, 0];
    return p ? new THREE.Vector3(p.x + off[0], p.y + off[1], p.z + off[2]) : null;
  }

  /** How far a third-person camera can go from a point along a direction before a block (solid props don't stop it). */
  private clearance(from: THREE.Vector3, dir: THREE.Vector3, max: number): number {
    const w = this.chunks.world;
    for (let t = 0.25; t <= max + 0.35; t += 0.25) {
      const id = w.get_block(Math.floor(from.x + dir.x * t), Math.floor(from.y + dir.y * t), Math.floor(from.z + dir.z * t));
      if (id !== 255 && this.registry.blocks[id]?.solid) return Math.max(0, t - 0.6);
    }
    return max;
  }

  /** The game's client code starts: its kits' `setup`, then its own (the items' looks, its voices). */
  private startClient(me: PlayerFrame) {
    this.clientStarted = true;
    this.client.setup(this.meData(me));
  }

  /** The local player for the game's client code (`client.me`): as predicted and shown this frame. */
  private meOf(me: PlayerFrame, dt: number): Me {
    void dt;
    // Landing: how fast they were falling (the frame before).
    if (me.onGround && !this.wasGround) this.emit({ t: 'land', vy: this.lastVy });
    this.wasGround = me.onGround;
    this.lastVy = me.vy;
    return this.meData(me);
  }

  /** `client.me` from a player's frame (with the gun and throw controllers' word). */
  private meData(me: PlayerFrame): Me {
    const stack = me.hotbar?.slots[me.hotbar.selected] ?? null;
    // Throwables: those with keys of their own, how many (less throws the host hasn't taken), one being cooked.
    const slots = me.hotbar?.slots ?? [];
    const quick = this.throwsCtl.quick(slots).map((item) => {
      const d = this.content.items.get(item);
      return { item, count: this.throwsCtl.count(slots, item, me.throws ?? 0), key: isThrowable(d) && d.key ? d.key : '' };
    });
    const c = this.throwsCtl.cooking;
    return {
      id: this.playerId,
      position: { x: me.x, y: me.y, z: me.z },
      velocity: { x: me.vx, y: me.vy, z: me.vz },
      look: { yaw: this.view.yaw, pitch: this.view.pitch },
      onGround: me.onGround,
      flying: me.flying,
      crouching: me.sneaking,
      sprinting: me.sprinting,
      sliding: me.sliding,
      dead: me.dead,
      inVehicle: !!me.vehicle,
      health: me.health,
      maxHealth: me.maxHealth,
      bob: { phase: me.bob * Math.PI * 0.9, amount: this.settings.viewBobbing && me.onGround && !me.flying ? Math.min(1, Math.hypot(me.vx, me.vz) / 4.3) : 0 },
      thirdPerson: this.view.thirdPerson,
      hand: { item: stack?.item ?? null, count: stack?.count ?? 0, strength: this.itemMode ? me.hand.strength : 1, drawing: me.hand.drawing, charge: me.hand.charge },
      // The held gun as its controller has it (the newest frame's hand: what fires, and what the HUD shows).
      held: this.heldGun(me),
      abilities: {},
      quick,
      cooking: c ? { item: c.item, held: c.held, fuse: c.t.cook ? c.t.fuse : 0 } : null,
    };
  }
  /** On the ground last frame, and falling how fast (for `land`). */
  private wasGround = true;
  private lastVy = 0;

  /** The held gun as this screen fires and reloads it: aimed, sprinting, sliding, reloading, its rounds; null without one. */
  private heldGun(me: PlayerFrame): Me['held'] {
    const st = this.guns.state;
    const def = this.guns.def;
    const item = this.guns.item;
    if (!st || !def || !item) return null;
    const g = gunOf(def);
    return {
      item,
      def,
      state: {
        aim: st.aim,
        sprint: this.guns.sprint,
        slide: me.sliding ? 1 : 0,
        reload: this.guns.reloadProgress,
        shells: def.shells ? this.guns.shellsToLoad : 0,
        sight: g.aim.sight,
        action: def.action,
        zoom: g.aim.zoom,
        ...this.gunNumbers(me),
      },
    };
  }

  /**
   * The held gun's numbers for client code (its HUD): the rounds in it and spare, the spread
   * now (degrees; standing as they are, not sprinting: what the crosshair opens to), and the
   * sight's colour.
   */
  private gunNumbers(me: PlayerFrame) {
    const st = this.guns.state!;
    const p = this.predictor?.shown() ?? me;
    const spread = this.guns.spread({ moving: Math.hypot(p.vx, p.vz) / Math.max(1, this.tune.params[0]), air: !p.onGround, crouch: p.sneaking, sprinting: false, dead: false });
    return { mag: st.mag, reserve: st.reserve, spread, color: gunOf(this.guns.def!).aim.color };
  }

  /** The item in this player's hand, as the newest frame has it. */
  private heldDef(): ItemDefinition | undefined {
    const me = this.mine(this.frameData);
    const stack = me?.hotbar?.slots[me.hotbar.selected];
    return stack ? this.content.items.get(stack.item) : undefined;
  }

  /** Shots fired since the last controls sent go with these ones, and what this screen is showing. */
  private withShots<T extends { shots?: [number, number, number, number][]; throws?: PlayerInput['throws']; seen?: number }>(input: T): T {
    if (this.walker && this.itemMode) {
      input.shots = this.shotQueue;
      this.shotQueue = [];
      input.throws = this.throwQueue;
      this.throwQueue = [];
    }
    input.seen = this.shownT;
    return input;
  }

  /** This frame's aiming, reloading and firing with the held gun (see `GunController`). */
  private gunFrame(dt: number, active: boolean, me: PlayerFrame): FiredShot[] {
    const stack = me.hotbar?.slots[me.hotbar.selected] ?? null;
    const def = stack ? this.content.items.get(stack.item) : undefined;
    this.guns.hold(isGun(def) ? stack!.item : null, def, me.hand.gun);
    if (!this.guns.state) return [];
    const p = this.predictor?.shown() ?? me;
    const body = { moving: Math.hypot(p.vx, p.vz) / Math.max(1, this.tune.params[0]), air: !p.onGround, crouch: p.sneaking, sprinting: p.sprinting, dead: me.dead };
    // (Not while a throwable's being cooked: the hand's on it.)
    const cooking = this.throwsCtl.cooking !== null || this.throwsCtl.tossed !== null;
    const c = {
      active,
      trigger: this.input.button(0) && !cooking,
      triggerPressed: this.input.clickedThisFrame(0) && !cooking,
      aim: this.input.button(2),
      reload: this.input.keyThisFrame('KeyR'),
    };
    const shots = this.guns.update(
      dt,
      c,
      body,
      this.view.yaw,
      this.view.pitch,
      (dPitch, dYaw) => {
        this.view.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.view.pitch + dPitch));
        this.view.yaw += dYaw;
      },
      (e) => this.emit({ t: e, item: this.guns.item! }),
    );
    const kick = this.guns.g?.recoil.up ?? 1;
    if (shots.length && this.input.device === 'pad' && this.settings.vibration) rumble(Math.min(1, kick / 5), 0.3 + Math.min(0.5, kick / 6), 55 + kick * 18);
    // (The first-person kit kicks the gun and zooms the view; the effects kit sounds each shot.)
    for (const _ of shots) this.emit({ t: 'shot', item: stack!.item, power: 1 });
    return shots;
  }

  /**
   * This frame's own shots, for the client code (`bullets` events): where each bullet lands on
   * this screen, from the eye as the camera's placed now (what they aimed at is what they hit).
   */
  private ownBullets() {
    const shots = this.ownShots;
    this.ownShots = [];
    const def = this.guns.def;
    const g = this.guns.g;
    const item = this.guns.item;
    if (!shots.length || !def || !g || !item) return;
    const eye = this.camera.position.clone().sub(this.fx.shakeOffset);
    const others = (this.frameData?.players ?? []).filter((p) => p.id !== this.playerId && !p.dead);
    for (const shot of shots) {
      const bullets = shot.dirs.map((d): ClientBullet => {
        const end = this.bulletEnd(eye, d, g.range, others, g.penetration);
        const block = end.block >= 0;
        return {
          end: end.point,
          hit: block ? 'block' : end.body ? 'body' : null,
          normal: end.normal,
          color: block ? this.blockColor(end.block) : null,
          carved: block && this.carves(def, end.block, end.point, end.normal),
          walls: end.walls.map((p) => this.wallOf(def, p.entry, p.normal, p.exit, p.out, p.block)),
        };
      });
      this.emit({ t: 'bullets', item, by: this.playerId, mine: true, from: null, bullets });
    }
  }

  /** A wall a bullet went through, for the client code: where, its colour, and whether each side was carved. */
  private wallOf(def: GunItem, entry: Vec3, normal: Vec3, exit: Vec3, out: Vec3, block: number): ClientBullet['walls'][number] {
    return { entry, normal, exit, out, color: this.blockColor(block), carvedIn: this.carves(def, block, entry, normal), carvedOut: this.carves(def, block, exit, out) };
  }

  /**
   * Where a bullet from this screen lands: a block (through foliage, and walls it goes through,
   * as the host's does), or someone drawn in the way (`body`).
   */
  private bulletEnd(o: Vec3, d: Vec3, range: number, others: PlayerFrame[], pen: Gun['penetration']): { point: Vec3; normal: Vec3 | null; block: number; body: boolean; walls: WallPass[] } {
    let { end, normal, block, walls } = bulletPath(this.chunks.world, this.registry, o, d, range, pen);
    let body = false;
    for (const p of others) {
      const b = playerBoxes(p, p.sliding ? 2 : p.sneaking ? 1 : 0, this.gunRules);
      const t = Math.min(rayBox(o, d, b.body[0], b.body[1]) ?? Infinity, rayBox(o, d, b.head[0], b.head[1]) ?? Infinity);
      if (t < end) {
        end = t;
        normal = null;
        block = -1;
        body = true;
      }
    }
    walls = walls.filter((p) => p.at < end);
    return { point: { x: o.x + d.x * end, y: o.y + d.y * end, z: o.z + d.z * end }, normal, block, body, walls };
  }

  /**
   * Someone else's shot (the host's word), for the client code (a `bullets` event): from their
   * gun's muzzle as their figure's drawn, where each bullet ended and what it hit. Their figure kicks.
   */
  private othersShot(w: ShotWire, players = this.frameData?.players) {
    const shooter = players?.find((p) => p.id === w.by);
    const avatar = this.avatarIds.get(w.by);
    const from = new THREE.Vector3();
    if (!(avatar !== undefined && this.entityView.muzzle(avatar, from))) {
      if (!shooter) return;
      from.set(shooter.x, shooter.y + 1.45, shooter.z);
    }
    if (avatar !== undefined) this.entityView.kick(avatar);
    this.emit({ t: 'bullets', item: w.item, by: w.by, mine: false, from: { x: from.x, y: from.y, z: from.z }, bullets: this.bulletsOf(w) });
  }

  /** A shot's bullets as the host had them, for the client code: where each ended, what it hit, the walls it went through. */
  private bulletsOf(w: ShotWire): ClientBullet[] {
    const def = this.content.items.get(w.item);
    const gun = isGun(def) ? def : null;
    const v = (p: number[], i: number) => ({ x: p[i], y: p[i + 1], z: p[i + 2] });
    return w.ends.map(([x, y, z, kind], i): ClientBullet => {
      const at = { x, y, z };
      const block = w.blocks[i];
      const normal = w.normals[i] ? v(w.normals[i]!, 0) : null;
      const hit = kind === 1 && block >= 0 ? 'block' : kind === 2 ? 'body' : null;
      return {
        end: at,
        hit,
        normal,
        color: hit === 'block' ? this.blockColor(block) : null,
        carved: hit === 'block' && !!gun && this.carves(gun, block, at, normal),
        walls: gun ? (w.walls?.[i] ?? []).map((p) => this.wallOf(gun, v(p, 0), v(p, 3), v(p, 6), v(p, 9), p[12])) : [],
      };
    });
  }

  /** Whether a bullet from `gun` that hit `block` at `at` (on its face `normal`) carves it (then the pit it leaves is its mark). */
  private carves(gun: GunItem, block: number, at: Vec3, normal: Vec3 | null): boolean {
    const c = this.carving;
    if (!c || gun.carve === false || !c.ids[block]) return false;
    return Math.floor(at.y - (normal?.y ?? 0) * 1e-3) > c.above;
  }

  /** A block's average colour (linear), for the chips a bullet knocks off it. */
  private blockColor(id: number): [number, number, number] {
    let c = this.blockColors.get(id);
    if (c) return c;
    const def = this.registry.blocks[id];
    const layer = def?.tex[0] ?? 0;
    const px = this.textures.albedoData.subarray(layer * 1024, layer * 1024 + 1024);
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < 1024; i += 4) {
      r += (px[i] / 255) ** 2.2;
      g += (px[i + 1] / 255) ** 2.2;
      b += (px[i + 2] / 255) ** 2.2;
    }
    const tint = def?.tint ? DEFAULT_TINT : [1, 1, 1];
    c = [(r / 256) * tint[0], (g / 256) * tint[1], (b / 256) * tint[2]];
    this.blockColors.set(id, c);
    return c;
  }

  /**
   * This frame's throwables (see `ThrowController`): cooking one, throwing it. A throw flies here
   * at once, from our eyes, and goes to the host with the next controls; the hand tosses it.
   */
  private throwFrame(dt: number, active: boolean, me: PlayerFrame) {
    const slots = me.hotbar?.slots ?? [];
    const held = me.hotbar ? (slots[me.hotbar.selected]?.item ?? null) : null;
    const p = this.predictor?.shown() ?? me;
    const eye = { x: p.x, y: p.y + (p.sneaking && !p.flying ? 1.27 : 1.62), z: p.z };
    const made = this.throwsCtl.update(dt, { active: active && !me.dead && !me.vehicle, isDown: (c) => this.input.isDown(c), fire: this.input.button(0) }, slots, held, me.throws ?? 0, eye, this.view.yaw, this.view.pitch, (item) => this.emit({ t: 'cook', item }));
    if (!made) return;
    const def = this.content.items.get(made.item);
    if (!isThrowable(def)) return;
    this.throwQueue.push([made.serial, made.item, made.from.x, made.from.y, made.from.z, made.v.x, made.v.y, made.v.z, made.cooked]);
    // It flies here at once, on the path the host will fly it on (the client code draws it leaving the hand).
    const key = `${this.playerId}:${made.serial}`;
    if (this.flights.add(key, made.item, made.from, made.v, fuseSteps(throwable(def), made.cooked), true)) this.emit({ t: 'thrown', key, item: made.item, mine: true });
    this.emit({ t: 'toss' });
  }

  /**
   * Rubble from damage (a batch's carves: bullets' pits, a blast's crater): a few chips out of
   * each block, more the more went, flung away from an explosion just shown, with a puff of dust.
   */
  private rubbleFromDamage(data: Uint8Array) {
    const cells = damageTaken(data, 5);
    // A big change at once (a player joining late catching up) throws nothing.
    if (cells.length > 400) return;
    for (const c of cells) {
      const id = this.chunks.world.get_block(c.x, c.y, c.z);
      const def = this.registry.blocks[id];
      if (!def) continue;
      const px = this.textures.albedoData.subarray(def.tex[0] * 1024, def.tex[0] * 1024 + 1024);
      const tint = def.tint ? DEFAULT_TINT : null;
      const n = Math.min(c.at.length, 1 + Math.floor(c.taken / 260));
      const blast = this.blasts.find((b) => Math.hypot(b.at.x - c.x - 0.5, b.at.y - c.y - 0.5, b.at.z - c.z - 0.5) < 3 + b.size * 2);
      for (let i = 0; i < n; i++) {
        const [x, y, z] = c.at[i];
        let v: Vec3;
        if (blast) {
          // Away from the blast, and up.
          const dx = x - blast.at.x;
          const dy = y - blast.at.y;
          const dz = z - blast.at.z;
          const l = Math.hypot(dx, dy, dz) || 1;
          const k = (4 + Math.random() * 5) * Math.min(1.6, blast.size);
          v = { x: (dx / l) * k, y: (dy / l) * k * 0.6 + 2 + Math.random() * 3, z: (dz / l) * k };
        } else v = { x: (Math.random() - 0.5) * 2.4, y: Math.random() * 1.5, z: (Math.random() - 0.5) * 2.4 };
        const size = c.taken > 600 ? 0.06 + Math.random() * 0.12 : 0.035 + Math.random() * 0.05;
        this.rubble.add(x, y, z, size, v, px, tint);
      }
      // Dust.
      const [x, y, z] = c.at[0] ?? [c.x + 0.5, c.y + 0.5, c.z + 0.5];
      const col = this.blockColor(id);
      const dust: [number, number, number] = [col[0] * 0.6 + 0.2, col[1] * 0.6 + 0.19, col[2] * 0.6 + 0.18];
      this.particles.burstColor(x, y, z, dust, { count: blast ? 3 : 1, speed: blast ? 1.6 : 0.5, size: blast ? 0.3 : 0.14, gravity: -0.4, life: blast ? 1.8 : 0.9, drag: 2.2, spread: 0.3, up: 0.3, collide: false });
    }
  }

  /** Rubble from a block broken whole: a handful of chunks tumbling out of where it was. */
  private rubbleFromBlock(x: number, y: number, z: number, id: number) {
    const def = this.registry.blocks[id];
    if (!def || def.small) return;
    const px = this.textures.albedoData.subarray(def.tex[0] * 1024, def.tex[0] * 1024 + 1024);
    const blast = this.blasts.find((b) => Math.hypot(b.at.x - x - 0.5, b.at.y - y - 0.5, b.at.z - z - 0.5) < 3 + b.size * 2);
    for (let i = 0; i < 6; i++) {
      const at = { x: x + 0.2 + Math.random() * 0.6, y: y + 0.2 + Math.random() * 0.6, z: z + 0.2 + Math.random() * 0.6 };
      const dx = blast ? at.x - blast.at.x : Math.random() - 0.5;
      const dz = blast ? at.z - blast.at.z : Math.random() - 0.5;
      const l = Math.hypot(dx, dz) || 1;
      const k = blast ? 3 + Math.random() * 4 : 1 + Math.random() * 1.5;
      this.rubble.add(at.x, at.y, at.z, 0.08 + Math.random() * 0.14, { x: (dx / l) * k, y: 1.5 + Math.random() * 3, z: (dz / l) * k }, px, def.tint ? DEFAULT_TINT : null);
    }
  }

  /**
   * What the game's widgets can bind from this screen's own state (`{{$gun.mag}}`, `{{$health}}`):
   * the held gun as this screen fires and reloads it, the movement abilities as it predicts them,
   * health and stance as the newest frame (and prediction) have them. No round trip: a widget
   * bound to `$gun.mag` changes on the frame the shot goes off.
   */
  private localState(me: PlayerFrame): PlainData {
    const st = this.guns.state;
    const def = this.guns.def;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const gun =
      st && def && !me.dead && !me.vehicle
        ? { item: this.guns.item, name: def.name, mag: st.mag, size: def.magazine, reserve: st.reserve, reloading: st.reload >= 0, reload: r2(Math.max(0, this.guns.reloadProgress)), aim: r2(st.aim) }
        : null;
    const abilities = plainRecord(this.predictor?.abilities ?? me.move.abilities ?? {});
    return {
      $gun: gun,
      $ability: abilities,
      $health: me.health,
      $maxHealth: me.maxHealth,
      $dead: me.dead,
      $crouching: me.sneaking,
      $sliding: me.sliding,
      $sprinting: me.sprinting,
    };
  }

  /** Render, HUD, debug overlay, end of input frame. */
  private present(dt: number, t0: number) {
    const medium = this.camera.position.y < 256 ? this.eyeMedium() : 'air';
    this.hud.setMedium(medium);
    this.renderer.render(this.camera, this.env, this.hooks, medium === 'water' ? 1 : medium === 'lava' ? 2 : 0);
    this.gameHud.update(dt, this.camera, window.innerWidth, window.innerHeight);
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
      `Entities ${f.entities.length} alive   server ${f.players.length} playing`,
      '',
      `Columns  ${c.loaded} loaded · ${c.meshed} meshed · ${c.pending} pending upload`,
      `Workers  ${this.pool.size} · gen ${c.generating} (${c.genMs.toFixed(2)} ms) · mesh ${c.meshing} (${c.meshMs.toFixed(2)} ms)`,
      `Draws    ${r.stats.calls} (shadow ${r.stats.shadowCalls}) · ${(r.stats.triangles / 1e6).toFixed(2)}M tris`,
      `Culling  ${c.visibleSections} sections visible · cave culling ${this.chunks.occlusion ? 'on' : 'off'}`,
      `Render   ${Math.round(r.width * rs.renderScale)}x${Math.round(r.height * rs.renderScale)} · MSAA ${rs.msaa}x · shadows ${rs.shadowRes || 'off'}${this.quality.level ? ` · auto quality -${this.quality.level}` : ''}`,
      mem ? `JS heap  ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : '',
    ]);
  }

  // ---------------------------------------------------------------------------------------------
  // Development hooks (automated browser tests)
  // ---------------------------------------------------------------------------------------------

  /** Join and play without the pointer lock a click would take (tests; with `debugActive`). */
  debugPlay() {
    this.beginPlay();
  }

  /**
   * Development tools (`await __game.dev('game.players.length')`): run `js` in this game's room
   * on its server, a function body (or one expression) with `game` (the room's `GameContext`) and
   * `me` (this client's own `Player` there, null until it joins) in scope. Resolves with the
   * result as JSON (a promise it returns is awaited), or rejects with the error. Only a
   * development server (`npm run dev`) runs it; any other refuses.
   */
  dev(js: string): Promise<unknown> {
    if (!import.meta.env.DEV) return Promise.reject(new Error('__game.dev is for development builds'));
    const reply = this.request<DevReply>({ t: 'dev', js });
    const late = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('__game.dev: no answer from the server in 10 s')), 10_000));
    return Promise.race([reply, late]).then((r) => {
      if (!r.ok) throw new Error(r.error);
      return r.value;
    });
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
      host: 'server',
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
