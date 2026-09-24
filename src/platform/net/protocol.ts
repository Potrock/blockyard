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

/** Where a presentation call goes on the client. */
export type PresentTarget = 'hud' | 'fx' | 'audio' | 'view' | 'client';

/** One presentation call: `target.method(...args)` on one player's client (`to`), or everyone's. */
export interface PresentCall {
  to: string | null;
  target: PresentTarget;
  method: string;
  args: unknown[];
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
  | { t: 'creativePick'; player: string; block: number };

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
  /** Where the player is looking (radians; yaw 0 looks toward -z). */
  yaw: number;
  pitch: number;
  /**
   * The last view the simulation set (`PlayerFrame.view.seq`) that this client has taken on. Until
   * it catches up, its `yaw` / `pitch` are stale and the simulation keeps its own.
   */
  viewSeq: number;
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
  | { kind: 'model'; id: number; blueprint: BlueprintData; opts: { scale?: number; pivot?: Vec3 } };

/** What a host tells a client, in the order it happened. */
export type HostEvent =
  /** The game defined content (in `setup`, or later). */
  | { t: 'content'; def: ContentDef }
  /** A presentation call. */
  | { t: 'call'; call: PresentCall }
  /** Blocks changed: [x, y, z, block id]. */
  | { t: 'edits'; cells: [number, number, number, number][] }
  /** Every edit this session was undone (a restart). */
  | { t: 'revert' }
  /** Set up and placed: play can begin. */
  | { t: 'ready' }
  /** The game called `exit()`. */
  | { t: 'exit' }
  /** The answer to a request (`exec`, `complete`), for the player who asked. */
  | { t: 'reply'; id: number; value: unknown; player?: string }
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
  /** A server's client: the player's controls now (the server keeps its own clock). */
  | { t: 'input'; input: PlayerInput }
  | { t: 'message'; msg: ClientMessage }
  /** Play begins (the title screen was clicked). */
  | { t: 'start' }
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
}
