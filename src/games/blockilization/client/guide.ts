import type { Settings } from '../rules/state';
import { UNITS } from '../rules/units';
import { VICTORIES } from './concepts';
import { icon, svg } from './icons';
import { setLens } from './lenses';
import { openPedia } from './pedia';
import { store } from './store';
import { click, h, idleUnits, openCity, selectUnitAt, tile, togglePanel, touchScreen, type El } from './ui';

/**
 * A new player's guide: the advisor's tips through the first game (found the capital, choose
 * research, the first builds, explore, improve the land, a second city, the lenses, a neighbour, a
 * city-state, barbarians, policies and the rest), each said once when it's the time for it, never in
 * the way, and dismissed for good (the player's preferences keep which); and, as a game begins, a
 * card of the ways to win it.
 */

/** One of the advisor's tips: when it's worth saying, and what its button does. */
export interface Tip {
  key: string;
  title: string;
  text: string;
  when: boolean;
  /** Always true once due (the lenses, the Civilopedia): it waits while something happening now is said. */
  evergreen?: boolean;
  act?: { label: string; run: () => void };
}

const open = (panel: NonNullable<typeof store.panel>) => () => {
  if (store.panel !== panel) togglePanel(panel);
};

/** Every tip, in the order they're worth saying (the advisor says the first due not yet dismissed). */
export function guideTips(): Tip[] {
  const v = store.view!;
  const s = v.self;
  const mine = v.cities.filter((c) => c.owner === v.you);
  const units = v.units.filter((u) => u.owner === v.you);
  const settler = units.find((u) => UNITS[u.type]?.abilities?.includes('found_city'));
  const worker = units.find((u) => u.type === 'worker');
  const idleCity = mine.find((c) => !c.building);
  const improved = store.known.some((k) => k && k.owner === v.you && k.improvement);
  const others = v.players.filter((p) => p.index !== v.you && p.met && p.alive && p.civ !== 'barbarian');
  const neighbour = others.find((p) => !p.cityState);
  const cityState = others.find((p) => p.cityState);
  const barbarian = v.units.some((u) => v.players[u.owner]?.civ === 'barbarian' && store.known[u.tile]?.visible) || store.known.some((k) => k?.camp);
  return [
    { key: 'found', title: 'Found your capital', when: !mine.length && !!settler, text: 'Your Settler founds your first city. Rivers, the coast and grassland make the best start: the Settler lens colours every tile by how good a city would be there. Found it this turn or next.', act: settler && { label: 'Select the Settler', run: () => selectUnitAt(settler.id, settler.tile) } },
    { key: 'research', title: s.techs.length ? 'Choose what to research next' : 'Pick your first technology', when: !s.researching && mine.length > 0, text: `Your scholars need something to study. The advisor’s picks are marked Advised in the tree, with why; ${click()} any later tech and the way there is queued.`, act: { label: 'Open the tech tree', run: open('tech') } },
    { key: 'build', title: 'Your city needs orders', when: !!idleCity, text: 'Choose what your city builds. Early on: a Scout to explore, a Warrior to guard, a Settler to grow, a Worker to farm.', act: idleCity && { label: `Open ${idleCity.name}`, run: () => openCity(idleCity.id) } },
    { key: 'firstbuild', title: 'Your first builds', when: mine.length === 1 && v.turn <= 6 && !!mine[0].building, text: `A Warrior or Scout first, to explore and keep barbarians off; then a Settler for a second city (or a Worker to farm). ${touchScreen() ? 'The + beside each in the city queues several.' : 'Shift-click in the city to queue several.'}`, act: { label: `Open ${mine[0]?.name ?? 'the city'}`, run: () => openCity(mine[0].id) } },
    { key: 'explore', title: 'Explore the world', when: v.turn >= 2 && v.turn < 15 && idleUnits().length > 0, text: touchScreen()
        ? 'Tap a unit, then tap where it should go twice (the first tap shows the way). Ruins hold gifts; the first to find a neighbour or a city-state meets them. The arrow by End turn jumps to the next unit waiting for orders.'
        : 'Click a unit, then where it should go. Ruins hold gifts; the first to find a neighbour or a city-state meets them. Space jumps to the next unit waiting for orders.' },
    {
      key: 'pedia',
      evergreen: true,
      title: 'Anything you want to know',
      when: v.turn >= 3 && mine.length > 0,
      // (On a touch screen there's no hovering, no right button and no keys: a finger held on it is the hover.)
      text: matchMedia('(pointer: coarse)').matches
        ? 'Touch and hold anything with a picture (or a tile) for a short card about it; tap the card for its article in the Civilopedia (in the menu too).'
        : 'Hover anything with a picture for a short card about it; right-click it for its article in the Civilopedia (F1). ? lists every keyboard shortcut.',
      act: { label: 'Open the Civilopedia', run: () => openPedia('concept:basics') },
    },
    { key: 'worker', title: 'Improve your land', when: !!worker && !improved, text: 'Workers build farms (flat land near fresh water), mines (hills), and the right improvement on each resource: a luxury improved makes your whole empire happier. Roads link your cities.', act: worker && { label: 'Select the Worker', run: () => selectUnitAt(worker.id, worker.tile) } },
    { key: 'settler', title: 'Found another city', when: mine.length > 0 && !!settler, text: 'More cities are how an empire grows. With the Settler selected, the Settler lens shows the best sites you know, numbered: food, fresh water, the coast and resources, away from others’ land.', act: settler && { label: 'Select the Settler', run: () => selectUnitAt(settler.id, settler.tile) } },
    { key: 'lenses', evergreen: true, title: 'Lenses', when: v.turn >= 6 && mine.length > 0, text: 'The buttons over the minimap (or L) colour the map: every tile’s yields, the best city sites, resources, religion, and borders with the tile each city claims next.', act: { label: 'Show the yields', run: () => setLens('yields') } },
    { key: 'neighbour', title: neighbour ? `You’ve met ${neighbour.name}` : 'A neighbour', when: !!neighbour, text: 'Other civilizations race you for land, wonders and the win. See how you stand in Diplomacy (F4) and the Overview’s demographics (F9); a strong army keeps a neighbour friendly.', act: { label: 'Open Diplomacy', run: open('diplomacy') } },
    { key: 'citystate', title: cityState ? `${cityState.name}, a city-state` : 'A city-state', when: !!cityState, text: 'City-states are small single-city nations. Gifts of gold, and doing what they ask (Diplomacy shows their requests), win their friendship, and with it food, culture, faith, happiness or units, by their kind.', act: { label: 'Open Diplomacy', run: open('diplomacy') } },
    { key: 'barbarians', title: 'Barbarians', when: barbarian, text: 'Barbarians come out of camps in the wilds and raid whoever is near. Keep a unit fortified in your city (F) and on hills; clearing a camp brings gold, and grateful city-states.' },
    { key: 'policy', title: 'Adopt a social policy', when: s.culture >= s.policyCost, text: 'You have the culture for a new policy. Tradition suits a few great cities, Liberty many small ones, Honor war.', act: { label: 'Open Social Policies', run: open('policies') } },
    { key: 'notes', evergreen: true, title: 'What needs deciding', when: v.turn >= 8, text: 'What the turn waits on, and what could be done (a promotion, a pantheon), stays at the top right; N opens every note of the game, and O your cities and units side by side.', act: { label: 'Open the notifications', run: open('notes') } },
    { key: 'pantheon', title: 'Found a pantheon', when: !s.pantheon && s.faith >= s.pantheonCost, text: 'Your faith is enough for a pantheon. Pick a belief for your people.', act: { label: 'Open Religion', run: open('religion') } },
    // Religions running out: the last one or two can still be had, with faith now.
    {
      key: `religions${s.religionsLeft}`,
      title: s.religionsLeft === 1 ? 'One religion left to found' : `${s.religionsLeft} religions left to found`,
      when: !s.religion && s.religionsLeft > 0 && s.religionsLeft <= 2 && v.religions.length > 0 && !units.some((u) => u.type === 'great_prophet'),
      text: `The world has room for ${s.religionsLeft} more. A Great Prophet comes at ${s.prophetCost} faith (you have ${s.faith}${s.faithPerTurn > 0 ? `, +${s.faithPerTurn} a turn: ${Math.max(0, Math.ceil((s.prophetCost - s.faith) / s.faithPerTurn))} turns` : ''}). Shrines and temples bring faith: now, or never.`,
      act: { label: 'Open Religion', run: open('religion') },
    },
    { key: 'unhappy', title: 'Your people are unhappy', when: s.happiness < 0, text: 'Unhappy empires grow slowly. Build temples, amphitheaters and colosseums, and improve luxury resources with workers.' },
    { key: 'gold', title: 'You’re losing gold', when: s.income < 0 && s.gold < 50, text: 'Your upkeep is more than you earn. Disband old units, build a Market, or work gold tiles: when the gold runs out, units disband.' },
    { key: 'war', title: 'You’re at war', when: v.players.some((p) => p.war && !p.cityState && p.civ !== 'barbarian' && p.met), text: 'Fortify units in cities and on hills; ranged units fire from behind your lines. Offer peace from Diplomacy when you are ready.' },
  ];
}

