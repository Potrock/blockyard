import type { DealHelp, OfferWire, PlayerSummary } from '../protocol';
import { CIVS } from '../rules/civs';
import type { DealItem } from '../rules/diplomacy';
import { ERA_NAMES, ERAS } from '../rules/techs';
import { RESOURCES } from '../rules/terrain';
import { icon, resourceGlyph, svg } from './icons';
import { leaderScene, SCENE_CSS } from './leaderscene';
import { renderPolitics } from './politics';
import { renderCityStates } from './citystates';
import { renderCongress, unvoted } from './congress';
import { play } from './sound';
import { ask, store, TEAM_COLORS, teammate, tone } from './store';
import { checkDeal, h, portrait, send, tell, tile, togglePanel, type El } from './ui';

/**
 * Diplomacy, on this screen: the civs met down the left, each with how its leader feels about you;
 * one chosen, what its leader thinks of you and why, what stands between you (friendship, pacts,
 * embassies, open borders, deals running, denouncements) and what can be done (trade, declare
 * friendship, denounce, war or peace); the trade table, where a deal is drawn up item by item while
 * the server says what the other side would make of it; and a deal put to you, to accept or not.
 */

const STANCE: Record<string, { label: string; color: string }> = {
  friendly: { label: 'Friendly', color: '#6fd27a' },
  favorable: { label: 'Favorable', color: '#a6dd8a' },
  neutral: { label: 'Neutral', color: '#b7c3cf' },
  guarded: { label: 'Guarded', color: '#f0a24a' },
  hostile: { label: 'Hostile', color: '#ff6b5e' },
};

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const name = (i: number) => store.view?.players[i]?.name ?? '?';

/** The civs on the list: the met ones, alive, not city-states. */
function known(): PlayerSummary[] {
  const v = store.view!;
  return v.players.filter((p) => p.index !== v.you && p.met && p.alive && !p.cityState && p.civ !== 'barbarian' && p.relation);
}

/** An item as words, with its glyph and colour. */
export function itemLabel(item: DealItem, turns: number): { glyph: string; color: string; text: string } {
  switch (item.kind) {
    case 'gold':
      return { glyph: 'gold', color: '#f6cf4a', text: `${item.amount} gold` };
    case 'goldPerTurn':
      return { glyph: 'coins', color: '#f6cf4a', text: `${item.amount} gold a turn for ${turns} turns` };
    case 'luxury':
      return { glyph: resourceGlyph(item.resource), color: RESOURCES[item.resource]?.color ?? '#ccc', text: `${RESOURCES[item.resource]?.name ?? item.resource} for ${turns} turns` };
    case 'strategic':
      return { glyph: resourceGlyph(item.resource), color: RESOURCES[item.resource]?.color ?? '#ccc', text: `${item.amount} ${RESOURCES[item.resource]?.name ?? item.resource} for ${turns} turns` };
    case 'openBorders':
      return { glyph: 'trade', color: '#6ab8ff', text: `Open borders for ${turns} turns` };
    case 'embassy':
      return { glyph: 'city', color: '#c8b8ff', text: 'An embassy' };
    case 'research':
      return { glyph: 'science', color: '#6ab8ff', text: `A research agreement (${turns} turns)` };
    case 'friendship':
      return { glyph: 'people', color: '#6fd27a', text: 'A declaration of friendship' };
    case 'pact':
      return { glyph: 'shield', color: '#6fd27a', text: 'A defensive pact' };
    case 'peace':
      return { glyph: 'peace', color: '#6fd27a', text: 'Peace (a treaty for 10 turns)' };
  }
}

/** A line of a deal: its glyph and words. */
function itemLine(item: DealItem, turns: number, remove?: () => void): El {
  const l = itemLabel(item, turns);
  return h('div.cv-deal-item', {}, h('span', { html: svg(l.glyph, 15, tone(l.color)) }), h('span.cv-grow', {}, l.text), remove ? h('button.x', { onclick: remove, title: 'Take it out', html: svg('close', 11) }) : null);
}

/** The deal's items in three lists: what the viewer gives, what the other side gives, what both do. */
function sides(items: DealItem[], me: number) {
  return {
    mine: items.filter((x) => 'from' in x && x.from === me),
    theirs: items.filter((x) => 'from' in x && x.from !== me),
    both: items.filter((x) => !('from' in x)),
  };
}

