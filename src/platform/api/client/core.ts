import type * as THREE from 'three';
import type { ItemDefinition, ItemLook, SharedDefinition, SoundName, SynthVoice, Vec3 as PlainVec3 } from '../types';
import type { ViewLayer } from './view';
import type { ClientFigures } from './figures';
import type { ClientHud } from './hud';

/**
 * Something drawn, or a group of things: a three.js `Object3D` as far as a game's client code
 * sees it (it never imports three.js). Positions, turns and sizes use the platform's math types
 * (`@platform/client/math`).
 */
export type Node = Pick<THREE.Object3D, 'position' | 'quaternion' | 'scale' | 'rotation' | 'visible' | 'renderOrder' | 'name' | 'updateMatrixWorld' | 'matrixWorld'> & {
  /** Hang nodes from this one (taken from wherever they hung before). */
  add(...nodes: Node[]): Node;
  remove(...nodes: Node[]): Node;
  readonly children: Node[];
  readonly parent: Node | null;
};

/** A kit: a piece of a game's client behaviour (what a first-person gun looks like, a HUD panel). */
export interface ClientKit {
  readonly name: string;
  /**
   * Once, when the game's client starts: at the first frame this screen shows the game, watching
   * from the home page or playing (so looks and voices are ready for what it shows either way).
   */
  setup?(client: Client): void;
  /** Every frame, in the order the kits are listed, before the game's own `frame`. */
  frame?(client: Client, dt: number): void;
  /**
   * Every frame after every kit's `frame` and the game's, once the world's effects (particles,
   * tracers, flares) have moved on by this frame's time and just before drawing: what's made here
   * is drawn where it starts (a shot fired this frame: its tracer leaves the muzzle as the hand
   * is drawn). `client.events` has this frame's shots by now (`bullets`, ours).
   */
  late?(client: Client, dt: number): void;
  /** When the game's client stops (switching games). */
  dispose?(): void;
}

/** What a game does on each player's screen, beyond its shared definition (`defineClient`). */
export interface ClientDefinition {
  /** The kits it uses, in the order they run each frame. */
  kits?: ClientKit[];
  /** Once, after the kits' `setup`, when this screen starts showing the game (watching or playing): define looks and voices, listen for messages. */
  setup?(client: Client): void;
  /** Every frame, after the kits (after prediction, before rendering). */
  frame?(client: Client, dt: number): void;
  /** Every frame, after the kits' `late` (see `ClientKit.late`). */
  late?(client: Client, dt: number): void;
}

/** The local player's held item, as this screen has it (predicted). */
export interface MeHeld {
  item: string;
  def: ItemDefinition | undefined;
  /**
   * The item's local state, as its mechanics keep it: a gun's `mag`, `reserve`, `reload`
   * (progress 0..1, -1 when not reloading), `shells` (rounds still to load, one at a time),
   * `aim` (0..1 down the sights), `sprint` (0..1 carried for sprinting), `slide` (0..1), `sight`,
   * `action`, `zoom` (how much aiming all the way zooms the view).
   */
  state: Record<string, unknown>;
}

/** The local player, as this screen predicts and shows it. */
export interface Me {
  readonly id: string | null;
  readonly position: PlainVec3;
  readonly velocity: PlainVec3;
  /** Where they look (radians; yaw 0 looks toward -z). */
  readonly look: { yaw: number; pitch: number };
  readonly onGround: boolean;
  readonly flying: boolean;
  readonly crouching: boolean;
  readonly sprinting: boolean;
  readonly sliding: boolean;
  readonly dead: boolean;
  readonly inVehicle: boolean;
  readonly health: number;
  readonly maxHealth: number;
  /** The walk cycle's phase (radians) and how much it shows (0..1, 0 when still or airborne). */
  readonly bob: { phase: number; amount: number };
  /** The camera is behind them (`camera.orbit`), not at their eyes. */
  readonly thirdPerson: boolean;
  /** What's in hand: the hotbar's item and count; melee readiness (0..1); a bow's draw. */
  readonly hand: { item: string | null; count: number; strength: number; drawing: boolean; charge: number };
  readonly held: MeHeld | null;
  readonly abilities: Record<string, Record<string, number | boolean>>;
  /**
   * Throwables with a key of their own that they carry (thrown whatever's in hand), in hotbar
   * order: how many (less the throws the server hasn't taken yet), and the key (`'KeyG'`).
   */
  readonly quick: readonly { item: string; count: number; key: string }[];
  /**
   * A throwable being cooked (its pin out, held to throw): which, for how long (seconds), and the
   * fuse it burns down (seconds; 0 when holding it doesn't burn it).
   */
  readonly cooking: { item: string; held: number; fuse: number } | null;
}

