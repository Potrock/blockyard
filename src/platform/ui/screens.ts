import { h } from './dom';
import type { Settings, ShadowQuality } from '../settings';
import type { Registry } from '../world/registry';

/** Title / loading screen shown until the spawn area is ready and the player clicks. */
/** Playing on a game server, from the title screen. */
export interface OnlineOptions {
  /** This build's game server (`wss://…`), if it has one. */
  server: string | null;
  /** The game on show (to ask the server whether it hosts it). */
  game: string;
  /** Already on a server: as whom. */
  joined: { name: string } | null;
  /** Join the game on the server as `name`. */
  join(name: string): void;
  /** Back to playing alone. */
  leave(): void;
}

/** The online row: a name and "Play online" (with how many are playing), or who you are online. */
function onlineRow(o: OnlineOptions): HTMLElement | null {
  if (o.joined) {
    const off = h('a.online-leave', { href: '#', onclick: (e: Event) => (e.preventDefault(), o.leave()) }, 'Play offline');
    return h('div.online', {}, h('span.online-dot', {}), h('span', {}, 'Online as '), h('b', {}, o.joined.name), h('span', {}, ' · '), off);
  }
  if (!o.server) return null;
  let saved = '';
  try {
    saved = localStorage.getItem('voxel.name') ?? '';
  } catch {
    // no storage: no remembered name
  }
  const name = h('input.online-name', { type: 'text', maxlength: '20', placeholder: 'Your name', value: saved, spellcheck: false }) as HTMLInputElement;
  const count = h('span.online-count', {}, '');
  const go = () => {
    const n = name.value.trim().slice(0, 20) || 'Player';
    try {
      localStorage.setItem('voxel.name', n);
    } catch {
      // not remembered
    }
    o.join(n);
  };
  name.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') go();
  });
  const row = h('div.online', { style: 'display: none' }, name, h('button.btn.online-play', { onclick: go }, 'Play online', count));
  // Show it once the server says it hosts this game (and how many are in it).
  const http = o.server.replace(/^ws/, 'http').replace(/\/+$/, '');
  fetch(`${http}/games`)
    .then((r) => r.json() as Promise<{ games: { id: string; players: number }[] }>)
    .then(({ games }) => {
      const g = games.find((x) => x.id === o.game);
      if (!g) return;
      row.style.display = '';
      count.textContent = g.players ? ` · ${g.players} playing` : '';
    })
    .catch(() => {});
  return row;
}

export class TitleScreen {
  readonly root: HTMLElement;
  private bar: HTMLElement;
  private label: HTMLElement;
  private button: HTMLButtonElement;
  private ready = false;

  constructor(
    parent: HTMLElement,
    seed: number,
    onPlay: () => void,
    games: { id: string; title: string; tagline?: string; accent?: string }[] = [],
    current = '',
    onPick: (id: string) => void = () => {},
    controls: [string, string][] = [['LMB', 'break'], ['RMB', 'place'], ['E', 'blocks']],
    walks = true,
    online: OnlineOptions | null = null,
  ) {
    this.bar = h('div.progress-fill');
    const cards = games.length > 1
      ? h(
          'div.game-cards',
          {},
          ...games.map((g) =>
            h(
              `button.game-card${g.id === current ? '.current' : ''}`,
              { style: `--accent: ${g.accent ?? '#7fd46b'}`, onclick: () => g.id !== current && onPick(g.id) },
              h('div.game-card-title', {}, g.title),
              g.tagline ? h('div.game-card-tag', {}, g.tagline) : null,
            ),
          ),
        )
      : null;
    this.label = h('div.progress-label', {}, 'Compiling engine…');
    this.button = h('button.btn.primary.play', { disabled: true, onclick: () => this.ready && onPlay() }, 'Generating world…') as HTMLButtonElement;
    this.root = h(
      'div.screen.title-screen',
      {},
      h(
        'div.title-card',
        {},
        h('h1.logo', {}, 'VOXEL'),
        h('div.tagline', {}, 'Rust + WebAssembly engine · three.js renderer'),
        cards,
        h('div.progress', {}, this.bar),
        this.label,
        this.button,
        online ? onlineRow(online) : null,
        h(
          'div.controls-hint',
          {},
          ...(walks ? [h('span', {}, h('kbd', {}, 'WASD'), ' move'), h('span', {}, h('kbd', {}, 'Space'), ' jump')] : []),
          ...controls.map(([k, v]) => h('span', {}, h('kbd', {}, k), ` ${v}`)),
          h('span', {}, h('kbd', {}, '/'), ' commands'),
          h('span', {}, h('kbd', {}, 'F3'), ' debug'),
        ),
        h('div.seed', {}, `Seed ${seed}`),
      ),
    );
    parent.append(this.root);
  }

  progress(fraction: number, text: string) {
    this.bar.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    this.label.textContent = text;
  }

  setReady() {
    if (this.ready) return;
    this.ready = true;
    this.button.disabled = false;
    this.button.textContent = 'Click to play';
    this.root.classList.add('ready');
  }

  hide() {
    this.root.classList.add('hidden');
    window.setTimeout(() => this.root.remove(), 600);
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
