import { centre } from '../geometry';
import { IDEOLOGIES } from '../rules/policies';
import { unitName } from '../rules/armies';
import { lookAt } from './camera';
import { icon, svg } from './icons';
import { openCityState } from './citystates';
import { openCongress, sessionWhen, unvoted } from './congress';
import { reviewOffer } from './diplomacy';
import { defenceWarnings, lookAtDefence } from './defend';
import { cityAt, store } from './store';
import { foundingSettler, h, openCity, selectUnitAt, togglePanel, year, type El } from './ui';

/**
 * Notifications, Civ V's way: what needs deciding (research to choose, a city without production, a
 * policy or a pantheon to pick, a unit to promote...) pinned at the top right as buttons that open
 * the right panel; the latest news under them, brief and dismissable, each going to its place; and
 * the notification centre (N), the log of everything this game has said, by turn, filterable by kind.
 */

/** Each kind of note's glyph and colour, and its name in the centre's filters. */
const LOOK: Record<string, [glyph: string, color: string, name: string]> = {
  tech: ['science', '#2f6fc0', 'Research'],
  city: ['city', '#8a6a3a', 'Cities'],
  war: ['war', '#b8432f', 'War'],
  religion: ['faith', '#7a6a9a', 'Religion'],
  citystate: ['scroll', '#3f8f6f', 'City-states'],
  great: ['xp', '#b8892a', 'Great people'],
  wonder: ['golden', '#b8892a', 'Wonders'],
  good: ['check', '#3f8f4f', 'Good news'],
  bad: ['info', '#b8432f', 'Bad news'],
  info: ['info', '#3a4a5a', 'Other'],
};
const look = (kind: string | undefined) => LOOK[kind ?? 'info'] ?? LOOK.info;

/** Something to decide this turn, and what deciding it opens. */
export interface Decision {
  key: string;
  text: string;
  glyph: string;
  color: string;
  /** Needed before the turn can end. */
  needed: boolean;
  /** Soon too late, though the turn can end without it (a vote before the World Congress meets): marked "!". */
  urgent?: boolean;
  act: () => void;
}

/** Where a note leads: a city-state's request to its card (or the city-states' page), the city it's about opened (a choice to make there), else a look at its tile. */
function follow(n: { at?: number; openCity?: boolean; kind?: string }) {
  if (n.kind === 'citystate') {
    const home = n.at === undefined ? undefined : cityAt(n.at);
    if (home && store.view?.players[home.owner]?.cityState) return openCityState(home.owner);
    store.diplo.with = -1;
    store.diplo.cityState = null;
    store.diplo.deal = null;
    return open('diplomacy')();
  }
  if (n.at === undefined) return;
  const city = n.openCity ? cityAt(n.at) : undefined;
  if (city && city.owner === store.view?.you) openCity(city.id);
  else goTo(n.at);
}

/** Look at a tile (and select a unit of yours there, if `unit`). */
function goTo(at: number, unit?: number) {
  if (!store.grid) return;
  const c = centre(store.grid, at);
  lookAt(c.x, c.z);
  if (unit !== undefined) {
    store.selectedUnit = unit;
    store.selectedCity = null;
  }
  store.panel = null;
  store.changed++;
}

const open = (panel: NonNullable<typeof store.panel>) => () => {
  if (store.panel !== panel) togglePanel(panel);
};