/**
 * One bullet of a shot, as this screen has it: where it ended and what it hit there (a block, with
 * its face and colour; someone; or nothing, at its range), and the walls it went through first.
 */
export interface ClientBullet {
  end: PlainVec3;
  hit: 'block' | 'body' | null;
  /** The face of the block it hit. */
  normal: PlainVec3 | null;
  /** The block's colour (linear RGB), for chips of it. */
  color: [number, number, number] | null;
  /** It took a bite out of the block (a world whose blocks carve): the pit is its mark. */
  carved: boolean;
  /**
   * The walls it went through on the way (wall-banging): where it went in and came out, each
   * face, the wall's colour, and whether each side was carved.
   */
  walls: { entry: PlainVec3; normal: PlainVec3; exit: PlainVec3; out: PlainVec3; color: [number, number, number]; carvedIn: boolean; carvedOut: boolean }[];
}

/**
 * Something thrown, in the air on this screen: flown here step by step as the server flies it
 * (from the throw: ours at once, someone else's from the server's word), until the server says
 * it went off.
 */
export interface ClientThrown {
  readonly key: string;
  readonly item: string;
  /** Thrown from this screen (it left our hand here). */
  readonly mine: boolean;
  readonly position: PlainVec3;
  /** Rolling or sliding along the ground; come to rest there. */
  readonly grounded: boolean;
  readonly resting: boolean;
  /** Seconds since it was thrown (on this screen). */
  readonly age: number;
  /** How far round it harm reaches when it goes off: its blast's radius and its fire's, added (0 for neither). */
  readonly reach: number;
}

/**
 * Something that happened this frame, on this screen or from the server: the kits react (a gun
 * kicks, a sword swings, a tracer flies). `view.*` are the server's calls to this player's view
 * (`player.viewModel.play`, the sim's own swings and kicks).
 */
export type ClientEvent =
  // Core.
  | { t: 'message'; name: string; data: unknown }
  // First person (its kit reacts: a gun kicks, a sword swings).
  | { t: 'shot'; item: string; power: number }
  | { t: 'use'; power: number }
  | { t: 'swing'; power: number }
  | { t: 'kick'; strength: number }
  | { t: 'toss' }
  | { t: 'equip'; item: string | null }
  | { t: 'reload'; item: string }
  | { t: 'land'; vy: number }
  | { t: 'view.play'; anim: string; power: number; speed: number }
  | { t: 'view.visible'; visible: boolean }
  | { t: 'view.setSkin'; skin: [number, number] | null; atlas?: string }
  // Figures.
  // HUD and effects.
  /**
   * A shot's bullets: ours as this screen fired them (`mine`: the tracers leave our own hand's
   * muzzle), or someone else's as the server had them (from `from`, their figure's muzzle).
   */
  | { t: 'bullets'; item: string; by: string | null; mine: boolean; from: PlainVec3 | null; bullets: ClientBullet[] }
  /** The trigger on an empty gun. */
  | { t: 'empty'; item: string }
  /** A throwable's pin pulled: it's being cooked (`client.me.cooking`). */
  | { t: 'cook'; item: string }
  /** Something thrown: ours (it just left our hand), or someone else's. It flies in `client.thrown`. */
  | { t: 'thrown'; key: string; item: string; mine: boolean }
  /** Something thrown hit a block as it flew, at `speed` (blocks a second). */
  | { t: 'bounce'; key: string; item: string; at: PlainVec3; speed: number }
  /** It's gone: went off at `at`, or (null) the server turned it down or never said. */
  | { t: 'thrownEnd'; key: string; item: string; at: PlainVec3 | null }
  /** A fire started (a molotov broke): flames `radius` round `at` for `duration` seconds. */
  | { t: 'fire'; id: number; at: PlainVec3; radius: number; duration: number; color: string }
  /** The game restarted: what the kits put on screen goes. */
  | { t: 'reset' }
  // Replays.
  /** A replay started on this screen (`client.replay`): `client.me` is now whoever it follows. */
  | { t: 'replay.start'; label: string; follow: string | null; data: unknown }
  /** It ended: played out, ended by the server, or skipped here (`skipped`). `client.me` is this player again. */
  | { t: 'replay.end'; label: string; skipped: boolean };

