import { h } from './dom';

/** What the travel screen says of the game: its name, colour and picture (its meta's). */
export interface TravelGame {
  title: string;
  accent?: string;
  cover?: string;
}

/**
 * On the way to another room of the game being played (`client.rooms.go`: a saved game's own room,
 * a new one, back to one's games). A move within a game doesn't go back to the home page: this is
 * up meanwhile instead, saying the game's name and how far along the room is, and goes as play
 * carries on there (or as the home page comes up to say why it couldn't).
 */
export class TravelScreen {
  readonly root: HTMLElement;
  private fill = h('i');
  private text = h('div.travel-text', {}, 'Connecting…');

  constructor(parent: HTMLElement, game: TravelGame) {
    const cover = h('div.travel-cover');
    if (game.cover) cover.style.backgroundImage = `url("${game.cover}")`;
    this.root = h(
      'div.screen.travel-screen',
      { role: 'status', 'aria-live': 'polite' },
      cover,
      h('div.travel-card', {}, h('div.travel-title', {}, game.title), h('div.travel-bar', {}, this.fill), this.text),
    );
    this.root.style.setProperty('--game', game.accent ?? '#7fd46b');
    parent.append(this.root);
  }

  progress(fraction: number, text: string) {
    this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    this.text.textContent = text;
  }

  /** There (or not going after all): it fades away. */
  close() {
    this.root.classList.add('hidden');
    window.setTimeout(() => this.root.remove(), 500);
  }
}
