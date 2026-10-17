import { centre } from '../geometry';
import type { PlayerSummary } from '../protocol';
import { ALLY, FRIEND } from '../rules/citystates';
import { lookAt } from './camera';
import { CITY_STATE_KINDS } from './concepts';
import { emblemEl, icon } from './icons';
import { ask, store } from './store';
import { h, send, tile, type El } from './ui';

/**
 * The city-states, as Civ V's city-state screen has them, one card each: its kind and what it gives
 * a friend and an ally, your influence on a bar marked where friendship (30) and alliance (60)
 * begin, who its ally is, what it asks of you (its quests: the influence each wins, the turns left,
 * a look at the place), tribute you could demand of it, and gifts of gold (with the influence each
 * buys), war and peace, and a look at where it stands on the map. Your allies first, then your
 * friends, then the rest.
 */

/** Each standing's word and colour. */
const STANDING: Record<string, { word: string; cls: string }> = {
  ally: { word: 'Your ally', cls: 'good' },
  friend: { word: 'Your friend', cls: 'on' },
  neutral: { word: 'Neutral', cls: '' },
  war: { word: 'At war', cls: 'bad' },
};
const ORDER = ['ally', 'friend', 'neutral', 'war'];

/** The influence bar's top: a little past alliance, so the marks sit in it. */
const BAR_TOP = 90;

/** Look at a city-state's home on the map (its capital, else any city of its it shows). */
function showOnMap(p: PlayerSummary) {
  const v = store.view!;
  const home = v.cities.find((c) => c.owner === p.index && c.capital) ?? v.cities.find((c) => c.owner === p.index);
  if (home) goTo(home.tile);
}

/** How your influence drifts each turn: down to its rest from above, up to it from below (null: it's there). */
function drift(cs: NonNullable<PlayerSummary['cityState']>): string | null {
  const fall = Math.round(cs.fall * 100) / 100;
  if (cs.influence > cs.rest) return `−${fall} a turn, to ${cs.rest}`;
  if (cs.influence < cs.rest) return `+1 a turn, to ${cs.rest}`;
  return null;
}

/** Your influence with a city-state on a bar, with the marks for friendship and alliance (and where it drifts back to, when that's above nothing). */
function influenceBar(cs: NonNullable<PlayerSummary['cityState']>): El {
  const { influence, standing, rest } = cs;
  const at = (n: number) => `${(Math.max(0, Math.min(BAR_TOP, n)) / BAR_TOP) * 100}%`;
  return h(
    'div.cs-inf',
    { title: `Your influence: ${influence}. Friends from ${FRIEND}, allies from ${ALLY} (the civ with the most). ${drift(cs) ? `It drifts ${drift(cs)}.` : `It rests at ${rest}.`}` },
    h(`div.cv-bar.${standing === 'ally' ? 'gold' : standing === 'friend' ? 'green' : standing === 'war' ? 'red' : ''}`, {}, h('i', { style: `width:${at(influence)}` })),
    h('span.mark', { style: `left:${at(FRIEND)}` }, h('small', {}, String(FRIEND))),
    h('span.mark', { style: `left:${at(ALLY)}` }, h('small', {}, String(ALLY))),
    rest > 0 && h('span.mark.rest', { style: `left:${at(rest)}` }),
  );
}

/** What it gives you now (or would as a friend), and an ally. */
function gives(p: PlayerSummary): El {
  const g = p.cityState!.gives;
  const line = (cls: string, label: string, text: string) => h(`div.cs-give.${cls}`, {}, h('b', {}, label), h('span', {}, text));
  return h('div.cs-gives', {}, g.now ? line('now', 'You get', g.now) : line('friend', 'Friends get', g.friend), p.cityState!.standing !== 'ally' ? line('ally', 'Its ally gets', g.ally) : null);
}

