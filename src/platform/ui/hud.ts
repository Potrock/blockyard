import { h } from './dom';
import type { Registry } from '../world/registry';

/** Crosshair, hotbar and the block-name toast. */
export class Hud {
  private crosshairEl: HTMLElement;
  private hotbarEl: HTMLElement;
  readonly root: HTMLElement;
  private slots: HTMLElement[] = [];
  private toast: HTMLElement;
  private toastTimer = 0;
  private waterTint: HTMLElement;
  /** A gun's crosshair: four ticks that open up with the spread. */
  private gunCross: HTMLElement;
  private scopeEl: HTMLElement;
  /** A red dot or holo sight's reticle, glowing at the aim point while aiming through it. */
  private reticleEl: HTMLElement;
  private reticleKey = '';
  /** The game wants a crosshair (`hud.crosshair`). */
  private wanted = true;
  private gunGap: number | null = null;

  constructor(parent: HTMLElement, private registry: Registry, private icons: Map<number, string>) {
    this.toast = h('div.toast');
    const bar = h('div.hotbar');
    for (let i = 0; i < 9; i++) {
      const slot = h('div.slot', {}, h('img', { alt: '', draggable: false }), h('span.key', {}, String(i + 1)), h('span.count'));
      this.slots.push(slot);
      bar.append(slot);
    }
    this.waterTint = h('div.water-tint');
    this.crosshairEl = h('div.crosshair');
    this.gunCross = h('div.gun-cross', {}, h('span.gc-t'), h('span.gc-b'), h('span.gc-l'), h('span.gc-r'), h('span.gc-dot'));
    this.gunCross.style.display = 'none';
    this.scopeEl = h('div.scope', {}, h('div.scope-lens'));
    this.scopeEl.style.display = 'none';
    this.reticleEl = h('div.gun-reticle', {}, h('span.gun-reticle-ring'), h('span.gun-reticle-dot'));
    this.reticleEl.style.display = 'none';
    this.hotbarEl = bar;
    this.root = h('div.hud', {}, this.waterTint, this.scopeEl, this.reticleEl, this.crosshairEl, this.gunCross, this.toast, bar);
    parent.append(this.root);
  }

  setHotbar(ids: number[], selected: number, announce: boolean) {
    ids.forEach((id, i) => {
      const img = this.slots[i].querySelector('img')!;
      const src = this.icons.get(id) ?? '';
      if (img.getAttribute('src') !== src) img.src = src;
      this.slots[i].classList.toggle('selected', i === selected);
      this.slots[i].title = this.registry.blocks[id]?.label ?? '';
    });
    if (announce) this.showToast(this.registry.blocks[ids[selected]]?.label ?? '');
  }

  /** Item mode: icons (data URLs) with stack counts. */
  setSlots(slots: ({ icon: string; count: number; label: string } | null)[], selected: number, announce: boolean) {
    slots.forEach((st, i) => {
      const el = this.slots[i];
      const img = el.querySelector('img')!;
      const src = st?.icon ?? '';
      if (img.getAttribute('src') !== src) {
        if (src) img.src = src;
        else img.removeAttribute('src');
      }
      img.style.visibility = src ? '' : 'hidden';
      (el.querySelector('.count') as HTMLElement).textContent = st && st.count > 1 ? String(st.count) : '';
      el.classList.toggle('selected', i === selected);
      el.title = st?.label ?? '';
    });
    if (announce) this.showToast(slots[selected]?.label ?? '');
  }

  showToast(text: string) {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), 1400);
  }

  setCrosshair(v: boolean) {
    this.wanted = v;
    this.showCross();
  }

  /** Holding a gun: its crosshair, `gap` pixels from the middle (the spread), or null for the plain one; hidden while aiming down the sights. */
  setGunCrosshair(gap: number | null, aiming = false) {
    this.gunGap = gap;
    if (gap !== null) this.gunCross.style.setProperty('--gap', `${Math.round(gap)}px`);
    this.gunCross.classList.toggle('aiming', aiming);
    this.showCross();
  }

  private showCross() {
    const gun = this.gunGap !== null;
    this.crosshairEl.style.display = this.wanted && !gun ? '' : 'none';
    this.gunCross.style.display = this.wanted && gun ? '' : 'none';
  }

  /** A red dot (`dot`) or a holo's ring and dot (`holo`) at the aim point, `opacity` 0..1; null hides it. */
  setReticle(kind: 'dot' | 'holo' | null, opacity = 1, color = '#ff2a2a') {
    const show = kind !== null && opacity > 0.01;
    const key = show ? `${kind}|${opacity.toFixed(2)}|${color}` : '';
    if (key === this.reticleKey) return;
    this.reticleKey = key;
    this.reticleEl.style.display = show ? '' : 'none';
    if (!show) return;
    this.reticleEl.className = `gun-reticle ${kind}`;
    this.reticleEl.style.opacity = opacity.toFixed(2);
    this.reticleEl.style.setProperty('--rc', color);
  }

  /** Looking through a scope. */
  setScope(on: boolean) {
    const v = on ? '' : 'none';
    if (this.scopeEl.style.display !== v) this.scopeEl.style.display = v;
  }

  setHotbarVisible(v: boolean) {
    this.hotbarEl.style.display = v ? '' : 'none';
  }

  setVisible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
  }

  setMedium(medium: 'air' | 'water' | 'lava') {
    this.waterTint.dataset.medium = medium;
  }
}
