import { h } from './dom';
import type { Settings, ShadowQuality } from '../settings';
import type { Registry } from '../world/registry';

/** Playing on a game server: the home page asks for a name, and says who's on. */
export interface OnlineOptions {
  /** The server (`wss://host`), to ask how many are playing each game. */
  server: string;
  /** The game on show. */
  game: string;
}

interface GameEntry {
  id: string;
  title: string;
  tagline?: string;
  accent?: string;
}

/** Blockyard's mark: a grass block, drawn isometric. */
const MARK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="#6fd35c" d="M8 1l6 3.5L8 8 2 4.5z"/><path fill="#7a5530" d="M2 4.5L8 8v7l-6-3.5z"/><path fill="#9b6c3e" d="M14 4.5L8 8v7l6-3.5z"/><path fill="#57b247" d="M2 4.5L8 8v1.6L2 6.1z"/><path fill="#62c051" d="M14 4.5L8 8v1.6l6-3.5z"/></svg>';

/** What the home page shows for one game (and does when played or another game is picked). */
export interface HomeGame {
  current: string;
  /** Its name (for a game not in the list: a development preview). */
  title?: string;
  onPlay: () => void;
  onPick: (id: string) => void;
  controls?: [string, string][];
  walks?: boolean;
  online?: OnlineOptions | null;
}

/**
 * The home page, shown while the world loads and until the player clicks Play: Blockyard's name,
 * the games (with how many are playing each, online), a name to play under (online), and one
 * button that fills as the world loads and then starts the game. The world itself (the game's
 * spawn, slowly circling) is the backdrop. It outlives a game: picking another one switches in
 * place (`select`, then `show` for the new game), with the page staying put.
 */
export class TitleScreen {
  readonly root: HTMLElement;
  private nameInput: HTMLInputElement | null = null;
  private list: HTMLElement;
  private start: HTMLElement;
  private fill: HTMLElement;
  private label: HTMLElement;
  private button: HTMLButtonElement;
  private status: HTMLElement;
  private counts = new Map<string, HTMLElement>();
  private ready = false;
  private title = 'the game';
  private poll = 0;
  private game: HomeGame | null = null;

  constructor(
    parent: HTMLElement,
    private games: GameEntry[],
  ) {
    const mark = h('span.home-mark');
    mark.innerHTML = MARK;
    this.list = h('nav.home-games');
    this.fill = h('span.home-play-fill');
    this.label = h('span.home-play-label', {}, 'Starting the engine…');
    this.button = h('button.btn.play.home-play', { disabled: true, onclick: () => this.ready && this.game?.onPlay() }, this.fill, this.label) as HTMLButtonElement;
    this.status = h('div.home-status', {}, '');
    this.start = h('section.home-start');
    this.root = h(
      'div.screen.title-screen.home',
      {},
      h(
        'div.home-panel',
        {},
        h('header.home-brand', {}, mark, h('div', {}, h('h1.home-logo', {}, 'Blockyard'), h('p.home-pitch', {}, 'Block games anyone can build, played together.'))),
        this.list,
        this.start,
      ),
    );
    parent.append(this.root);
  }

