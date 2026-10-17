import type { CityWire, SelfWire, UnitWire } from '../protocol';
import { BELIEF_LIST, BELIEFS } from '../rules/religion';
import { CHOOSABLE, type GreatKind } from '../rules/effects';
import { PROMOTIONS } from '../rules/promotions';
import { TECHS } from '../rules/techs';
import { UNITS } from '../rules/units';
import { emblemEl, icon, svg } from './icons';
import { ask, cityAt, store, teammate } from './store';
import { teamMark } from './lobby';
import { VICTORIES } from './concepts';
import { within } from '../rules/hex';
import { bigTitle, h, itemArt, pic, send, tile, togglePanel, type El } from './ui';

/**
 * The wider game's panels: religion (a pantheon, founding and enhancing a religion with a Great
 * Prophet), city-states (influence, gifts), trade routes and espionage, the victories (how near each
 * is), and the extra things a unit or a city can do (promotions, great people, missionaries, trade
 * routes, a captured city's fate, faith purchases).
 */

const religionName = (id: string | null | undefined) => (id ? (store.view?.religions.find((r) => r.id === id)?.name ?? id) : 'None');

// -------------------------------------------------------------------------------------------------
// A unit's extra actions
// -------------------------------------------------------------------------------------------------

/**
 * The extra things a unit can do, as buttons (`act`: one with what it does; `more.why`: why it can't
 * now, the button off; `more.pedia`: its hover card's article) and lines under them.
 */