/** A stance chip: how a leader feels (with its number), or "At war". */
function stanceChip(p: PlayerSummary): El {
  if (p.war) return h('span.cv-chip.bad', {}, icon('war', 12), 'At war');
  if (teammate(p.index) && typeof p.team === 'number') return h('span.cv-chip', { style: `color:#fff;border-color:${TEAM_COLORS[p.team]};background:${TEAM_COLORS[p.team]}55` }, icon('people', 12), 'Teammate');
  const o = p.relation?.opinion;
  if (!o) return h('span.cv-chip', {}, icon('people', 12), 'A person');
  const s = STANCE[o.stance] ?? STANCE.neutral;
  const c = tone(s.color);
  return h('span.cv-chip', { style: `color:${c};border-color:${c}55;background:${c}1c` }, s.label, h('small', { style: 'opacity:.75' }, signed(o.total)));
}

/** The small marks on a civ's row: friendship, pact, embassy, denouncement, open borders. */
function marks(p: PlayerSummary): El {
  const r = p.relation!;
  const m = (glyph: string, color: string, title: string) => h('span', { title, html: svg(glyph, 13, tone(color)) });
  return h(
    'div.marks',
    {},
    r.friends > 0 ? m('people', '#6fd27a', 'Declaration of friendship') : null,
    r.pact > 0 ? m('shield', '#6fd27a', 'Defensive pact') : null,
    r.embassyThere ? m('city', '#c8b8ff', 'Your embassy in their capital') : null,
    p.opensBorders ? m('trade', '#6ab8ff', 'Their borders are open to you') : null,
    r.deals.length ? m('scroll', '#f6cf4a', `${r.deals.length} deal${r.deals.length > 1 ? 's' : ''} running`) : null,
    r.denouncedYou > 0 ? m('skull', '#ff6b5e', 'They have denounced you') : null,
    store.view!.waiting.includes(p.index) ? m('turn', '#b7c3cf', 'Your deal awaits their answer') : null,
  );
}

/** The diplomacy panel: the civs met, and the one chosen (or the trade table with it, or the city-states). */
export function renderDiplomacy(): El {
  const v = store.view!;
  const civs = known();
  if (store.diplo.with === null || (store.diplo.with >= 0 && !civs.some((p) => p.index === store.diplo.with))) store.diplo.with = civs[0]?.index ?? -1;
  const chosen = store.diplo.with;
  const cityStates = v.players.some((p) => p.cityState && p.met && p.alive);
  const list = h(
    'div.cv-dip-list.cv-scroll',
    {},
    ...civs.map((p) =>
      h(
        `button.cv-dip-civ${p.index === chosen ? '.on' : ''}`,
        { onclick: () => pick(p.index) },
        h('span', { 'data-pedia': `civ:${p.civ}` }, portrait(p.civ, 42)),
        h('div.cv-grow', {}, h('b', {}, p.name), h('small', {}, CIVS[p.civ]?.name ?? ''), marks(p)),
        stanceChip(p),
      ),
    ),
    cityStates ? h(`button.cv-dip-civ.cs${chosen === -1 ? '.on' : ''}`, { onclick: () => pick(-1) }, tile('crown', '#3f8f6f', 42), h('div.cv-grow', {}, h('b', {}, 'City-states'), h('small', {}, 'Influence, gifts and allies'))) : null,
    civs.length > 0 ? h(`button.cv-dip-civ.cs${chosen === -2 ? '.on' : ''}`, { onclick: () => pick(-2) }, tile('globe', '#3a5a7a', 42), h('div.cv-grow', {}, h('b', {}, 'World politics'), h('small', {}, 'Who is at war, friends, pacts'))) : null,
    v.congress
      ? h(
          `button.cv-dip-civ.cs${chosen === -3 ? '.on' : ''}`,
          { onclick: () => pick(-3) },
          tile('vote', '#3a6a9a', 42),
          h('div.cv-grow', {}, h('b', {}, 'World Congress'), h('small', {}, unvoted(v.congress).length ? `${unvoted(v.congress).length} to vote on` : 'Resolutions and delegates')),
        )
      : null,
    !civs.length && !cityStates ? h('div.cv-muted', { style: 'padding:10px' }, "You haven't met anyone yet. Explore!") : null,
  );
  const p = chosen !== null && chosen >= 0 ? v.players[chosen] : null;
  const pane = p
    ? store.diplo.deal
      ? tradePane(p)
      : civPane(p)
    : chosen === -2
      ? h('div.cv-dip-pane.cv-scroll', {}, h('div.cv-h', {}, 'World politics'), h('small.cv-muted', {}, 'How the civilizations you know stand with one another, and with you.'), ...renderPolitics())
      : chosen === -3
        ? h('div.cv-dip-pane.cv-scroll', {}, h('div.cv-h', {}, 'World Congress'), ...renderCongress())
        : h('div.cv-dip-pane.cv-scroll', {}, h('div.cv-h', {}, 'City-states'), ...renderCityStates());
  return h(
    'div.cv-big.cv-panel.cv-dip',
    {},
    h('button.cv-x', { onclick: () => togglePanel('diplomacy'), html: svg('close', 15) }),
    h('div.title', {}, tile('peace', '#3f8f6f', 40), h('div', {}, h('div.cv-h.big', {}, 'Diplomacy'), h('small.cv-muted', {}, 'Leaders, what they think of you, and the deals between you.'))),
    h('div.cv-dip-body', {}, list, pane),
  );
}

