/**
 * The simulation / client boundary.
 *
 * The simulation (world, players, entities, rules, the game's own code) runs headless and
 * describes what each player should see and hear; the client (renderer, HUD, audio, input)
 * shows it. Everything that crosses is plain data (structured-cloneable), so the two can live in
 * one page, in a worker, or on either end of a socket.
 *
 * Functions never cross: a callback in a presentation call (a menu entry, a screen button) is
 * sent as `{ $cb: id }` and the client answers with a `callback` message.
 */

import type { AtlasPixels, EntityDefinition, ItemDefinition, Vec3, ViewAnimation } from '../api/types';
import type { RecordedVoice } from '../audio/voice';
import type { BlueprintData } from '../api/blueprint';
import type { SimFrame } from '../sim/sim';
import type { WidgetWire } from '../ui/markup';

/** Where a presentation call goes on the client. */
export type PresentTarget = 'hud' | 'fx' | 'audio' | 'view' | 'client';

/** One presentation call: `target.method(...args)` on one player's client (`to`), or everyone's. */
export interface PresentCall {
  to: string | null;
  /** For everyone (`to` null) but this player (whose own screen already showed it: their shot). */
  skip?: string;
  target: PresentTarget;
  method: string;
  args: unknown[];
}

/**
 * An `Anchor` on the wire: a spot, or something to follow by id (each screen places it where it
 * draws it, every frame).
 */
export type AnchorRef = { x: number; y: number; z: number } | { $prop: number } | { $entity: number } | { $player: string };

/** `RadarData` on the wire. */
export interface RadarWire {
  center: AnchorRef;
  heading?: number;
  range: number;
  blips: (({ x: number; z: number; y?: number } | { at: AnchorRef }) & { color: string; size?: number })[];
}

/** A callback in call arguments. */
export interface CallbackRef {
  $cb: number;
}

export const isCallbackRef = (v: unknown): v is CallbackRef => typeof v === 'object' && v !== null && typeof (v as CallbackRef).$cb === 'number';

/** Client to simulation: things a player did outside the per-frame input. */
export type ClientMessage =
  /** A callback the simulation sent (a menu entry, a screen button) was triggered. */
  | { t: 'callback'; player: string; id: number }
  /** A menu was closed on the client (Esc, the close button). */
  | { t: 'menuClosed'; player: string; menu: number }
  /** Creative building: put a block in the current hotbar slot (the block picker). */
  | { t: 'creativePick'; player: string; block: number }
  /** A button in a game's widget was pressed (`data-action`, with its `data-value`). */
  | { t: 'widgetAction'; player: string; widget: string; action: string; value: string }
  /** The player closed a modal widget (Esc, B, a click outside). */
  | { t: 'widgetClosed'; player: string; widget: string };

/**
 * One player's controls for one tick. The client owns mouse look (it feels immediate), so the
 * view direction arrives here too; the simulation moves the player and runs the game with it.
 */
export interface PlayerInput {
  /** Controls reach the game (playing, mouse captured, no menu open, alive). */
  active: boolean;
  /** Keys held and keys that went down this tick (KeyboardEvent.code). */
  down: string[];
  pressed: string[];
  /** Mouse buttons held and clicked this tick (bit masks: 1 left, 2 middle, 4 right). */
  buttons: number;
  clicked: number;
  mouseX: number;
  mouseY: number;
  wheel: number;
  /**
   * A controller's left stick, when it's pushed: [right, forward], each -1..1 (length at most 1).
   * Walking goes that way, as fast as it's pushed; the arrow keys and WASD still work alongside.
   */
  move?: [number, number];
  /** Where the player is looking (radians; yaw 0 looks toward -z). */
  yaw: number;
  pitch: number;
  /**
   * The last view the simulation set (`PlayerFrame.view.seq`) that this client has taken on. Until
   * it catches up, its `yaw` / `pitch` are stale and the simulation keeps its own.
   */
  viewSeq: number;
  /**
   * Guns: the shots this client fired with these controls, each [serial, yaw, pitch, spread in
   * degrees]. The client fires at once (it knows the gun's rate and rounds); the host takes each
   * shot the gun could have fired and decides what it hit.
   */
  shots?: [number, number, number, number][];
  /** The host time (`SimFrame.t`) of what this client was showing when it made these controls: shots hit where targets were then. */
  seen?: number;
}

export const IDLE_INPUT: PlayerInput = { active: false, down: [], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: -1 };

// -------------------------------------------------------------------------------------------------
// Host and client
//
// A host runs a game's simulation on a world of its own; a client draws it. The client sends one
// `tick` per frame with the player's controls and gets back a `HostBatch`: what happened, in
// order, then the frame to draw. The same messages go to a worker in the page or, later, over a
// socket to a server.
// -------------------------------------------------------------------------------------------------

/**
 * Something the game defined for its look and sound, as data: the client's copy of `Content`.
 * Entity and item definitions arrive without their functions (behaviours and callbacks stay with
 * the simulation).
 */
