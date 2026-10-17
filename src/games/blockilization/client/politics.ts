import type { PlayerSummary } from '../protocol';
import { emblemEl, icon } from './icons';
import { store } from './store';
import { h, type El } from './ui';

/**
 * The world's politics, Civilization V's Global Politics: how the civilizations you know stand with
 * one another (and with you): wars, declarations of friendship, defensive pacts and denouncements,
 * as a table of each pair and as lists; and whom each city-state you know is allied with. Only what
 * you could know: civilizations you haven't met aren't in it.
 */

/** How one civ stands toward another (a denouncement goes one way; the rest both). */
interface Stance {
  war: boolean;
  friends: boolean;
  pact: boolean;
  denounced: boolean;
}

const LOOK: Record<keyof Stance, { glyph: string; color: string; name: string }> = {
  war: { glyph: 'war', color: '#c04a34', name: 'At war' },
  denounced: { glyph: 'unhappy', color: '#d8842a', name: 'Denounced' },
  pact: { glyph: 'shield', color: '#3f80c8', name: 'Defensive pact' },
  friends: { glyph: 'peace', color: '#4a9a3a', name: 'Friends' },
};
/** The order a pair's ties show in (the strongest first). */
const ORDER: (keyof Stance)[] = ['war', 'denounced', 'pact', 'friends'];

/** The civilizations in it: you, and those you've met still standing. */
function civs(): PlayerSummary[] {
  const v = store.view!;
  return v.players.filter((p) => (p.index === v.you || (p.met && p.relation)) && p.alive && !p.cityState && p.civ !== 'barbarian');
}

/** How `a` stands toward `b`, from what the view says. */
function stance(a: number, b: number): Stance {
  const v = store.view!;
  if (a === v.you || b === v.you) {
    const them = v.players[a === v.you ? b : a];
    const r = them.relation;
    return {
      war: them.war,
      friends: (r?.friends ?? 0) > 0,
      pact: (r?.pact ?? 0) > 0,
      denounced: a === v.you ? (r?.youDenounced ?? 0) > 0 : (r?.denouncedYou ?? 0) > 0,
    };
  }
  const r = v.players[a].relation;
  return { war: !!r?.atWarWith.includes(b), friends: !!r?.friendsWith.includes(b), pact: !!r?.pactsWith.includes(b), denounced: !!r?.denouncing.includes(b) };
}

const nameOf = (i: number) => (i === store.view?.you ? 'You' : (store.view?.players[i]?.name ?? '?'));

/** A pair's names, emblems first. */
const pair = (a: number, b: number, joint: string) => {
  const v = store.view!;
  return h('div.gp-line', {}, emblemEl(v.players[a].civ, 16), h('b', {}, nameOf(a)), h('span.cv-muted', {}, joint), emblemEl(v.players[b].civ, 16), h('b', {}, nameOf(b)));
};

/**
 * The world's politics: the table of every pair, then each kind of tie listed, then (unless `allies` is
 * false, where the city-states are shown apart) the city-states' allies.
 */