  /** Show the page for a game: it's the selected one, loading until `setReady`. */
  show(g: HomeGame) {
    this.game = g;
    const entry = this.games.find((x) => x.id === g.current);
    this.title = entry?.title ?? g.title ?? 'the game';
    this.root.style.setProperty('--game', entry?.accent ?? '#7fd46b');
    this.root.classList.remove('hidden', 'ready');
    this.ready = false;
    this.renderList(g.current);
    // The name box keeps what's typed across games.
    const typed = this.nameInput?.value;
    this.nameInput = null;
    let name: HTMLElement | null = null;
    if (g.online) {
      this.nameInput = this.makeName(typed);
      this.nameInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && this.ready) this.game?.onPlay();
      });
      name = h('label.home-name', {}, h('span', {}, 'Your name'), this.nameInput);
    }
    const walks = g.walks ?? true;
    const controls = g.controls ?? [['LMB', 'break'], ['RMB', 'place'], ['E', 'blocks']];
    this.start.replaceChildren(
      ...[name, this.button, this.status].filter((x): x is HTMLElement => !!x),
      h(
        'div.home-controls',
        {},
        ...(walks ? [h('span', {}, h('kbd', {}, 'WASD'), ' move'), h('span', {}, h('kbd', {}, 'Space'), ' jump')] : []),
        ...controls.map(([k, v]) => h('span', {}, h('kbd', {}, k), ` ${v}`)),
        h('span', {}, h('kbd', {}, '/'), ' commands'),
      ),
    );
    this.loading(`Loading ${this.title}…`);
    this.status.textContent = '';
    window.clearInterval(this.poll);
    if (g.online) this.watchCounts(g.online);
  }

  /** Picked another game: show it chosen at once, while the switch happens behind. */
  select(id: string) {
    const entry = this.games.find((x) => x.id === id);
    this.root.style.setProperty('--game', entry?.accent ?? '#7fd46b');
    this.root.classList.remove('hidden', 'ready');
    this.ready = false;
    this.renderList(id);
    this.loading(`Loading ${entry?.title ?? 'the game'}…`);
    this.status.textContent = '';
  }

  private renderList(current: string) {
    this.counts.clear();
    if (this.games.length < 2) return this.list.replaceChildren();
    this.list.replaceChildren(
      ...this.games.map((x) => {
        const count = h('span.home-game-live', {}, '');
        this.counts.set(x.id, count);
        return h(
          `button.home-game${x.id === current ? '.current' : ''}`,
          { style: `--game: ${x.accent ?? '#7fd46b'}`, onclick: () => x.id !== this.game?.current && this.game?.onPick(x.id), 'aria-current': x.id === current ? 'true' : undefined },
          h('span.home-game-name', {}, x.title),
          x.tagline ? h('span.home-game-tag', {}, x.tagline) : null,
          count,
        );
      }),
    );
  }

  private loading(text: string) {
    this.button.disabled = true;
    this.fill.style.width = '0%';
    this.label.textContent = text;
  }

  /** How many are playing each game (online), kept fresh while the page is up. */
  private watchCounts(online: OnlineOptions) {
    const http = online.server.replace(/^ws/, 'http').replace(/\/+$/, '');
    const load = () =>
      fetch(`${http}/games`)
        .then((r) => r.json() as Promise<{ games: { id: string; players: number }[] }>)
        .then(({ games }) => {
          for (const g of games) {
            const el = this.counts.get(g.id);
            if (!el) continue;
            el.textContent = g.players ? `${g.players} playing` : '';
            el.classList.toggle('on', g.players > 0);
          }
          const here = games.find((g) => g.id === online.game)?.players ?? 0;
          this.status.textContent = here ? `${here} ${here === 1 ? 'player' : 'players'} in this game now` : 'Nobody in this game yet: you could be first';
        })
        .catch(() => {});
    void load();
    this.poll = window.setInterval(load, 5000);
  }

  private makeName(typed?: string): HTMLInputElement {
    let saved = typed ?? '';
    if (typed === undefined) {
      try {
        saved = localStorage.getItem('voxel.name') ?? '';
      } catch {
        // no storage: no remembered name
      }
    }
    return h('input.home-name-input', { type: 'text', maxlength: '20', placeholder: 'Pick a name', value: saved, spellcheck: false, autocomplete: 'nickname' }) as HTMLInputElement;
  }

  /** The name typed (remembered for next time), online. */
  name(): string {
    const n = (this.nameInput?.value ?? '').trim().slice(0, 20) || 'Player';
    try {
      localStorage.setItem('voxel.name', n);
    } catch {
      // not remembered
    }
    return n;
  }

  progress(fraction: number, text: string) {
    if (this.ready) return;
    this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    this.label.textContent = text;
  }

  setReady() {
    if (this.ready) return;
    this.ready = true;
    this.button.disabled = false;
    this.fill.style.width = '100%';
    this.label.textContent = `Play ${this.title}`;
    this.root.classList.add('ready');
  }

  /** The game couldn't start (say, its server is down): say so; another can still be picked. */
  failed(text: string, onPick: (id: string) => void) {
    this.game = { current: this.game?.current ?? '', onPlay: () => {}, onPick };
    this.label.textContent = `Couldn't load ${this.title}`;
    this.status.textContent = text;
  }

  /** Playing: the page fades away (it comes back with `show`). */
  hide() {
    window.clearInterval(this.poll);
    this.root.classList.add('hidden');
  }
}

type Change = (s: Settings) => void;

/** Pause menu with graphics / control settings. */
export class PauseMenu {
  readonly root: HTMLElement;
  private settings: Settings;
  private timeSlider!: HTMLInputElement;
  onTime: ((t: number) => void) | null = null;
  onNewWorld: ((seed: number | null) => void) | null = null;
  onRestart: (() => void) | null = null;
  onExit: (() => void) | null = null;

  constructor(parent: HTMLElement, settings: Settings, private onChange: Change, onResume: () => void) {
    this.settings = { ...settings };
    const s = this.settings;
    const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
      s[k] = v;
      this.onChange({ ...s });
    };