/** Look at another civ (any deal being drawn up is put away). */
function pick(i: number) {
  store.diplo.with = i;
  store.diplo.deal = null;
  store.diplo.check = null;
  store.changed++;
}

/** A civ's page: its leader, what it thinks of you and why, what's between you, what can be done. */
function civPane(p: PlayerSummary): El {
  const v = store.view!;
  const r = p.relation!;
  const civ = CIVS[p.civ];
  const turns = v.self.trade.dealTurns;
  const between: El[] = [];
  const line = (glyph: string, color: string, text: string) => between.push(h('div.cv-dip-line', {}, h('span', { html: svg(glyph, 15, tone(color)) }), h('span', {}, text)));
  const mate = teammate(p.index);
  if (mate) line('people', TEAM_COLORS[p.team ?? 0] ?? '#6fd27a', 'Your teammate: at peace for good, borders open, each seeing what the other sees; you go to war, make peace and win together');
  if (p.war) line('war', '#ff6b5e', 'You are at war');
  else if (p.peace > 0) line('peace', '#6fd27a', `A peace treaty holds for ${p.peace} more turns`);
  if (r.friends > 0) line('people', '#6fd27a', `Declaration of friendship (${r.friends} turns)`);
  if (r.pact > 0) line('shield', '#6fd27a', `Defensive pact (${r.pact} turns): an attack on one is an attack on both`);
  if (r.research > 0) line('science', '#6ab8ff', `Research agreement (${r.research} turns to its breakthrough)`);
  if (r.embassyThere || r.embassyHere) line('city', '#c8b8ff', r.embassyThere && r.embassyHere ? 'Embassies in each other’s capitals' : r.embassyThere ? 'Your embassy in their capital' : 'Their embassy in your capital');
  if (p.openBorders || p.opensBorders) line('trade', '#6ab8ff', p.openBorders && p.opensBorders ? 'Borders open both ways' : p.opensBorders ? 'Their borders are open to you' : 'Your borders are open to them');
  if (r.youDenounced > 0) line('skull', '#f0a24a', `You have denounced them (${r.youDenounced} turns)`);
  if (r.denouncedYou > 0) line('skull', '#ff6b5e', `They have denounced you (${r.denouncedYou} turns)`);
  for (const d of r.deals) {
    const l = itemLabel(d.item, d.turns);
    const dir = 'from' in d.item ? (d.item.from === v.you ? 'You give' : 'They give') : 'Both';
    line(l.glyph, l.color, `${dir}: ${l.text.replace(/ for \d+ turns/, '')} (${d.turns} turns left)`);
  }
  if (!between.length) between.push(h('div.cv-muted', {}, 'Nothing yet: trade, exchange embassies, declare friendship.'));
  // (Others than you, among those you've met.)
  const told = (list: number[]) => list.filter((i) => i !== v.you && v.players[i]?.met).map(name);
  const others: string[] = [];
  if (told(r.friendsWith).length) others.push(`Friends with ${told(r.friendsWith).join(', ')}`);
  if (told(r.denouncing).length) others.push(`Has denounced ${told(r.denouncing).join(', ')}`);
  const reasons = r.opinion
    ? r.opinion.reasons.length
      ? r.opinion.reasons.map((x) => h(`div.cv-dip-reason.${x.value > 0 ? 'good' : 'bad'}`, {}, h('b', {}, signed(x.value)), h('span', {}, x.text)))
      : [h('div.cv-muted', {}, 'Nothing in particular, yet.')]
    : [h('div.cv-muted', {}, 'A person leads them: they speak for themselves.')];
  const waiting = v.waiting.includes(p.index);
  const offered = v.offers.find((o) => o.from === p.index);
  return h(
    'div.cv-dip-pane.cv-scroll',
    {},
    h(
      'div.cv-dip-head.scene',
      {},
      leaderScene(p),
      h(
        'div.cv-grow',
        {},
        h('div.cv-h.big', {}, p.name),
        h('small.cv-muted', {}, `${civ?.name ?? ''} · ${ERA_NAMES[ERAS[p.era]] ?? ''} · score ${p.score} · ${p.cities} cit${p.cities === 1 ? 'y' : 'ies'}`),
        h('div.cv-row', { style: 'gap:6px;margin-top:6px;flex-wrap:wrap' }, stanceChip(p), civ ? h('span.cv-chip', { title: civ.ability.text }, civ.ability.name) : null),
      ),
    ),
    h('div.cv-label', {}, r.opinion ? `What ${p.name} thinks of you` : 'Their leader'),
    h('div.cv-dip-reasons', {}, ...reasons),
    h('div.cv-label', {}, 'Between you'),
    h('div.cv-dip-between', {}, ...between),
    others.length ? h('small.cv-muted', {}, others.join(' · ')) : null,
    h(
      'div.cv-dip-acts',
      {},
      offered ? h('button.cv-btn.gold', { onclick: () => reviewOffer(offered.id), title: 'They have put a deal to you: see it and answer' }, icon('scroll', 14), 'Their offer…') : null,
      h(`button.cv-btn${offered ? '' : '.gold'}`, { onclick: () => openTrade([]), disabled: waiting, title: waiting ? 'A deal of yours awaits their answer' : undefined }, icon('scroll', 14), 'Trade…'),
      !mate && !p.war && r.friends <= 0 && r.youDenounced <= 0 && r.denouncedYou <= 0 ? h('button.cv-btn', { onclick: () => openTrade([{ kind: 'friendship' }]) }, icon('people', 14), 'Declare friendship…') : null,
      !mate && !p.war && r.youDenounced <= 0
        ? h('button.cv-btn', { onclick: () => ask(`Denounce ${p.name} before the world?${r.friends > 0 ? ' This ends your friendship.' : ''}`, 'Denounce', () => send({ t: 'denounce', target: p.index })) }, icon('skull', 14), 'Denounce')
        : null,
      p.war && p.peaceOffered
        ? h('button.cv-btn.gold', { onclick: () => send({ t: 'peace', target: p.index }), title: `${p.name} has offered peace: accept it` }, icon('peace', 14), 'Accept their peace')
        : p.war
        ? h('button.cv-btn', { onclick: () => openTrade([{ kind: 'peace' }]) }, icon('peace', 14), 'Make peace…')
        : mate
        ? null
        : h(
            'button.cv-btn.danger',
            {
              onclick: () => ask(`Declare war on ${p.name}?${r.friends > 0 ? ' You are friends: the world will remember the betrayal.' : ''}${r.deals.length ? ' Your deals with them end.' : ''}${teamWar(p)}`, 'Declare war', () => send({ t: 'war', target: p.index })),
              disabled: p.peace > 0,
              title: p.peace > 0 ? `A peace treaty holds for ${p.peace} more turns` : undefined,
            },
            icon('war', 14),
            'Declare war',
          ),
    ),
    waiting ? h('small.cv-muted', {}, 'Your deal awaits their answer.') : null,
    h('small.cv-dim', {}, `Deals, friendships and pacts last ${turns} turns.`),
  );
}