/** Each kind of quest's glyph and colour. */
const QUEST_LOOK: Record<string, [string, string]> = {
  camp: ['skull', '#a83a2a'],
  resource: ['gems', '#8a4aa8'],
  wonder: ['golden', '#b8892a'],
  nature: ['compass', '#3f8f6f'],
  religion: ['faith', '#7a6a9a'],
  route: ['trade', '#2f6fc0'],
};

/** Look at a tile on the map (the panel put away). */
function goTo(t: number) {
  if (!store.grid) return;
  const c = centre(store.grid, t);
  lookAt(c.x, c.z);
  store.panel = null;
  store.changed++;
}

/** What a city-state asks of you: each quest, its reward and the turns it has left (or done), and a look at its place. */
function quests(p: PlayerSummary): El | null {
  const list = p.cityState!.quests;
  if (!list.length) return null;
  return h(
    'div.cs-quests',
    {},
    h('div.cv-label', {}, 'It asks'),
    ...list.map((q) => {
      const [glyph, color] = QUEST_LOOK[q.kind] ?? ['info', '#3a4a5a'];
      return h(
        `div.cs-quest${q.done ? '.done' : ''}`,
        {},
        tile(q.done ? 'check' : glyph, q.done ? (store.colourBlind ? '#2f6fc0' : '#3f8f4f') : color, 26),
        h('span.cv-grow', {}, q.text, q.firstOnly && !q.done && h('small.first', {}, 'the first to do it')),
        h('b.reward', { title: 'Influence it wins' }, `+${q.reward}`),
        h('small.cv-muted', {}, q.done ? 'done' : `${q.turns} turn${q.turns === 1 ? '' : 's'}`),
        q.at !== null && !q.done && h('button.cv-btn.small.icon', { onclick: () => goTo(q.at!), title: q.kind === 'camp' ? 'Show the camp' : 'Show it on the map' }, icon('globe', 13)),
      );
    }),
  );
}

/** Demanding tribute (Civ V's bullying, when your soldiers near it outmatch it): its gold or a worker, each for influence lost (asked first). */
function tribute(p: PlayerSummary): El | null {
  const t = p.cityState!.tribute;
  if (p.war) return null;
  const demand = (take: 'gold' | 'worker', label: string, cost: number) =>
    h(
      'button.cv-btn.small.danger',
      {
        disabled: !!t.why,
        title: t.why ?? `${label} of ${p.name}: ${cost} influence lost, and it can't be bullied again for a while`,
        onclick: () => ask(`${label} of ${p.name}? It sours them: ${cost} influence lost.`, label, () => send({ t: 'tribute', target: p.index, take })),
      },
      icon(take === 'gold' ? 'gold' : 'hammer', 13),
      label,
      h('small.loss', { title: 'Influence lost' }, `−${cost}`),
    );
  return h(
    'div.cs-tribute',
    {},
    demand('gold', `Demand gold (${t.gold})`, t.cost.gold),
    demand('worker', 'Demand a worker', t.cost.worker),
    // (On a touch screen there's no hovering for the reason: it's said beside them.)
    t.why && h('small.cv-muted.why', {}, t.why),
  );
}

