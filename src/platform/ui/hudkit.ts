import * as THREE from 'three';
import { h } from './dom';
import type { HudApi, IconRef, MarkerOptions, MenuEntry, MenuHandle, MenuOptions, RadarData, ScreenOptions, Vec3 } from '../api/types';

interface Marker {
  el: HTMLElement;
  label: HTMLElement;
  pos: THREE.Vector3;
  opts: MarkerOptions;
}

interface FloatingNumber {
  el: HTMLElement;
  pos: THREE.Vector3;
  age: number;
  vy: number;
}

/** Game-facing HUD widgets layered over the base HUD. */
export class GameHud implements HudApi {
  readonly root: HTMLElement;
  private hearts: HTMLElement;
  private heartEls: HTMLElement[] = [];
  private bannerEl: HTMLElement;
  private bannerTimer = 0;
  private objectiveEl: HTMLElement;
  private statsEl: HTMLElement;
  private statEls = new Map<string, HTMLElement>();
  private boss: HTMLElement;
  private bossFill: HTMLElement;
  private bossName: HTMLElement;
  private toastEl: HTMLElement;
  private toastTimer = 0;
  private flashEl: HTMLElement;
  private hitEl: HTMLElement;
  private numbers: FloatingNumber[] = [];
  private tmp = new THREE.Vector3();
  private lastHealth = -1;
  private lastMax = -1;
  /** Called when a modal screen opens / closes (the runtime releases / re-grabs the mouse). */
  onScreen: ((open: boolean) => void) | null = null;
  /** Shows / hides the base HUD's crosshair. */
  onCrosshair: ((visible: boolean) => void) | null = null;
  private metersEl: HTMLElement;
  private feedEl: HTMLElement;
  private progressEl: HTMLElement;
  private meterEls = new Map<string, HTMLElement>();
  private markersEl: HTMLElement;
  private markers = new Map<string, Marker>();
  private radarCanvas: HTMLCanvasElement;
  private screens: HTMLElement[] = [];
  /** An open menu's key listener, removed when it closes, however it closes. */
  private unhooks = new Map<HTMLElement, () => void>();

  constructor(parent: HTMLElement, private iconFor: (ref: IconRef) => string) {
    this.hearts = h('div.hearts');
    this.bannerEl = h('div.banner');
    this.objectiveEl = h('div.objective');
    this.statsEl = h('div.stats');
    this.bossName = h('div.boss-name');
    this.bossFill = h('div.boss-fill');
    this.boss = h('div.bossbar', {}, this.bossName, h('div.boss-track', {}, this.bossFill));
    this.toastEl = h('div.game-toast');
    this.flashEl = h('div.screen-flash');
    this.hitEl = h('div.hitmarker');
    this.metersEl = h('div.meters');
    this.feedEl = h('div.feed');
    this.progressEl = h('div.progress-ring');
    this.markersEl = h('div.markers');
    this.radarCanvas = h('canvas.radar', { width: 150, height: 150 }) as HTMLCanvasElement;
    this.radarCanvas.style.display = 'none';
    this.root = h(
      'div.gamehud',
      {},
      this.flashEl,
      this.markersEl,
      this.hitEl,
      this.hearts,
      this.bannerEl,
      this.objectiveEl,
      this.statsEl,
      this.boss,
      this.toastEl,
      this.feedEl,
      this.progressEl,
      this.metersEl,
      this.radarCanvas,
    );
    parent.append(this.root);
    this.boss.style.display = 'none';
  }