/**
 * A replay playing on this screen (the game's server showed one: `game.replay.show`): a stretch of
 * the last few seconds, drawn in place of the live game (which goes on underneath) with the same
 * figures and interpolation, through a player's eyes or from a camera of its own.
 *
 * While it plays, `client.me` is the player it follows as the replay shows them (their look, what
 * they hold, their gun as it was: a first-person kit draws their hands), and the events are theirs
 * (their shots, `mine`). The live HUD steps aside (the platform's panels and the game's widgets);
 * client code's own layers stay, for it to show what it likes (say whose eyes these are) and hide
 * what's the live player's own.
 */
export interface ClientReplay {
  /** A replay is playing. */
  readonly playing: boolean;
  /** Its number (0 when none is playing). */
  readonly id: number;
  /** Whose eyes it looks through (a player's id), or null for a camera of its own. */
  readonly follow: string | null;
  /** The game's name for it (`label`) and what it sent with it (`data`). */
  readonly label: string;
  readonly data: unknown;
  /** Seconds into it and how long it lasts, as played (at its speed). */
  readonly time: number;
  readonly duration: number;
  readonly speed: number;
  /** Its viewer may end it early. */
  readonly skippable: boolean;
  /**
   * End it on this screen, if it's skippable: as the next frame starts (`replay.end` comes then,
   * `skipped`), and the server hears (its `onEnd` runs with `skipped`).
   */
  skip(): void;
}

/** The world's camera, as client code may change it. */
export interface ClientCamera {
  /** How much the view is zoomed (1 none; 1.5 narrows the field of view 1.5 times): aiming down the sights. */
  zoom: number;
  /** The field of view as drawn (degrees, vertical). */
  readonly fov: number;
  /** Where it is this frame, before any shake (world space). */
  readonly position: PlainVec3;
  /** A point in the camera's own space (x right, y up, looking down -z) in the world, as it's placed this frame (before any shake). */
  toWorld(local: PlainVec3): PlainVec3;
}

/** Effects in the world, on this screen only. */
export interface ClientFx {
  explosion(at: PlainVec3, opts?: { size?: number; color?: string }): void;
  burst(at: PlainVec3, opts?: { color?: string; count?: number; speed?: number; size?: number; gravity?: number; glow?: number; life?: number; drag?: number }): void;
  shake(strength: number, duration?: number): void;
  flash(color: string, strength?: number, duration?: number): void;
  shockwave(at: PlainVec3, radius: number, color?: string): void;
  tracer(from: PlainVec3, to: PlainVec3, color?: string): void;
  impact(at: PlainVec3, normal: PlainVec3 | null, color: [number, number, number], body?: boolean, mark?: boolean): void;
  /** A hot glow for a moment (a few hundredths of a second), facing the camera: `size` blocks across. */
  flare(at: PlainVec3, size?: number): void;
  /**
   * Particles, with every knob: `color` in linear RGB; `spread` (how far round `at` they start),
   * `up` (an extra push upward), `glow` (emissive), `collide` (they stop on blocks).
   */
  particles(at: PlainVec3, color: [number, number, number], opts?: { count?: number; speed?: number; size?: number; gravity?: number; glow?: number; life?: number; spread?: number; up?: number; drag?: number; collide?: boolean }): void;
  damageNumber(at: PlainVec3, amount: number, opts?: { crit?: boolean; color?: string }): void;
  fireworks(at: PlainVec3, count?: number): void;
}

/** Sounds on this screen. */
export interface ClientAudio {
  play(name: SoundName, opts?: { at?: PlainVec3; volume?: number; pitch?: number }): void;
  /**
   * A voice of the game's own (synthesised on each play, with real Web Audio: nothing is recorded
   * or sent), under a name `play` uses: here, the server's `audio.play`, and items' `sounds`. Define
   * them in `setup` (a kit's, then the game's: a later one of the same name replaces the earlier).
   * A voice the game's server defines under the same name (its `audio.define`) takes precedence
   * over one defined here.
   */
  define(name: string, voice: SynthVoice): void;
}