/** What else a war on a civ brings: teams go to war together (theirs, and the viewer's). */
function teamWar(p: PlayerSummary): string {
  const v = store.view!;
  const theirs = typeof p.team === 'number' ? v.players.filter((o) => o.team === p.team && o !== p && o.alive).map((o) => o.name) : [];
  const ours = v.players.filter((o) => teammate(o.index) && o.alive).map((o) => o.name);
  return `${theirs.length ? ` Their team (${theirs.join(', ')}) will be at war with you too.` : ''}${ours.length ? ` Your team (${ours.join(', ')}) goes to war with you.` : ''}`;
}

/** Open the trade table with a civ, starting from some items. */
function openTrade(items: DealItem[]) {
  store.diplo.deal = items;
  store.diplo.check = null;
  askVerdict();
  store.changed++;
}

/** Ask the server what the other side would make of the deal as it stands. */
function askVerdict() {
  const deal = store.diplo.deal;
  const target = store.diplo.with;
  if (!deal || target === null || target < 0) return;
  if (deal.length) checkDeal({ target, items: deal, key: JSON.stringify(deal) });
}

/** The bot's word from the deal helper (its buttons at the table), for the deal it was about. */
let help: { key: string; text: string } | null = null;

/**
 * Ask the bot at the table, Civ V's way: what would make the deal work (`balance`: it adds what it
 * wants from your side), or what it would give for it (`counter`: it fills its own).
 */