export function unitExtras(u: UnitWire, act: (label: string, o: Parameters<typeof send>[0] | (() => void), title?: string, more?: { why?: string | null; pedia?: string }) => void): El[] {
  const out: El[] = [];
  const type = UNITS[u.type];
  const inCity = cityAt(u.tile);
  const mine = inCity?.owner === store.view!.you;
  // Promotions earned, to choose from (what each does shown), and those taken.
  if ((u.promotionsDue ?? 0) > 0 && u.promotionOptions?.length)
    out.push(
      h(
        'div.cv-promos',
        {},
        h('span', { style: 'display:flex;align-items:center;gap:5px;font-weight:700;color:#ffe3a1' }, icon('xp', 15, '#f2c14e'), `Choose a promotion${(u.promotionsDue ?? 0) > 1 ? ` (${u.promotionsDue} due)` : ''}:`),
        ...u.promotionOptions.map((id) => h('button.cv-promo', { onclick: () => send({ t: 'promote', unit: u.id, promotion: id }), 'data-pedia': `promotion:${id}` }, h('b', {}, PROMOTIONS[id]?.name ?? id), h('small', {}, PROMOTIONS[id]?.text ?? ''))),
      ),
    );
  if (u.promotions?.length)
    out.push(h('div.cv-proms', {}, ...u.promotions.map((id) => h('div', { 'data-pedia': `promotion:${id}` }, icon('xp', 12, '#f2c14e'), h('b', {}, PROMOTIONS[id]?.name ?? id), h('span.cv-muted', {}, PROMOTIONS[id]?.text ?? '')))));
  // Great people.
  switch (u.type) {
    case 'great_scientist':
      act('Discover technology', { t: 'greatPerson', unit: u.id, action: 'discover' }, 'Science toward your research: about eight turns of it.');
      act('Build Academy', { t: 'greatPerson', unit: u.id, action: 'improvement' }, '+3 science on this tile, for good.');
      break;
    case 'great_engineer':
      act('Hurry production', { t: 'greatPerson', unit: u.id, action: 'hurry' }, 'In one of your cities: a great deal of production toward what it builds (wonders too).');
      act('Build Manufactory', { t: 'greatPerson', unit: u.id, action: 'improvement' }, '+3 production on this tile, for good.');
      break;
    case 'great_merchant':
      act('Trade mission', { t: 'greatPerson', unit: u.id, action: 'trade' }, 'A large sum of gold.');
      act('Build Customs House', { t: 'greatPerson', unit: u.id, action: 'improvement' }, '+3 gold on this tile, for good.');
      break;
    case 'great_artist':
      act('Create Great Work', { t: 'greatPerson', unit: u.id, action: 'work' }, 'A great work of art in an empty slot (tourism).');
      act('Golden age', { t: 'greatPerson', unit: u.id, action: 'golden' });
      break;
    case 'great_writer':
      act('Create Great Work', { t: 'greatPerson', unit: u.id, action: 'work' }, 'A great work of writing in an empty slot (tourism).');
      act('Political treatise', { t: 'greatPerson', unit: u.id, action: 'culture' }, 'Culture toward your next policy.');
      break;
    case 'great_musician': {
      act('Create Great Work', { t: 'greatPerson', unit: u.id, action: 'work' }, 'A great work of music in an empty slot (tourism).');
      // A Concert Tour: spent in another civ's land, at peace with it, a burst of tourism toward it.
      const host = store.view!.players[store.known[u.tile]?.owner ?? -1];
      const why = !host || host.index === store.view!.you || host.cityState || host.civ === 'barbarian' ? "Take it into another civilization's land first" : host.war ? `Not while you're at war with ${host.name}` : null;
      act('Concert Tour', { t: 'greatPerson', unit: u.id, action: 'concert' }, `Spends it on a tour of ${host && !why ? `${host.name}'s land` : "another civilization's land"}: about ten turns of your tourism toward ${host && !why ? 'them' : 'its people'} at once, on the way to a culture victory.`, { why, pedia: 'concept:tourism' });
      if (why) out.push(h('small.cv-muted.cv-why', {}, `Concert Tour: ${why}.`));
      break;
    }
    case 'great_admiral': {
      // Repair Fleet: every damaged ship of yours on its tile and beside it as good as new.
      const near = new Set(within(store.grid!, u.tile, 1));
      const ships = store.view!.units.filter((x) => x.owner === u.owner && UNITS[x.type]?.domain === 'sea' && near.has(x.tile) && x.hp < 100);
      const why = ships.length ? null : 'No damaged ship of yours here or beside it';
      act('Repair Fleet', { t: 'greatPerson', unit: u.id, action: 'repair' }, `Spends it to heal every damaged ship of yours on its tile and beside it${ships.length ? ` (${ships.length} now)` : ''}, fully.`, { why, pedia: `unit:${u.type}` });
      if (why) out.push(h('small.cv-muted.cv-why', {}, `Repair Fleet: ${why}.`));
      break;
    }
    case 'great_general':
      act('Build Citadel', { t: 'greatPerson', unit: u.id, action: 'improvement' }, 'A fortress that claims the land around it, even another civ’s (they won’t like it); units in it defend far better, and enemies beside it are hurt each turn.');
      break;
    case 'great_prophet': {
      // (Founding while the world has room for another religion; enhancing a religion of yours not yet enhanced.)
      const s = store.view!.self;
      const rel = s.religion ? store.view!.religions.find((r) => r.id === s.religion) : undefined;
      if (mine && (rel ? rel.beliefs.length < 4 : s.religionsLeft > 0)) act(rel ? 'Enhance religion' : 'Found religion', () => ((store.panel = 'religion'), (store.prophet = u.id), store.changed++));
      if (store.view!.self.religion) act('Spread religion', { t: 'spread', unit: u.id });
      act('Build Holy Site', { t: 'greatPerson', unit: u.id, action: 'improvement' }, '+3 faith on this tile, for good.');
      break;
    }
    case 'missionary':
      act('Spread religion', { t: 'spread', unit: u.id }, 'In or next to a city: convert many of its people.');
      break;
    case 'inquisitor':
      act('Remove heresy', { t: 'inquisition', unit: u.id }, 'In or next to one of your cities: drive other religions out.');
      break;
  }
  if (u.religion) out.push(h('div.cv-row', { style: 'gap:6px;font-size:12px' }, icon('faith', 14, '#e8e2d0'), h('span.cv-muted', {}, `${religionName(u.religion)} · ${u.spreads ?? 0} spreads left`)));
  // Trade routes.
  if (type?.abilities?.includes('trade_route')) {
    const self = store.view!.self;
    // (Every route it can have is running: one ends, or a tech opens another.)
    if (self.routes.length >= self.maxRoutes) out.push(h('div.cv-muted', { style: 'font-size:12px' }, `All ${self.maxRoutes} of your trade routes are running: send it when one ends (more come with techs). Sleep it till then.`));
    else if (!u.destinations) out.push(h('div.cv-muted', { style: 'font-size:12px' }, 'Move it into (or next to) one of your cities to start a trade route from there.'));
    else if (!u.destinations.length) out.push(h('div.cv-muted', { style: 'font-size:12px' }, 'No city in reach to trade with.'));
    else
      out.push(
        h(
          'div',
          {},
          h('div.cv-label', { style: 'margin-bottom:3px' }, 'Open a trade route to'),
          h(
            'div.cv-dests.cv-scroll',
            {},
            ...u.destinations.map((d) => {
              const owner = store.view!.cities.find((c) => c.id === d.city)?.owner ?? -1;
              const p = store.view!.players[owner];
              // A route home carries food or production, as chosen on its toggle (food unless said).
              const cargo = d.home ? (cargoChoice.get(d.city) ?? 'food') : undefined;
              const choose = (c: 'food' | 'prod') => () => (cargoChoice.set(d.city, c), store.changed++);
              const row = h(
                'div.cv-opt',
                { style: 'cursor:pointer', title: d.home ? `Open the route, carrying ${cargo === 'prod' ? 'production' : 'food'}` : 'Open the route' },
                p ? emblemEl(p.civ, 22, p.cityState?.kind) : null,
                h('div.cv-grow', {}, h('div.n', {}, d.name), d.home && h('small.cv-muted', {}, 'Home: it carries food or production')),
                d.gold > 0 && h('span.y-gold', { style: 'display:flex;gap:3px;align-items:center;font-weight:700' }, icon('gold', 13), `+${d.gold}`),
                d.science > 0 && h('span.y-science', { style: 'display:flex;gap:3px;align-items:center;font-weight:700' }, icon('science', 13), `+${d.science}`),
                !d.home && d.food > 0 && h('span.y-food', { style: 'display:flex;gap:3px;align-items:center;font-weight:700' }, icon('food', 13), `+${d.food}`),
                d.home &&
                  h(
                    'div.cv-cargo',
                    {},
                    h(`button${cargo === 'food' ? '.on' : ''}`, { onclick: choose('food'), title: `Carry food: +${d.food} a turn to ${d.name}` }, icon('food', 13), `+${d.food}`),
                    h(`button${cargo === 'prod' ? '.on' : ''}`, { onclick: choose('prod'), title: `Carry production: +${d.prod} a turn to ${d.name}` }, icon('prod', 13), `+${d.prod}`),
                  ),
              );
              row.addEventListener('click', () => send({ t: 'trade', unit: u.id, to: d.city, cargo }));
              return row;
            }),
          ),
        ),
      );
  }
  return out;
}

/** What each route home being drawn up would carry, by its city (food unless the toggle says production). */
const cargoChoice = new Map<number, 'food' | 'prod'>();

// -------------------------------------------------------------------------------------------------
// A city's extras
// -------------------------------------------------------------------------------------------------

/** Enemy units a city could fire at now (within two tiles, in sight). */
export function cityTargets(city: CityWire): number[] {
  const v = store.view!;
  if (city.fired || !store.grid) return [];
  return within(store.grid, city.tile, 2).filter((t) => t !== city.tile && store.known[t]?.visible && v.units.some((u) => u.tile === t && u.owner !== v.you && v.players[u.owner]?.war));
}

/** A city's ranged attack (when there's an enemy in reach), and a captured city's fate. */
export function cityAlerts(city: CityWire): El[] {
  const out: El[] = [];
  const targets = cityTargets(city);
  if (targets.length)
    out.push(
      h(
        'div.cv-alert',
        { style: 'background:rgba(255,90,74,.1);border-color:rgba(255,90,74,.4)' },
        icon('ranged', 16, '#ff8a7a'),
        h('span.cv-grow', {}, `${targets.length} enem${targets.length === 1 ? 'y' : 'ies'} in reach of the walls (strength ${city.strength}).`),
        h(
          'button.cv-btn.small.danger',
          {
            onclick: () => {
              if (targets.length === 1) send({ t: 'cityFire', city: city.id, target: targets[0] });
              else {
                store.cityTarget = city.id;
                store.selectedCity = null;
                store.changed++;
              }
            },
            title: 'The city fires once a turn at a unit up to two tiles away',
          },
          icon('target', 13),
          'Fire',
        ),
      ),
    );
  if (city.razing) out.push(h('div.cv-alert', {}, icon('war', 16, '#ffb36b'), h('span.cv-grow', {}, `Being razed: gone in ${city.razing} turns.`), h('button.cv-btn.small', { onclick: () => send({ t: 'cityChoice', city: city.id, choice: 'annex' }) }, 'Stop: annex it')));
  else if (city.puppet)
    out.push(
      h(
        'div.cv-alert',
        { style: 'flex-direction:column;align-items:stretch;gap:6px' },
        h('div.cv-row', { style: 'gap:6px' }, icon('info', 16, '#ffb36b'), h('b', { style: 'font-size:14px' }, 'A puppet chooses its own builds')),
        h('span', {}, 'It makes less science and culture, nothing can be bought there, and its people don’t mind the occupation. Annexed, it takes your orders, but it’s unhappy as occupied till it has a Courthouse.'),
        h(
          'div.cv-row',
          { style: 'gap:6px' },
          h('button.cv-btn.small', { onclick: () => send({ t: 'cityChoice', city: city.id, choice: 'annex' }), title: 'It takes your orders, but its people are unhappy at the occupation till it has a Courthouse' }, 'Annex'),
          city.canRaze && h('button.cv-btn.small.danger', { onclick: () => ask(`Raze ${city.name} to the ground? It loses a citizen each turn until it's gone, with any wonders in it.`, 'Raze it', () => send({ t: 'cityChoice', city: city.id, choice: 'raze' })) }, 'Raze'),
        ),
      ),
    );
  else if (city.occupied || city.resistance) {
    // (In resistance it makes nothing but food; annexed, its people are unhappy till a Courthouse calms them.)
    const coming = city.queue?.some((q) => q.kind === 'building' && q.id === 'courthouse');
    const said = [
      city.resistance ? `In resistance for ${city.resistance} more turn${city.resistance === 1 ? '' : 's'}: it makes nothing but food till then` : '',
      city.occupied ? `Occupied: its people are unhappy at the occupation till it has a Courthouse${coming ? ' (one is on the way)' : ''}` : '',
    ].filter(Boolean);
    out.push(h('div.cv-alert', {}, icon('info', 16, '#ffb36b'), `${said.join('. ')}.`));
  }
  return out;
}

// -------------------------------------------------------------------------------------------------
// Religion
// -------------------------------------------------------------------------------------------------

const draft: { founder?: string; follower?: string; enhancer?: string; name: string } = { name: '' };
const BELIEF_COLOR: Record<string, string> = { pantheon: '#8a7a4a', founder: '#b8892a', follower: '#3a7ac0', enhancer: '#7a5aa8', reformation: '#3f8f6f' };

export function renderReligion(): El {
  const v = store.view!;
  const s = v.self;
  const taken = new Set(s.takenBeliefs);
  const prophet = v.units.find((u) => u.id === store.prophet && u.type === 'great_prophet' && u.owner === v.you);
  const rel = s.religion ? v.religions.find((r) => r.id === s.religion) : null;
  const pick = (kind: 'pantheon' | 'founder' | 'follower' | 'enhancer' | 'reformation', chosen: string | undefined, choose: (id: string) => void) =>
    h(
      'div.cv-beliefs',
      {},
      ...BELIEF_LIST.filter((b) => b.kind === kind && !taken.has(b.id)).map((b) => h(`button.cv-pol${chosen === b.id ? '.have' : '.can'}`, { onclick: () => choose(b.id), 'data-pedia': `belief:${b.id}` }, h('b', {}, b.name), h('small', {}, b.text))),
    );
  const sections: (El | null | false)[] = [];
  // A pantheon.
  if (!s.pantheon) {
    const enough = s.faith >= s.pantheonCost;
    sections.push(h('div.cv-h', {}, 'Found a pantheon'), h('small.cv-muted', {}, enough ? 'Choose a belief for your people:' : `It needs ${s.pantheonCost} faith (you have ${s.faith}).`));
    if (enough) sections.push(pick('pantheon', undefined, (id) => send({ t: 'pantheon', belief: id })));
  } else sections.push(h('div.cv-card.cv-row', {}, tile('faith', BELIEF_COLOR.pantheon, 34), h('div', {}, h('div.cv-label', {}, 'Pantheon'), h('b', {}, BELIEFS[s.pantheon]?.name ?? ''), h('div.cv-muted', { style: 'font-size:12px' }, BELIEFS[s.pantheon]?.text ?? ''))));
  // Founding or enhancing.
  if (prophet && (!rel || rel.beliefs.length < 4)) {
    const founding = !rel;
    sections.push(h('div.cv-h', { style: 'margin-top:8px' }, founding ? 'Found your religion' : `Enhance ${rel!.name}`));
    if (founding) {
      const input = h('input.cv-input', { placeholder: 'Its name (or leave blank for one)', value: draft.name, maxlength: '30', style: 'max-width:360px' }) as HTMLInputElement;
      input.addEventListener('input', () => (draft.name = input.value));
      input.addEventListener('keydown', (e) => e.stopPropagation());
      sections.push(input, h('div.cv-label', {}, 'A founder belief (for you)'), pick('founder', draft.founder, (id) => ((draft.founder = id), store.changed++)));
    } else sections.push(h('div.cv-label', {}, 'An enhancer belief'), pick('enhancer', draft.enhancer, (id) => ((draft.enhancer = id), store.changed++)));
    sections.push(h('div.cv-label', {}, 'A follower belief (for every city that follows it)'), pick('follower', draft.follower, (id) => ((draft.follower = id), store.changed++)));
    const beliefs = [founding ? draft.founder : draft.enhancer, draft.follower].filter(Boolean) as string[];
    sections.push(
      h(
        'div',
        {},
        h(
          'button.cv-btn.gold',
          {
            disabled: beliefs.length < 2,
            onclick: () => {
              send({ t: 'religion', unit: prophet.id, name: draft.name, beliefs });
              draft.founder = draft.follower = draft.enhancer = undefined;
              store.panel = null;
              store.changed++;
            },
          },
          icon('faith', 15),
          founding ? 'Found it' : 'Enhance it',
        ),
      ),
    );
  } else if (!rel) {
    const turns = s.faithPerTurn > 0 ? Math.max(0, Math.ceil((s.prophetCost - s.faith) / s.faithPerTurn)) : null;
    sections.push(
      s.religionsLeft > 0
        ? h(
            'div.cv-card',
            {},
            h('div.cv-row', {}, tile('faith', '#7a6a9a', 34), h('div.cv-grow', {}, h('b', {}, `${s.religionsLeft} more religion${s.religionsLeft === 1 ? '' : 's'} can still be founded`), h('div.cv-muted', { style: 'font-size:12px' }, 'With a pantheon, faith brings a Great Prophet; take it to one of your cities to found a religion of your own (it keeps your place till then).'))),
            h('div', { style: 'margin-top:8px' }, h('div.cv-label', {}, `Toward a Great Prophet: ${s.faith} of ${s.prophetCost} faith${!s.pantheon ? ' · after a pantheon' : turns !== null ? ` · ${turns ? `${turns} turn${turns === 1 ? '' : 's'}` : 'next turn'}` : ' · no faith coming in: build a Shrine'}`), h('div.cv-bar.purple', {}, h('i', { style: `width:${Math.min(100, Math.round((s.faith / Math.max(1, s.prophetCost)) * 100))}%` }))),
          )
        : h('div.cv-card.cv-muted', {}, 'No religion is left for you to found: the world’s room for them is taken, or kept for Great Prophets already born. Your cities can still follow one: missionaries and trade routes carry them.'),
    );
  }
  // Reformation (with the Piety policies finished): one more belief, for good.
  if (rel && s.reformation)
    sections.push(
      h('div.cv-h', { style: 'margin-top:8px' }, `Reform ${rel.name}`),
      h('small.cv-muted', {}, "A Reformation belief, for good (if you don't choose by the turn's end, one is chosen for you):"),
      pick('reformation', undefined, (id) => send({ t: 'reformation', belief: id })),
    );
  if (rel)
    sections.push(
      h(
        'div.cv-card',
        {},
        h('div.cv-row', {}, tile('faith', '#7a6a9a', 34), h('div', {}, h('b', { style: 'font-size:14px' }, rel.name), h('div.cv-muted', { style: 'font-size:12px' }, `Followed in ${rel.cities} cities · holy city ${rel.holyCity}`))),
        h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;margin-top:8px' }, ...rel.beliefs.map((b) => h('span.cv-chip', { 'data-pedia': `belief:${b}` }, BELIEFS[b]?.name ?? b))),
      ),
    );
  // The world's religions.
  sections.push(
    h('div.cv-h', { style: 'margin-top:8px' }, 'Religions of the world'),
    v.religions.length
      ? h(
          'div',
          { style: 'display:flex;flex-direction:column;gap:6px' },
          ...v.religions.map((r) =>
            h('div.civrow', {}, emblemEl(v.players[r.founder]?.civ ?? '', 26), h('div.who', {}, h('b', {}, r.name), h('small', {}, `Founded by ${v.players[r.founder]?.name} · ${r.cities} cities · ${r.beliefs.map((b) => BELIEFS[b]?.name ?? b).join(', ')}`))),
          ),
        )
      : h('small.cv-muted', {}, 'None yet.'),
    // (Only once there's a religion to spread: before, they can't be bought.)
    v.religions.length > 0 && h('small.cv-muted', {}, `Faith buys a Missionary for ${s.faithCosts.missionary} or an Inquisitor for ${s.faithCosts.inquisitor}, in a city of your religion (open the city).`),
  );
  return h('div.cv-big.cv-panel', {}, ...bigTitle('faith', '#7a6a9a', 'Religion', `Faith ${s.faith} (+${s.faithPerTurn} a turn)`, 'religion'), h('div.cv-scroll', { style: 'flex:1;display:flex;flex-direction:column;gap:8px' }, ...sections));
}

// -------------------------------------------------------------------------------------------------
// Trade routes and espionage
// -------------------------------------------------------------------------------------------------

/** What a spy in a civ's city is doing: watching it, working toward a theft (and how long it has to go), or why it can't steal there. */
function spyStatus(spy: SelfWire['spies'][number]): El | null {
  if (!spy.cityName) return null;
  if (spy.why) return h('small.cv-muted', {}, spy.why);
  if (spy.watch) return h('small.cv-muted', {}, `Getting to know the city: ${spy.watch} turn${spy.watch === 1 ? '' : 's'}`);
  if (spy.need === null || !spy.perTurn) return null;
  const turns = Math.max(1, Math.ceil((spy.need - spy.progress) / spy.perTurn));
  return h('small.cv-muted', {}, `${Math.round(spy.progress)} of ${spy.need} toward a theft (${turns} turn${turns === 1 ? '' : 's'})`);
}

export function renderEspionage(): El {
  const v = store.view!;
  const s = v.self;
  const targets = v.cities.filter((c) => c.owner !== v.you && !v.players[c.owner]?.cityState && v.players[c.owner]?.civ !== 'barbarian');
  const ballots = v.cities.filter((c) => v.players[c.owner]?.cityState);
  const mine = v.cities.filter((c) => c.owner === v.you);
  const spies = s.spies.map((spy, i) => {
    const select = h('select.cv-input', {}) as HTMLSelectElement;
    // (A diplomat's place is its city's id with a 'd'.)
    const now = spy.city === null ? '' : `${spy.diplomat ? 'd' : ''}${spy.city}`;
    const opt = (value: string, label: string) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      if (value === now) o.selected = true;
      select.append(o);
    };
    opt('', 'In reserve');
    for (const c of mine) opt(String(c.id), `${c.name} (guarding)`);
    for (const c of targets) {
      opt(String(c.id), `${c.name} (${v.players[c.owner]?.name}: steal technology)`);
      // Another civ's capital, at peace with it: a diplomat there instead.
      if (c.capital && !v.players[c.owner]?.war) opt(`d${c.id}`, `${c.name} (${v.players[c.owner]?.name}: as a diplomat)`);
    }
    for (const c of ballots) opt(String(c.id), `${c.name} (city-state: rig its elections)`);
    select.addEventListener('change', () => {
      const diplomat = select.value.startsWith('d');
      const target = select.value ? +select.value.replace('d', '') : null;
      send({ t: 'spy', spy: spy.id, target, ...(diplomat ? { diplomat: true } : {}) });
    });
    select.addEventListener('click', (e) => e.stopPropagation());
    // A coup, in a city-state allied to another civ: its odds, or why not; failure costs the spy.
    const coup = spy.coup;
    const odds = coup ? Math.round(coup.chance * 100) : 0;
    const coupButton =
      coup &&
      h(
        'button.cv-btn.small.danger',
        {
          disabled: !!coup.why,
          title: coup.why ?? `A ${odds}% chance to make ${spy.cityName} your ally in place of its ally (your influence and theirs swapped); if it fails, your spy is caught and killed`,
          onclick: () => ask(`Attempt a coup in ${spy.cityName}? A ${odds}% chance to make it your ally; if it fails, your spy is caught and killed.`, `Coup (${odds}%)`, () => send({ t: 'coup', spy: spy.id })),
        },
        `Coup (${odds}%)`,
      );
    const status = spy.diplomat
      ? h('small.cv-muted', {}, `A diplomat: steals nothing; tells you of ${(v.players[v.cities.find((c) => c.id === spy.city)?.owner ?? -1]?.name ?? 'their leader') + '’s'} plans for war, and is a World Congress delegate with Globalization. A war brings it home.`)
      : spy.election !== null
        ? h('small.cv-muted', {}, `Election in ${spy.election} turns (+20 influence)`)
        : spyStatus(spy);
    return h(
      `div.civrow${spy.diplomat ? '.diplomat' : ''}`,
      {},
      tile(spy.diplomat ? 'scroll' : 'spy', spy.diplomat ? '#3a6a9a' : '#3a4a5a', 34),
      h('b', {}, spy.diplomat ? `Diplomat ${i + 1}` : `Agent ${i + 1}`),
      select,
      status,
      coupButton,
      coup?.why && h('small.cv-muted.cv-why', {}, `Coup: ${coup.why}.`),
    );
  });
  const routes = s.routes.map((r) =>
    h(
      'div.civrow',
      {},
      pic('u_caravan', 36),
      h('div.who', {}, h('b', {}, `${r.from} → ${r.to}`), h('small', {}, `${r.turns} turns left`)),
      r.gold > 0 && h('span.y-gold.cv-row', { style: 'gap:3px;font-weight:700' }, icon('gold', 13), `+${r.gold}`),
      r.science > 0 && h('span.y-science.cv-row', { style: 'gap:3px;font-weight:700' }, icon('science', 13), `+${r.science}`),
      r.food > 0 && h('span.y-food.cv-row', { style: 'gap:3px;font-weight:700' }, icon('food', 13), `+${r.food}`),
      r.prod > 0 && h('span.y-prod.cv-row', { style: 'gap:3px;font-weight:700' }, icon('prod', 13), `+${r.prod}`),
    ),
  );
  return h(
    'div.cv-diplo.cv-panel',
    {},
    h('button.cv-x', { onclick: () => togglePanel('espionage'), html: svg('close', 15) }),
    h('div.cv-row', {}, tile('trade', '#8a6a3a', 40), h('div', {}, h('div.cv-h.big', {}, 'Trade & espionage'), h('small.cv-muted', {}, `${s.routes.length} of ${s.maxRoutes} trade routes · ${s.spies.length} spies`))),
    h(
      'div.list.cv-scroll',
      {},
      h('div.cv-label', {}, 'Trade routes'),
      ...(routes.length ? routes : [h('div.cv-muted', {}, s.maxRoutes ? 'Build a Caravan (or a Cargo Ship) and send it from one of your cities.' : 'Animal Husbandry opens trade routes.')]),
      h('div.cv-label', { style: 'margin-top:10px' }, 'Espionage'),
      ...(spies.length ? spies : [h('div.cv-muted', {}, 'Spies join you from the Renaissance.')]),
      spies.length > 0 && h('small.cv-muted', {}, 'A spy sent to another civ’s capital “as a diplomat” steals nothing: it tells you of their plans for war, and with Globalization it’s a World Congress delegate for you. A war calls it home.'),
    ),
  );
}

