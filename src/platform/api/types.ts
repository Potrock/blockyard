/**
 * Public game API.
 *
 * A game is a `GameDefinition`: plain data describing the world and player rules, plus a few
 * lifecycle hooks that receive a `GameContext`. Everything a game can do goes through the
 * context. Games never touch the renderer, workers or WebAssembly directly, which keeps them
 * small and makes it possible to run game logic on a server later.
 */

import type { Quaternion as MathQuaternion, Vector3 as MathVector3 } from 'three';
import type { Blueprint } from './blueprint';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// ---------------------------------------------------------------------------------------------
// Game definition
// ---------------------------------------------------------------------------------------------

export interface GameDefinition {
  /** Stable identifier, used in the URL (`?game=arena`) and for saves. */
  id: string;
  title: string;
  /** One line shown under the title in the launcher. */
  tagline?: string;
  /** Accent colour for the launcher card (CSS colour). */
  accent?: string;
  /** Control hints for the title screen, e.g. `[['LMB', 'attack']]` (movement keys are always shown). */
  controls?: [string, string][];
  /**
   * Controllers: what each button does, over the platform's layout (see `PadAction`; `A` jump,
   * `B` crouch, `X` R, `Y` / `RB` next slot, `LB` previous, `LT` right mouse, `RT` left mouse,
   * `L3` sprint, `R3` middle mouse, `View` Tab, `Menu` pause, D-pad ↑ E, ↓ F, ← → slots). A
   * controller drives the same keys and mouse buttons the keyboard and mouse do, so a game reads
   * them all the same way; its hints on the home page come from `controls` (the entry for the
   * key a button presses), or give one: `{ Up: ['KeyL', 'loadout'] }`.
   */
  gamepad?: Partial<Record<PadButton, PadAction | [PadAction, string]>>;
  /**
   * Allow the built-in cheat commands (`/give`, `/tp`, `/spawn`, `/kill`, `/heal`, `/time`, `/fly`)
   * in production builds. They're always available in development.
   */
  cheats?: boolean;
  world?: WorldOptions;
  player?: PlayerOptions;
  /** How guns play in this game: rewind, hitboxes, what they do to movement, reloading, aim assist (see `GunOptions`). */
  guns?: GunOptions;
  /**
   * Runs once after the engine has loaded and before the world streams in. Register entity
   * types, items and event handlers here.
   */
  setup?(game: GameContext): void;
  /** Runs when play begins, and again after `game.restart()`. */
  start?(game: GameContext): void;
  /** Runs every frame while the game is running (not while paused). `dt` is in seconds. */
  update?(game: GameContext, dt: number): void;
  /**
   * Players can start a game of their own on a server (just them, or friends they send the link
   * to) instead of joining the public one: each such game is a separate copy with its own world,
   * and the home page offers both. For match games (Bed Wars, the Arena); leave it off for one
   * shared world everyone builds in (Sandbox).
   */
  instances?: boolean;
  /**
   * Vehicles players can drive (`player.drive(name, state)`): ships, cars, boards. Defined here,
   * not in `setup`, because a pilot's own screen runs them too (see `VehicleDefinition`).
   */
  vehicles?: Record<string, VehicleDefinition>;
  /**
   * Blocks of the game's own, by name: `{ crate: { texture: crateUrl }, lamp: { texture: { color:
   * '#ffd27a' }, light: 15 } }` (see `BlockDefinition`). They're used like the built-in blocks, by
   * name: `world.setBlock`, `Blueprint`s and `world.structures`, the creative block picker,
   * `world.blockInfo`; saves keep them by name, and every player gets them. Defined here, not in
   * `setup`, because each player's screen generates the terrain (structures too) and draws it.
   */
  blocks?: Record<string, BlockDefinition>;
  /** How the HUD looks: the health display, health bars over heads, fonts and colours. */
  hud?: HudOptions;
}

/** The HUD's look for a game (read by each player's screen, so it's data). */
export interface HudOptions {
  /** The player's own health: Minecraft's hearts (default), a bar with the number, or nothing. */
  health?: 'hearts' | 'bar' | 'none';
  /** Health bars over other players' heads (and creatures'), under their names. */
  healthBars?: boolean;
  /**
   * Other players' names over their heads: always (default), only while nothing blocks the view
   * of them (shooters: no seeing names through walls), or never.
   */
  nameTags?: 'always' | 'sight' | 'never';
  /** Fonts and colours for the whole HUD, the menus and the result screens. */
  theme?: HudTheme;
}

export interface HudTheme {
  /** Font for titles, banners, big numbers (a CSS font-family). */
  display?: string;
  /** Font for everything else. */
  text?: string;
  /** Google Fonts families to load for them, e.g. `['Bangers', 'Anton']`. */
  fonts?: string[];
  /**
   * `accent`: highlights and your own row; `ink`: outlines and shadows; `paper`: panel
   * backgrounds; `text`; `danger`: damage and low health; `good`: health and healing.
   */
  colors?: { accent?: string; ink?: string; paper?: string; text?: string; danger?: string; good?: string };
  /** Comic-book style: hard offset shadows and outlines on text and panels. */
  comic?: boolean;
}

export interface WorldOptions {
  /** Fixed seed. Default: `?seed=` from the URL, else random. */
  seed?: number;
  /** `natural` (default) or a `flat` world at `flatHeight`. */
  /** `natural` (default), `flat` (at `flatHeight`), or `void`: nothing but your structures (sky islands). */
  terrain?: 'natural' | 'flat' | 'void';
  flatHeight?: number;
  /** Voxel structures stamped into the world while it generates (see `Blueprint`). */
  structures?: BlueprintLike[];
  /** Flatten terrain around points: `radius` fully flat, blending back over `blend` blocks. */
  terraform?: { x: number; z: number; radius: number; blend: number; height: number }[];
  /** Player spawn point. `auto` picks pleasant land near the origin. */
  spawn?: Vec3 | 'auto';
  /** Initial look direction in radians (0 = looking toward -Z). */
  spawnYaw?: number;
  /** Time of day at start: 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset. */
  time?: number;
  freezeTime?: boolean;
  /** Minimum view distance in chunks (flight games see further); the player's setting wins if higher. Max 24. */
  viewDistance?: number;
  /** Save block edits and the player position between sessions. Default false. */
  persist?: boolean;
}

export interface PlayerOptions {
  /** Break and place blocks with the mouse. Default false. */
  build?: boolean;
  /** Allow toggling flight (double-tap space / F). Default false. */
  fly?: boolean;
  /** Max health in half-hearts (20 = 10 hearts). `false` disables damage entirely. Default 20. */
  health?: number | false;
  /** Natural regeneration: `perSecond` health after `delay` seconds without taking damage. */
  regen?: { delay: number; perSecond: number };
  fallDamage?: boolean;
  /** What the hotbar holds: `blocks` (creative building) or `items` (inventory). */
  hotbar?: 'blocks' | 'items';
  /**
   * `walk` (default): the first-person player. `none`: no walking body, hand or hotbar; the game
   * drives the camera (`game.camera`) and reads the controls (`game.input`) itself, e.g. for
   * vehicles, flight or strategy games. The world streams around the camera.
   */
  controller?: 'walk' | 'none';
  /**
   * Player skin (Minecraft layout, origin in `skinAtlas`). Used for the first-person arm.
   * Default `Skins.player`.
   */
  skin?: [number, number];
  skinAtlas?: string;
  /**
   * A model for players' figures instead of the skin: `Models.gltf(url, { clips, head, hand })`.
   * With a `hand` node, their own first-person arm is that part of the model. Per player:
   * `player.setModel`.
   */
  model?: ModelSpec;
  /**
   * Players can hurt each other: melee hits and shots land on other players (never the shooter).
   * Off by default, so co-op games have no friendly fire.
   */
  pvp?: boolean;
  /** How players move (see `MovementOptions`). Default: Minecraft's walking. */
  movement?: MovementOptions;
  /** Seconds a player ignores further damage after a hit (Minecraft's 0.45; 0 for shooters). */
  hurtCooldown?: number;
}

/**
 * How players move: speeds in blocks a second, and the extras a game can turn on. Movement runs on
 * each player's own screen as well as the host (prediction), so it's data, and the moves a game
 * adds (`abilities`) are pure functions. Defaults are Minecraft's.
 */
export interface MovementOptions {
  /** Walking (4.3), sprinting (5.6) and crouching (1.3) speeds. */
  walk?: number;
  sprint?: number;
  crouch?: number;
  /** Jump height in blocks (1.27). */
  jump?: number;
  /** Blocks a second per second (32). */
  gravity?: number;
  /** How quickly speed follows the controls: on the ground (14) and in the air (3), per second. */
  acceleration?: number;
  airControl?: number;
  /** Keys (KeyboardEvent.code) that sprint and crouch. Default: Ctrl sprints, Shift crouches (sneaks). */
  sprintKeys?: string[];
  crouchKeys?: string[];
  /** Double-tapping W sprints. Default true. */
  doubleTapSprint?: boolean;
  /** Crouching on the ground stops at edges, like Minecraft's sneaking. Default true. */
  edgeGuard?: boolean;
  /**
   * Crouching out of a sprint slides: a burst of `speed` (default 1.45 x sprint) that bleeds away
   * (`friction` per second, 1.4) over up to `time` seconds (0.75); jumping out of it keeps the
   * speed. `cooldown` seconds (0.5) before the next. `true` for the defaults.
   */
  slide?: boolean | { speed?: number; time?: number; friction?: number; cooldown?: number };
  /** Jumping into a ledge climbs onto it if its top is up to this far above the feet (blocks; `true` = 1). */
  mantle?: boolean | number;
  /**
   * Moves of the game's own, by name: a dash, a double jump, a wall-run, a grapple, a ground pound
   * (see `MovementAbility`). They run inside every step of a player's movement, in the order
   * given, on the host and on the player's own screen alike, so they answer at once online.
   */
  abilities?: Record<string, MovementAbility>;
}

/**
 * A movement ability (`movement.abilities`): code of the game's own inside each step of a walking
 * player's movement. Like a vehicle's `step`, it runs on the host for everyone and, ahead of the
 * host, on each player's own screen (client-side prediction), which starts again from the host's
 * state whenever it arrives and replays the inputs since. So `step` must be pure: it reads its
 * state, the controls, the body and the world; it changes only its state and the body's step
 * (`AbilityBody`); and it does the same with the same inputs wherever it runs (no `Math.random`,
 * no clock but `body.time`, nothing kept outside its state). Anything with consequences (a sound,
 * a trail, damage) is the game's: `body.trigger` tells the game (the `ability` event), and the
 * state is there to read (`player.abilities`).
 */
