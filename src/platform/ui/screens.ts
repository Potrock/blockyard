import { h } from './dom';
import type { Registry } from '../world/registry';
import type { BlockIcons } from './icons';

/** Creative block picker. */
export class Inventory {
  readonly root: HTMLElement;
  onPick: ((id: number) => void) | null = null;

  /** Each block's picture and its id: drawn when the picker first opens. */
  private pictures: [HTMLImageElement, number][] = [];

  constructor(parent: HTMLElement, registry: Registry, private icons: BlockIcons, onClose: () => void) {
    const grid = h('div.inv-grid');
    for (const b of registry.blocks) {
      if (!b.placeable) continue;
      const img = h('img', { alt: b.label, draggable: false }) as HTMLImageElement;
      this.pictures.push([img, b.id]);
      grid.append(h('button.inv-cell', { title: b.label, onclick: () => this.onPick?.(b.id) }, img));
    }
    this.root = h(
      'div.screen.inventory-screen.hidden',
      { onclick: (e: Event) => e.target === this.root && onClose() },
      h('div.panel.inv-panel', {}, h('div.panel-head', {}, h('h2', {}, 'Blocks'), h('span.hint', {}, 'Click a block to put it in the selected hotbar slot'), h('button.btn', { onclick: () => onClose() }, 'Done')), grid),
    );
    parent.append(this.root);
  }

  show() {
    for (const [img, id] of this.pictures) img.src = this.icons.get(id) ?? '';
    this.pictures = [];
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }
}