// -------------------------------------------------------------------------------------------------
// Victory
// -------------------------------------------------------------------------------------------------

/**
 * The World Leader vote as it would go now: each candidate's delegates against those needed, with the
 * city-states behind them, and a warning (with what to do about it) when someone else could win it.
 */
function worldLeaderRace(): (El | null)[] {
  const v = store.view!;
  const tally = v.unVotes;
  if (!tally) return [];
  const allies = (i: number) => v.players.filter((p) => p.cityState?.ally === i).length;
  const rows = tally.votes.map((x) =>
    h(
      'div.cv-row',
      {},
      emblemEl(v.players[x.candidate]?.civ ?? '', 18),
      h('small', { style: 'width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, x.candidate === v.you ? 'You' : (v.players[x.candidate]?.name ?? '?')),
      h(`div.cv-bar.${x.candidate === v.you ? 'gold' : 'green'}`, { style: 'flex:1' }, h('i', { style: `width:${Math.round(Math.min(1, x.votes / tally.needed) * 100)}%` })),
      h('small.cv-muted', { style: 'width:120px;text-align:right', title: 'Delegates of those needed, and the city-states whose ally it is' }, `${x.votes} / ${tally.needed} · ${allies(x.candidate)} allies`),
    ),
  );
  const threat = tally.votes.find((x) => x.candidate !== v.you && x.votes >= tally.needed - 2);
  return [
    h('small.cv-muted', {}, v.un === null ? 'If the vote were held now:' : 'As it stands:'),
    ...rows,
    threat
      ? h('div.cv-muted', { style: 'font-size:12px;color:#ff9a8e' }, `${v.players[threat.candidate]?.name} is within reach of the World Leader vote. Win their city-states from them (gifts of gold, or a spy rigging their elections) and keep your vote, and your friends', away from them.`)
      : null,
  ];
}

export function renderVictory(): El {
  const v = store.view!;
  const s = v.self;
  const majors = v.players.filter((p) => !p.cityState && p.civ !== 'barbarian');
  const bar = (frac: number, cls = 'gold') => h(`div.cv-bar.${cls}`, { style: 'flex:1' }, h('i', { style: `width:${Math.round(Math.min(1, frac) * 100)}%` }));
  // (Each way's head shows its Civilopedia card: the article named as the card is.)
  const card = (glyph: string, bg: string, title: string, sub: string, ...body: (El | null | false)[]) =>
    h('div.cv-card', { style: 'display:flex;flex-direction:column;gap:6px' }, h('div.cv-row', { 'data-pedia': `victory:${VICTORIES.find((x) => x.name === title)?.id ?? ''}` }, tile(glyph, bg, 34), h('div', {}, h('b', { style: 'font-size:13.5px' }, title), h('div.cv-muted', { style: 'font-size:12px' }, sub))), ...body);
  const parts = s.spaceship.reduce((n, x) => n + x.have, 0);
  const total = s.spaceship.reduce((n, x) => n + x.count, 0);
  // With teams, each team is a side (its civs' scores together); a civ on none is one by itself.
  const teams = majors.some((p) => typeof p.team === 'number');
  const sides = [...new Set(majors.map((p) => (typeof p.team === 'number' ? `t${p.team}` : `c${p.index}`)))]
    .map((key) => {
      const members = majors.filter((p) => (typeof p.team === 'number' ? `t${p.team}` : `c${p.index}`) === key);
      return { team: members[0].team, members, score: members.reduce((n, p) => n + p.score, 0) };
    })
    .sort((a, b) => b.score - a.score);
  const standing = sides.filter((x) => x.members.some((p) => p.alive)).length;
  return h(
    'div.cv-diplo.cv-panel',
    {},
    h('button.cv-x', { onclick: () => togglePanel('victory'), html: svg('close', 15) }),
    h('div.cv-row', {}, tile('golden', '#b8892a', 40), h('div', {}, h('div.cv-h.big', {}, 'Victory'), h('small.cv-muted', {}, 'Four ways to win, and the score if the turns run out.'))),
    h(
      'div.list.cv-scroll',
      {},
      card('war', '#b8432f', 'Domination', teams ? 'Hold every original capital (a team, between its civs).' : 'Hold every original capital.', h('div.cv-muted', { style: 'font-size:12px' }, teams ? `${standing} side${standing === 1 ? '' : 's'} still stand${standing === 1 ? 's' : ''}.` : `${majors.filter((p) => p.alive).length} civilizations still stand.`)),
      card(
        'rocket',
        '#3a5a9a',
        'Science',
        s.apollo ? 'The Apollo Program is built: build the spaceship.' : `Build the Apollo Program (${TECHS.rocketry?.name ?? 'Rocketry'}), then the spaceship.`,
        h('div.cv-row', {}, h('small.cv-muted', { style: 'width:110px' }, `${parts} / ${total} parts`), bar(parts / Math.max(1, total), '')),
        h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px' }, ...s.spaceship.map((x) => h(`span.cv-chip${x.have >= x.count ? '.good' : ''}`, { title: `Needs ${TECHS[x.tech]?.name ?? x.tech}` }, `${x.name} ${x.have}/${x.count}`))),
      ),
      card(
        'tourism',
        '#7a4aa8',
        'Culture',
        `Be influential over every civilization${teams ? ' not on your team' : ''}, from the Industrial Era (your tourism: ${s.tourism} a turn).`,
        ...majors.filter((p) => p.index !== v.you && p.alive && p.met && !teammate(p.index)).map((p) => h('div.cv-row', {}, emblemEl(p.civ, 18), h('small', { style: 'width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, p.name), bar(p.influence ?? 0), h('small.cv-muted', { style: 'width:36px;text-align:right' }, `${Math.round((p.influence ?? 0) * 100)}%`))),
      ),
      card(
        'vote',
        '#3f8f6f',
        'Diplomacy',
        v.un === null
          ? 'Once someone builds the United Nations, the world votes every ten turns: two delegates a civ (the builder two more), one for each city-state with its ally. More than half of them all wins.'
          : `The United Nations stands (${v.players[v.un]?.name}). Next vote: turn ${v.nextVote}.`,
        ...worldLeaderRace(),
        v.un !== null && h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px' }, h('small.cv-muted', {}, 'Your vote:'), ...majors.filter((p) => p.alive && p.met).map((p) => h(`button.cv-chip${(s.vote ?? v.you) === p.index ? '.on' : ''}`, { onclick: () => send({ t: 'vote', candidate: p.index }) }, p.name))),
      ),
      card(
        'chart',
        '#5a6a7a',
        'Score',
        teams ? 'Who leads if no one wins first: each team by its civs’ scores together.' : 'Who leads if no one wins first.',
        ...(teams
          ? sides.map((x) =>
              h(
                'div.cv-row',
                {},
                typeof x.team === 'number' ? teamMark(x.team) : emblemEl(x.members[0].civ, 18),
                ...(typeof x.team === 'number' ? x.members.map((p) => emblemEl(p.civ, 18)) : []),
                h('small.cv-grow', {}, typeof x.team === 'number' ? `Team ${x.team + 1}: ${x.members.map((p) => p.name).join(', ')}` : x.members[0].name),
                h('b', {}, String(x.score)),
              ),
            )
          : majors
              .slice()
              .sort((a, b) => b.score - a.score)
              .map((p) => h('div.cv-row', {}, emblemEl(p.civ, 18), h('small.cv-grow', {}, p.name), h('b', {}, String(p.score))))),
      ),
    ),
  );
}


// -------------------------------------------------------------------------------------------------
// A free great person (Liberty finished, Hero of the People...)
// -------------------------------------------------------------------------------------------------

/** What each kind of great person is for, in a line. */
const GREAT_ROLE: Partial<Record<GreatKind, string>> = {
  scientist: 'Science toward your research at once, or an Academy.',
  engineer: "Production toward a city's build (wonders too), or a Manufactory.",
  merchant: 'A trade mission for a large sum of gold, or a Customs House.',
  artist: 'A great work of art, or a golden age.',
  writer: 'A great work of writing, or culture toward your next policy.',
  musician: 'A great work of music, for tourism.',
  general: 'Strength for your soldiers near it, or a Citadel.',
  admiral: 'Strength for your ships near it; it heals them.',
};

/** The free great people to choose from: each kind, what it's for; the choice is born by your capital. */
export function renderGreatChoice(): El {
  const v = store.view!;
  const left = v.self.greatChoices;
  const close = () => togglePanel('great');
  return h(
    'div.cv-diplo.cv-panel.gd-win',
    {},
    h('button.cv-x', { onclick: close, html: svg('close', 15), title: 'Close (Esc)' }),
    h('div.cv-row', {}, tile('xp', '#b8892a', 40), h('div', {}, h('div.cv-h.big', {}, left > 1 ? `Choose ${left} free great people` : 'Choose a free great person'), h('small.cv-muted', {}, "Born by your capital. If you don't choose by the turn's end, it's the kind you're nearest to."))),
    h(
      'div.gd-ways.cv-scroll',
      {},
      ...CHOOSABLE.map((kind) => {
        const id = `great_${kind}`;
        return h(
          'button.gd-way',
          {
            'data-pedia': `unit:${id}`,
            onclick: () => {
              send({ t: 'greatChoice', kind });
              if (left <= 1) store.panel = null;
              store.changed++;
            },
          },
          itemArt('unit', id, 34),
          h('div', { style: 'text-align:left' }, h('b', {}, UNITS[id]?.name ?? kind), h('small.cv-muted', {}, GREAT_ROLE[kind])),
        );
      }),
    ),
  );
}