export interface MovementAbility<S extends object = any> {
  /**
   * Its state when a player starts: plain data (numbers, booleans, strings, short lists), copied
   * for each player. It goes to their screen with every frame, so keep it small.
   */
  state: S;
  /** One step of `dt` seconds, before the body moves (see `AbilityBody`). */
  step(state: S, controls: AbilityControls, body: AbilityBody, dt: number, world: VehicleWorld): void;
}

/**
 * The controls of one step, as an ability reads them (one frame on the player's screen): held
 * keys, this frame's presses, mouse buttons. `consume` claims one for the rest of the step, so the
 * abilities after this one see it idle (a wall-jump's Space isn't also a double jump's).
 */
export type AbilityControls = Pick<InputApi, 'isDown' | 'pressed' | 'button' | 'buttonPressed' | 'consume' | 'mouseX' | 'mouseY' | 'wheel'>;

/**
 * A player's body as an ability's step begins, and what that step does. The platform has read the
 * controls (`wish`, `jump`); the abilities can change them, change the velocity, and scale this
 * step's gravity and steering; then the body moves.
 */
export interface AbilityBody {
  /** Feet position and velocity (blocks, blocks a second), as they are now. */
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly onGround: boolean;
  readonly inWater: boolean;
  readonly flying: boolean;
  /** What the platform's movement is doing this step. */
  readonly crouching: boolean;
  readonly sprinting: boolean;
  readonly sliding: boolean;
  /** Where they look: `yaw` (0 looks toward -z), `pitch` (up is positive), and as a unit vector. */
  readonly yaw: number;
  readonly pitch: number;
  readonly look: Vec3;
  /** Seconds of movement so far: a clock that runs the same on the host and on their screen. */
  readonly time: number;
  /**
   * Where the controls push them this step: a direction on the ground (world space, length 0..1),
   * from the keys or the stick, turned by the view. Change it to steer the step; zero coasts.
   */
  wish: { x: number; z: number };
  /** Jump is held (the body jumps if it's on the ground): `false` swallows it. */
  jump: boolean;
  /** Gravity this step, times the game's (1): 0 floats (a dash), 0.1 slides slowly down a wall. */
  gravity: number;
  /**
   * How quickly speed follows `wish` this step, times the game's (1): 0 keeps the velocity as the
   * ability left it, with no steering or friction (a dash, a grapple's swing).
   */
  control: number;
  /** Multiplies walking, sprinting and crouching speed this step (1). */
  speed: number;
  /** Set the velocity (the axes given), or add to it. Upward speed lifts them off the ground. */
  setVelocity(v: Partial<Vec3>): void;
  addVelocity(v: Partial<Vec3>): void;
  /** Put their feet somewhere (a blink): check it's free with `fits` first. */
  setPosition(p: Vec3): void;
  /** Whether their body (0.6 x 1.8 x 0.6) would fit with its feet at `p`: no solid block or solid prop in the way. */
  fits(p: Vec3): boolean;
  /**
   * Tell the game this ability did something (`'dash'`, `'jump'`, `'start'`): the host's `ability`
   * event, heard once, after the step. (Their screen replays steps, so only the host's are heard.)
   */
  trigger(name: string): void;
}

// ---------------------------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------------------------

/**
 * Data a game keeps across restarts: all-time stats, leaderboards, unlocks, settings. On a game
 * server it lives in the server's database; in single-player, in the browser. Values are anything
 * JSON can hold, copied in and out.
 */
export interface StoreApi {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  /** The keys saved, or those starting with `prefix` (`'stats:'`). */
  keys(prefix?: string): string[];
}

export interface GameContext {
  readonly world: WorldApi;
  /** Data kept across restarts (see `StoreApi`). Key per player by name: `stats:${player.name}`. */
  readonly store: StoreApi;
  /**
   * Everyone playing. A single-player game has exactly one; in a multiplayer game players join
   * and leave (`playerJoin` / `playerLeave` events). Players already here when `start` runs are
   * in the list.
   */
  readonly players: readonly Player[];
  /**
   * The player, for single-player games (in a multiplayer game, the first one). Multiplayer
   * games use `players` and the player each event and callback names.
   */
  readonly player: Player;
  readonly entities: EntityApi;
  readonly items: ItemApi;
  /** Everyone's screen: banners, the scoreboard, messages for all. One player's: `player.hud`. */
  readonly hud: HudApi;
  readonly fx: FxApi;
  readonly audio: AudioApi;
  readonly env: EnvApi;
  readonly events: EventApi;
  readonly clock: ClockApi;
  /** Deterministic random numbers (seeded per session). */
  readonly rng: Rng;
  /** Slash commands typed into the command bar (`/` or `T`). */
  readonly commands: CommandApi;
  /** The player's camera (single-player shortcut for `player.camera`). */
  readonly camera: CameraApi;
  /** The player's keyboard and mouse (single-player shortcut for `player.input`). */
  readonly input: InputApi;
  /** Movable objects: block builds (ships, lifts, vehicles) and glowing bolts. */
  readonly props: PropApi;
  /** Players driven by the game's code (see `BotApi`). */
  readonly bots: BotApi;
  /** Clear entities, timers, pickups and HUD, revive the player at spawn, then call `start` again. */
  restart(): void;
  /** Return to the game launcher. */
  exit(): void;
}

// ---------------------------------------------------------------------------------------------
// Camera, input, props
// ---------------------------------------------------------------------------------------------

export interface CameraApi {
  /** Current camera position and look direction (world). */
  readonly position: Vec3;
  readonly forward: Vec3;
  /** Place the camera looking at `target`. Only applies with `player.controller: 'none'`. */
  set(position: Vec3, target: Vec3, up?: Vec3): void;
  /** Or place it with an orientation (camera looks down its -z). */
  setPose(position: Vec3, rotation: { x: number; y: number; z: number; w: number }): void;
  /** Vertical field of view in degrees. */
  fov: number;
  /**
   * Back to the vehicle's own camera (`VehicleDefinition.camera`) after `set` / `setPose` took
   * over (a cutscene, watching after being shot down). Driving starts with it.
   */
  follow(): void;
  /**
   * Third person, for a walking player: the mouse wheel pulls the camera back from their eyes to
   * circle `target` (a prop: the ship they're steering; or a player: themselves) at a distance,
   * turned by their own mouse look. It's worked out on their screen every frame, so it's smooth
   * and immediate online. Blocks stop it; solid props don't (it sees a ship from outside). Zoomed
   * all the way in (distance 0) they're back in first person. While it's on, the wheel zooms
   * rather than changing hotbar slots. Their figure shows while the camera is out of their eyes.
   * `null` returns to first person.
   */
  orbit(target: Prop | Player | null, opts?: OrbitOptions): void;
}

export interface OrbitOptions {
  /** The point it circles, from the target: in a prop's own space, or up from a player's feet. Default: a player's eyes, a prop's origin. */
  offset?: Vec3;
  /** Blocks from that point to start at (0: still first person until they zoom out). Default 0. */
  distance?: number;
  /** How close and how far the wheel takes it. Default 0 and 30. */
  min?: number;
  max?: number;
}

/** A controller's buttons (the standard layout: Xbox names; `Back` is View, `Start` is Menu). */
export type PadButton = 'A' | 'B' | 'X' | 'Y' | 'LB' | 'RB' | 'LT' | 'RT' | 'Back' | 'Start' | 'L3' | 'R3' | 'Up' | 'Down' | 'Left' | 'Right';

/**
 * What a controller button does: press a key (KeyboardEvent.code, e.g. `'KeyL'`) or a mouse
 * button (`'LMB'`, `'MMB'`, `'RMB'`); or `'jump'`, `'crouch'`, `'sprint'` (the player's movement
 * keys; sprint stays on until the stick lets go), `'next'` / `'prev'` (hotbar slot, skipping
 * empty ones for items), `'pause'`; or null for nothing.
 */
export type PadAction = string | null;

export interface InputApi {
  /** Key held (KeyboardEvent.code: 'KeyW', 'Space', 'ShiftLeft'…). */
  isDown(code: string): boolean;
  /** Key went down this frame. */
  pressed(code: string): boolean;
  /** Mouse button held / clicked this frame (0 left, 1 middle, 2 right). */
  button(b: number): boolean;
  buttonPressed(b: number): boolean;
  /**
   * Claim a mouse button (0, 1, 2) or key code for the rest of this frame: everything that reads
   * input after you, including the platform's built-in weapons, sees it as idle. Your game's
   * `update` runs before the built-in systems each frame, so handling a click and consuming it
   * (a pickaxe mining a block, say) stops the sword from also swinging.
   */
  consume(input: number | string): void;
  /** Mouse movement this frame, in pixels (while the mouse is captured). */
  readonly mouseX: number;
  readonly mouseY: number;
  readonly wheel: number;
}

/** A meshed block build, ready to spawn (see `PropApi.model`). */
export interface PropModel {
  /** Bounding radius in world units (from the pivot). */
  readonly radius: number;
  /** Number of blocks. */
  readonly blocks: number;
}

/** A rotation as a unit quaternion (a `math.Quaternion` is one). */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Where a prop could be: a position and / or rotation (on its parent, if it rides one), the rest as it is. */
export interface PropPose {
  position?: Vec3;
  quaternion?: Quat;
}

