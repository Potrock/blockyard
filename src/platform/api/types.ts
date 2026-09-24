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
   * Allow the built-in cheat commands (`/give`, `/tp`, `/spawn`, `/kill`, `/heal`, `/time`, `/fly`)
   * in production builds. They're always available in development.
   */
  cheats?: boolean;
  world?: WorldOptions;
  player?: PlayerOptions;
  /**
   * Runs once after the engine has loaded and before the world streams in. Register entity
   * types, items and event handlers here.
   */
  setup?(game: GameContext): void;
  /** Runs when play begins, and again after `game.restart()`. */
  start?(game: GameContext): void;
  /** Runs every frame while the game is running (not while paused). `dt` is in seconds. */
  update?(game: GameContext, dt: number): void;
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
}

// ---------------------------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------------------------

export interface GameContext {
  readonly world: WorldApi;
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
  /** Movable objects: block builds (ships, vehicles) and glowing bolts. */
  readonly props: PropApi;
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
}

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

/** A movable object. Mutate `position` / `quaternion` directly each frame. */
export interface Prop {
  readonly position: MathVector3;
  readonly quaternion: MathQuaternion;
  scale: number;
  visible: boolean;
  /** Tint it briefly (hits). */
  flash(color?: string, seconds?: number): void;
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
  spawn(model: PropModel, opts?: { position?: Vec3; scale?: number }): Prop;
  /** A glowing streak pointing along its -z (lasers, tracers). Length and width in blocks. */
  bolt(opts: { color: string; length?: number; width?: number; intensity?: number }): Prop;
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

export type BlockRef = number | string;

export interface RayHit {
  x: number;
  y: number;
  z: number;
  normal: Vec3;
  block: number;
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
  /** First targetable block along a ray. */
  raycast(origin: Vec3, dir: Vec3, maxDistance: number): RayHit | null;
  /** True if nothing solid blocks the straight line between two points. */
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
   * Place a block if the cell is free (air or a plant), nobody is standing in it, and a plant has
   * ground under it; with a sound, and fire `blockPlace`. Returns false if it couldn't.
   */
  placeBlock(x: number, y: number, z: number, block: BlockRef, opts?: { by?: Actor }): boolean;
}

export interface BlockInfo {
  id: number;
  name: string;
  /** Display name, e.g. "Oak Planks". */
  label: string;
  /** Bodies collide with it. */
  solid: boolean;
  liquid: boolean;
  /** A cross-shaped plant (flowers, grass, torches). */
  plant: boolean;
  /** Placing a block here replaces it (air, plants, liquids). */
  replaceable: boolean;
  /** Light it gives off, 0..15. */
  light: number;
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
}

export interface PlayerApi {
  /** Tells players from entities in an `Actor`. */
  readonly kind: 'player';
  /** Stable for the session (`local` in single-player). */
  readonly id: string;
  readonly name: string;
  /** This player's screen: HUD calls here reach only them (their wallet, their shop, their toasts). */
  readonly hud: HudApi;
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
  /** Armour points, 0..20: each blocks 4% of incoming damage (Minecraft-style). Default 0. */
  armor: number;
  /** The first-person arm and held item. */
  readonly viewModel: ViewModelApi;
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
 */
export type HoldStyle = 'sword' | 'axe' | 'bow' | 'item' | 'block' | 'polearm';

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
  /** Multiplies the style's scale (swords: 0.68). */
  scale?: number;
  /** Animation for attacking or using: built-in (`swing`, `punch`, `jab`, `drink`, `release`, `chop`, `stab`), registered with `viewModel.define`, or inline. */
  use?: string | ViewAnimation;
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
  /** Melee swing, bow release, or using a consumable. Defaults: `swing`, `bow_shoot`, none. */
  use?: SoundName;
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

export interface ConsumableItem extends ItemBase {
  kind: 'consumable';
  /** Right-click to use. Return true to consume one. */
  use(game: GameContext, player: Player): boolean;
}

export interface MiscItem extends ItemBase {
  kind: 'misc';
}

export type ItemDefinition = MeleeItem | BowItem | ConsumableItem | MiscItem;

/** An icon anywhere the HUD shows one: a sprite, or a block's own look. */
export type IconRef = SpriteRef | { block: string };

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
  /** Drop an item into the world. `beam` adds a light pillar so players can find it. */
  spawnPickup(item: string, at: Vec3, opts?: { count?: number; velocity?: Vec3; beam?: string; despawn?: number }): Pickup;
  clearPickups(): void;
  /** Register a custom sprite / skin atlas from any canvas (e.g. drawn with Canvas 2D). */
  atlas(name: string, source: HTMLCanvasElement | OffscreenCanvas | AtlasPixels): void;
}

// ---------------------------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------------------------

/** Box model description (see `Models`). Units are texels, 16 per block. */
export interface ModelSpec {
  rig: 'humanoid' | 'spider' | 'static';
  parts: ModelPart[];
  /** Skin atlas (`builtin` or a name registered with `items.atlas`). */
  atlas: string;
  /** Uniform scale applied to the whole model. */
  scale: number;
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
  /** Seconds since spawn. */
  readonly age: number;
  /** Free-form per-entity state for behaviours and games. */
  readonly data: Record<string, unknown>;
  damage(amount: number, opts?: DamageOptions): void;
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
   * the bottom, and fade after a few seconds. `color` tints the line.
   */
  feed(text: string, opts?: { color?: string }): void;
  /** Modal screen with buttons; releases the mouse. Returns a function that closes it. */
  screen(opts: ScreenOptions): () => void;
  /** A labelled bar at the bottom left (shields, fuel, boost); `null` removes it. */
  meter(id: string, label: string, value: number | null, opts?: { color?: string; text?: string }): void;
  /**
   * A marker drawn over a world position (targets, waypoints); `null` removes it. With `edge`,
   * an off-screen target shows as an arrow on the screen edge.
   */
  marker(id: string, at: Vec3 | null, opts?: MarkerOptions): void;
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

export interface MarkerOptions {
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
}

export interface RadarData {
  center: Vec3;
  /** Heading in radians (0 = looking toward -z, like `player.yaw`); the radar turns with it. */
  heading: number;
  /** Blocks from the centre to the rim. */
  range: number;
  blips: { x: number; z: number; color: string; size?: number; y?: number }[];
}

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
  | 'whoosh';

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

export interface GameEvents {
  entityDamage: { entity: Entity; amount: number; source: DamageOptions['source'] };
  entityDeath: { entity: Entity; killer: DamageOptions['source'] };
  playerDamage: { player: Player; amount: number; source: DamageOptions['source'] };
  playerDeath: { player: Player; source: DamageOptions['source'] };
  pickup: { player: Player; item: string; count: number };
  /** A player joined a game in progress (multiplayer). */
  playerJoin: { player: Player };
  /** A player left (multiplayer). They're no longer in `players`. */
  playerLeave: { player: Player };
  /** A block was broken by the player, an entity, an explosion or `world.breakBlock`. */
  blockBreak: { x: number; y: number; z: number; block: string; by: Actor };
  blockPlace: { x: number; y: number; z: number; block: string; by: Actor };
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