  setVisible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
  }

  /** Hearts: health in half-hearts. Hidden when max is 0 (damage disabled). */
  setHealth(health: number, max: number) {
    const hp = Math.max(0, Math.ceil(health));
    if (hp === this.lastHealth && max === this.lastMax) return;
    const damaged = hp < this.lastHealth;
    this.lastHealth = hp;
    if (max > 40) {
      // Too many hearts to draw: compact counter.
      this.lastMax = max;
      this.heartEls = [];
      this.hearts.replaceChildren(h('span.heart.full'), h('span.heart-count', {}, `${hp} / ${max}`));
      this.hearts.style.display = '';
      return;
    }
    if (max !== this.lastMax) {
      this.lastMax = max;
      this.hearts.replaceChildren();
      this.heartEls = [];
      for (let i = 0; i < Math.ceil(max / 2); i++) {
        const el = h('span.heart');
        this.heartEls.push(el);
        this.hearts.append(el);
      }
      this.hearts.style.display = max > 0 ? '' : 'none';
    }
    this.heartEls.forEach((el, i) => {
      const v = hp - i * 2;
      el.className = `heart ${v >= 2 ? 'full' : v === 1 ? 'half' : 'empty'}`;
    });
    this.hearts.classList.toggle('low', hp <= 6 && max > 0);
    if (damaged) {
      this.hearts.classList.remove('shake');
      void this.hearts.offsetWidth;
      this.hearts.classList.add('shake');
    }
  }

  banner(title: string, subtitle?: string, opts: { duration?: number; color?: string } = {}) {
    this.bannerEl.replaceChildren(h('div.banner-title', { style: opts.color ? { color: opts.color } : {} }, title));
    if (subtitle) this.bannerEl.append(h('div.banner-sub', {}, subtitle));
    this.bannerEl.classList.remove('show');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('show');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove('show'), (opts.duration ?? 2.2) * 1000);
  }

  objective(text: string | null) {
    this.objectiveEl.textContent = text ?? '';
    this.objectiveEl.style.display = text ? '' : 'none';
  }

  stat(id: string, label: string, value: string | number | null) {
    let el = this.statEls.get(id);
    if (value === null) {
      el?.remove();
      this.statEls.delete(id);
      return;
    }
    if (!el) {
      el = h('div.stat', {}, h('span.stat-label'), h('span.stat-value'));
      this.statEls.set(id, el);
      this.statsEl.append(el);
    }
    (el.firstChild as HTMLElement).textContent = label;
    (el.lastChild as HTMLElement).textContent = String(value);
  }

  bossBar(name: string, fraction: number, color?: string) {
    this.boss.style.display = '';
    this.bossName.textContent = name;
    this.bossFill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    if (color) this.bossFill.style.background = color;
  }

  hideBossBar() {
    this.boss.style.display = 'none';
  }

  meter(id: string, label: string, value: number | null, opts: { color?: string; text?: string } = {}) {
    let el = this.meterEls.get(id);
    if (value === null) {
      el?.remove();
      this.meterEls.delete(id);
      return;
    }
    if (!el) {
      el = h('div.meter', {}, h('span.meter-label'), h('div.meter-track', {}, h('div.meter-fill')), h('span.meter-text'));
      this.meterEls.set(id, el);
      this.metersEl.append(el);
    }
    const [lab, track, text] = el.children as unknown as HTMLElement[];
    lab.textContent = label;
    const fill = track.firstElementChild as HTMLElement;
    fill.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`;
    if (opts.color) fill.style.background = opts.color;
    text.textContent = opts.text ?? '';
    el.classList.toggle('low', value < 0.25);
  }

  marker(id: string, at: Vec3 | null, opts: MarkerOptions = {}) {
    let m = this.markers.get(id);
    if (!at) {
      m?.el.remove();
      this.markers.delete(id);
      return;
    }
    if (!m) {
      const label = h('span.marker-label');
      const el = h('div.marker', {}, h('div.marker-shape'), label);
      this.markersEl.append(el);
      m = { el, label, pos: new THREE.Vector3(), opts };
      this.markers.set(id, m);
    }
    m.pos.set(at.x, at.y, at.z);
    m.opts = opts;
    m.el.className = `marker ${opts.shape ?? 'box'}${opts.pulse ? ' pulse' : ''}`;
    m.el.style.setProperty('--c', opts.color ?? '#ff5a4f');
    m.label.textContent = opts.label ?? '';
  }

  crosshair(visible: boolean) {
    this.onCrosshair?.(visible);
  }

  radar(data: RadarData | null) {
    this.radarCanvas.style.display = data ? '' : 'none';
    if (data) this.drawRadar(data);
  }

  private drawRadar(d: RadarData) {
    const c = this.radarCanvas.getContext('2d');
    if (!c) return;
    const W = this.radarCanvas.width;
    const R = W / 2 - 4;
    c.clearRect(0, 0, W, W);
    c.save();
    c.translate(W / 2, W / 2);
    c.beginPath();
    c.arc(0, 0, R, 0, Math.PI * 2);
    c.fillStyle = 'rgba(6, 14, 20, 0.62)';
    c.fill();
    c.strokeStyle = 'rgba(140, 220, 255, 0.35)';
    c.lineWidth = 1.5;
    c.stroke();
    c.strokeStyle = 'rgba(140, 220, 255, 0.14)';
    for (const f of [0.33, 0.66]) {
      c.beginPath();
      c.arc(0, 0, R * f, 0, Math.PI * 2);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(0, -R);
    c.lineTo(0, R);
    c.moveTo(-R, 0);
    c.lineTo(R, 0);
    c.stroke();
    // Blips, rotated so the heading points up.
    const sin = Math.sin(d.heading);
    const cos = Math.cos(d.heading);
    const k = R / d.range;
    for (const b of d.blips) {
      const dx = b.x - d.center.x;
      const dz = b.z - d.center.z;
      const right = dx * cos - dz * sin;
      const ahead = -dx * sin - dz * cos;
      let x = right * k;
      let y = -ahead * k;
      const len = Math.hypot(x, y);
      const out = len > R - 3;
      if (out) {
        x *= (R - 3) / len;
        y *= (R - 3) / len;
      }
      const s = (b.size ?? 3) * (out ? 0.7 : 1);
      c.fillStyle = b.color;
      c.globalAlpha = out ? 0.6 : 1;
      c.fillRect(x - s / 2, y - s / 2, s, s);
      if (b.y !== undefined && !out) {
        // Above / below: a tick.
        const dy = b.y - d.center.y;
        if (Math.abs(dy) > 8) c.fillRect(x - 0.5, dy > 0 ? y - s / 2 - 4 : y + s / 2, 1, 4);
      }
    }
    c.globalAlpha = 1;
    // You: an arrow at the centre.
    c.fillStyle = '#e8f6ff';
    c.beginPath();
    c.moveTo(0, -6);
    c.lineTo(4, 5);
    c.lineTo(0, 3);
    c.lineTo(-4, 5);
    c.closePath();
    c.fill();
    c.restore();
  }

  /** Project markers; off-screen ones with `edge` ride the screen edge as arrows. */
  private placeMarkers(camera: THREE.Camera, width: number, height: number) {
    const cam = camera as THREE.PerspectiveCamera;
    const focal = height / 2 / Math.tan(((cam.fov ?? 70) * Math.PI) / 360);
    for (const m of this.markers.values()) {
      const v = this.tmp.copy(m.pos).applyMatrix4(camera.matrixWorldInverse);
      const dist = v.length();
      const behind = v.z > -0.1;
      this.tmp.copy(m.pos).project(camera);
      let x = this.tmp.x;
      let y = this.tmp.y;
      if (behind) {
        x = -x;
        y = -y;
      }
      const off = behind || Math.abs(x) > 1 || Math.abs(y) > 1;
      const size = m.opts.size ?? 26;
      let px = typeof size === 'number' ? size : Math.max(size.min ?? 18, Math.min(size.max ?? 160, (size.world / Math.max(1, dist)) * focal));
      if (off) {
        if (!m.opts.edge) {
          m.el.style.display = 'none';
          continue;
        }
        // Push the direction out to an inset rectangle.
        const s = 1 / Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.88, 1e-4);
        x *= s;
        y *= s;
        px = 22;
      }
      m.el.style.display = '';
      m.el.classList.toggle('offscreen', off);
      const sx = (x * 0.5 + 0.5) * width;
      const sy = (-y * 0.5 + 0.5) * height;
      m.el.style.transform = `translate(${sx}px, ${sy}px)`;
      m.el.style.setProperty('--s', `${px}px`);
      m.el.style.setProperty('--a', `${Math.atan2(-y, x)}rad`);
    }
  }

  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1800);
  }

  feed(text: string, opts: { color?: string } = {}) {
    const line = h('div.feed-line', {}, text);
    if (opts.color) line.style.color = opts.color;
    this.feedEl.append(line);
    while (this.feedEl.childElementCount > 6) this.feedEl.firstElementChild!.remove();
    window.setTimeout(() => line.classList.add('fade'), 6000);
    window.setTimeout(() => line.remove(), 6600);
  }

  /** Set by the runtime: draws `highlight` in the world. */
  onHighlight: ((at: Vec3 | null, progress?: number) => void) | null = null;

  highlight(at: Vec3 | null, opts: { progress?: number } = {}) {
    this.onHighlight?.(at, opts.progress);
  }

  progress(fraction: number | null, opts: { color?: string } = {}) {
    const el = this.progressEl;
    el.style.display = fraction === null ? 'none' : 'block';
    if (fraction === null) return;
    el.style.setProperty('--p', `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`);
    if (opts.color) el.style.setProperty('--c', opts.color);
    else el.style.removeProperty('--c');
  }

  screen(opts: ScreenOptions): () => void {
    const buttons = h('div.result-buttons');
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      el.classList.add('closing');
      window.setTimeout(() => el.remove(), 250);
      this.screens = this.screens.filter((s) => s !== el);
      if (this.screens.length === 0) this.onScreen?.(false);
    };
    for (const b of opts.buttons) {
      buttons.append(h(`button.btn${b.primary ? '.primary' : ''}`, { onclick: () => { close(); b.onClick(); } }, b.label));
    }
    const stats = opts.stats?.length
      ? h('div.result-stats', {}, ...opts.stats.map(([k, v]) => h('div.result-stat', {}, h('span', {}, k), h('b', {}, v))))
      : null;
    const icon = opts.icon ? h('img.result-icon', { src: this.iconFor(opts.icon), alt: '' }) : null;
    const el = h(
      `div.screen.result-screen.${opts.tone ?? 'neutral'}`,
      {},
      h('div.result-card', {}, icon, h('h1.result-title', {}, opts.title), opts.subtitle ? h('div.result-sub', {}, opts.subtitle) : null, stats, buttons),
    );
    this.root.parentElement!.append(el);
    this.screens.push(el);
    this.onScreen?.(true);
    return close;
  }

  menu(opts: MenuOptions): MenuHandle {
    let current = { ...opts };
    let open = true;
    const body = h('div.menu-body');
    const title = h('h2.menu-title');
    const sub = h('div.menu-sub');
    const closeBtn = h('button.menu-close', { title: 'Close (Esc)' }, '×');
    const card = h('div.menu-card', {}, h('div.menu-head', {}, h('div', {}, title, sub), closeBtn), body);
    const el = h('div.screen.menu-screen', {}, card);
    const entry = (e: MenuEntry) => {
      const icon = e.icon ? h('img.menu-icon', { src: this.iconFor(e.icon), alt: '' }) : h('span.menu-icon');
      const b = h(
        `button.menu-entry${e.disabled ? '.disabled' : ''}${e.active ? '.active' : ''}`,
        {
          onclick: () => {
            if (!e.disabled) e.onSelect?.();
          },
        },
        icon,
        h('span.menu-text', {}, h('span.menu-label', {}, e.label), e.note ? h('span.menu-note', {}, e.note) : null),
        e.detail ? h('span.menu-detail', {}, e.detail) : null,
      );
      return b;
    };
    const render = () => {
      title.textContent = current.title;
      sub.textContent = current.subtitle ?? '';
      sub.style.display = current.subtitle ? '' : 'none';
      body.replaceChildren(
        ...current.sections.map((sec) =>
          h('div.menu-section', {}, sec.title ? h('div.menu-section-title', {}, sec.title) : null, h('div.menu-grid', {}, ...sec.entries.map(entry))),
        ),
      );
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' || ev.code === 'KeyE') {
        ev.stopPropagation();
        close();
      }
    };
    const close = () => {
      if (!open) return;
      this.unhooks.get(el)?.();
      el.classList.add('closing');
      window.setTimeout(() => el.remove(), 150);
      this.screens = this.screens.filter((x) => x !== el);
      if (this.screens.length === 0) this.onScreen?.(false);
      current.onClose?.();
    };
    closeBtn.onclick = close;
    el.onclick = (ev) => {
      if (ev.target === el) close();
    };
    render();
    window.addEventListener('keydown', onKey, true);
    this.unhooks.set(el, () => {
      open = false;
      window.removeEventListener('keydown', onKey, true);
      this.unhooks.delete(el);
    });
    this.root.parentElement!.append(el);
    this.screens.push(el);
    this.onScreen?.(true);
    return {
      update: (o) => {
        current = { ...current, ...o };
        if (open) render();
      },
      close,
      get open() {
        return open;
      },
    };
  }

  closeScreens() {
    for (const unhook of [...this.unhooks.values()]) unhook();
    for (const s of this.screens) s.remove();
    if (this.screens.length) this.onScreen?.(false);
    this.screens = [];
  }

  get screenOpen(): boolean {
    return this.screens.length > 0;
  }

  flash(color: string, strength: number, duration: number) {
    const el = this.flashEl;
    el.style.transition = 'none';
    el.style.background = color;
    el.style.opacity = String(strength);
    void el.offsetWidth;
    el.style.transition = `opacity ${duration}s ease-out`;
    el.style.opacity = '0';
  }

  hitMarker(crit: boolean) {
    this.hitEl.classList.remove('show', 'crit');
    void this.hitEl.offsetWidth;
    this.hitEl.classList.add('show');
    if (crit) this.hitEl.classList.add('crit');
  }

  damageNumber(pos: THREE.Vector3, amount: number, crit: boolean, color?: string) {
    const el = h('div.dmg-number', { style: { color: color ?? (crit ? '#ffd54a' : '#ffffff') } }, (Math.round(amount * 10) / 10).toString());
    if (crit) el.classList.add('crit');
    this.root.append(el);
    this.numbers.push({ el, pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4)), age: 0, vy: 1.6 });
  }

  /** Per frame: project floating numbers and markers. */
  update(dt: number, camera: THREE.Camera, width: number, height: number) {
    if (this.markers.size) this.placeMarkers(camera, width, height);
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.age += dt;
      n.pos.y += n.vy * dt;
      n.vy *= 0.94;
      const life = 0.9;
      if (n.age > life) {
        n.el.remove();
        this.numbers.splice(i, 1);
        continue;
      }
      this.tmp.copy(n.pos).project(camera);
      if (this.tmp.z > 1) {
        n.el.style.display = 'none';
        continue;
      }
      n.el.style.display = '';
      const x = (this.tmp.x * 0.5 + 0.5) * width;
      const y = (-this.tmp.y * 0.5 + 0.5) * height;
      const a = 1 - Math.max(0, (n.age - life * 0.6) / (life * 0.4));
      n.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${1 + Math.max(0, 0.25 - n.age) * 1.5})`;
      n.el.style.opacity = String(a);
    }
  }

  clear() {
    this.objective(null);
    for (const id of [...this.statEls.keys()]) this.stat(id, '', null);
    for (const id of [...this.meterEls.keys()]) this.meter(id, '', null);
    for (const id of [...this.markers.keys()]) this.marker(id, null);
    this.radar(null);
    this.crosshair(true);
    this.hideBossBar();
    this.bannerEl.classList.remove('show');
    this.feedEl.replaceChildren();
    this.progress(null);
    this.highlight(null);
    for (const n of this.numbers) n.el.remove();
    this.numbers = [];
    this.closeScreens();
  }
}
