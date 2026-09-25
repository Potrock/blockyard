import type {
  Anchor,
  AudioApi,
  FxApi,
  HudApi,
  LoopHandle,
  MarkerOptions,
  MenuEntry,
  MenuHandle,
  MenuOptions,
  RadarData,
  ScreenOptions,
  Vec3,
  ViewAnimation,
  ViewModelApi,
} from '../api/types';
import type { Content } from '../content';
import type { AnchorRef, CallbackRef, ClientMessage, PresentCall, PresentTarget, RadarWire } from '../net/protocol';

export type Sink = (call: PresentCall) => void;

class MenuProxy implements MenuHandle {
  open = true;
  cbs: number[] = [];

  constructor(
    readonly id: number,
    private hub: Presentation,
    private to: string | null,
    private opts: MenuOptions,
  ) {}

  update(o: Partial<MenuOptions>) {
    if (!this.open) return;
    this.opts = { ...this.opts, ...o };
    this.hub.release(this.cbs);
    this.cbs = [];
    this.hub.send(this.to, 'hud', 'menuUpdate', [this.id, this.hub.encodeMenu(o, this.cbs)]);
  }

  close() {
    if (!this.open) return;
    this.hub.send(this.to, 'hud', 'menuClose', [this.id]);
    this.closed();
  }

  /** Closed here or by the player: forget the callbacks and tell the game. */
  closed() {
    if (!this.open) return;
    this.open = false;
    this.hub.release(this.cbs);
    this.hub.menus.delete(this.id);
    this.opts.onClose?.();
  }
}

/**
 * The simulation's side of presentation: the game's `hud`, `fx`, `audio` and `viewModel` calls
 * become plain-data `PresentCall`s for the clients. Callbacks (menu entries, screen buttons) are
 * kept here and sent by id; definitions that carry code or pixels go to `Content`.
 */
export class Presentation {
  private nextCb = 1;
  private nextId = 1;
  private callbacks = new Map<number, () => void>();
  readonly menus = new Map<number, MenuProxy>();
  /**
   * An anchor as data: a spot as it is, or what to follow by id. The simulation (which knows its
   * props, entities and players) sets this.
   */
  anchor: (a: Anchor) => AnchorRef = (a) => {
    const v = a as Vec3;
    return { x: v.x, y: v.y, z: v.z };
  };

  constructor(
    public sink: Sink,
    readonly content: Content,
  ) {}

  /** A call for one player (`to`), or everyone (null), or everyone but `skip`. */
  send(to: string | null, target: PresentTarget, method: string, args: unknown[], skip?: string) {
    this.sink(skip ? { to, target, method, args, skip } : { to, target, method, args });
  }

  callback(fn: () => void, into: number[]): CallbackRef {
    const id = this.nextCb++;
    this.callbacks.set(id, fn);
    into.push(id);
    return { $cb: id };
  }

  release(ids: number[]) {
    for (const id of ids) this.callbacks.delete(id);
  }

  encodeMenu(o: Partial<MenuOptions>, cbs: number[]): Record<string, unknown> {
    const { onClose: _onClose, sections, ...rest } = o;
    const out: Record<string, unknown> = { ...rest };
    if (sections) {
      out.sections = sections.map((s) => ({
        ...s,
        entries: s.entries.map((e: MenuEntry) => {
          const { onSelect, ...plain } = e;
          return onSelect ? { ...plain, onSelect: this.callback(onSelect, cbs) } : plain;
        }),
      }));
    }
    return out;
  }

  /** Something a player did on their client. */
  receive(m: ClientMessage) {
    if (m.t === 'callback') this.callbacks.get(m.id)?.();
    else if (m.t === 'menuClosed') this.menus.get(m.menu)?.closed();
  }

  /** A restart: menus and screens are gone, their callbacks with them. */
  reset() {
    for (const m of [...this.menus.values()]) m.open = false;
    this.menus.clear();
    this.callbacks.clear();
  }