/** The game the card of the ways to win was last shown for (its map). */
let howToWinFor: unknown = null;

/** Whether this game's start still wants the card of the ways to win (once, on its first turn). */
export function wantsHowToWin(): boolean {
  const v = store.view;
  if (!v || v.spectator || v.over || v.turn > 1 || howToWinFor === store.grid) return false;
  howToWinFor = store.grid;
  return true;
}

/** How to win this game: each way that's on, in a line. */
export function renderHowToWin(): El {
  const settings: Settings | undefined = store.lobby?.settings;
  const on = VICTORIES.filter((x) => settings?.victories[x.id as keyof Settings['victories']] ?? true);
  const close = () => togglePanel('win');
  return h(
    'div.cv-diplo.cv-panel.gd-win',
    {},
    h('button.cv-x', { onclick: close, html: svg('close', 15), title: 'Close (Esc)' }),
    h('div.cv-row', {}, tile('golden', '#b8892a', 40), h('div', {}, h('div.cv-h.big', {}, 'How to win'), h('small.cv-muted', {}, on.length ? `${on.length} way${on.length === 1 ? '' : 's'} in this game` : 'No way to win is on: the game goes on until you stop'))),
    h(
      'div.gd-ways',
      {},
      ...on.map((x) => h('div.gd-way', { 'data-pedia': `victory:${x.id}` }, tile(x.glyph, x.color, 34), h('div', {}, h('b', {}, x.name), h('small.cv-muted', {}, x.id === 'score' ? `The highest score at turn ${settings?.turnLimit ?? 330}, if no one has won before` : x.sub)))),
    ),
    h('small.cv-muted', {}, 'The Victory panel (V) shows how near everyone is; the Civilopedia (F1) tells each way in full.'),
    h('div.gd-acts', {}, h('button.cv-btn', { onclick: () => togglePanel('victory') }, icon('golden', 14), 'Victory progress'), h('button.cv-btn.gold', { onclick: close }, 'Begin')),
  );
}