/** A movable object. Mutate `position` / `quaternion` directly each frame. */
export interface Prop {
  /** Where it is and how it's turned: in the world, or on its parent (`attach`). */
  readonly position: MathVector3;
  readonly quaternion: MathQuaternion;
  scale: number;
  visible: boolean;
  /**
   * Solid, like the world's blocks (block builds only, `props.model`): players and creatures
   * bump into it, stand on it and ride along wherever you move and turn it (a ship's deck, a
   * lift, a moving platform), and are pushed out of its way when it runs into them; shots and
   * lines of sight stop at it. Its solid blocks count, and it stays solid while hidden. Walking
   * over it is smoothest turned about the vertical; a gentle tilt (a rolling deck) is walkable.
   * Default false.
   */
  solid: boolean;
  /**
   * How many of its blocks are inside the world's solid blocks (a block counts when its middle is
   * in one): where it is, or with it at `at` (to test a move before making it). 0 when it's clear.
   * Solid props only.
   */
  overlap(at?: PropPose): number;
  /**
   * Move it toward `to` without going into the world's blocks, the way a walker moves: all the way
   * if that doesn't put more of it into blocks than there is now, or else as far as it can (the
   * turn alone, then the move one axis at a time, sliding along whatever is in the way). It can
   * always back off or turn away from what it's touching. True if it got all the way. Solid
   * props only; `position` and `quaternion` hold where it got to.
   */
  sweep(to: PropPose): boolean;
  /** A point on it (its own space, like `offset`s and `attach`ed props) in the world, and back. */
  toWorld(local: Vec3): Vec3;
  toLocal(world: Vec3): Vec3;
  /** Tint it briefly (hits). */
  flash(color?: string, seconds?: number): void;
  /**
   * Ride on another prop (an engine flame on its ship, a turret on its tank): from now on
   * `position` and `quaternion` are on the parent, so it goes wherever the parent goes, on every
   * screen and without being moved each tick. Null puts it back in the world.
   */
  attach(parent: Prop | null): void;
  /**
   * Send it flying in a straight line from `from` at `velocity` (blocks a second): it moves on its
   * own, on every screen, and its `position` follows (moving it yourself stops that). For shots:
   * nothing is sent while it flies. `by` the player who fired it: on their own screen it leaves
   * from where their (predicted) guns were when they fired, rather than where the server had them.
   */
  launch(from: Vec3, velocity: Vec3, opts?: { by?: Player }): void;
  /** Loop one of its glTF model's animations (by name), or stop with null. */
  play(animation: string | null): void;
  remove(): void;
}

export interface PropApi {
  /**
   * Mesh a Blueprint as a movable object drawn with the world's block textures (lit, shadowed,
   * glowing blocks glow). `pivot` (blueprint coordinates) becomes its origin; `scale` is the size
   * of one block in world units (e.g. 0.25 for a detailed "micro-block" build). Do this once and
   * spawn as many copies as you like.
   */
  model(blueprint: Blueprint, opts?: { scale?: number; pivot?: Vec3 }): PropModel;
  /** A copy of a model; `solid` makes it something to stand on (see `Prop.solid`). */
  spawn(model: PropModel, opts?: { position?: Vec3; scale?: number; solid?: boolean }): Prop;
  /**
   * A glTF or GLB model (tables, machines, anything made in Blockbench or Blender), drawn lit and
   * shadowed like the world's blocks; spawn copies with `spawn`. Each player's screen fetches the
   * file itself (import it: `import slot from './models/slot.gltf?url'`); the host doesn't open
   * it, so give its `radius` if you need one. `animation` loops one of its animations on every
   * copy (see `Prop.play`).
   */
  gltf(url: string, opts?: { scale?: number; radius?: number; animation?: string }): PropModel;
  /**
   * A glowing streak pointing along its -z (lasers, tracers, engine flames). Length and width in
   * blocks; `flicker` (0..1) makes it waver in length on its own (flames); past `far` blocks from
   * each player's camera it grows with the distance, so it stays visible.
   */
  bolt(opts: { color: string; length?: number; width?: number; intensity?: number; flicker?: number; far?: number }): Prop;
  /** The first solid prop along a ray (a cannonball hitting a ship's hull), within `maxDistance`. */
  raycast(origin: Vec3, dir: Vec3, maxDistance: number): PropHit | null;
}

export interface PropHit {
  prop: Prop;
  distance: number;
  point: Vec3;
}

// ---------------------------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------------------------

/** One input's controls, as a vehicle's `step` reads them (one frame on the pilot's screen). */
export type VehicleControls = Pick<InputApi, 'isDown' | 'pressed' | 'button' | 'buttonPressed' | 'mouseX' | 'mouseY' | 'wheel'>;

/** What a vehicle's `step` and `camera` may ask of the world: the same answers on the host and on the pilot's screen. */
export type VehicleWorld = Pick<WorldApi, 'getBlock' | 'blockName' | 'raycast' | 'lineOfSight' | 'surfaceY' | 'seaLevel'>;

/** A vehicle's camera, kept from frame to frame (so it can ease after the vehicle). */
export interface VehicleCamera {
  readonly position: MathVector3;
  /** The point it looks at, and which way is up. */
  readonly target: MathVector3;
  readonly up: MathVector3;
  /** Vertical field of view in degrees. */
  fov: number;
  /** The first frame, or after a jump (a respawn): place it rather than ease into it. */
  readonly snap: boolean;
}

/**
 * Something players drive with the game's own physics: a ship, a car, a board. `step` runs on the
 * host for everyone and, ahead of it, on each pilot's own screen (client-side prediction, as
 * walking has), so the controls answer at once however far away the server is; when the host's
 * state comes back, the pilot's screen starts again from it and replays the inputs it hasn't
 * seen yet. So `step` must be pure: it reads the state, the controls and the world, changes only
 * the state, and does the same with the same inputs wherever it runs. Anything with consequences
 * (damage, sounds, shots) is the game's `update`, reading the state.
 */
export interface VehicleDefinition<S extends object = any> {
  /** Move it `dt` seconds under these controls. */
  step(state: S, controls: VehicleControls, dt: number, world: VehicleWorld): void;
  /** Where it is and how it's turned: its model (`drive`'s `prop`) goes there. */
  pose(state: S, position: MathVector3, quaternion: MathQuaternion): void;
  /** The pilot's camera, every frame on their screen (a chase camera, a cockpit). */
  camera?(state: S, camera: VehicleCamera, dt: number, world: VehicleWorld): void;
}

/** A player's vehicle (`player.drive`). */
export interface Vehicle<S extends object = any> {
  readonly name: string;
  /** Its state, live: the game reads it and may change it (a knock-back, a refill); the pilot's screen follows. */
  readonly state: S;
  /** Its model, kept at its pose (on the pilot's own screen, where prediction has it). */
  readonly prop: Prop | null;
}

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

export interface CommandSpec {
  /** One line for `/help`. */
  help?: string;
  /** Argument summary, e.g. `<item> [count]`. */
  usage?: string;
  /** Do it. Return a message to show; throw an Error to report a problem. */
  run(args: string[], game: GameContext, player: Player): string | void;
  /** Tab-completion candidates for the last argument (filtered by what's typed). */
  complete?(args: string[], game: GameContext): string[];
  /**
   * A developer tool (win now, fill the wallet, skip a wave): it only exists where cheats are on
   * (development, a server started with `--cheats`, or a game with `cheats: true`). Public
   * servers don't have it.
   */
  cheat?: boolean;
}

export interface CommandApi {
  /** Add or replace a command (name without the slash). */
  register(name: string, spec: CommandSpec): void;
  /** Run a command line as if typed; returns the message it printed. */
  run(line: string): string;
}

// ---------------------------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------------------------

/**
 * A block: its id, its name (`'oak_stairs'`), or a name with a state, Minecraft style, for one
 * variant of a block that has several (`'oak_stairs[facing=east,half=top]'`,
 * `'red_bed[facing=south,part=head]'`, `'torch[facing=west]'` on a wall, `'oak_log[axis=x]'`).
 * States left out are the default's. `world.blockInfo` tells a block's state.
 */
export type BlockRef = number | string;

/** Horizontal directions: north is -z, east +x. */
export type Facing = 'north' | 'east' | 'south' | 'west';

export interface RayHit {
  /** The block hit. */
  x: number;
  y: number;
  z: number;
  /** The face hit: which way it faces. */
  normal: Vec3;
  block: number;
  /** Exactly where the ray hit it. */
  point: Vec3;
}

export interface WorldApi {
  /** Block id at a position; -1 if the chunk is not loaded. */
  getBlock(x: number, y: number, z: number): number;
  /** Set a block by id or name. Returns false if the chunk is not loaded. Lighting updates. */
  setBlock(x: number, y: number, z: number, block: BlockRef): boolean;
  blockId(name: string): number;
  blockName(id: number): string;
  /** What a block is (by id or name): solid, a liquid, a plant (instant to break, walk-through), replaceable by placing. Null if unknown. */
  blockInfo(block: BlockRef): BlockInfo | null;
  /** First targetable block along a ray (blocks only: `props.raycast` finds solid props). */
  raycast(origin: Vec3, dir: Vec3, maxDistance: number): RayHit | null;
  /** True if nothing solid (a block, a solid prop) blocks the straight line between two points. */
  lineOfSight(a: Vec3, b: Vec3): boolean;
  /** Highest non-air, non-plant block in a column (-1 if unloaded). */
  surfaceY(x: number, z: number): number;
  /** The water surface: the top of sea-level water is at `seaLevel + 1`. */
  readonly seaLevel: number;
  /**
   * Blow a ragged sphere out of the world (bedrock and liquids survive) with debris and an
   * explosion. `filter` decides which blocks go (e.g. only ones placed this match); `by` is
   * passed on to the `blockBreak` events. Returns blocks removed.
   */
  explode(center: Vec3, radius: number, opts?: { effect?: boolean; filter?: (at: Vec3, block: string) => boolean; by?: Actor }): number;
  /**
   * Break a block with debris and a sound (and the plant on top), and fire `blockBreak`.
   * Bedrock and liquids don't break. Returns false if nothing was broken. (`setBlock` is the
   * silent version.) Who may break what is up to your game.
   */
  breakBlock(x: number, y: number, z: number, opts?: { by?: Actor }): boolean;
  /**
   * Place a block the way a player would, if the cell is free (air or a plant), nobody is standing
   * in it, a plant has ground under it and a torch something to stand or hang on; with a sound,
   * and fire `blockPlace`. Returns false if it couldn't.
   *
   * Given by name (`'torch'`, `'oak_stairs'`), a block is turned the Minecraft way: `against`
   * (the face aimed at, a `raycast` hit) hangs a torch on the side of a block, puts a slab or
   * stairs in the upper half (aiming at a ceiling or high on a side) and lays a log along the
   * axis aimed along; stairs and beds face `facing`, else the way `by` is looking. A bed takes
   * two cells, its head beyond (x, y, z). A slab placed on the same kind of slab makes a full
   * block. Given with a state (`'oak_stairs[facing=east]'`), it goes as it is.
   */
  placeBlock(x: number, y: number, z: number, block: BlockRef, opts?: { by?: Actor; against?: RayHit; facing?: Facing }): boolean;
}