/** What needs deciding now: first what the turn waits on, then what could be done. */
export function decisions(): Decision[] {
  const v = store.view;
  if (!v || v.spectator || v.over) return [];
  const s = v.self;
  const out: Decision[] = [];
  // Before anything else: the capital.
  const settler = foundingSettler();
  if (settler) out.push({ key: 'found', text: 'Found your capital', glyph: 'city', color: '#a8702a', needed: false, act: () => selectUnitAt(settler.id, settler.tile) });
  for (const b of s.blockers) {
    const city = b.at !== undefined ? cityAt(b.at) : undefined;
    if (b.text.startsWith('Choose research')) out.push({ key: 'research', text: 'Choose research', glyph: 'science', color: '#2f6fc0', needed: true, act: open('tech') });
    else if (b.text.startsWith('Choose a policy')) out.push({ key: 'policy', text: 'Choose a social policy', glyph: 'crown', color: '#b8892a', needed: true, act: open('policies') });
    else if (b.text.startsWith('Choose a free great person')) out.push({ key: 'great', text: b.text, glyph: 'xp', color: '#b8892a', needed: true, act: open('great') });
    else if (b.text.startsWith('Choose a Reformation')) out.push({ key: 'reformation', text: b.text, glyph: 'faith', color: '#3f8f6f', needed: true, act: open('religion') });
    else if (city?.owner === v.you) out.push({ key: `city${city.id}`, text: b.text, glyph: 'hammer', color: '#a8702a', needed: true, act: () => openCity(city.id) });
    else out.push({ key: b.text, text: b.text, glyph: 'info', color: '#2f6fc0', needed: true, act: () => (b.at !== undefined ? goTo(b.at) : undefined) });
  }
  // The World Congress: proposals not voted on (a person who doesn't vote abstains), pressing as the session nears.
  const c = v.congress;
  if (c && unvoted(c).length) out.push({ key: 'congress', text: `Vote in the World Congress: it ${sessionWhen(c, v.turn)}`, glyph: 'vote', color: '#3a6a9a', needed: false, urgent: c.next - v.turn <= 2, act: openCongress });
  else if (c?.canPropose) out.push({ key: 'propose', text: 'You may propose a resolution to the World Congress', glyph: 'vote', color: '#3a6a9a', needed: false, act: openCongress });
  if (!s.pantheon && s.faith >= s.pantheonCost) out.push({ key: 'pantheon', text: 'Found a pantheon', glyph: 'faith', color: '#7a6a9a', needed: false, act: open('religion') });
  // A city with no defenders while a known civ is a danger (the military advisor's warning).
  for (const w of defenceWarnings())
    out.push({
      key: `defend${w.city.id}`,
      text: w.text,
      glyph: 'shield',
      color: '#a03a2a',
      needed: false,
      urgent: true,
      act: () => {
        lookAtDefence(w.city.id);
        openCity(w.city.id);
      },
    });
  if (s.ideologyOpen && !s.ideology) out.push({ key: 'ideology', text: 'Choose an ideology', glyph: 'vote', color: '#3a7ac0', needed: false, act: open('policies') });
  // A revolution the people would have (their dissent from a rival ideology); the tenets one left free.
  const sw = s.ideologySwitch;
  const to = sw && IDEOLOGIES.find((i) => i.id === sw.to);
  if (to) out.push({ key: `revolution${to.id}`, text: `Your people lean to ${to.name}: a revolution?`, glyph: 'war', color: '#a03a2a', needed: false, act: open('policies') });
  if (s.freeTenets > 0) out.push({ key: 'tenets', text: `${s.freeTenets} free tenet${s.freeTenets === 1 ? '' : 's'} to take`, glyph: 'crown', color: '#b8892a', needed: false, act: open('policies') });
  for (const u of v.units)
    if (u.owner === v.you && (u.promotionsDue ?? 0) > 0 && u.promotionOptions?.length)
      out.push({ key: `promote${u.id}`, text: `${unitName(u)} can be promoted`, glyph: 'xp', color: '#b8892a', needed: false, act: () => goTo(u.tile, u.id) });
  const prophet = !s.religion && s.religionsLeft > 0 ? v.units.find((u) => u.owner === v.you && u.type === 'great_prophet') : undefined;
  if (prophet) out.push({ key: 'religion', text: 'A Great Prophet can found a religion', glyph: 'faith', color: '#7a6a9a', needed: false, act: () => goTo(prophet.tile, prophet.id) });
  if (s.spies.some((x) => x.city === null)) out.push({ key: 'spy', text: 'A spy awaits orders', glyph: 'spy', color: '#3a4a5a', needed: false, act: open('espionage') });
  // A deal put to you and put off till later: to answer.
  for (const o of v.offers)
    if (store.diplo.later.includes(o.id)) out.push({ key: `offer${o.id}`, text: `${v.players[o.from]?.name ?? 'A leader'} proposes a deal`, glyph: 'scroll', color: '#b8892a', needed: false, act: () => reviewOffer(o.id) });
  // A peace offered (it lasts until answered or the war goes on without it): Diplomacy, on them.
  for (const p of v.players)
    if (p.peaceOffered)
      out.push({
        key: `peace${p.index}`,
        text: `${p.name} offers peace`,
        glyph: 'peace',
        color: '#3f8f6f',
        needed: false,
        act: () => {
          // (Their page, with its "Accept their peace": any deal drawn up with someone else is put away.)
          store.diplo.with = p.index;
          store.diplo.deal = null;
          store.diplo.check = null;
          open('diplomacy')();
        },
      });
  return out;
}

/** Notes dismissed from the stack. */
const dismissed = new WeakSet<object>();