function askHelp(target: number, ask: 'balance' | 'counter') {
  const deal = store.diplo.deal;
  if (!deal?.length) return;
  const key = JSON.stringify(deal);
  help = { key, text: 'Asking…' };
  tell('dealHelp', { target, items: deal, ask, key });
  store.changed++;
}

/** The bot's answer: the deal it would take put on the table (with its word), or only its word. */
export function takeHelp(d: DealHelp & { key: string }) {
  if (help?.key !== d.key || JSON.stringify(store.diplo.deal) !== d.key) return;
  if (d.items) {
    store.diplo.deal = d.items;
    askVerdict();
  }
  help = { key: JSON.stringify(store.diplo.deal), text: d.text };
  store.changed++;
}

/** Whether two items are the same thing (amounts aside). */
const same = (a: DealItem, b: DealItem) => a.kind === b.kind && ('from' in a ? 'from' in b && a.from === b.from : true) && ('resource' in a ? 'resource' in b && a.resource === b.resource : true);

/** Put an item into the deal (or, if it's there, take it out); an amount changes in place. */
function toggle(item: DealItem) {
  const deal = store.diplo.deal!;
  const i = deal.findIndex((x) => same(x, item));
  if (i >= 0) deal.splice(i, 1);
  else deal.push(item);
  askVerdict();
  store.changed++;
}

/** The items with an amount (gold, gold a turn, a strategic resource). */
type Amounted = Extract<DealItem, { amount: number }>;

function setAmount(item: Amounted, amount: number) {
  const deal = store.diplo.deal!;
  const i = deal.findIndex((x) => same(x, item));
  if (amount <= 0) {
    if (i >= 0) deal.splice(i, 1);
  } else if (i >= 0) (deal[i] as Amounted).amount = amount;
  else deal.push({ ...item, amount });
  askVerdict();
  store.changed++;
}

/** A number field for an amount (gold, gold a turn, a strategic resource), up to a most. */
function amountField(item: Amounted, most: number, glyph: string, color: string, label: string): El {
  const now = (store.diplo.deal!.find((x) => same(x, item)) as Amounted | undefined)?.amount ?? 0;
  const input = h('input.cv-input', { type: 'number', min: '0', max: String(Math.max(0, most)), step: '1', value: String(now) }) as HTMLInputElement;
  input.addEventListener('change', () => setAmount(item, Math.max(0, Math.min(most, Math.floor(Number(input.value) || 0)))));
  input.addEventListener('click', (e) => e.stopPropagation());
  return h(`div.cv-trade-amt${now > 0 ? '.on' : ''}`, {}, h('span', { html: svg(glyph, 15, color) }), h('span.cv-grow', {}, label, h('small', {}, ` (of ${Math.max(0, most)})`)), input);
}

/** A thing that can go into the deal, as a button that puts it in or takes it out. */
function option(item: DealItem, text: string, glyph: string, color: string, note?: string): El {
  const on = store.diplo.deal!.some((x) => same(x, item));
  return h(`button.cv-trade-opt${on ? '.on' : ''}`, { onclick: () => toggle(item), title: note }, h('span', { html: svg(glyph, 15, tone(color)) }), h('span.cv-grow', {}, text, note ? h('small', {}, note) : null), on ? h('span', { html: svg('check', 13, '#f2c14e') }) : null);
}