/** One city-state's card. */
function card(p: PlayerSummary): El {
  const v = store.view!;
  const cs = p.cityState!;
  const kind = CITY_STATE_KINDS.find((k) => k.id === cs.kind);
  const st = STANDING[cs.standing] ?? STANDING.neutral;
  const ally = cs.ally >= 0 ? v.players[cs.ally] : null;
  const allyName = !ally ? 'No ally' : ally.index === v.you ? 'Allied with you' : `Allied with ${ally.met ? ally.name : 'a civilization you haven’t met'}`;
  const gifts = cs.gifts.map(({ gold, influence }) =>
    h(
      'button.cv-btn.small',
      { onclick: () => send({ t: 'gift', target: p.index, gold }), disabled: v.self.gold < gold || p.war, title: p.war ? 'Make peace first' : `Give ${gold} gold for ${influence} influence` },
      icon('gold', 13, '#f6cf4a'),
      String(gold),
      h('small.gain', {}, `+${influence}`),
    ),
  );
  return h(
    `div.cs-card.${cs.standing}`,
    {},
    h(
      'div.cs-head',
      {},
      h('span.cs-em', { 'data-pedia': `citystate:${cs.kind}` }, emblemEl(p.civ, 40, cs.kind)),
      h(
        'div.cv-grow',
        {},
        h('b.cs-name', {}, p.name),
        h('div.cs-kind', { 'data-pedia': `citystate:${cs.kind}` }, kind ? tile(kind.glyph, kind.color, 20) : null, h('span', {}, kind ? `${kind.name}: ${kind.sub.toLowerCase()}` : cs.kind)),
      ),
      h(`span.cv-chip${st.cls ? `.${st.cls}` : ''}`, {}, st.word),
    ),
    h('div.cs-row', {}, influenceBar(cs), h('b.cs-num', {}, String(cs.influence))),
    h('div.cs-row.cs-facts', {}, h('span', {}, icon('crown', 13, ally ? '#f2c14e' : '#6c7688'), allyName), drift(cs) && h('span.cs-drift', { title: 'How your influence moves each turn, and where it stops' }, icon('turn', 13, '#9aa4b5'), drift(cs))),
    gives(p),
    quests(p),
    tribute(p),
    h(
      'div.cs-acts',
      {},
      ...gifts,
      h('span.cv-grow'),
      h('button.cv-btn.small.icon', { onclick: () => showOnMap(p), title: 'Show it on the map' }, icon('globe', 14)),
      p.war
        ? h('button.cv-btn.small', { onclick: () => send({ t: 'peace', target: p.index }) }, icon('peace', 13), 'Peace')
        : h('button.cv-btn.small.icon.danger', { onclick: () => ask(`Declare war on ${p.name}? Its friendship (and any alliance) is lost.`, 'Declare war', () => send({ t: 'war', target: p.index })), title: 'Declare war on it' }, icon('war', 13)),
    ),
  );
}

/** How many quests the city-states ask that you haven't done. */
export const openQuests = (states: PlayerSummary[]) => states.reduce((n, p) => n + (p.cityState?.quests.filter((q) => !q.done).length ?? 0), 0);

/** The city-states' page in Diplomacy: a line of how you stand with them all, then a card each. */
export function renderCityStates(): El[] {
  const v = store.view!;
  const states = v.players.filter((p) => p.cityState && p.met && p.alive).sort((a, b) => ORDER.indexOf(a.cityState!.standing) - ORDER.indexOf(b.cityState!.standing) || b.cityState!.influence - a.cityState!.influence);
  if (!states.length) return [h('div.cv-muted', {}, 'You haven’t met a city-state yet. Explore!')];
  const count = (s: string) => states.filter((p) => p.cityState!.standing === s).length;
  const asks = openQuests(states);
  return [
    h(
      'div.cs-sum',
      {},
      h('span', {}, h('b', {}, String(states.length)), ' met'),
      h('span', {}, h('b', {}, String(count('ally'))), count('ally') === 1 ? ' ally' : ' allies'),
      h('span', {}, h('b', {}, String(count('friend'))), count('friend') === 1 ? ' friend' : ' friends'),
      asks > 0 && h('span', {}, h('b', {}, String(asks)), asks === 1 ? ' request for you' : ' requests for you'),
      h('small.cv-muted', {}, `Friends from ${FRIEND} influence; the civ with the most, from ${ALLY}, is the ally. Influence falls back a little each turn.`),
    ),
    ...states.map(card),
  ];
}

