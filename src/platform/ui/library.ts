import { h } from './dom';
import { isHandheld } from '../settings';
import { tally, type Earned } from './profile';
import { ago, type Played } from './recent';
import type { DirectoryGame } from '../package/link';

/** A game as the library lists it: its meta's name, pitch, colour, cover and achievements. */
export interface LibraryGame {
  id: string;
  title: string;
  tagline?: string;
  accent?: string;
  cover?: string;
  achievements?: Record<string, { title: string; description: string; hidden?: boolean }>;
}

/** What the home page knows, for the library to show. */
export interface LibraryState {
  /** The games on the home page, in its order. */
  games: LibraryGame[];
  /** The game on show. */
  current: string | null;
  /** How many are playing each game's public game now. */
  players: ReadonlyMap<string, number>;
  /** The games played from this browser, the latest first. */
  recent: Played[];
  /** What the signed-in player has earned (null: a guest). */
  earned: Earned | null;
}

type Tab = 'all' | 'live' | 'community';

const SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square" d="M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13zM15.5 15.5L20 20"/></svg>';
const TROPHY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.4A5 5 0 0 1 13 14.9V17h3v2H8v-2h3v-2.1A5 5 0 0 1 8.4 12H8a4 4 0 0 1-4-4V5h3V3zm0 4H6v1a2 2 0 0 0 1 1.7V7zm10 0v2.7A2 2 0 0 0 18 8V7h-1zM6 20h12v2H6v-2z"/></svg>';

/** A card's game, and what its foot says of it. */
interface Entry {
  game: LibraryGame;
  /** Its owners (a community game). */
  by?: string[];
  /** When it was last played from this browser. */
  played?: number;
}

/**
 * Every game, over the home page: the ones played lately first (to jump back in), then the home
 * page's games, then the community's (uploaded by players, not on the home page), as a grid of
 * cards to search and to narrow to what's being played now. Picking one plays it. The shelf along
 * the bottom of the home page shows a row; this is all of them.
 */
export class LibraryPanel {
  readonly root = h('div.screen.library-screen.hidden', { role: 'dialog', 'aria-label': 'All games' });
  private search = h('input.library-search-input', { type: 'search', placeholder: 'Search games', spellcheck: false, autocomplete: 'off', 'aria-label': 'Search games' }) as HTMLInputElement;
  private tabs = h('div.library-tabs', { role: 'tablist' });
  private body = h('div.library-body');
  private count = h('span.library-count');
  private tab: Tab = 'all';
  private state: LibraryState = { games: [], current: null, players: new Map(), recent: [], earned: null };
  /** The community's games (null: not asked yet, or it couldn't be had; `asked` says which). */
  private community: DirectoryGame[] | null = null;
  private asked: 'no' | 'asking' | 'failed' | 'yes' = 'no';
  /** The results in order, for Enter to pick the first. */
  private shown: Entry[] = [];
  /** A game picked: play it. */
  onPick: ((id: string) => void) | null = null;