/** The top right: what needs deciding, then the latest news (each for a little while, or until dismissed). */
export function renderNoteStack(now: number): El {
  const list = decisions();
  const news = store.notes.filter((n) => now - n.t < 20 && !dismissed.has(n)).slice(0, 4);
  const older = store.log.length - news.length;
  return h(
    'div.cv-notes',
    {},
    ...list.slice(0, 5).map((d) =>
      h(`button.nt-decide${d.needed ? '.needed' : ''}${d.urgent ? '.urgent' : ''}`, { onclick: d.act, title: d.needed ? 'Needed before the turn can end' : d.urgent ? 'Soon too late' : undefined }, h('span.ico', { style: `background:${d.color}`, html: svg(d.glyph, 15, '#fff') }), h('span', {}, d.text), icon('moves', 13)),
    ),
    list.length > 5 && h('button.nt-more', { onclick: open('notes') }, `${list.length - 5} more to decide`),
    ...news.map((n) => {
      const [glyph, bg] = look(n.kind);
      return h(
        // (Sliding in only as it comes: the stack's redrawn often.)
        `div.cv-note${now - n.t < 0.6 ? '.new' : ''}`,
        { onclick: () => follow(n) },
        h('span.ico', { style: `background:${bg}`, html: svg(glyph, 16, '#fff') }),
        h('span.cv-grow', {}, n.text),
        (n.count ?? 1) > 1 && h('b.cv-count', {}, `×${n.count}`),
        h('button.nt-x', {
          onclick: () => {
            dismissed.add(n);
            store.changed++;
          },
          title: 'Dismiss',
          html: svg('close', 11),
        }),
      );
    }),
    (news.length > 0 || list.length > 0) && older > 0 && h('button.nt-more', { onclick: open('notes') }, icon('bell', 12), 'All notifications (N)'),
  );
}

/** The order a turn's summary tells its news in: war first, then cities, research and the rest. */
const DIGEST_ORDER = ['war', 'bad', 'city', 'tech', 'wonder', 'great', 'religion', 'citystate', 'good', 'info'];

/**
 * The turn's summary, at the top as a turn begins: what happened since the last (cities grown or
 * done building, research, wars, attacks), most pressing first, each going to its place; a reminder
 * of a choice to make (a policy to adopt...) is left to the decisions at the top right. Put away by
 * its × or by itself, a while after it's first shown.
 */
export function renderDigest(now: number): El | null {
  const d = store.digest;
  const v = store.view;
  if (!d || d.closed || !v || v.turn !== d.turn || (d.shownAt !== undefined && now - d.shownAt > 25)) return null;
  const said = new Set(store.log.filter((n) => n.turn === d.turn - 1).map((n) => `${n.text}|${n.at ?? ''}`));
  const fresh = d.notes.filter((n) => !said.has(`${n.text}|${n.at ?? ''}`));
  if (!fresh.length) return null;
  const rank = (n: (typeof fresh)[number]) => DIGEST_ORDER.indexOf(n.kind ?? 'info');
  const sorted = [...fresh].sort((a, b) => rank(a) - rank(b));
  const shown = sorted.slice(0, 6);
  const close = () => {
    d.closed = true;
    store.changed++;
  };
  d.shownAt ??= now;
  return h(
    'div.nt-digest.cv-panel',
    {},
    h('div.nt-dhead', {}, h('b', {}, `Turn ${d.turn}`), h('span.cv-muted', {}, year(d.turn)), h('span.cv-grow'), h('button.nt-x', { onclick: close, title: 'Put away', html: svg('close', 11) })),
    ...shown.map((n) => {
      const [glyph, bg] = look(n.kind);
      return h(
        `div.nt-row${n.at !== undefined ? '.go' : ''}`,
        {
          onclick: () => follow(n),
        },
        h('span.ico', { style: `background:${bg}`, html: svg(glyph, 13, '#fff') }),
        h('span.cv-grow', {}, n.text),
      );
    }),
    sorted.length > shown.length && h('button.nt-more.in', { onclick: open('notes') }, `${sorted.length - shown.length} more · all notifications (N)`),
  );
}

/** The top of the screen's news: the turn's summary in the middle (unless it's to wait: something's in front), the stack at the right. */
export function renderNotesPart(now: number, digest: boolean): El {
  return h('div.nt-part', {}, digest && renderDigest(now), renderNoteStack(now));
}

/** The kind of note the centre shows (null: all), and how many of the latest it shows. */
let filter: string | null = null;
const SHOWN = 300;