export const CITYSTATES_CSS = `
.cs-sum { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; }
.cs-sum b { font: 400 22px/1 'Jersey 10', monospace; color: #fff; }
.cs-sum small { flex-basis: 100%; }
.cs-card { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; background: rgba(255,255,255,.035); box-shadow: inset 0 0 0 2px #11141a, inset 4px 0 0 #5d6884; }
.cs-card.ally { box-shadow: inset 0 0 0 2px #11141a, inset 4px 0 0 #f2c14e; }
.cs-card.friend { box-shadow: inset 0 0 0 2px #11141a, inset 4px 0 0 #6fd27a; }
.cs-card.war { box-shadow: inset 0 0 0 2px #11141a, inset 4px 0 0 #ff6b5e; }
.cs-head { display: flex; align-items: center; gap: 10px; }
.cs-name { display: block; font: 400 24px/1 'Jersey 10', monospace; color: #fff; text-shadow: 2px 2px 0 #0b0d12; }
.cs-kind { display: flex; align-items: center; gap: 6px; margin-top: 3px; color: var(--muted); font-size: 14px; }
.cs-row { display: flex; align-items: center; gap: 10px; }
.cs-inf { position: relative; flex: 1; padding-bottom: 12px; }
.cs-inf .mark { position: absolute; top: -3px; bottom: 10px; width: 2px; background: #eef1f5; box-shadow: 0 0 0 1px #07090c; }
.cs-inf .mark.rest { background: #6c7688; top: 0; bottom: 12px; width: 2px; }
.cs-inf .mark small { position: absolute; top: 100%; left: -8px; font: 400 13px/12px 'Jersey 10', monospace; color: var(--muted); }
.cs-num { font: 400 24px/1 'Jersey 10', monospace; min-width: 34px; text-align: right; }
.cs-facts { flex-wrap: wrap; gap: 4px 12px; font-size: 14px; }
.cs-facts > span { display: inline-flex; align-items: center; gap: 5px; }
.cs-facts .cs-drift { margin-left: auto; color: var(--muted); }
.cs-gives { display: flex; flex-direction: column; gap: 2px; font-family: 'Chakra Petch', system-ui, sans-serif; font-size: 13.5px; }
.cs-give { display: flex; gap: 8px; align-items: baseline; color: var(--muted); }
.cs-give b { flex: none; width: 92px; font: 400 16px/1 'Jersey 10', monospace; color: var(--muted); }
.cs-give.now { color: #e8f6dc; } .cs-give.now b { color: #b8f09c; }
.cs-quests { display: flex; flex-direction: column; gap: 4px; }
.cs-quest { display: flex; align-items: center; gap: 8px; padding: 3px 6px 3px 3px; background: rgba(242,193,78,.07); box-shadow: inset 0 0 0 2px #11141a; font-size: 14px; }
.cs-quest .first { margin-left: 6px; color: #ffcf9a; font-size: 12px; }
.cs-quest .reward { font: 400 20px/1 'Jersey 10', monospace; color: #b8f09c; }
.cs-quest small { min-width: 52px; text-align: right; }
.cs-quest.done { background: rgba(111,210,122,.07); color: var(--muted); }
.cs-quest.done .cv-grow { text-decoration: line-through; }
.cs-tribute { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.cs-tribute .why { display: none; flex-basis: 100%; font-family: 'Chakra Petch', system-ui, sans-serif; font-size: 13px; }
@media (hover: none) { .cs-tribute .why { display: block; } }
.cs-tribute .loss { font: 400 15px/1 'Jersey 10', monospace; color: #ffb4a6; margin-left: 2px; }
.cs-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.cs-acts .gain { font: 400 15px/1 'Jersey 10', monospace; color: #b8f09c; margin-left: 2px; }
/* The colour-blind palette (the rest is pixel.ts's): a request done in blue. */
.cv-root.cb .cs-quest.done { background: rgba(90,174,255,.07); }
@media (max-width: 760px), (max-height: 520px) {
  .cs-card { padding: 8px; gap: 6px; }
  .cs-name { font-size: 21px; }
  .cs-give b { width: 80px; }
}
`;