  constructor() {
    const close = h('button.library-close', { onclick: () => this.close(), 'aria-label': 'Close' }, '×');
    const field = h('label.library-search');
    field.innerHTML = SEARCH;
    field.append(this.search);
    this.search.addEventListener('input', () => this.render());
    this.search.addEventListener('keydown', (e) => {
      // (The keys typed are the search's, not the game's behind.)
      e.stopPropagation();
      if (e.key === 'Escape') this.search.value ? ((this.search.value = ''), this.render()) : this.close();
      if (e.key === 'Enter' && this.shown[0]) this.pick(this.shown[0].game.id);
    });
    this.root.append(h('div.library-panel', {}, h('header.library-head', {}, h('div.library-heading', {}, h('h2.library-title', {}, 'All games'), this.count), field, close), this.tabs, this.body));
    this.root.addEventListener('pointerdown', (e) => e.target === this.root && this.close());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) this.close();
    });
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /**
   * Show it (`tab`: all the games, or the community's alone), with the community's games from the
   * game server at `http` (its web address; null: none to ask).
   */
  show(http: string | null, state: LibraryState, tab: Tab = 'all') {
    this.state = state;
    this.tab = tab;
    this.search.value = '';
    this.root.classList.remove('hidden');
    this.render();
    this.body.scrollTop = 0;
    // The search takes the keys (a phone's keyboard would cover the games: there it comes up when
    // the search is tapped).
    if (!isHandheld()) this.search.focus({ preventScroll: true });
    if (http && this.asked !== 'asking') void this.ask(http);
  }

  /** What the home page knows has changed (who's playing, what's earned): the cards say so. */
  update(state: LibraryState) {
    this.state = state;
    if (this.open) this.render();
  }

  close() {
    this.root.classList.add('hidden');
    this.search.blur();
  }

  private pick(id: string) {
    this.close();
    this.onPick?.(id);
  }

  private async ask(http: string) {
    this.asked = this.community ? 'yes' : 'asking';
    if (!this.community) this.render();
    const r = await fetch(`${http}/g/directory`).catch(() => null);
    const games = r?.ok ? ((await r.json()) as { games: DirectoryGame[] }).games : null;
    if (games) this.community = games;
    this.asked = this.community ? 'yes' : 'failed';
    if (this.open) this.render();
  }

  /** The community's games that aren't on the home page (one approved for it is there already). */
  private others(): Entry[] {
    const listed = new Set(this.state.games.map((g) => g.id));
    return (this.community ?? []).filter((g) => !listed.has(g.id)).map((g) => ({ game: g, by: g.by }));
  }

  private render() {
    const { games, players, recent } = this.state;
    const home: Entry[] = games.map((game) => ({ game }));
    const others = this.others();
    const all = [...home, ...others];
    const live = home.filter((e) => (players.get(e.game.id) ?? 0) > 0).sort((a, b) => (players.get(b.game.id) ?? 0) - (players.get(a.game.id) ?? 0));
    this.count.textContent = String(all.length);

    const tab = (id: Tab, label: string, n: number | null) =>
      h('button.library-tab', { role: 'tab', 'aria-selected': String(this.tab === id), onclick: () => ((this.tab = id), this.render(), (this.body.scrollTop = 0)) }, label, n === null ? null : h('span.library-tab-count', {}, String(n)));
    this.tabs.replaceChildren(tab('all', 'All', null), tab('live', 'Playing now', live.length || null), tab('community', 'Community', others.length || null));

    const query = this.search.value.trim().toLowerCase();
    const sections: (HTMLElement | null)[] = [];
    if (query) {
      const found = all.filter((e) => `${e.game.title} ${e.game.id} ${e.game.tagline ?? ''} ${e.by?.join(' ') ?? ''}`.toLowerCase().includes(query));
      // (A name that starts with what's typed comes first.)
      found.sort((a, b) => Number(b.game.title.toLowerCase().startsWith(query)) - Number(a.game.title.toLowerCase().startsWith(query)));
      this.shown = found;
      sections.push(found.length ? this.grid(found) : this.empty(`No game matches “${this.search.value.trim()}”.`));
    } else if (this.tab === 'live') {
      this.shown = live;
      sections.push(live.length ? this.grid(live) : this.empty('Nobody’s in a public game right now. Pick one and be the first in.'));
    } else if (this.tab === 'community') {
      this.shown = others;
      sections.push(this.section('Community games', 'Made and uploaded by players, and not reviewed for the home page', this.communityGrid(others)));
    } else {
      const again = recent.flatMap((p): Entry[] => {
        const e = all.find((x) => x.game.id === p.id);
        return e ? [{ ...e, played: p.at }] : [];
      }).slice(0, 4);
      this.shown = [...again, ...home, ...others];
      if (again.length) sections.push(this.section('Jump back in', 'What you played last, from this browser', this.grid(again, 'wide')));
      sections.push(this.section('On Blockyard', null, this.grid(home)));
      if (others.length || this.asked !== 'yes') sections.push(this.section('Community games', 'Made and uploaded by players, and not reviewed for the home page', this.communityGrid(others)));
    }
    this.body.replaceChildren(...sections.filter((s) => s !== null));
  }

  private section(title: string, note: string | null, content: HTMLElement): HTMLElement {
    return h('section.library-section', {}, h('header.library-section-head', {}, h('h3', {}, title), note ? h('span', {}, note) : null), content);
  }

  private empty(text: string): HTMLElement {
    return h('div.library-empty', {}, text);
  }

  /** The community's games, or why there are none to show. */
  private communityGrid(others: Entry[]): HTMLElement {
    if (others.length) return this.grid(others);
    if (this.asked === 'asking' || this.asked === 'no') return this.empty('Looking…');
    if (this.asked === 'failed') return this.empty("Couldn't reach the game server.");
    return this.empty('Nothing here yet. Upload a game from the account menu (Your games) and put it in the directory.');
  }

  private grid(entries: Entry[], kind?: 'wide'): HTMLElement {
    return h(`div.library-grid${kind ? `.${kind}` : ''}`, {}, ...entries.map((e) => this.card(e)));
  }

  private card({ game, by, played }: Entry): HTMLElement {
    const { players, current, earned } = this.state;
    const here = players.get(game.id) ?? 0;
    const art = h('span.library-art');
    if (game.cover) art.style.backgroundImage = `url("${game.cover}")`;
    else art.classList.add('blank');
    if (here) art.append(h('span.library-live', {}, h('span.live-dot'), `${here} playing`));
    if (game.id === current) art.append(h('span.library-onshow', {}, 'On show'));
    const { have, all } = tally(game, earned);
    const feats = all ? h('span.library-feats', {}) : null;
    if (feats) {
      feats.innerHTML = TROPHY;
      feats.append(earned ? `${have}/${all}` : String(all));
      feats.title = earned ? `${have} of ${all} achievements` : `${all} achievements to earn`;
    }
    const foot = [played !== undefined ? h('span.library-played', {}, `Played ${ago(played)}`) : null, by?.length ? h('span.library-by', {}, `by ${by.join(', ')}`) : null, feats].filter((x) => x !== null);
    return h(
      'button.library-card',
      { style: `--game: ${game.accent ?? '#7fd46b'}`, onclick: () => this.pick(game.id) },
      art,
      h('span.library-text', {}, h('span.library-name', {}, game.title), game.tagline ? h('span.library-tagline', {}, game.tagline) : null, foot.length ? h('span.library-foot', {}, ...foot) : null),
    );
  }
}