/** The notification centre: what needs deciding, then every note of this game by turn. */
export function renderNoteCentre(): El {
  const v = store.view!;
  const list = decisions();
  const kinds = Object.keys(LOOK).filter((k) => store.log.some((n) => (n.kind ?? 'info') === k));
  // (The latest few hundred: a long game's whole log is a lot to draw each time the panel redraws.)
  const shown = store.log.filter((n) => !filter || (n.kind ?? 'info') === filter).slice(-SHOWN);
  // Newest first, by turn; a note said turn after turn (a reminder) once, at its latest, with since when.
  const latest = new Map<string, { n: (typeof shown)[number]; since: number }>();
  const turns = new Map<number, { n: (typeof shown)[number]; since: number }[]>();
  for (let i = shown.length - 1; i >= 0; i--) {
    const n = shown[i];
    const key = `${n.text}|${n.at ?? ''}`;
    const same = latest.get(key);
    if (same && same.since - n.turn <= 1) {
      same.since = n.turn;
      continue;
    }
    const row = { n, since: n.turn };
    latest.set(key, row);
    if (!turns.has(n.turn)) turns.set(n.turn, []);
    turns.get(n.turn)!.push(row);
  }
  const byTurn: El[] = [];
  for (const [turn, rows] of turns) {
    byTurn.push(h('div.nt-turn', {}, h('b', {}, `Turn ${turn}`), h('span.cv-muted', {}, year(turn)), turn === v.turn && h('span.cv-chip.on', {}, 'this turn')));
    for (const { n, since } of rows) {
      const [glyph, bg] = look(n.kind);
      byTurn.push(
        h(
          `div.nt-row${n.at !== undefined ? '.go' : ''}`,
          { onclick: () => follow(n) },
          h('span.ico', { style: `background:${bg}`, html: svg(glyph, 14, '#fff') }),
          h('span.cv-grow', {}, n.text, since < n.turn && h('small.cv-dim', {}, ` every turn since turn ${since}`)),
          n.at !== undefined && h('span.nt-goto', { html: svg('moves', 13) }),
        ),
      );
    }
  }
  return h(
    'div.nt-panel.cv-panel',
    {},
    h('button.cv-x', { onclick: () => togglePanel('notes'), html: svg('close', 15), title: 'Close (Esc)' }),
    h('div.cv-row', {}, h('span.cv-tile', { style: 'width:38px;height:38px;background:linear-gradient(160deg,#4a6a8a,#2a3a4a)', html: svg('bell', 22, '#fff') }), h('div', {}, h('div.cv-h.big', {}, 'Notifications'), h('small.cv-muted', {}, `${store.log.length} this game`))),
    list.length > 0 &&
      h(
        'div.nt-decisions',
        {},
        h('div.cv-label', {}, 'To decide'),
        ...list.map((d) => h(`button.nt-decide${d.needed ? '.needed' : ''}${d.urgent ? '.urgent' : ''}`, { onclick: d.act }, h('span.ico', { style: `background:${d.color}`, html: svg(d.glyph, 15, '#fff') }), h('span.cv-grow', {}, d.text), d.needed && h('small', {}, 'before the turn ends'), icon('moves', 13))),
      ),
    kinds.length > 1 &&
      h(
        'div.nt-filters',
        {},
        h(`button.cv-chip${filter === null ? '.on' : ''}`, { onclick: () => ((filter = null), store.changed++) }, 'All'),
        ...kinds.map((k) => h(`button.cv-chip${filter === k ? '.on' : ''}`, { onclick: () => ((filter = filter === k ? null : k), store.changed++) }, icon(LOOK[k][0], 12, LOOK[k][1] === '#3a4a5a' ? '#8fa1b3' : LOOK[k][1]), LOOK[k][2])),
      ),
    h('div.nt-log.cv-scroll', {}, ...(byTurn.length ? byTurn : [h('div.cv-muted', { style: 'padding:12px 4px' }, store.log.length ? 'Nothing of that kind yet.' : 'Nothing has happened yet. News will gather here as the game goes on.')])),
  );
}