    const slider = (label: string, key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string) => {
      const val = h('span.value', {}, fmt(s[key] as number));
      const input = h('input', { type: 'range', min, max, step, value: String(s[key]) }) as HTMLInputElement;
      input.addEventListener('input', () => {
        const v = Number(input.value);
        val.textContent = fmt(v);
        set(key, v as never);
      });
      return h('label.row', {}, h('span.name', {}, label), input, val);
    };
    const toggle = (label: string, key: keyof Settings) => {
      const input = h('input', { type: 'checkbox', checked: Boolean(s[key]) }) as HTMLInputElement;
      input.addEventListener('change', () => set(key, input.checked as never));
      return h('label.toggle', {}, input, h('span.switch'), h('span', {}, label));
    };
    const shadowOpts: ShadowQuality[] = ['off', 'low', 'medium', 'high', 'ultra'];
    const seg = h('div.segmented');
    for (const q of shadowOpts) {
      const b = h('button', { class: s.shadows === q ? 'on' : '', onclick: () => {
        seg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        set('shadows', q);
      } }, q);
      seg.append(b);
    }

    this.timeSlider = h('input', { type: 'range', min: 0, max: 1, step: 0.001, value: '0.3' }) as HTMLInputElement;
    this.timeSlider.addEventListener('input', () => this.onTime?.(Number(this.timeSlider.value)));
    const seedInput = h('input.seed-input', { type: 'text', placeholder: 'seed (blank = random)' }) as HTMLInputElement;

    this.root = h(
      'div.screen.pause-screen.hidden',
      {},
      h(
        'div.panel',
        {},
        h(
          'div.panel-head',
          {},
          h('h2', {}, 'Paused'),
          h(
            'div.head-buttons',
            {},
            h('button.btn', { onclick: () => this.onExit?.() }, 'Switch game'),
            h('button.btn', { onclick: () => this.onRestart?.() }, 'Restart'),
            h('button.btn.primary', { onclick: onResume }, 'Resume'),
          ),
        ),
        h(
          'div.cols',
          {},
          h(
            'section',
            {},
            h('h3', {}, 'World'),
            slider('Render distance', 'renderDistance', 4, 24, 1, (v) => `${v} chunks`),
            slider('Day length', 'dayMinutes', 2, 60, 1, (v) => `${v} min`),
            h('label.row', {}, h('span.name', {}, 'Time of day'), this.timeSlider, h('span.value', {}, '')),
            h('h3', {}, 'Camera'),
            slider('Field of view', 'fov', 55, 110, 1, (v) => `${v}°`),
            slider('Mouse sensitivity', 'sensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2)),
            toggle('View bobbing', 'viewBobbing'),
          ),
          h(
            'section',
            {},
            h('h3', {}, 'Graphics'),
            h('div.row', {}, h('span.name', {}, 'Shadows'), seg),
            slider('Resolution', 'renderScale', 0.4, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
            h(
              'div.toggles',
              {},
              toggle('Anti-aliasing (MSAA)', 'msaa'),
              toggle('Bloom', 'bloom'),
              toggle('God rays', 'godrays'),
              toggle('Water reflections', 'ssr'),
              toggle('Clouds', 'clouds'),
              toggle('Cave culling', 'occlusion'),
            ),
          ),
        ),
        h(
          'div.panel-foot',
          {},
          h(
            'div.keys',
            {},
            'WASD move · Space jump / fly up · Shift sneak / fly down · Ctrl or double-tap W sprint · F fly · 1-9 / wheel select · MMB pick · E blocks · F1 hide HUD · F3 debug · [ ] time',
          ),
          h('div.new-world', {}, seedInput, h('button.btn', { onclick: () => {
            const v = seedInput.value.trim();
            const n = v === '' ? null : Number.isFinite(Number(v)) ? Number(v) >>> 0 : hashString(v);
            this.onNewWorld?.(n);
          } }, 'New world')),
        ),
      ),
    );
    parent.append(this.root);
  }

  show(time: number) {
    this.timeSlider.value = String(time);
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Creative block picker. */
export class Inventory {
  readonly root: HTMLElement;
  onPick: ((id: number) => void) | null = null;

  constructor(parent: HTMLElement, registry: Registry, icons: Map<number, string>, onClose: () => void) {
    const grid = h('div.inv-grid');
    for (const b of registry.blocks) {
      if (!b.placeable) continue;
      const cell = h('button.inv-cell', { title: b.label, onclick: () => this.onPick?.(b.id) }, h('img', { src: icons.get(b.id) ?? '', alt: b.label, draggable: false }));
      grid.append(cell);
    }
    this.root = h(
      'div.screen.inventory-screen.hidden',
      { onclick: (e: Event) => e.target === this.root && onClose() },
      h('div.panel.inv-panel', {}, h('div.panel-head', {}, h('h2', {}, 'Blocks'), h('span.hint', {}, 'Click a block to put it in the selected hotbar slot')), grid),
    );
    parent.append(this.root);
  }

  show() {
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }
}
