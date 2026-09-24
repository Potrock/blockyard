import type { LoopHandle, MenuHandle } from '../api/types';
import type { Sfx } from '../audio/sfx';
import type { Effects } from '../fx/effects';
import { isCallbackRef, type ClientMessage, type PresentCall } from '../net/protocol';
import type { ViewModel } from '../render/viewmodel';
import type { GameHud } from '../ui/hudkit';

export interface PresenterParts {
  hud: GameHud;
  fx: Effects;
  sfx: Sfx;
  view: ViewModel;
  /** Messages back to the simulation (callbacks, closed menus). */
  send: (m: ClientMessage) => void;
  /** Calls for the client itself: `debris` from broken blocks, `reset` on restart. */
  client: (method: string, args: unknown[]) => void;
}

type Callable = Record<string, (...args: unknown[]) => unknown>;

/**
 * The client's side of presentation: runs the simulation's `PresentCall`s for this player on the
 * real HUD, effects, audio and first-person view, and turns callback ids back into functions
 * that message the simulation.
 */
export class Presenter {
  private screens = new Map<number, () => void>();
  private menus = new Map<number, MenuHandle>();
  private loops = new Map<number, LoopHandle>();

  constructor(
    /** The player this client shows; null while watching a server's game before joining. */
    public player: string | null,
    private parts: PresenterParts,
  ) {}

  apply(c: PresentCall) {
    if (c.to !== null && c.to !== this.player) return;
    const p = this.parts;
    const args = c.args.map((a) => this.decode(a));
    switch (c.target) {
      case 'hud':
        return this.hud(c.method, args);
      case 'fx':
        return (p.fx as unknown as Callable)[c.method](...args);
      case 'audio':
        return this.audio(c.method, args);
      case 'view':
        if (c.method === 'visible') p.view.visible = args[0] as boolean;
        else (p.view as unknown as Callable)[c.method](...args);
        return;
      case 'client':
        return p.client(c.method, args);
    }
  }

  /** A restart: the HUD was cleared, so forget its screens and menus; stop the loops. */
  reset() {
    this.screens.clear();
    this.menus.clear();
    for (const l of this.loops.values()) l.stop();
    this.loops.clear();
  }

  private hud(method: string, args: unknown[]) {
    const hud = this.parts.hud;
    switch (method) {
      case 'screen': {
        const [id, opts] = args as [number, Parameters<GameHud['screen']>[0]];
        this.screens.set(id, hud.screen(opts));
        return;
      }
      case 'closeScreen': {
        const id = args[0] as number;
        this.screens.get(id)?.();
        this.screens.delete(id);
        return;
      }
      case 'menu': {
        const [id, opts] = args as [number, Parameters<GameHud['menu']>[0]];
        this.menus.set(
          id,
          hud.menu({
            ...opts,
            onClose: () => {
              this.menus.delete(id);
              this.parts.send({ t: 'menuClosed', player: this.player ?? '', menu: id });
            },
          }),
        );
        return;
      }
      case 'menuUpdate': {
        const [id, opts] = args as [number, Parameters<MenuHandle['update']>[0]];
        this.menus.get(id)?.update(opts);
        return;
      }
      case 'menuClose':
        this.menus.get(args[0] as number)?.close();
        return;
      default:
        (hud as unknown as Callable)[method](...args);
    }
  }

  private audio(method: string, args: unknown[]) {
    const sfx = this.parts.sfx;
    switch (method) {
      case 'play':
        return sfx.play(args[0] as string, args[1] as Parameters<Sfx['play']>[1]);
      case 'loop': {
        const [id, name, opts] = args as [number, Parameters<Sfx['loop']>[0], Parameters<Sfx['loop']>[1]];
        this.loops.set(id, sfx.loop(name, opts));
        return;
      }
      case 'loopSet':
        return this.loops.get(args[0] as number)?.set(args[1] as Parameters<LoopHandle['set']>[0]);
      case 'loopStop': {
        const id = args[0] as number;
        this.loops.get(id)?.stop();
        this.loops.delete(id);
        return;
      }
    }
  }

  /** Callback refs become functions that tell the simulation. */
  private decode(v: unknown): unknown {
    if (isCallbackRef(v)) {
      const id = v.$cb;
      return () => this.parts.send({ t: 'callback', player: this.player ?? '', id });
    }
    if (Array.isArray(v)) return v.map((x) => this.decode(x));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = this.decode(x);
      return out;
    }
    return v;
  }
}