export const GUIDE_CSS = `
.cv-advisor .acts .cv-btn.go { background: rgba(106,184,255,.16); border-color: rgba(106,184,255,.45) !important; color: #cfe6ff; }
.gd-win { width: min(520px, 94vw); overflow-y: auto; }
.gd-ways { display: flex; flex-direction: column; gap: 6px; }
.gd-way { display: flex; align-items: center; gap: 11px; padding: 8px 10px; border-radius: 11px; background: rgba(255,255,255,.04); border: 1px solid var(--line); }
.gd-way b { display: block; font-size: 13.5px; }
button.gd-way { width: 100%; text-align: left; cursor: pointer; transition: background .12s, border-color .12s; background: rgba(255,255,255,.04) !important; border: 1px solid var(--line) !important; }
button.gd-way:hover { background: rgba(255,255,255,.09) !important; border-color: rgba(242,193,78,.45) !important; }
.gd-acts { display: flex; justify-content: flex-end; gap: 8px; position: sticky; bottom: -18px; margin: 0 -18px -18px; padding: 10px 18px 12px; background: #252a35; }
@media (max-width: 760px), (max-height: 520px) {
  .gd-ways { gap: 3px; }
  .gd-way { padding: 3px 8px; gap: 8px; }
  .gd-way .cv-tile { width: 26px !important; height: 26px !important; }
  .gd-acts { bottom: -12px; margin: 0 -12px -12px; padding: 8px 12px; }
}
`;
