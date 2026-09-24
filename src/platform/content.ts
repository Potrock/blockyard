import type { AtlasPixels, EntityDefinition, ItemDefinition, SynthVoice, ViewAnimation } from './api/types';

type Listener<T> = (name: string, value: T) => void;

/**
 * What a game defines for its look and sound in `setup`: synthesised voices, texture atlases and
 * first-person animations. These are code and pixels, not messages, so they don't travel with
 * the per-frame presentation calls: the client gets them from here, and calls refer to them by
 * name. (Running in one page, both sides share this object; a remote client builds its own by
 * running the game's `setup`.)
 */
export class Content {
  readonly sounds = new Map<string, SynthVoice>();
  readonly atlases = new Map<string, HTMLCanvasElement | OffscreenCanvas | AtlasPixels>();
  readonly animations = new Map<string, ViewAnimation>();
  /** Entity types: their models, for the client to draw. */
  readonly entities = new Map<string, EntityDefinition>();
  /** Items: their icons and how they're held. */
  readonly items = new Map<string, ItemDefinition>();
  private soundListeners: Listener<SynthVoice>[] = [];
  private atlasListeners: Listener<HTMLCanvasElement | OffscreenCanvas | AtlasPixels>[] = [];
  private animationListeners: Listener<ViewAnimation>[] = [];
  private inline = 0;

  defineSound(name: string, voice: SynthVoice) {
    this.sounds.set(name, voice);
    for (const l of this.soundListeners) l(name, voice);
  }

  defineAtlas(name: string, source: HTMLCanvasElement | OffscreenCanvas | AtlasPixels) {
    this.atlases.set(name, source);
    for (const l of this.atlasListeners) l(name, source);
  }

  defineItem(id: string, def: ItemDefinition) {
    this.items.set(id, def);
  }

  defineEntity(type: string, def: EntityDefinition) {
    this.entities.set(type, def);
  }

  defineAnimation(name: string, anim: ViewAnimation) {
    this.animations.set(name, anim);
    for (const l of this.animationListeners) l(name, anim);
  }

  /** An animation passed inline to `viewModel.play`: stored under a generated name. */
  inlineAnimation(anim: ViewAnimation): string {
    const name = `inline:${++this.inline}`;
    this.defineAnimation(name, anim);
    return name;
  }

  /** Get everything defined so far, then each new definition as it comes. */
  onSound(fn: Listener<SynthVoice>) {
    for (const [n, v] of this.sounds) fn(n, v);
    this.soundListeners.push(fn);
  }

  onAtlas(fn: Listener<HTMLCanvasElement | OffscreenCanvas | AtlasPixels>) {
    for (const [n, v] of this.atlases) fn(n, v);
    this.atlasListeners.push(fn);
  }

  onAnimation(fn: Listener<ViewAnimation>) {
    for (const [n, v] of this.animations) fn(n, v);
    this.animationListeners.push(fn);
  }
}