/** The trade table: what each side could give, what both could agree, the deal as it stands and the other side's word on it. */
function tradePane(p: PlayerSummary): El {
  const v = store.view!;
  const s = v.self;
  const r = p.relation!;
  const me = v.you;
  const them = p.index;
  const turns = s.trade.dealTurns;
  const deal = store.diplo.deal!;
  const war = p.war;
  const mine: El[] = [];
  const theirs: El[] = [];
  const both: El[] = [];
  if (war) both.push(option({ kind: 'peace' }, 'Peace', 'peace', '#6fd27a', 'A treaty for 10 turns'));
  mine.push(amountField({ kind: 'gold', from: me, amount: 0 }, s.gold, 'gold', '#f6cf4a', 'Gold'));
  mine.push(amountField({ kind: 'goldPerTurn', from: me, amount: 0 }, Math.max(0, s.income), 'coins', '#f6cf4a', `Gold a turn (${turns} turns)`));
  theirs.push(amountField({ kind: 'gold', from: them, amount: 0 }, r.gold, 'gold', '#f6cf4a', 'Gold'));
  theirs.push(amountField({ kind: 'goldPerTurn', from: them, amount: 0 }, Math.max(0, r.income), 'coins', '#f6cf4a', `Gold a turn (${turns} turns)`));
  for (const [res, n] of Object.entries(s.trade.luxuries)) if (!r.luxuries.includes(res)) mine.push(option({ kind: 'luxury', from: me, resource: res }, RESOURCES[res]?.name ?? res, resourceGlyph(res), RESOURCES[res]?.color ?? '#ccc', n === 1 ? 'your only one' : `${n} to spare`));
  for (const res of r.luxuries) if (!(res in s.trade.luxuries) && !s.luxuries.includes(res)) theirs.push(option({ kind: 'luxury', from: them, resource: res }, RESOURCES[res]?.name ?? res, resourceGlyph(res), RESOURCES[res]?.color ?? '#ccc'));
  for (const [res, n] of Object.entries(s.trade.strategic)) mine.push(amountField({ kind: 'strategic', from: me, resource: res, amount: 0 }, n, resourceGlyph(res), RESOURCES[res]?.color ?? '#ccc', `${RESOURCES[res]?.name ?? res} (${turns} turns)`));
  for (const [res, n] of Object.entries(r.strategic)) theirs.push(amountField({ kind: 'strategic', from: them, resource: res, amount: 0 }, n, resourceGlyph(res), RESOURCES[res]?.color ?? '#ccc', `${RESOURCES[res]?.name ?? res} (${turns} turns)`));
  if (!war) {
    if (!p.openBorders && s.trade.writing) mine.push(option({ kind: 'openBorders', from: me }, 'Open your borders', 'trade', '#6ab8ff', `${turns} turns`));
    if (!p.opensBorders && r.writing) theirs.push(option({ kind: 'openBorders', from: them }, 'Open their borders', 'trade', '#6ab8ff', `${turns} turns`));
    if (!r.embassyHere && s.trade.writing && r.writing) mine.push(option({ kind: 'embassy', from: me }, 'An embassy in your capital', 'city', '#c8b8ff'));
    if (!r.embassyThere && s.trade.writing && r.writing) theirs.push(option({ kind: 'embassy', from: them }, 'An embassy in their capital', 'city', '#c8b8ff'));
    if (r.friends <= 0 && r.youDenounced <= 0 && r.denouncedYou <= 0) both.push(option({ kind: 'friendship' }, 'Declaration of friendship', 'people', '#6fd27a', `${turns} turns`));
    if (r.friends > 0 && r.pact <= 0) both.push(option({ kind: 'pact' }, 'Defensive pact', 'shield', '#6fd27a', 'needs embassies both ways'));
    if (r.research <= 0 && s.trade.philosophy && r.philosophy) both.push(option({ kind: 'research' }, 'Research agreement', 'science', '#6ab8ff', `${s.trade.researchCost} gold each; needs embassies both ways`));
  }
  const parts = sides(deal, me);
  const key = JSON.stringify(deal);
  const check = store.diplo.check?.key === key ? store.diplo.check : null;
  const verdict = !deal.length
    ? h('div.cv-muted', {}, 'Put something on the table.')
    : check
      ? h(`div.cv-trade-verdict.${check.ok ? 'good' : 'bad'}`, {}, icon(check.ok ? 'check' : 'close', 15), check.text)
      : h('div.cv-muted', {}, `Asking ${p.name}…`);
  const list = (title: string, items: DealItem[]) => h('div.cv-trade-sum', {}, h('div.cv-label', {}, title), ...(items.length ? items.map((x) => itemLine(x, turns, () => toggle(x))) : [h('small.cv-dim', {}, 'Nothing')]));
  return h(
    'div.cv-dip-pane.cv-scroll',
    {},
    h(
      'div.cv-dip-head',
      {},
      portrait(v.self.civ, 54),
      h('span', { html: svg('scroll', 22, '#f2c14e') }),
      leaderScene(p, { small: true }),
      h('div.cv-grow', {}, h('div.cv-h.big', {}, `A deal with ${p.name}`), h('small.cv-muted', {}, `${p.bot ? 'They answer at once.' : 'They will answer in their own time.'} Per-turn items last ${turns} turns.`)),
      stanceChip(p),
    ),
    h(
      'div.cv-trade',
      {},
      h('div.col', {}, h('div.cv-label', {}, 'You could give'), ...mine),
      h('div.col', {}, h('div.cv-label', {}, 'Both of you'), ...(both.length ? both : [h('small.cv-dim', {}, 'Nothing to agree together yet')])),
      h('div.col', {}, h('div.cv-label', {}, `${p.name} could give`), ...theirs),
    ),
    h('div.cv-trade-deal', {}, list('You give', parts.mine), list('Together', parts.both), list('They give', parts.theirs)),
    verdict,
    help?.key === key && h('div.cv-trade-help', {}, icon('scroll', 14, '#f2c14e'), help.text),
    h(
      'div.cv-dip-acts',
      {},
      h('button.cv-btn', { onclick: () => pick(them) }, 'Back'),
      h('button.cv-btn', { onclick: () => openTrade([]), disabled: !deal.length }, 'Clear'),
      // (Civ V's questions to a leader at the table: a person answers in their own time instead.)
      p.bot && h('button.cv-btn', { onclick: () => askHelp(them, 'balance'), disabled: !deal.length || !!check?.ok || !!(check && !check.valid), title: 'Ask them to add what they would want from you for it' }, 'What would make this work?'),
      p.bot && h('button.cv-btn', { onclick: () => askHelp(them, 'counter'), disabled: !parts.mine.length || !!(check && !check.valid), title: 'Ask them what they would give for what you put on the table' }, 'What would you give?'),
      h('span.cv-grow', {}),
      h(
        'button.cv-btn.gold',
        {
          onclick: () => {
            store.diplo.pending = true;
            send({ t: 'deal', target: them, items: deal });
          },
          disabled: !deal.length || (check !== null && !check.valid),
        },
        icon('scroll', 14),
        p.bot ? 'Propose' : 'Send the offer',
      ),
    ),
  );
}