export interface BlockInfo {
  id: number;
  name: string;
  /** Display name, e.g. "Oak Planks". */
  label: string;
  /** Which variant it is, for blocks with several: `{ facing: 'east', half: 'top' }`; else `{}`. */
  state: Record<string, string>;
  /** Exactly this variant, as a block reference (`'oak_stairs[facing=east,half=top]'`). */
  variant: string;
  /** Bodies collide with it. */
  solid: boolean;
  liquid: boolean;
  /** Something small that breaks at a touch and you walk through: plants, torches. */
  plant: boolean;
  /** Placing a block here replaces it (air, plants, liquids). */
  replaceable: boolean;
  /** Light it gives off, 0..15. */
  light: number;
  /** Players and explosions can break it (not bedrock, not liquids, not a game block made unbreakable). */
  breakable: boolean;
  /** A game's own block: seconds to mine it by hand, if the game gave it (`BlockDefinition.hardness`). */
  hardness?: number;
}

/**
 * A block of the game's own (`GameDefinition.blocks`). A texture (or a built-in block it's
 * `like`) is all it needs: the rest defaults to a plain solid block, like stone.
 */
export interface BlockDefinition {
  /** Its name for players (the block picker, `blockInfo`). Default: the name in words (`neon_sign` is "Neon Sign"). */
  label?: string;
  /**
   * What it looks like: one texture on every face, or face by face (`{ top, bottom, side }`, see
   * `BlockFaces`).
   */
  texture?: BlockTexture | BlockFaces;
  /**
   * Start from a built-in full block or plant (`'glass'`, `'neon_red'`, `'poppy'`): its textures,
   * shape, light and the rest, which anything given here changes (`{ like: 'stone', breakable:
   * false }`, `{ like: 'white_wool', tint: '#e0457b' }`).
   */
  like?: string;
  /**
   * `cube` (default); `cross`: two crossed planes, like flowers (walked through, broken at a
   * touch, needs ground under it); `slab`: half a block (`name[type=top]` is the upper half);
   * `stairs` (`name[facing=east,half=top]`). Slabs and stairs are placed the way the built-in ones
   * are: in the half aimed at, climbing away from whoever places them.
   */
  shape?: 'cube' | 'cross' | 'slab' | 'stairs';
  /** A slab: the block two of them make, one placed on the other (default: they don't join). */
  full?: string;
  /**
   * How light and sight get through: `opaque` (default); `cutout`: through the clear pixels of
   * its texture (grates, leaves, fences); `transparent`: like glass (clear pixels show through,
   * and faces between two of it aren't drawn). A pixel is there or not: half-clear colours show
   * solid.
   */
  transparency?: 'opaque' | 'cutout' | 'transparent';
  /** Bodies collide with it. Default: true (a `cross` plant is walked through). */
  solid?: boolean;
  /** Light it gives off, 0..15 (a torch is 14, glowstone 15). Default 0. */
  light?: number;
  /**
   * How much its textures glow, 0..1: lit by themselves in the dark, and blooming (neon, lamps).
   * Default: `light / 15`, so a lamp looks lit.
   */
  glow?: number;
  /**
   * Multiply its textures by a colour (`'#e0457b'`: one grey texture, many colours), or by the
   * grass colour of where it stands (`'grass'`, like grass and leaves).
   */
  tint?: string;
  /** In the creative block picker (games with `player.build`). Default true. */
  picker?: boolean;
  /** Players and explosions can break it (`world.breakBlock`, `world.explode`, building). Default true. */
  breakable?: boolean;
  /** Seconds to mine it by hand with the `building` kit (`blockInfo().hardness`). Default: like stone. */
  hardness?: number;
  /** Placing a block into its cell replaces it (default: only `cross` plants). */
  replaceable?: boolean;
  /** Sounds when it's broken and placed (built-in or `audio.define`d). Default: the platform's. */
  sounds?: { break?: SoundName; place?: SoundName };
}

/**
 * One face's texture, 16 x 16 pixels:
 * - an image: a PNG imported with `?url` (`import crate from './crate.png?url'`); other sizes are
 *   scaled to fit, and a tall strip (animation frames) shows its top square;
 * - a built-in block texture by name: `'oak_planks'`, `'glass'`, `'neon_red'`, `'grass_top'`;
 * - a colour, mottled: `{ color: '#8a8f96', noise: 0.25 }`. `noise` 0..1 (default 0.12) is how
 *   much it varies, `scale` the size of its blotches in pixels (default 2), `seed` another
 *   pattern. Several colours (`['#5b3a1e', '#6e4827', '#82562f']`) are picked between by the
 *   noise, pixel-art style;
 * - pixel art: 16 rows of 16 characters, each a colour from `palette` (`.` or a character not in
 *   it is clear);
 * - painted by code: `paint(x, y)` gives each pixel's colour (`null`: clear), row 0 at the top.
 */
export type BlockTexture =
  | string
  | { color: string | string[]; noise?: number; scale?: number; seed?: number }
  | { pixels: string[]; palette: Record<string, string> }
  | { paint(x: number, y: number): string | null };

/**
 * A block's textures face by face: `top`, `bottom`, the four `side`s, or one side (`north`,
 * `south`, `east`, `west`); `all` for any face not given.
 */
export interface BlockFaces {
  all?: BlockTexture;
  top?: BlockTexture;
  bottom?: BlockTexture;
  side?: BlockTexture;
  north?: BlockTexture;
  south?: BlockTexture;
  east?: BlockTexture;
  west?: BlockTexture;
}

/** Anything that can be packed into generator data (the `Blueprint` class). */
export interface BlueprintLike {
  build(resolve: (block: BlockRef) => number): BlueprintData;
}

/** Serialisable structure produced by `Blueprint.build()`. */
export interface BlueprintData {
  origin: Vec3;
  size: Vec3;
  /** Block ids, index `(y * size.z + z) * size.x + x`; 255 = leave terrain untouched. */
  data: Uint8Array;
}

// ---------------------------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------------------------

/** A player (the same object as in `game.players`). */
export type Player = PlayerApi;

/** Who did something: an entity, a player, or the world (explosions, the void, traps). Check `kind` to tell them apart. */
export type Actor = Entity | Player | 'world';

export interface DamageOptions {
  /** Who dealt the damage (for events and knockback direction). */
  source?: Actor;
  /** Knockback strength (0 = none, 1 = normal). */
  knockback?: number;
  /** Where the hit came from; defaults to the source position. */
  from?: Vec3;
  /** Show as a critical hit. */
  crit?: boolean;
  /** The item it was done with (its id), for kill feeds. */
  weapon?: string;
  /** A head hit (guns). */
  headshot?: boolean;
  /**
   * What did it, for the `damage` event (see `DamageCause`). The platform says for its own
   * guns, blades, arrows and falls; without it, a hit from someone is `melee` and anything else `world`.
   */
  cause?: DamageCause;
  /** The part of the target hit, when it's known (a bullet knows). */
  part?: 'head' | 'body';
}

export interface PlayerApi {
  /** Tells players from entities in an `Actor`. */
  readonly kind: 'player';
  /** Stable for the session (`local` in single-player). */
  readonly id: string;
  readonly name: string;
  /** This player's screen: HUD calls here reach only them (their wallet, their shop, their toasts). */
  readonly hud: HudApi;
  /** Sounds only this player hears (their coins, their kill). */
  readonly audio: AudioApi;
  /** Effects only this player sees (their screen shaking, a flash when they're hit). */
  readonly fx: FxApi;
  /** This player's keyboard and mouse. */
  readonly input: InputApi;
  /** This player's camera (drive it with `player.controller: 'none'`). */
  readonly camera: CameraApi;
  /** Feet position. */
  readonly position: Vec3;
  readonly eye: Vec3;
  readonly velocity: Vec3;
  /** Unit vector the camera looks along. */
  readonly look: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  readonly onGround: boolean;
  health: number;
  maxHealth: number;
  readonly alive: boolean;
  readonly inventory: InventoryApi;
  teleport(pos: Vec3, yaw?: number, pitch?: number): void;
  /** Apply damage. Returns false if ignored (invulnerable, dead, or damage disabled). */
  damage(amount: number, opts?: DamageOptions): boolean;
  heal(amount: number): void;
  /** Restore full health after death. */
  revive(): void;
  impulse(x: number, y: number, z: number): void;
  /** Freeze movement (cutscenes, countdowns). */
  freeze(frozen: boolean): void;
  /**
   * Put them in one of the game's `vehicles`, starting from `state` (plain numbers, booleans and
   * lists: it goes to their screen as data). From now on their controls drive it (the vehicle's
   * `step`, on the host and, ahead of it, on their own screen), `prop` (its model) is kept at its
   * `pose` on every screen, their camera is the vehicle's, and their body goes where it goes.
   */
  drive<S extends object>(vehicle: string, state: S, opts?: { prop?: Prop }): Vehicle<S>;
  /** Out of their vehicle (their model stays where it was; remove it if it should go). */
  leaveVehicle(): void;
  /** The vehicle they're driving, if any. */
  readonly vehicle: Vehicle | null;
  /**
   * The solid prop they're riding (`Prop.solid`): the one they stand on, or jumped from and
   * haven't left. Null on the ground, swimming, flying.
   */
  readonly riding: Prop | null;
  /** Armour points, 0..20: each blocks 4% of incoming damage (Minecraft-style). Default 0. */
  armor: number;
  /** The first-person arm and held item. */
  readonly viewModel: ViewModelApi;
  /**
   * How others see this player: their figure's skin (Minecraft layout, origin in `atlas`), which
   * their own first-person arm wears too. Default: the game's `player.skin`.
   */
  setSkin(skin: [number, number], atlas?: string): void;
  /**
   * How others see this player: a model (`Models.gltf(...)`) instead of a skin, or null for the
   * game's (`player.model`, else the skin). With a `hand` node, their first-person arm is that part.
   */
  setModel(model: ModelSpec | null): void;
  /** The colour of their name above their figure (team colours); null for white. */
  color: string | null;
  /** A bot (`game.bots`): driven by the game's code, not a person. */
  readonly bot: boolean;
  /** Crouching (or sneaking), and sliding (`movement.slide`). */
  readonly crouching: boolean;
  readonly sliding: boolean;
  /** Aiming down the sights of the gun they hold (right mouse). */
  readonly aiming: boolean;
  /** Multiplies their movement speed (a power-up, a heavy load). Default 1. */
  speed: number;
  /**
   * Their movement abilities' states (`movement.abilities`), by name, live: read them for the HUD
   * (a cooldown), or change them (reset a cooldown, unlock a move); their screen follows.
   */
  readonly abilities: Record<string, any>;
  /** Ignore damage for this long (spawn protection); 0 ends it. */
  protect(seconds: number): void;
}