/**
 * Items on this screen: how they look and sound (the game's client code gives that), and their
 * definitions as this screen reads them (the server's, with the looks over them).
 */
export interface ClientItems {
  /**
   * How an item looks and sounds on this screen (`ItemLook`: its icon, its hold and model, its
   * sounds, a gun's tracer, a throwable's trail, its shown name). Each field given goes over the
   * server's definition (`sounds` sound by sound) wherever this screen reads the item:
   * `client.item(id)`, `me.held.def`, the model in hand, the hotbar, pickups on the ground, other
   * players' figures, `{ item }` icons, and the kits. Call it in `setup`, before anything's shown;
   * an item the server defines later takes its look when it comes.
   */
  look(id: string, look: ItemLook): void;
  /** An item as this screen has it (the same as `client.item(id)`). */
  get(id: string): ItemDefinition | undefined;
}

/** The controls, read for feel (the game acts on the controls on its server). */
export interface ClientInput {
  isDown(code: string): boolean;
  /** A mouse button held (0 left, 1 middle, 2 right; a controller's triggers too). */
  button(b: number): boolean;
  /** What was used last. */
  readonly device: 'mouse' | 'pad';
}

/** The world as this screen has it, to look at (never to change). */
export interface ClientWorld {
  /** The block's name at a position (`'air'` where nothing is, or its chunk isn't here). */
  blockAt(x: number, y: number, z: number): string;
  /** The first solid block along a ray (`dir` of length 1) within `max` blocks: how far, and the face it meets. */
  raycast(from: PlainVec3, dir: PlainVec3, max: number): { distance: number; normal: PlainVec3 } | null;
}

/** Things this screen puts in the world itself (never on the server, never on anyone else's screen). */
export interface ClientScene {
  /** A group to put things in (`add` it to the world). */
  node(): Node;
  /** Into the world, lit and shadowed as figures are. */
  add(node: Node): void;
  remove(node: Node): void;
  /**
   * An item's look as a mesh (not in the world yet): its model (glTF or boxes) or its sprite
   * pressed flat, `center` its middle in its own space. Null while its model's file is coming.
   */
  item(id: string): { node: Node; center: PlainVec3; form: 'model' | 'sprite' } | null;
}

/**
 * The services client code gets. Each part of the platform's presentation adds its own here, in
 * its own section (the view, figures, the HUD; the camera, effects, sounds, controls, the world).
 */
export interface ClientServices {
  /** The first-person layer: what's in hand and the player's own arms. */
  readonly view: ViewLayer;
  /** Players' and creatures' figures as drawn. */
  readonly figures: ClientFigures;
  /** The HUD: the game's own layers and the platform's panels. */
  readonly hud: ClientHud;
  readonly camera: ClientCamera;
  readonly fx: ClientFx;
  readonly audio: ClientAudio;
  /** Items' looks on this screen (`client.items.look`). */
  readonly items: ClientItems;
  readonly input: ClientInput;
  readonly world: ClientWorld;
  // First person.
  // Figures.
  // HUD and effects.
  /** Things this screen puts in the world itself. */
  readonly scene: ClientScene;
  /** Things thrown, in the air on this screen now (see `ClientThrown`). */
  readonly thrown: readonly ClientThrown[];
  /** A replay playing on this screen (see `ClientReplay`). */
  readonly replay: ClientReplay;
}

/** A game's code on each player's screen. */
export interface Client extends ClientServices {
  /** The game's shared definition. */
  readonly shared: SharedDefinition;
  readonly me: Me;
  /** This frame's events (cleared after the game's `frame`). */
  readonly events: readonly ClientEvent[];
  /** Seconds this screen has run the game. */
  readonly time: number;
  /** The game is under way (its server's `start` has run): what moves there moves here. */
  readonly running: boolean;
  /** An item as this screen has it: the server's definition, with its look (`client.items.look`) over it. */
  item(id: string): ItemDefinition | undefined;
  /** The game's own messages from its server (`game.clients.send`). */
  on(name: string, fn: (data: unknown) => void): void;
  /** A message to the game's server (`game.events.on('clientMessage')`); the server checks it. */
  send(name: string, data: unknown): void;
}

/** The game on each player's screen (`client.ts`). */
export interface ClientGame {
  readonly shared: SharedDefinition;
  readonly client: ClientDefinition;
}