/** A deal put to you, to accept, decline or leave for later. */
/** The first deal put to this player that's waiting for an answer (not put off till later). */
export const waitingOffer = (): OfferWire | undefined => store.view?.offers.find((o) => !store.diplo.later.includes(o.id));

/** Put the deal on show off till later (it waits in Diplomacy, and in the decisions at the top right). */
export function putOffOffer() {
  const offer = waitingOffer();
  if (offer) store.diplo.later.push(offer.id);
  store.changed++;
}

/** A deal put off, brought back to be answered (over the map: panels closed). */
export function reviewOffer(id: number) {
  store.diplo.later = store.diplo.later.filter((x) => x !== id);
  store.panel = null;
  store.changed++;
}

export function renderOffer(): El | null {
  const v = store.view;
  const offer = waitingOffer();
  if (!v || store.confirm || !offer) return null;
  const from = v.players[offer.from];
  const turns = v.self.trade.dealTurns;
  const parts = sides(offer.items, v.you);
  const list = (title: string, items: DealItem[]) => (items.length ? h('div.cv-trade-sum', {}, h('div.cv-label', {}, title), ...items.map((x) => itemLine(x, turns))) : null);
  return h(
    'div.cv-confirm',
    {},
    h(
      'div.cv-panel.box.cv-offer',
      {},
      h('div.cv-dip-head', {}, portrait(from.civ, 64), h('div.cv-grow', {}, h('div.cv-h', {}, `${from.name} proposes a deal`), h('small.cv-muted', {}, CIVS[from.civ]?.name ?? '')), stanceChip(from)),
      list('They give you', parts.theirs),
      list('Together', parts.both),
      list('You give them', parts.mine),
      h(
        'div.acts',
        {},
        h('button.cv-btn', { onclick: putOffOffer, title: 'Answer it later, in Diplomacy (Esc)' }, 'Later'),
        h('button.cv-btn.danger', { onclick: () => send({ t: 'answer', offer: offer.id, accept: false }) }, 'Decline'),
        h(
          'button.cv-btn.gold',
          {
            onclick: () => {
              send({ t: 'answer', offer: offer.id, accept: true });
              play('deal');
            },
          },
          icon('check', 14),
          'Accept',
        ),
      ),
    ),
  );
}