// ---------------------------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------------------------

/**
 * Players driven by the game's code instead of a person: they're in `game.players`, everyone sees
 * them like any player (a figure, a name, what they hold), and they move, jump, slide, swing and
 * shoot by the same rules, through the same controls a person has. Steer each one every tick
 * with `bot.controls`; what a person's keyboard and mouse would do, they do.
 */
export interface BotApi {
  /** A new bot, standing at the spawn; the game hears `playerJoin`. */
  add(name: string): Bot;
  /** It leaves (the game hears `playerLeave`). */
  remove(bot: Player): void;
  readonly all: readonly Bot[];
}

export interface Bot extends PlayerApi {
  readonly controls: BotControls;
}

/** A bot's keyboard and mouse. Held keys and buttons stay held until released; presses and clicks last one tick. */
export interface BotControls {
  /** Hold or let go of a key (KeyboardEvent.code: 'KeyW', 'ShiftLeft', 'Space'…). */
  hold(code: string, down?: boolean): void;
  /** Press a key this tick ('KeyR' to reload, 'Digit2' for the second slot). */
  press(code: string): void;
  /** Hold or let go of a mouse button (0 left: attack / fire; 2 right: use / aim). */
  button(b: number, down?: boolean): void;
  /** Click a mouse button this tick. */
  click(b: number): void;
  /** Turn to look (radians, like `player.yaw` and `pitch`), or toward a point. */
  look(yaw: number, pitch: number): void;
  lookAt(point: Vec3): void;
  /** Let go of every key and button. */
  release(): void;
  readonly yaw: number;
  readonly pitch: number;
}

// ---------------------------------------------------------------------------------------------
// First-person view model
// ---------------------------------------------------------------------------------------------

/**
 * How an item sits in the first-person hand. The arm is posed like Minecraft's first-person arm,
 * and the item is held upright in the fist, turned the way Minecraft shows it in first person:
 * - `sword`, `axe`: gripped at the handle, blade up (`item/handheld.json`).
 * - `bow`: held at its middle; drawing swings it up to aim (Java's first-person draw pose).
 * - `item`: potions, food, trinkets (`item/generated.json`).
 * - `block`: a small cube on the fist (`block/block.json`).
 * - `polearm`: two-handed, low at the right with the tip just under the crosshair (pikes, spears).
 * - `gun`: two hands on a gun (guns' default): at the hip, up to the eye to aim down the sights,
 *   down and across the chest to sprint.
 */
export type HoldStyle = 'sword' | 'axe' | 'bow' | 'item' | 'block' | 'polearm' | 'gun';

/**
 * A 3D held item made of boxes, for things a 16x16 sprite can't do (pikes, staffs, shields).
 * Same conventions as entity model parts: sizes and offsets in pixels, Minecraft box UVs.
 * The item's length runs along +z (the tip end) and +y is up.
 */
export interface HeldModelSpec {
  /** Atlas the UVs refer to. Default `builtin`. */
  atlas?: string;
  parts: {
    size: [number, number, number];
    uv: [number, number];
    /** Box min corner, in pixels. */
    offset: [number, number, number];
    /** Degrees about X, Y, Z around the box centre. */
    rotation?: [number, number, number];
  }[];
  /** Where the hands hold it (pixels): the rear / main hand, and the front hand for two-handed styles. */
  grip?: [number, number, number];
  grip2?: [number, number, number];
  /**
   * Guns: the barrel's tip (flashes and tracers start there), the point that sits on the eye line
   * when aiming down the sights, and the magazine (a reload's hand goes there). Pixels. A glTF
   * model can mark all of these (and the grips) with empty nodes named `grip`, `grip2`, `muzzle`,
   * `sight` and `mag` instead.
   */
  muzzle?: [number, number, number];
  sight?: [number, number, number];
  mag?: [number, number, number];
  /**
   * A glTF or GLB model instead of boxes (`HeldModels.gltf`): its file, turned (degrees about X,
   * then Y, then Z) and scaled so it runs along +z to its tip, like the built-in ones.
   */
  gltf?: { url: string; rotation?: [number, number, number]; scale?: number };
}

/**
 * How an item is held. Every field is optional. `rotation` and `scale` take the same numbers as
 * a Minecraft model's `display.firstperson_righthand`.
 */
export interface HoldSpec {
  /** Base pose. Default: melee `sword`, bow `bow`, otherwise `item`. */
  style?: HoldStyle;
  /** Which hand. Default right. */
  hand?: 'right' | 'left';
  /** Sprite pixel `[x, y]` (0..16 from the top left) that sits in the fist. Swords: `[3, 12.5]`. */
  grip?: [number, number];
  /** Hold a 3D model (`HeldModelSpec`, e.g. `HeldModels.ironSword`). Without one, the icon is extruded into 3D. */
  model?: HeldModelSpec;
  /** Degrees about X, then Y, then Z. Swords: `[0, -90, 25]`. */
  rotation?: [number, number, number];
  /** Extra offset in pixels (camera axes: x right, y up, z back). */
  translation?: [number, number, number];
  /** Multiplies the style's scale (swords: 0.68; guns: 0.42 of the model's own size). */
  scale?: number;
  /** Animation for attacking or using: built-in (`swing`, `punch`, `jab`, `drink`, `release`, `chop`, `stab`), registered with `viewModel.define`, or inline. */
  use?: string | ViewAnimation;
  /** The `gun` style's poses for this gun: whatever it gives goes over the defaults (see `GunHold`). */
  gun?: GunHold;
}

/**
 * Where a gun sits in first person (the `gun` hold style), per gun. Camera space: x right, y up,
 * z back (so ahead is -z), in blocks, written for the right hand and mirrored for the left. Every
 * field is optional and goes over its default, so `{ ads: 0.36 }` changes only that.
 */
export interface GunHold {
  /**
   * The firing fist at the hip: [0.235, -0.255, -0.62], low at the right; a compact gun (a
   * pistol's length or less ahead of the hand) [0.12, -0.19, -0.52], nearer the middle.
   */
  fist?: [number, number, number];
  /** Which way the barrel points at the hip: nearly straight ahead, a touch inward and up ([-0.1, 0.045, -1]). */
  barrel?: [number, number, number];
  /** Cant about the barrel at the hip, radians (-0.22). */
  roll?: number;
  /** Sprinting: swung down and across the chest (radians: yaw 0.8, pitch -0.5, roll -0.45) and moved (blocks: [-0.08, -0.06, 0.08]). */
  sprint?: { yaw?: number; pitch?: number; roll?: number; move?: [number, number, number] };
  /** Sliding: leaning into it (roll, radians: 0.35) and moved (blocks: [-0.04, -0.03, 0.02]). */
  slide?: { roll?: number; move?: [number, number, number] };
  /**
   * How far ahead of the eye the `sight` point sits when aiming down the sights, in blocks. By
   * the gun's sight: iron sights 0.42, a `dot` or `holo` optic's window 0.3 (nearer, so it frames
   * more), a scope 0.46.
   */
  ads?: number;
  /**
   * The firing forearm's direction, from the fist toward the elbow: at the hip ([0.32, -0.74, 0.6])
   * and aiming ([0.22, -0.64, 0.74]). `forearm2` is the support arm's: [-0.52, -0.72, 0.48] and
   * [-0.4, -0.72, 0.56]. They needn't be unit length.
   */
  forearm?: { hip?: [number, number, number]; ads?: [number, number, number] };
  forearm2?: { hip?: [number, number, number]; ads?: [number, number, number] };
  /** A shot's kick back (blocks, 0.075) and muzzle rise (degrees, 7), per unit of recoil. */
  kick?: number;
  rise?: number;
}

/**
 * One keyframe of a first-person animation. Values are offsets from the rest pose and default
 * to 0. `t` is normalised time (0..1); `ease` shapes the segment that ends at this key.
 * Written for the right hand; mirrored for the left.
 */
export interface ViewKey {
  t: number;
  /** Move the hand, in blocks (camera axes: x right, y up, z back). */
  move?: [number, number, number];
  /** Turn the hand (item and forearm together) about the grip: [pitch, yaw, roll] in radians. */
  hand?: [number, number, number];
  /** Turn only the item about the grip, same axes. */
  wrist?: [number, number, number];
  ease?: 'linear' | 'in' | 'out' | 'inOut';
}

/** Keyframes, or a function of normalised time for procedural motion. Duration in seconds. */
export type ViewAnimation =
  | { duration: number; keys: ViewKey[] }
  | { duration: number; sample(t: number): Omit<ViewKey, 't' | 'ease'> };

export interface ViewModelApi {
  /** Show the first-person arm and held item. Default true. */
  visible: boolean;
  /** Skin for the arm (Minecraft layout origin in `atlas`, default `builtin`); `null` hides the arm and keeps the item. */
  setSkin(skin: [number, number] | null, atlas?: string): void;
  /** Play an animation: a built-in name, one registered with `define`, or keyframes. `power` scales it. */
  play(anim: string | ViewAnimation, opts?: { power?: number; speed?: number }): void;
  /** Register a named animation for `play` and `HoldSpec.use`. */
  define(name: string, anim: ViewAnimation): void;
  /** Jolt the arm (recoil, being hit). */
  kick(strength?: number): void;
}

export interface ItemStack {
  item: string;
  count: number;
}

export interface InventoryApi {
  /** Nine hotbar slots. */
  readonly slots: readonly (ItemStack | null)[];
  readonly selected: number;
  readonly held: ItemStack | null;
  /** Add items; returns the amount that did not fit. */
  give(item: string, count?: number): number;
  take(item: string, count?: number): boolean;
  count(item: string): number;
  select(slot: number): void;
  clear(): void;
  /** A gun's rounds: in the magazine and spare (null for anything else, or if they don't have it). */
  ammo(item: string): { magazine: number; reserve: number } | null;
  /** Set a gun's rounds (a refill, a scavenged magazine); what's left out stays as it is. */
  setAmmo(item: string, ammo: { magazine?: number; reserve?: number }): void;
}

// ---------------------------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------------------------