export const NOTES_CSS = `
.cv-notes .cv-note { padding-right: 6px; }
.cv-top .menu .sep { width: 1px; height: 22px; margin: 0 4px; align-self: center; background: var(--line2); }
.cv-top .menu button .count { position: absolute; top: 1px; right: 0; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 99px; background: var(--gold); color: #1b1407; font-size: 10px; font-weight: 800; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 0 2px #121a24; }
.nt-x { width: 20px; height: 20px; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: var(--muted) !important; flex: none; opacity: 0; transition: opacity .12s; }
.cv-note:hover .nt-x { opacity: 1; } .nt-x:hover { background: rgba(255,255,255,.12) !important; color: var(--text) !important; }
.nt-part { display: contents; }
.cv-notes .cv-note { animation: none; } .cv-notes .cv-note.new { animation: cvSlide .25s ease-out; }
.nt-digest { position: absolute; top: 62px; left: 50%; transform: translateX(-50%); width: min(430px, calc(100vw - 640px)); min-width: 300px; padding: 8px 8px 6px; display: flex; flex-direction: column; gap: 1px; animation: cvIn .25s; z-index: 1; }
.nt-dhead { display: flex; align-items: center; gap: 8px; padding: 0 2px 4px 6px; font-size: 12.5px; }
.nt-digest .nt-x { opacity: 1; }
.nt-digest .nt-row { padding: 4px 6px; font-size: 12.5px; }
.nt-digest .nt-row .ico { width: 22px; height: 22px; }
.nt-more.in { align-self: center; margin-top: 3px; background: none !important; }
.nt-decide { pointer-events: auto; display: flex; align-items: center; gap: 9px; width: 100%; padding: 6px 10px 6px 6px; border-radius: 11px; text-align: left; font-weight: 650; font-size: 12.5px; background: var(--bg) !important; border: 1px solid rgba(106,184,255,.4) !important; box-shadow: 0 6px 16px rgba(0,0,0,.35); backdrop-filter: blur(12px); transition: border-color .12s, transform .12s; }
.nt-decide:hover { border-color: rgba(106,184,255,.8) !important; transform: translateX(-2px); }
.nt-decide.needed { border-color: rgba(242,193,78,.55) !important; }
.nt-decide.needed:hover { border-color: var(--gold) !important; }
.nt-decide.urgent { position: relative; overflow: visible !important; }
.nt-decide.urgent .ico { position: relative; overflow: visible; }
.nt-decide.urgent .ico::after { content: '!'; position: absolute; top: -6px; right: -6px; width: 16px; height: 16px; background: #f2c14e; color: #1b1407; font: 400 16px/16px 'Jersey 10', monospace; text-align: center; box-shadow: 0 0 0 2px #07090c; }
.nt-decide .ico { width: 26px; height: 26px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex: none; }
.nt-decide > span:nth-child(2) { flex: 1; min-width: 0; }
.nt-decide > .cv-i { color: var(--muted); }
.nt-decide small { color: #ffe3a1; font-size: 11px; font-weight: 600; }
.nt-more { pointer-events: auto; align-self: flex-end; display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 99px; font-size: 11.5px; font-weight: 600; color: var(--muted) !important; background: var(--bg) !important; border: 1px solid var(--line) !important; }
.nt-more:hover { color: var(--text) !important; }
.nt-panel { position: absolute; right: 8px; top: 62px; bottom: 8px; width: 420px; padding: 16px; display: flex; flex-direction: column; gap: 12px; animation: cvSlide .22s ease-out; z-index: 4; }
.nt-panel > .cv-row { padding-right: 36px; }
.nt-decisions { display: flex; flex-direction: column; gap: 5px; }
.nt-decisions .nt-decide { box-shadow: none; backdrop-filter: none; animation: none; background: rgba(255,255,255,.04) !important; padding: 8px 10px 8px 8px; }
.nt-filters { display: flex; flex-wrap: wrap; gap: 4px; }
.nt-filters .cv-chip { cursor: pointer; }
.nt-log { flex: 1; display: flex; flex-direction: column; gap: 2px; margin: 0 -6px; padding: 0 6px; }
.nt-turn { display: flex; align-items: center; gap: 8px; margin: 10px 0 3px; font-size: 12px; }
.nt-turn:first-child { margin-top: 0; }
.nt-row { display: flex; align-items: center; gap: 9px; padding: 5px 6px; border-radius: 9px; font-size: 12.5px; line-height: 1.35; }
.nt-row .ico { width: 24px; height: 24px; border-radius: 7px; display: flex; align-items: center; justify-content: center; flex: none; }
.nt-row.go { cursor: pointer; } .nt-row.go:hover { background: rgba(255,255,255,.06); }
.nt-goto { color: var(--dim); display: inline-flex; } .nt-row.go:hover .nt-goto { color: var(--text); }
@media (max-width: 760px), (max-height: 520px) {
  .nt-panel { top: 48px; right: 4px; bottom: 4px; width: min(380px, calc(100vw - 8px)); padding: 10px; }
  .nt-decide { padding: 4px 7px 4px 4px; font-size: 11px; } .nt-decide .ico { width: 22px; height: 22px; }
  .nt-digest { top: 48px; left: 4px; transform: none; width: calc(100vw - 220px); min-width: 0; }
}
`;