export function renderPolitics(allies = true): El[] {
  const v = store.view!;
  const list = civs();
  if (list.length < 2) return [h('div.cv-muted', {}, 'Meet another civilization to follow the world’s politics.')];
  // The table: each row's stance toward each column.
  const head = h('div.gp-row', {}, h('span.gp-name'), ...list.map((p) => h('span.gp-head', { title: nameOf(p.index), 'data-pedia': `civ:${p.civ}` }, emblemEl(p.civ, 22))));
  const rows = list.map((a) =>
    h(
      'div.gp-row',
      {},
      h('span.gp-name', {}, emblemEl(a.civ, 18), h('b', {}, nameOf(a.index))),
      ...list.map((b) => {
        if (a === b) return h('span.gp-cell.self');
        const s = stance(a.index, b.index);
        const ties = ORDER.filter((k) => s[k]);
        const top = ties[0];
        const words = ties.length ? ties.map((k) => (k === 'denounced' ? `${nameOf(a.index)} denounced ${nameOf(b.index)}` : LOOK[k].name)).join(' · ') : 'At peace';
        return h(`span.gp-cell${top ? `.${top}` : ''}`, { title: `${nameOf(a.index)} and ${nameOf(b.index)}: ${words}`, style: top ? `background:${LOOK[top].color}` : undefined }, top ? icon(LOOK[top].glyph, 15, '#fff') : null, ties.length > 1 && h('i', {}, `+${ties.length - 1}`));
      }),
    ),
  );
  const key = h('div.gp-key', {}, ...ORDER.map((k) => h('span', {}, h('i', { style: `background:${LOOK[k].color}` }, icon(LOOK[k].glyph, 11, '#fff')), LOOK[k].name)), h('span.cv-muted', {}, 'Row to column; blank: at peace'));
  // The lists: each pair once (a denouncement each way it was made).
  const lines: Record<keyof Stance, El[]> = { war: [], friends: [], pact: [], denounced: [] };
  for (const a of list)
    for (const b of list) {
      if (a === b) continue;
      const s = stance(a.index, b.index);
      if (s.denounced) lines.denounced.push(pair(a.index, b.index, 'denounced'));
      if (a.index > b.index) continue;
      if (s.war) lines.war.push(pair(a.index, b.index, 'at war with'));
      if (s.friends) lines.friends.push(pair(a.index, b.index, 'friends with'));
      if (s.pact) lines.pact.push(pair(a.index, b.index, 'pact with'));
    }
  const section = (k: keyof Stance, title: string) => lines[k].length > 0 && h('div.gp-sect', {}, h('div.cv-label', {}, icon(LOOK[k].glyph, 12, LOOK[k].color), ` ${title}`), ...lines[k]);
  const allied = allies ? v.players.filter((p) => p.cityState && p.met && p.alive && p.cityState.ally >= 0) : [];
  return [
    h('div.gp-table', {}, head, ...rows),
    key,
    h(
      'div.gp-lists',
      {},
      section('war', 'Wars'),
      section('friends', 'Declarations of friendship'),
      section('pact', 'Defensive pacts'),
      section('denounced', 'Denouncements'),
      ORDER.every((k) => !lines[k].length) && h('div.cv-muted', {}, 'The world is at peace: no wars, pacts, friendships or denouncements among the civilizations you know.'),
      allied.length > 0 &&
        h(
          'div.gp-sect',
          {},
          h('div.cv-label', {}, icon('crown', 12, '#c8b07a'), ' City-states’ allies'),
          ...allied.map((cs) => {
            const ally = v.players[cs.cityState!.ally];
            const known = ally && (ally.index === v.you || ally.met);
            return h('div.gp-line', {}, emblemEl(cs.civ, 16, cs.cityState!.kind), h('b', {}, cs.name), h('span.cv-muted', {}, 'allied with'), known ? emblemEl(ally.civ, 16) : null, h('b', {}, known ? nameOf(ally.index) : 'a civilization you haven’t met'));
          }),
        ),
    ),
  ];
}

export const POLITICS_CSS = `
.gp-wrap { display: flex; flex-direction: column; gap: 10px; }
.gp-table { display: inline-flex; flex-direction: column; gap: 2px; align-self: flex-start; }
.gp-row { display: flex; align-items: center; gap: 2px; }
.gp-name { width: 150px; display: flex; align-items: center; gap: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px; }
.gp-head { width: 36px; display: flex; justify-content: center; }
.gp-cell { position: relative; width: 36px; height: 26px; display: flex; align-items: center; justify-content: center; background: #2c3342; box-shadow: inset 0 0 0 1px #07090c; }
.gp-cell.self { background: repeating-linear-gradient(45deg, #1a1f28 0 4px, #222833 4px 8px); }
.gp-cell i { position: absolute; right: 1px; top: 1px; padding: 0 2px; background: #07090c; font-style: normal; font-size: 10px; line-height: 11px; color: #fff; }
.gp-key { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 13px; }
.gp-key span { display: inline-flex; align-items: center; gap: 5px; }
.gp-key i { width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; }
.gp-lists { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px 18px; }
.gp-sect { display: flex; flex-direction: column; gap: 3px; }
.gp-sect .cv-label { display: flex; align-items: center; gap: 4px; margin-bottom: 2px; }
.gp-line { display: flex; align-items: center; gap: 6px; font-size: 13px; }
`;