/** A built-in sprite name, or a 16x16 region of a custom atlas registered with `items.atlas`. */
export type SpriteRef = BuiltinSprite | { atlas: string; x: number; y: number };

export type BuiltinSprite =
  | 'wooden_sword'
  | 'stone_sword'
  | 'iron_sword'
  | 'diamond_sword'
  | 'bow'
  | 'bow_pulling'
  | 'arrow'
  | 'health_potion'
  | 'heart';

interface ItemBase {
  name: string;
  /**
   * A sprite, or `{ block }`: an item that looks like a block is shown as the block in the
   * hotbar, held as a little cube, and dropped as a spinning cube of it.
   */
  icon: IconRef;
  /** How it is held and swung in first person. */
  hold?: HoldSpec;
  /** Its own sounds (built-in or `audio.define`d); each defaults to the platform's generic one. */
  sounds?: ItemSounds;
  /** Max stack size. Default 1 for weapons, 64 otherwise. */
  stack?: number;
  /** Higher-ranked weapons are auto-selected when picked up. */
  rank?: number;
  /**
   * Called when the player walks over a pickup of this item. Return true to consume it
   * immediately (e.g. hearts) instead of adding it to the inventory; play your own sound then.
   */
  onPickup?(game: GameContext, count: number, player: Player): boolean;
}

export interface ItemSounds {
  /** Melee swing, bow release, a gunshot, or using a consumable. Defaults: `swing`, `bow_shoot`, `gunshot`, none. */
  use?: SoundName;
  /** Guns: reloading (`gun_reload`), pulling the trigger on an empty gun (`gun_empty`), working a pump or bolt (`gun_cycle`). */
  reload?: SoundName;
  empty?: SoundName;
  cycle?: SoundName;
  /** A melee hit landing. Default `hit` (`crit` for critical hits). */
  hit?: SoundName;
  /** Starting to draw a bow. Default `bow_draw`. */
  draw?: SoundName;
}

export interface MeleeItem extends ItemBase {
  kind: 'melee';
  damage: number;
  /** Seconds between swings. */
  cooldown: number;
  reach?: number;
  knockback?: number;
  /** Also hit other enemies near the target. */
  sweep?: boolean;
}

export interface BowItem extends ItemBase {
  kind: 'bow';
  /** Item consumed per shot (omit for infinite). */
  ammo?: string;
  /** Damage at no charge and at full charge. */
  damage: [number, number];
  /** Seconds to full draw. */
  drawTime: number;
  speed: number;
  /** Sprite shown while drawing (default: the item's icon). */
  drawIcon?: SpriteRef;
  /** What flies (default: the ammo item's icon; with no ammo, a glowing bolt). */
  projectile?: SpriteRef;
}

/**
 * A hitscan gun: each shot is a ray (a few for shotguns) that hits the first thing along it,
 * checked against where targets were on the shooter's own screen (so what you aim at is what you
 * hit, however far away the server is). Firing, recoil, aiming down the sights and reloading
 * happen at once on the shooter's screen; the host decides the hits. Right-click aims, R
 * reloads, and an empty gun reloads by itself.
 */
export interface GunItem extends ItemBase {
  kind: 'gun';
  /** Damage per bullet (per pellet): up close, and at `falloff[1]` blocks and beyond. */
  damage: number | [near: number, far: number];
  /** Where damage starts to fall off and where it bottoms out, in blocks. Default [20, 50]. */
  falloff?: [number, number];
  /** Damage multiplier for a head hit. Default 1.5. */
  headshot?: number;
  /** Rounds per minute. */
  rpm: number;
  /** Keeps firing while the trigger is held. Default false: a shot per click. */
  auto?: boolean;
  /** Rounds in a magazine, and spare rounds carried (default three magazines' worth). */
  magazine: number;
  reserve?: number;
  /** Seconds to reload a magazine; with `shells`, seconds per round loaded (shotguns), and firing stops it. */
  reload: number;
  shells?: boolean;
  /** Bullets per shot (shotguns). Default 1. */
  pellets?: number;
  /**
   * The cone shots land in, in degrees (half angle): from the hip, aiming down the sights, and
   * extra while moving or in the air; each shot adds `bloom`, which settles again quickly.
   */
  spread?: { hip?: number; aim?: number; move?: number; air?: number; bloom?: number };
  /** Kick per shot in degrees: up, and at most sideways; `recover` (0..1) is how much of it the view settles back from. */
  recoil?: { up?: number; side?: number; recover?: number };
  /**
   * Aiming down the sights (right mouse): `zoom` (the view's field of view divided by it; default
   * 1.3), seconds to raise (0.2), speed while aiming (0.6), and what's seen: the gun's own
   * `iron` sights (default); a red `dot` or a `holo` sight's ring and dot, glowing on the target
   * through the optic's window (`color`, default red; model the optic with its window open and
   * its `sight` point in the window's middle); or a `scope` (the view fills with the scope).
   */
  aim?: {
    zoom?: number;
    time?: number;
    move?: number;
    sight?: 'iron' | 'dot' | 'holo' | 'scope';
    color?: string;
    /**
     * Aim assist for someone on a controller (0 none, 1 strong; default 0.6): the view slows
     * over a player in sight and turns a little with them as they move. Mouse aim is never helped.
     * A number is the strength; `AimAssist` gives its shape too (over the game's `guns.assist`).
     */
    assist?: number | AimAssist;
  };
  /** Blocks. Default 150. */
  range?: number;
  /** Movement speed while it's held (a heavy gun is slower). Default 1. */
  mobility?: number;
  /** A pump or bolt worked after each shot (its animation plays before the next). */
  action?: 'pump' | 'bolt';
  /** The tracer's colour, or false for none. Default a warm yellow. */
  tracer?: string | false;
  knockback?: number;
}

/**
 * How guns play in a game (`GameDefinition.guns`). The host and each shooter's own screen both
 * play by these (a screen predicts its own movement and fires its own shots), so they're data.
 * Every field is optional; the defaults are what Call of Blocky plays by.
 */
export interface GunOptions {
  /**
   * The furthest back a shot looks for its target, in seconds (0.35). The host checks each shot
   * against where people were on the shooter's screen, but no further back than this, so a laggy
   * screen can't hit someone where they were a second ago.
   */
  rewind?: number;
  /** Players' hitboxes for bullets, standing, crouching and sliding: what's given goes over each stance's default (see `PlayerHitbox`). */
  hitboxes?: { stand?: Partial<PlayerHitbox>; crouch?: Partial<PlayerHitbox>; slide?: Partial<PlayerHitbox> };
  /** Aiming down the sights slows the holder to the gun's `aim.move`. Default true. */
  aimSlows?: boolean;
  /** Aiming down the sights stops a sprint, and so does holding the trigger. Both default true. */
  aimStopsSprint?: boolean;
  fireStopsSprint?: boolean;
  /** An empty gun reloads by itself. Default true; off, it waits for R. */
  autoReload?: boolean;
  /**
   * How many shots a screen may get ahead of its gun's rate (3, at least 1). Lag bunches shots
   * up, so the host takes each one the gun could have fired give or take this many: lower is
   * stricter with a cheat that fires too fast, higher kinder to a poor connection.
   */
  rateSlack?: number;
  /** Aim assist's shape for every gun (see `AimAssist`); a gun's own `aim.assist` goes over it. */
  assist?: AimAssist;
}

/**
 * A player's hitboxes in one stance, in blocks up from their feet: the body from the feet to
 * `neck`, the head from there to `height`, `width` across the body and `headWidth` across the
 * head (both square). Standing `{ height: 2, neck: 1.5, width: 0.72, headWidth: 0.56 }`;
 * crouching 1.7, 1.2, 0.76, 0.6; sliding (leaning back from the hips: lower and wider) 1.4, 0.85,
 * 0.9, 0.9. They match the figure everyone sees.
 */
export interface PlayerHitbox {
  height: number;
  neck: number;
  width: number;
  headWidth: number;
}

/**
 * Aim assist's shape (controllers only). Over a target near the crosshair the stick turns slower,
 * and while the sticks move the view turns a little with the target as it (or you) moves.
 */
export interface AimAssist {
  /** 0 none, 1 strong. Default 0.6. */
  strength?: number;
  /**
   * Who's near enough the crosshair: within `radius` blocks of its line (1.1, about a body's
   * width round them), plus `angle` degrees more (about 1.43, so far-off targets get a little extra).
   */
  cone?: { radius?: number; angle?: number };
  /** How much the stick slows over a target at full strength: from the hip (0.45) and aiming down the sights (0.6). It eases off toward the cone's edge. */
  slow?: { hip?: number; aim?: number };
  /** How much of a target's movement the view turns with, at full strength: from the hip (0.4) and aiming (0.6). */
  follow?: { hip?: number; aim?: number };
}

export interface ConsumableItem extends ItemBase {
  kind: 'consumable';
  /** Right-click to use. Return true to consume one. */
  use(game: GameContext, player: Player): boolean;
}

export interface MiscItem extends ItemBase {
  kind: 'misc';
}

export type ItemDefinition = MeleeItem | BowItem | GunItem | ConsumableItem | MiscItem;

/** An icon anywhere the HUD shows one: a sprite, or a block's own look. */
/**
 * A sprite, a block's picture, or a picture of a glTF model (`{ gltf: url }`, drawn once it has
 * loaded; `view: 'side'` draws it from the side, the way kill feeds show guns).
 */
export type IconRef = SpriteRef | { block: string } | { gltf: string; view?: 'iso' | 'side' };

export interface Pickup {
  readonly id: number;
  readonly item: string;
  readonly count: number;
  readonly position: Vec3;
  /** False once collected, despawned or removed. */
  readonly alive: boolean;
  remove(): void;
}

/**
 * Raw atlas pixels (for art painted in code): sRGB RGBA, row 0 at the top, plus an optional
 * glow map (one byte per texel, 0..255) for emissive parts like eyes and fire.
 */
export interface AtlasPixels {
  width: number;
  height: number;
  pixels: Uint8Array;
  emissive?: Uint8Array;
}

export interface ItemApi {
  define(id: string, def: ItemDefinition): void;
  get(id: string): ItemDefinition | undefined;
  /**
   * Drop an item into the world. `beam` adds a light pillar so players can find it. `for`: only
   * that player can pick it up (a reward each); once they've left, anyone can.
   */
  spawnPickup(item: string, at: Vec3, opts?: { count?: number; velocity?: Vec3; beam?: string; despawn?: number; for?: Player }): Pickup;
  clearPickups(): void;
  /** Register a custom sprite / skin atlas from any canvas (e.g. drawn with Canvas 2D). */
  atlas(name: string, source: HTMLCanvasElement | OffscreenCanvas | AtlasPixels): void;
}

