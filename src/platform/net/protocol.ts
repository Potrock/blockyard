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
  | { t: 'menuClosed'; player: string; menu: number };