export type ContentDef =
  | { kind: 'sound'; name: string; voice: RecordedVoice }
  | { kind: 'atlas'; name: string; source: AtlasPixels }
  | { kind: 'animation'; name: string; anim: ViewAnimation }
  | { kind: 'entity'; name: string; def: EntityDefinition }
  | { kind: 'item'; name: string; def: ItemDefinition }
  | { kind: 'model'; id: number; blueprint: BlueprintData; opts: { scale?: number; pivot?: Vec3 } }
  /** A glTF prop model (`props.gltf`): each client fetches the file. */
  | { kind: 'gltf'; id: number; url: string; opts: { scale?: number; animation?: string } }
  /** A HUD widget of the game's own (`hud.define`): its markup and styles; each screen checks them. */
  | { kind: 'widget'; name: string; def: WidgetWire };

/** What a host tells a client, in the order it happened. */
export type HostEvent =
  /** The game defined content (in `setup`, or later). */
  | { t: 'content'; def: ContentDef }
  /** A presentation call. */
  | { t: 'call'; call: PresentCall }
  /** Blocks changed: [x, y, z, block id]. */
  | { t: 'edits'; cells: [number, number, number, number][] }
  /**
   * Blocks were shot into (`world.carve`, guns): the little voxels taken from each, in the
   * engine's damage format (`VoxelWorld.apply_damage`). Taking them again changes nothing.
   */
  | { t: 'damage'; data: Uint8Array }
  /** Every edit this session was undone (a restart), and the damage with it. */
  | { t: 'revert' }
  /** Set up and placed: play can begin. */
  | { t: 'ready' }
  /** The game called `exit()`: for the client whose action it answered, or everyone. */
  | { t: 'exit'; client?: string }
  /** The answer to a request (`exec`, `complete`), for the client who asked. */
  | { t: 'reply'; id: number; value: unknown; client?: string }
  /** This client is in the game now, as this player (a server's client, after `start`). */
  | { t: 'joined'; player: string; client: string }
  /** The game threw (the host carries on). */
  | { t: 'error'; text: string };

export interface HostBatch {
  events: HostEvent[];
  /** After a tick: the state to draw. */
  frame: SimFrame | null;
}

/** What a client tells its host. */
export type ClientCommand =
  /** Advance the simulation `dt` seconds with this player's controls (idle without); `running` once play began. */
  | { t: 'tick'; dt: number; running: boolean; input?: PlayerInput }
  /**
   * A server's client: the player's controls now (the server keeps its own clock). A client that
   * predicts its own movement numbers each input (`seq`) and says how long it lasted (`dt`): the
   * server moves the player once per input, the way the client did, and reports the last applied.
   */
  | { t: 'input'; input: PlayerInput; seq?: number; dt?: number }
  | { t: 'message'; msg: ClientMessage }
  /**
   * Play begins (the title screen was clicked). On a server, a client that was watching joins the
   * game here, as `name`.
   */
  | { t: 'start'; name?: string }
  | { t: 'restart' }
  /** Time of day (the pause menu, `[` `]`), and the day length (settings). */
  | { t: 'env'; time?: number; dayLength?: number }
  /** How many columns around the player the host keeps (the client's view distance). */
  | { t: 'radius'; columns: number }
  /** Requests answered with a `reply`: run a typed command, complete one. */
  | { t: 'exec'; id: number; line: string }
  | { t: 'complete'; id: number; line: string };

/** A saved world, handed to the host at start. */
export interface SaveState {
  edits: Uint8Array;
  /** The game's own blocks' keys in id order when it was saved: the edits are translated by name. */
  blocks?: string[];
  player: [number, number, number, number, number];
  flying: boolean;
  time: number;
}

/** Starting a host in a worker: the first message it gets. */
export interface HostInit {
  t: 'init';
  /** The compiled engine, shared with the page. */
  module: WebAssembly.Module;
  game: string;
  seed: number;
  save: SaveState | null;
  cheats: boolean;
  radius: number;
  dayLength: number | null;
  /** What the game kept in `game.store` on this device. */
  store: Record<string, unknown>;
}

/** A room a player started of their own: its code, in its address (`wss://host/bedwars/k3x9f2`). */
export const ROOM_CODE = /^[a-z0-9]{4,24}$/;

/** A new room's code: eight letters and digits, hard to guess. */
export function newRoomCode(): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => abc[b % abc.length]).join('');
}

/** A server's first message to a client: which game, which world, and who they are in it. */
export interface ServerWelcome {
  t: 'welcome';
  game: string;
  /** `public`, or the code of a room a player started of their own (`?room=`). */
  room: string;
  seed: number;
  /** Null: watching until the client sends `start` (then `joined` names the player). */
  player: string | null;
  /** Where players start: where a watching client's camera looks on. */
  spawn: { x: number; y: number; z: number; yaw: number };
  /** Steps per second. */
  tickRate: number;
  /**
   * The game's own blocks' keys in id order (from the first game block id): the client gives the
   * blocks it defines the same ids, so edits and structures agree even if its copy of the game
   * differs (an older version: a block it hasn't got shows as "missing").
   */
  blocks?: string[];
}

/** A batch from a server, stamped with the host's clock (seconds) for smooth playback. */
export interface TimedBatch extends HostBatch {
  time: number;
}

/**
 * A batch as a server sends it: the frame as a patch on the one before (`net/delta`), not whole.
 * A `FrameReader` turns it back into a `TimedBatch`.
 */
export interface WireBatch {
  events: HostEvent[];
  /** The frame's patch (absent: no frame this batch). */
  f?: unknown;
  time: number;
}