// ---------------------------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------------------------

/** Box model description (see `Models`). Units are texels, 16 per block. */
export interface ModelSpec {
  rig: 'humanoid' | 'spider' | 'static' | 'gltf';
  parts: ModelPart[];
  /** Skin atlas (`builtin` or a name registered with `items.atlas`). */
  atlas: string;
  /** Uniform scale applied to the whole model. */
  scale: number;
  /** A glTF model (`Models.gltf`) instead of boxes. */
  gltf?: GltfSpec;
}

/**
 * A glTF / GLB model for a figure (`Models.gltf`): the file, and which of its animations play
 * when. Each player's screen fetches the file itself (a game imports it: `import zombie from
 * './models/zombie.gltf?url'`); a host never opens it.
 */
export interface GltfSpec {
  /** Where the file is: a game's own (imported with `?url`) or any address. */
  url: string;
  /**
   * The model's animations (by name) for what the figure does. A list plays together (a model
   * split into upper and lower body: `['walk_upper', 'walk_lower']`). Missing ones fall back:
   * `run` to `walk`, `walk` to `idle`; without `idle`, the model stands still.
   */
  clips?: { idle?: string | string[]; walk?: string | string[]; run?: string | string[]; attack?: string | string[]; cast?: string | string[] };
  /** Turn the model this far about its up axis (radians) if it doesn't face +z like glTF models should. */
  yaw?: number;
  /** The node that turns to look (its name in the file). */
  head?: string;
  /** The node a held item hangs from (its name in the file). */
  hand?: string;
  /** Nodes not to draw (by name). A node named `hitbox` (a collision box) is never drawn. */
  hide?: string[];
  /**
   * `humanoid`: the model is built on the platform's humanoid rig (docs/HUMANOID.md: joints named
   * `hips`, `spine`, `chest`, `head`, `upperArmR` …) and the platform animates it in code: walking,
   * running and strafing, crouching, sliding, jumping, looking, a gun in both hands, a sword, a fall
   * on death. A model with those joints and no `clips` is taken to be one.
   */
  rig?: 'humanoid';
  /**
   * A humanoid player's own arms in first person (its forearms and fists on what they hold), for
   * a model whose proportions want other numbers: `scale` times life size (1.2: a little bigger,
   * as shooters draw them, so the hands read round a gun); `reach`, how far the firing and the
   * support arm run back from the fist, in blocks, so they leave the screen's edge ([0.55, 0.72]);
   * `support`, where the support fist sits from the handguard's near side, in the model's own
   * blocks along the gun's axes (x out to the side we see, y up, z toward the muzzle; [0.01, -0.012, 0]).
   */
  firstPerson?: { scale?: number; reach?: [firing: number, support: number]; support?: [number, number, number] };
}

export interface ModelPart {
  name: string;
  /** Box size in texels (x, y, z). */
  size: [number, number, number];
  /** Minecraft-style box UV origin in the atlas. */
  uv: [number, number];
  /** Joint position in texels relative to the entity's feet (or the parent's joint). */
  pivot: [number, number, number];
  /** Box min corner relative to the pivot. */
  offset: [number, number, number];
  /** Rest pose rotation in radians (x, y, z). */
  rotation?: [number, number, number];
  parent?: string;
  /** Mirror the texture horizontally (left limbs). */
  mirror?: boolean;
}

/** AI: runs every frame for each living entity of the type. */
export type Behavior = (self: Entity, game: GameContext, dt: number) => void;

export interface EntityDefinition {
  name: string;
  model: ModelSpec;
  hitbox: { width: number; height: number };
  health: number;
  /** Walking speed in blocks per second. */
  speed: number;
  jump?: number;
  /** 0 = full knockback, 1 = immovable. */
  knockbackResistance?: number;
  ai?: Behavior;
  /** Items dropped on death. */
  drops?: { item: string; chance: number; count?: number }[];
  /** Show a boss bar while alive. */
  boss?: boolean;
  sounds?: { hurt?: SoundName; death?: SoundName; ambient?: SoundName };
  /** Particle colour for hits and death puffs. */
  bloodColor?: string;
  /** Ignores all damage (shopkeepers, scenery). */
  invulnerable?: boolean;
}

export interface ProjectileSpec {
  /** A sprite (drawn on the diagonal, tip at the top right, like an arrow). Without one, a glowing bolt in the `glow` colour. */
  sprite?: SpriteRef;
  speed: number;
  gravity?: number;
  damage: number;
  knockback?: number;
  /** Arrows stick in walls for a few seconds. */
  sticky?: boolean;
  /** Emissive glow colour (fireballs). */
  glow?: string;
}

export interface Entity {
  /** Tells entities from players in an `Actor`. */
  readonly kind: 'entity';
  readonly id: number;
  readonly type: string;
  readonly position: Vec3;
  readonly velocity: Vec3;
  health: number;
  readonly maxHealth: number;
  /** Armour points, 0..20: each blocks 4% of incoming damage, like the player's. Default 0. */
  armor: number;
  readonly alive: boolean;
  readonly onGround: boolean;
  /** The solid prop it stands on and rides (`Prop.solid`), if any. */
  readonly riding: Prop | null;
  /** Seconds since spawn. */
  readonly age: number;
  /** Free-form per-entity state for behaviours and games. */
  readonly data: Record<string, unknown>;
  /** Apply damage. Returns false if it didn't land (dead, invulnerable, or cancelled by a `damage` listener). */
  damage(amount: number, opts?: DamageOptions): boolean;
  heal(amount: number): void;
  kill(): void;
  /** Remove without a death animation or drops. */
  remove(): void;
  impulse(x: number, y: number, z: number): void;
  /** Path-find toward the player or walk straight to a point. */
  moveTo(target: Player | Vec3): void;
  /** Walk in a world-space direction (x, z), e.g. strafing. */
  moveDirection(x: number, z: number): void;
  stop(): void;
  jump(): void;
  /** Turn to face a point (otherwise entities face their movement). */
  lookAt(target: Player | Entity | Vec3 | null): void;
  /** The closest living player (null if nobody's alive). */
  nearestPlayer(): Player | null;
  /** A clear line from its eyes to them (to a player's eyes, an entity's middle, or a point). */
  canSee(target: Player | Entity | Vec3): boolean;
  distanceTo(target: Player | Entity | Vec3): number;
  /** Play a model animation: `attack` swings arms, `raise` holds them up (wind-ups), `cast`. */
  animate(name: 'attack' | 'raise' | 'cast' | 'none'): void;
  /** Speed multiplier on top of the type's speed. */
  setSpeed(multiplier: number): void;
  /** Tint the model (flash on wind-up). */
  glow(color: string | null): void;
  shoot(spec: ProjectileSpec, target: Player | Entity | Vec3, opts?: { spread?: number; lead?: boolean }): void;
}

export interface EntityApi {
  define(type: string, def: EntityDefinition): void;
  spawn(type: string, at: Vec3, opts?: { yaw?: number; data?: Record<string, unknown> }): Entity;
  all(type?: string): Entity[];
  count(type?: string): number;
  near(center: Vec3, radius: number): Entity[];
  clear(): void;
  /** Fire a projectile from anywhere (traps, turrets). */
  projectile(spec: ProjectileSpec, from: Vec3, dir: Vec3, owner?: Entity | Player): void;
  /** The first living entity along a ray, stopping at solid blocks (what the crosshair is on). */
  raycast(origin: Vec3, dir: Vec3, maxDistance: number): { entity: Entity; distance: number } | null;
}

// ---------------------------------------------------------------------------------------------
// HUD, effects, audio, environment
// ---------------------------------------------------------------------------------------------

/** One part of a feed line: text, coloured text, or an icon. */
export type FeedPart = string | { text: string; color?: string } | { icon: IconRef };

export interface Scoreboard {
  title?: string;
  /** Headers of the columns after the name ('Kills', 'Deaths', 'Score'). */
  columns: string[];
  rows: { name: string; values: (string | number)[]; color?: string; player?: Player }[];
  /** A line under the table (time left, the score to win). */
  footer?: string;
  /** Keep it up whether or not Tab is held. */
  show?: boolean;
}

export interface MenuEntry {
  icon?: IconRef;
  label: string;
  /** Shown on the right (a price, a level). */
  detail?: string;
  /** A second line under the label. */
  note?: string;
  /** Greyed out and not clickable (can't afford, locked). */
  disabled?: boolean;
  /** Highlighted (owned, selected). */
  active?: boolean;
  onSelect?(): void;
}

export interface MenuOptions {
  title: string;
  subtitle?: string;
  sections: { title?: string; entries: MenuEntry[] }[];
  /** Called when the menu closes (Esc, the close button, or `close()`). */
  onClose?(): void;
}

export interface MenuHandle {
  /** Replace its contents (e.g. after a purchase). */
  update(opts: Partial<MenuOptions>): void;
  close(): void;
  readonly open: boolean;
}

export interface ScreenOptions {
  title: string;
  subtitle?: string;
  tone?: 'victory' | 'defeat' | 'neutral';
  icon?: SpriteRef;
  stats?: [string, string][];
  buttons: { label: string; primary?: boolean; onClick: () => void }[];
}