export const DIPLO_CSS = `
/* Diplomacy: on a wide screen, centred in the room left of the notes column (and the leaders, when they're shown), so no
   banner is cut in half; narrower, the width of the screen (over the notes whole). */
.cv-dip { left: 8px !important; right: 8px !important; width: auto !important; transform: none !important; }
@media (min-width: 1200px) {
  .cv-dip { right: 306px !important; max-width: 1060px; margin: 0 auto; }
  .cv-root.ribbon-on .cv-dip { right: 380px !important; }
}
.cv-dip-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(230px, 290px) 1fr; gap: 14px; }
.cv-dip-list { display: flex; flex-direction: column; gap: 6px; overflow-y: auto; padding-right: 2px; }
.cv-dip-civ { display: flex; align-items: center; gap: 10px; padding: 7px 9px; border-radius: 12px; background: rgba(255,255,255,.04); border: 1px solid var(--line) !important; text-align: left; transition: background .12s, border-color .12s; }
.cv-dip-civ:hover { background: rgba(255,255,255,.08); }
.cv-dip-civ.on { background: rgba(242,193,78,.1); border-color: rgba(242,193,78,.45) !important; }
.cv-dip-civ b { display: block; font-size: 13.5px; } .cv-dip-civ small { color: var(--muted); font-size: 11.5px; }
.cv-dip-civ .marks { display: flex; gap: 4px; margin-top: 3px; min-height: 13px; }
.cv-dip-civ .cv-chip { font-size: 11px; padding: 2px 7px; }
.cv-dip-pane { overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 2px 4px 4px 2px; min-height: 0; }
.cv-dip-head { display: flex; align-items: center; gap: 12px; }
.cv-dip-head.scene { flex-wrap: wrap; }
.cv-dip-reasons { display: flex; flex-direction: column; gap: 3px; }
.cv-dip-reason { display: flex; gap: 10px; align-items: baseline; padding: 4px 8px; border-radius: 8px; background: rgba(255,255,255,.035); font-size: 12.5px; }
.cv-dip-reason b { min-width: 30px; text-align: right; font-variant-numeric: tabular-nums; }
.cv-dip-reason.good b { color: var(--good); } .cv-dip-reason.bad b { color: var(--bad); }
.cv-dip-between { display: flex; flex-direction: column; gap: 4px; }
.cv-dip-line { display: flex; gap: 9px; align-items: center; font-size: 12.5px; }
.cv-dip-acts { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 4px; }
.cv-trade { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
.cv-trade .col { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.cv-trade-opt, .cv-trade-amt { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 9px; background: rgba(255,255,255,.045); border: 1px solid var(--line) !important; font-size: 12.5px; text-align: left; min-height: 34px; }
.cv-trade-opt:hover { background: rgba(255,255,255,.09); }
.cv-trade-opt.on, .cv-trade-amt.on { background: rgba(242,193,78,.12); border-color: rgba(242,193,78,.5) !important; }
.cv-trade-opt small { display: block; color: var(--muted); font-size: 11px; line-height: 1.25; }
.cv-trade-amt small { color: var(--muted); font-size: 11px; }
.cv-trade-amt .cv-input { width: 74px; padding: 4px 6px; text-align: right; }
.cv-trade-deal { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; padding: 10px; border-radius: 12px; background: rgba(0,0,0,.18); border: 1px solid var(--line); }
.cv-trade-sum { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.cv-deal-item { display: flex; align-items: center; gap: 7px; font-size: 12.5px; }
.cv-deal-item .x { width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--muted); background: rgba(255,255,255,.06) !important; }
.cv-trade-verdict { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; }
.cv-trade-verdict.good { color: var(--good); } .cv-trade-verdict.bad { color: #ffb1a8; }
.cv-trade-help { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #ffe3a1; }
.cv-offer { width: min(460px, 94vw) !important; }
.cv-toast.good { border-color: rgba(111,210,122,.5); background: rgba(20,48,28,.92); color: #d6f5da; }
@media (max-width: 760px) {
  .cv-dip-body { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .cv-dip-list { flex-direction: row; overflow-x: auto; overflow-y: hidden; }
  .cv-dip-civ { min-width: 220px; }
  .cv-dip-civ b, .cv-dip-civ small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cv-trade, .cv-trade-deal { grid-template-columns: 1fr; }
}
${SCENE_CSS}`;