  hud(to: string | null): HudApi {
    const send = (method: string, ...args: unknown[]) => this.send(to, 'hud', method, args);
    return {
      banner: (title: string, subtitle?: string, opts?: { duration?: number; color?: string }) => send('banner', title, subtitle, opts),
      objective: (text: string | null) => send('objective', text),
      stat: (id: string, label: string, value: string | number | null) => send('stat', id, label, value),
      bossBar: (name: string, fraction: number, color?: string) => send('bossBar', name, fraction, color),
      hideBossBar: () => send('hideBossBar'),
      toast: (text: string) => send('toast', text),
      feed: (text, opts) => send('feed', text, opts),
      pop: (text, opts) => send('pop', text, opts),
      scoreboard: (b) =>
        send('scoreboard', b && { ...b, rows: b.rows.map((r) => ({ name: r.name, values: [...r.values], color: r.color, player: r.player?.id })) }),
      meter: (id: string, label: string, value: number | null, opts?: { color?: string; text?: string }) => send('meter', id, label, value, opts),
      marker: (id: string, at: Anchor | null, opts?: MarkerOptions) =>
        send('marker', id, at && this.anchor(at), opts?.offset ? { ...opts, offset: { x: opts.offset.x, y: opts.offset.y, z: opts.offset.z } } : opts),
      crosshair: (visible: boolean) => send('crosshair', visible),
      radar: (data: RadarData | null) => send('radar', data && this.radarWire(data)),
      progress: (fraction: number | null, opts?: { color?: string }) => send('progress', fraction, opts),
      highlight: (at: Vec3 | null, opts?: { progress?: number }) => send('highlight', at && { x: at.x, y: at.y, z: at.z }, opts),
      screen: (opts: ScreenOptions) => {
        const id = this.nextId++;
        const cbs: number[] = [];
        const buttons = opts.buttons.map(({ onClick, ...b }) => ({ ...b, onClick: this.callback(onClick, cbs) }));
        send('screen', id, { ...opts, buttons });
        return () => {
          this.release(cbs);
          send('closeScreen', id);
        };
      },
      menu: (opts: MenuOptions) => {
        const m = new MenuProxy(this.nextId++, this, to, opts);
        this.menus.set(m.id, m);
        send('menu', m.id, this.encodeMenu(opts, m.cbs));
        return m;
      },
    };
  }

  private radarWire(d: RadarData): RadarWire {
    return {
      center: this.anchor(d.center),
      heading: d.heading,
      range: d.range,
      blips: d.blips.map((b) => ('at' in b ? { at: this.anchor(b.at), color: b.color, size: b.size } : { x: b.x, z: b.z, y: b.y, color: b.color, size: b.size })),
    };
  }

  fx(to: string | null): FxApi {
    const send = (method: string, ...args: unknown[]) => this.send(to, 'fx', method, args);
    const v = (p: Vec3) => ({ x: p.x, y: p.y, z: p.z });
    return {
      burst: (at, opts) => send('burst', v(at), opts),
      shake: (strength, duration) => send('shake', strength, duration),
      flash: (color, strength, duration) => send('flash', color, strength, duration),
      shockwave: (at, radius, color) => send('shockwave', v(at), radius, color),
      damageNumber: (at, amount, opts) => send('damageNumber', v(at), amount, opts),
      fireworks: (at, count) => send('fireworks', v(at), count),
      explosion: (at, opts) => send('explosion', v(at), opts),
    };
  }

  audio(to: string | null): AudioApi {
    return {
      play: (name, opts) => this.send(to, 'audio', 'play', [name, opts && { ...opts, at: opts.at && { x: opts.at.x, y: opts.at.y, z: opts.at.z } }]),
      define: (name, voice) => this.content.defineSound(name, voice),
      loop: (name, opts): LoopHandle => {
        const id = this.nextId++;
        this.send(to, 'audio', 'loop', [id, name, opts]);
        return {
          set: (o) => this.send(to, 'audio', 'loopSet', [id, o]),
          stop: () => this.send(to, 'audio', 'loopStop', [id]),
        };
      },
    };
  }

  view(to: string): ViewModelApi {
    const hub = this;
    let visible = true;
    return {
      get visible() {
        return visible;
      },
      set visible(v: boolean) {
        visible = v;
        hub.send(to, 'view', 'visible', [v]);
      },
      setSkin: (skin, atlas) => this.send(to, 'view', 'setSkin', [skin, atlas]),
      play: (anim: string | ViewAnimation, opts) => this.send(to, 'view', 'play', [typeof anim === 'string' ? anim : this.content.inlineAnimation(anim), opts]),
      define: (name, anim) => this.content.defineAnimation(name, anim),
      kick: (strength) => this.send(to, 'view', 'kick', [strength]),
    };
  }
}
