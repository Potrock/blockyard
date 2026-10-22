import { centre } from '../geometry';
import type { ClanWire } from '../protocol';
import { UNITS } from '../rules/units';
import { lookAt } from './camera';
import { emblemEl, icon, unitGlyph } from './icons';
import { ask, store } from './store';
import { h, send, togglePanel, type El } from './ui';

/**
 * The barbarian clans whose camps you've found (`rules/clans.ts`), one card each, as Civ VI's
 * Barbarian Clans have them: how near each is to settling as a city-state (and whether it could
 * where it is), and what can be had of it for gold: a bribe to leave you alone for a while, one of
 * its warriors, a raid on a civ you've met.
 */

/** Diplomacy, open at the clans. */
export function openClans() {
  store.diplo.with = -4;
  store.diplo.deal = null;
  if (store.panel !== 'diplomacy') togglePanel('diplomacy');
  else store.changed++;
}

/** The clan whose raid is being paid for: its civs to choose from shown (null: none). */
let choosing: number | null = null;

const nameOf = (i: number) => store.view?.players[i]?.name ?? '?';
const turns = (n: number) => `${n} turn${n === 1 ? '' : 's'}`;

/** Look at a camp on the map. */
function goTo(t: number) {
  if (!store.grid) return;
  const c = centre(store.grid, t);
  lookAt(c.x, c.z);
  store.panel = null;
  store.changed++;
}

/** A dealing's button: its gold, what it does, and why it can't be had now (disabled, said on hover). */
function deal(label: El | string, cost: number, why: string | null, title: string, onclick: () => void): El {
  return h('button.cv-btn.small', { onclick, disabled: !!why, title: why ?? title }, label, icon('gold', 13, '#f6cf4a'), String(cost));
}

function card(c: ClanWire): El {
  const v = store.view!;
  const unit = UNITS[c.unit]?.name ?? c.unit;
  const raid = c.raid;
  const chip = raid?.target === v.you ? h('span.cv-chip.bad', {}, icon('war', 12), 'Raiding you') : raid?.mine ? h('span.cv-chip.good', {}, icon('war', 12), `Raiding ${nameOf(raid.target)}`) : c.bribed ? h('span.cv-chip.good', {}, icon('peace', 12), 'Bribed') : h('span.cv-chip', {}, 'Hostile');
  const facts: El[] = [];
  if (c.bribed) facts.push(h('span', {}, icon('peace', 13, '#6fd27a'), `Leaves you alone for ${turns(c.bribed)}`));
  if (raid?.mine) facts.push(h('span', {}, icon('war', 13, '#f0a24a'), `Raids ${nameOf(raid.target)} for you for ${turns(raid.turns)}`));
  if (raid && raid.target === v.you) facts.push(h('span', {}, icon('war', 13, '#ff6b5e'), `Paid to raid you, for ${turns(raid.turns)}`));
  return h(
    `div.cl-card${c.bribed || raid?.mine ? '.paid' : ''}`,
    {},
    h(
      'div.cs-head',
      {},
      h('span', { 'data-pedia': 'concept:barbarians' }, emblemEl('barbarian', 40)),
      h('div.cv-grow', {}, h('b.cs-name', {}, `The ${c.name} clan`), h('small.cv-muted', {}, 'A barbarian camp')),
      chip,
    ),
    h(
      'div.cs-row',
      { title: c.settles ? 'Left alone, it grows (paid, and as its raiders pillage, faster; its raiders killed set it back), and settles as a city-state where its camp is.' : 'It can’t settle where it is: in a civ’s land, close by a city, or with no city-state left to become. It grows all the same.' },
      h('div.cv-label', { style: 'white-space:nowrap' }, c.settles ? 'Toward a city-state' : 'Can’t settle here'),
      h(`div.cv-bar.${c.settles ? 'green' : ''}`, { style: 'flex:1' }, h('i', { style: `width:${c.growth}%` })),
      h('b.cs-num', {}, `${c.growth}%`),
    ),
    facts.length ? h('div.cs-row.cs-facts', {}, ...facts) : null,
    h(
      'div.cs-acts',
      {},
      deal('Bribe', c.cost.bribe, c.why.bribe, 'Its raiders leave you (and your team) alone for a while', () => send({ t: 'clan', clan: c.id, act: 'bribe', target: null })),
      deal(h('span.cl-hire', {}, icon(unitGlyph(c.unit), 13), `Hire a ${unit}`), c.cost.hire, c.why.hire, `A ${unit} of the clan joins you, by its camp`, () => send({ t: 'clan', clan: c.id, act: 'hire', target: null })),
      deal('Pay to raid…', c.cost.incite, c.why.incite, 'Its raiders go after a civ you choose, for a while: that civ will learn of it, and may learn who paid', () => {
        choosing = choosing === c.id ? null : c.id;
        store.changed++;
      }),
      h('span.cv-grow'),
      h('button.cv-btn.small.icon', { onclick: () => goTo(c.tile), title: 'Show its camp on the map' }, icon('globe', 14)),
    ),
    choosing === c.id && !c.why.incite
      ? h(
          'div.cl-prey',
          {},
          h('small.cv-muted', {}, 'Raid whom?'),
          ...c.targets.map((t) =>
            h(
              'button.cv-chip',
              {
                onclick: () => {
                  choosing = null;
                  ask(`Pay the ${c.name} clan ${c.cost.incite} gold to raid ${nameOf(t)}? ${nameOf(t)} will learn of it, and may learn it was you.`, 'Pay them', () => send({ t: 'clan', clan: c.id, act: 'incite', target: t }));
                },
              },
              emblemEl(v.players[t].civ, 14),
              nameOf(t),
            ),
          ),
        )
      : null,
  );
}

/** The clans' page: each clan whose camp you've found, nearest to settling first. */
export function renderClans(): El[] {
  const clans = [...(store.view?.clans ?? [])].sort((a, b) => b.growth - a.growth);
  if (!clans.length) return [h('div.cv-muted', {}, 'You haven’t found a barbarian camp. Explore!')];
  return [
    h('small.cv-muted', {}, 'Every barbarian camp is a clan’s. Bribe one to leave you alone, hire its warriors, or pay it to raid a rival. Left alone, a clan grows, and in time settles down as a city-state.'),
    ...clans.map(card),
  ];
}

export const CLANS_CSS = `
.cl-card { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; background: rgba(255,255,255,.035); box-shadow: inset 0 0 0 2px #11141a, inset 4px 0 0 #b8432f; }
.cl-card.paid { box-shadow: inset 0 0 0 2px #11141a, inset 4px 0 0 #6fd27a; }
.cl-prey { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.cl-prey .cv-chip { cursor: pointer; display: inline-flex; align-items: center; gap: 5px; }
`;
