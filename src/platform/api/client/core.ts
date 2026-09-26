import type * as THREE from 'three';
import type { ItemDefinition, SharedDefinition, Vec3 as PlainVec3 } from '../types';
import type { ViewLayer } from './view';
import type { ClientFigures } from './figures';
import type { ClientHud } from './hud';

/**
 * Something drawn, or a group of things: a three.js `Object3D` as far as a game's client code
 * sees it (it never imports three.js). Positions, turns and sizes use the platform's math types
 * (`@platform/client/math`).
 */
export type Node = Pick<THREE.Object3D, 'position' | 'quaternion' | 'scale' | 'rotation' | 'visible' | 'renderOrder' | 'add' | 'remove' | 'children' | 'parent' | 'name' | 'updateMatrixWorld' | 'matrixWorld'>;

/** A kit: a piece of a game's client behaviour (what a first-person gun looks like, a HUD panel). */
export interface ClientKit {
  readonly name: string;
  /** Once, when the game's client starts (the world is up, before the first frame). */
  setup?(client: Client): void;
  /** Every frame, in the order the kits are listed, before the game's own `frame`. */
  frame?(client: Client, dt: number): void;
  /** When the game's client stops (switching games). */
  dispose?(): void;
}

/** What a game does on each player's screen, beyond its shared definition (`defineClient`). */
export interface ClientDefinition {
  /** The kits it uses, in the order they run each frame. */
  kits?: ClientKit[];
  /** Once, when this screen joins: listen for messages, set up what the kits don't. */
  setup?(client: Client): void;
  /** Every frame, after the kits (after prediction, before rendering). */
  frame?(client: Client, dt: number): void;
}

/** The local player's held item, as this screen has it (predicted). */
export interface MeHeld {
  item: string;
  def: ItemDefinition | undefined;
  /**
   * The item's local state, as its mechanics keep it: a gun's `mag`, `reserve`, `reload`
   * (progress 0..1, -1 when not reloading), `shells` (rounds still to load, one at a time),
   * `aim` (0..1 down the sights), `sprint` (0..1 carried for sprinting), `sight`, `action`.
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
}

/**
 * Something that happened this frame, on this screen or from the server: the kits react (a gun
 * kicks, a sword swings, a tracer flies). `view.*` are the server's calls to this player's view
 * (`player.viewModel.play`, the sim's own swings and kicks).
 */
export type ClientEvent =
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
  | { t: 'message'; name: string; data: unknown };

/** A game's code on each player's screen. */
export interface Client {
  /** The game's shared definition. */
  readonly shared: SharedDefinition;
  readonly me: Me;
  /** This frame's events (cleared after the game's `frame`). */
  readonly events: readonly ClientEvent[];
  /** Seconds this screen has run the game. */
  readonly time: number;
  /** The first-person layer: what's in hand and the player's own arms. */
  readonly view: ViewLayer;
  /** Players' and creatures' figures as drawn. */
  readonly figures: ClientFigures;
  /** The HUD: the game's own layers and the platform's panels. */
  readonly hud: ClientHud;
  /** An item's definition as the server sent it. */
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