export interface HudApi {
  /** Big centred title, e.g. "Wave 3". */
  banner(title: string, subtitle?: string, opts?: { duration?: number; color?: string }): void;
  /** Persistent status line at the top (null hides it). */
  objective(text: string | null): void;
  /** Small labelled values in the top-right corner (null value removes the chip). */
  stat(id: string, label: string, value: string | number | null): void;
  bossBar(name: string, fraction: number, color?: string): void;
  hideBossBar(): void;
  toast(text: string): void;
  /**
   * A line in the message feed (top left): kill feeds, match events, chat. Lines stack, newest at
   * the bottom, and fade after a few seconds. `color` tints the line. A line can be parts: text,
   * coloured text and icons (`['Ann', { icon: { gltf: rifle, view: 'side' } }, { text: 'Bob', color: '#f55' }]`).
   */
  feed(text: string | FeedPart[], opts?: { color?: string }): void;
  /** A short pop-up under the crosshair ("+100", "Headshot!", "Double kill"): `big` for the big moments. */
  pop(text: string, opts?: { color?: string; big?: boolean; sub?: string }): void;
  /**
   * The scoreboard, shown while the player holds Tab (or kept up with `show`, at a match's end);
   * `null` removes it. Rows naming a `player` are theirs: that player sees their own highlighted.
   */
  scoreboard(board: Scoreboard | null): void;
  /** Modal screen with buttons; releases the mouse. Returns a function that closes it. */
  screen(opts: ScreenOptions): () => void;
  /** A labelled bar at the bottom left (shields, fuel, boost); `null` removes it. */
  meter(id: string, label: string, value: number | null, opts?: { color?: string; text?: string }): void;
  /**
   * A marker drawn over a world position (targets, waypoints); `null` removes it. With `edge`,
   * an off-screen target shows as an arrow on the screen edge.
   */
  marker(id: string, at: Anchor | null, opts?: MarkerOptions): void;
  /** Show or hide the default crosshair. */
  crosshair(visible: boolean): void;
  /** A round radar in the bottom-right corner; `null` hides it. */
  radar(data: RadarData | null): void;
  /** A panel of clickable entries (shops, upgrade trees, level select); releases the mouse while open. The game keeps running. */
  menu(opts: MenuOptions): MenuHandle;
  /** A ring round the crosshair filling 0..1 (mining, charging, capturing); `null` hides it. */
  progress(fraction: number | null, opts?: { color?: string }): void;
  /**
   * Outline one block (the one being aimed at), with Minecraft's break cracks growing over it as
   * `progress` goes 0..1. `null` hides it. It stays until moved or hidden.
   */
  highlight(at: Vec3 | null, opts?: { progress?: number }): void;
}

/**
 * Where a marker or radar blip is: a spot, or something it follows (a prop, an entity, a player).
 * Followed things are placed by each player's screen every frame, where that screen draws them
 * (smooth, and where prediction has a pilot's own ship), and sent only once.
 */
export type Anchor = Vec3 | Prop | Entity | Player;

export interface MarkerOptions {
  /** Offset from what it follows: in a prop's own space (`{ z: -30 }` is 30 ahead of a ship's nose), else in the world. */
  offset?: Vec3;
  color?: string;
  /** `box` (target brackets), `diamond`, `ring`, `reticle` (aiming sight), `dot`. */
  shape?: 'box' | 'diamond' | 'ring' | 'reticle' | 'dot';
  /** Size in pixels, or `{ world: n }` to scale with distance like an object n blocks wide. */
  size?: number | { world: number; min?: number; max?: number };
  label?: string;
  /** Arrow on the screen edge when off-screen. */
  edge?: boolean;
  /** Pulse (locks, warnings). */
  pulse?: boolean;
  /** A bar under the label, 0..1 (a health bar over someone's head). */
  bar?: number;
}

export interface RadarData {
  /** The middle of the radar: a spot, or something to follow (a pilot's ship). */
  center: Anchor;
  /**
   * Heading in radians (0 = looking toward -z, like `player.yaw`); the radar turns with it.
   * Following a prop, leave it out to turn with the prop.
   */
  heading?: number;
  /** Blocks from the centre to the rim. */
  range: number;
  /** Blips at spots (`x`, `z`, and `y` for the above / below tick), or following things (`at`). */
  blips: RadarBlip[];
}

export type RadarBlip = ({ x: number; z: number; y?: number } | { at: Anchor }) & { color: string; size?: number };

export interface FxApi {
  /** Particles: `glow` makes them emissive, `life` (seconds) and `drag` shape trails and smoke. */
  burst(at: Vec3, opts?: { color?: string; count?: number; speed?: number; size?: number; gravity?: number; glow?: number; life?: number; drag?: number }): void;
  shake(strength: number, duration?: number): void;
  flash(color: string, strength?: number, duration?: number): void;
  shockwave(at: Vec3, radius: number, color?: string): void;
  damageNumber(at: Vec3, amount: number, opts?: { crit?: boolean; color?: string }): void;
  fireworks(at: Vec3, count?: number): void;
  /** Fireball, smoke, shockwave, sound and a shake scaled by distance. `size` 1 = a small vehicle. */
  explosion(at: Vec3, opts?: { size?: number; color?: string }): void;
}

/** Sounds the platform provides (its own systems use them; games may too). */
export type BuiltinSound =
  | 'swing'
  | 'hit'
  | 'crit'
  | 'hurt'
  | 'mob_hurt'
  | 'mob_death'
  | 'bow_draw'
  | 'bow_shoot'
  | 'arrow_hit'
  | 'pickup'
  | 'heal'
  | 'wave'
  | 'victory'
  | 'defeat'
  | 'spawn'
  | 'click'
  | 'countdown'
  | 'explosion'
  | 'explosion_big'
  | 'lock'
  | 'alarm'
  | 'whoosh'
  | 'gunshot'
  | 'gun_reload'
  | 'gun_empty'
  | 'gun_cycle'
  | 'hitmarker'
  | 'kill';

/** A built-in sound, or one a game added with `audio.define`. */
export type SoundName = BuiltinSound | (string & {});

/** Continuous sounds: `engine` (a throttling thruster roar) and `wind`. */
export type LoopName = 'engine' | 'wind';

export interface LoopHandle {
  /** `pitch` 1 = normal; 0..1 volume. */
  set(opts: { volume?: number; pitch?: number }): void;
  stop(): void;
}

/**
 * What a game-defined sound gets to make noise with. Frequencies are Hz; times are seconds from
 * the start of the sound; `pitch` is the play call's pitch multiplier (apply it yourself).
 * `ctx` / `out` / `t` are there for anything the helpers don't cover (raw WebAudio into `out`).
 */
/**
 * What a voice makes its sound from. A voice is recorded as the layers it makes and sent to each
 * player's client, so it's built only from `tone` and `noise` (no raw Web Audio).
 */
export interface SynthKit {
  /** The play's pitch (1 = as written): multiply frequencies by it. */
  readonly pitch: number;
  /** An oscillator sweeping `from` -> `to` (exponential), with an attack / decay envelope. */
  tone(o: {
    wave?: OscillatorType;
    from: number;
    to?: number;
    duration: number;
    volume?: number;
    delay?: number;
    attack?: number;
    lowpass?: number;
    /** A bandpass filter, sweeping from `freq` to `to` over the duration if given. */
    bandpass?: { freq: number; to?: number; q?: number };
    vibrato?: { rate: number; depth: number };
  }): void;
  /** Filtered white noise, the filter sweeping `from` -> `to`. */
  noise(o: { duration: number; from: number; to?: number; filter?: BiquadFilterType; q?: number; volume?: number; delay?: number }): void;
}

export type SynthVoice = (s: SynthKit) => void;

export interface AudioApi {
  play(name: SoundName, opts?: { at?: Vec3; volume?: number; pitch?: number }): void;
  /** Add (or replace) a sound, synthesised on each play. Call it in `setup`. */
  define(name: string, voice: SynthVoice): void;
  /** Start a continuous sound; keep the handle to change it and stop it. */
  loop(name: LoopName, opts?: { volume?: number; pitch?: number }): LoopHandle;
}

export interface EnvApi {
  /** Time of day (0..1). */
  time: number;
  frozen: boolean;
}

/** What a hit was done with, when a weapon did it: its item id, and whether it was a head hit. */
export interface HitDetails {
  weapon?: string;
  headshot?: boolean;
}

/** What did some damage: a gun's bullet, a melee hit (a blade, a fist, a mob's swing), a projectile (an arrow, a fireball), or the world (a fall, `'world'` damage). */
export type DamageCause = 'gun' | 'melee' | 'projectile' | 'world';

/**
 * Damage about to land on a player or a creature (the `damage` event), before armour and before
 * their health changes. A listener can change `amount` or `knockback`, or `cancel()` it (then it
 * doesn't land at all: no hurt, no knockback, no `playerDamage` or `entityDamage`, and a gun's
 * shooter gets no hit marker).
 */
export interface DamageEvent extends HitDetails {
  readonly target: Player | Entity;
  /** How much, before armour. Change it to deal more or less; 0 or less is the same as cancelling. */
  amount: number;
  knockback: number;
  /** Who dealt it (an entity, a player, the world), if anyone said. */
  readonly source: DamageOptions['source'];
  readonly cause: DamageCause;
  /** The part hit, when it's known (bullets: `head` or `body`). */
  readonly part?: 'head' | 'body';
  /** Where it came from, if anywhere. */
  readonly from?: Vec3;
  readonly crit: boolean;
  readonly cancelled: boolean;
  cancel(): void;
}

export interface GameEvents {
  /**
   * Any damage about to land, from anything (a gun, a blade, an arrow, a fall, your own `damage`
   * call): change it or cancel it (see `DamageEvent`). Listeners run in the order they were added.
   */
  damage: DamageEvent;
  entityDamage: { entity: Entity; amount: number; source: DamageOptions['source'] } & HitDetails;
  entityDeath: { entity: Entity; killer: DamageOptions['source'] } & HitDetails;
  playerDamage: { player: Player; amount: number; source: DamageOptions['source'] } & HitDetails;
  playerDeath: { player: Player; source: DamageOptions['source'] } & HitDetails;
  /** A gun went off (every shot; a shotgun's pellets are one shot). */
  shot: { player: Player; weapon: string; from: Vec3; dir: Vec3 };
  pickup: { player: Player; item: string; count: number };
  /** A player joined a game in progress (multiplayer). */
  playerJoin: { player: Player };
  /** A player left (multiplayer). They're no longer in `players`. */
  playerLeave: { player: Player };
  /** A block was broken by the player, an entity, an explosion or `world.breakBlock`. */
  blockBreak: { x: number; y: number; z: number; block: string; by: Actor };
  blockPlace: { x: number; y: number; z: number; block: string; by: Actor };
  /** A movement ability called `body.trigger(name)`: a dash began, a wall-jump (for sounds, effects). */
  ability: { player: Player; ability: string; name: string };
}

export interface EventApi {
  on<K extends keyof GameEvents>(event: K, fn: (e: GameEvents[K]) => void): () => void;
}

export interface ClockApi {
  /** Seconds of game time since `start` (pauses with the game). */
  readonly now: number;
  after(seconds: number, fn: () => void): () => void;
  every(seconds: number, fn: () => void): () => void;
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  range(min: number, max: number): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
}
