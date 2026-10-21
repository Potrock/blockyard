import { MAP_SIZES, mapTypeWord, SPEED_NAMES } from '../rules/state';
import { openCongress } from './congress';
import { emblemEl, icon, svg } from './icons';
import { openPedia } from './pedia';
import { openOverview } from './overview';
import { togglePins } from './pins';
import { prefs, setPrefs, TOPIC_NAMES, type Pace, type UiSize } from './prefs';
import { isMuted, toggleMute } from './sound';
import { ask, store } from './store';
import { canOpenPlatformMenu, copyGameLink, h, openPlatformMenu, rooms, setLook, setTips, tell, tile, tipsOn, togglePanel, type El } from './ui';

/**
 * Every keyboard shortcut, listed (? shows them: `input.ts` does what they say), and the game's menu
 * (Escape with nothing open, or the top bar's ☰): the Civilopedia, the overviews, the shortcuts, sound
 * and the advisor's tips, this game's settings, and leaving.
 */

/** The shortcuts, by what they're for: the keys (as shown) and what they do. */
export const HOTKEYS: [group: string, keys: [string[], string][]][] = [
  [
    'The turn',
    [
      [['Enter'], 'End the turn (again to take it back); yes to a question'],
      [['Space', '.'], 'Next unit that needs orders'],
      [[','], 'The one before'],
    ],
  ],
  [
    'The selected unit',
    [
      [['F'], 'Fortify (sleep, for those that can’t)'],
      [['Z'], 'Sleep until woken'],
      [['X'], 'Skip this turn'],
      [['E'], 'Automate: a worker works, a soldier or warship explores (again: stop)'],
      [['B'], 'Found a city (a Settler)'],
      [['U'], 'Upgrade'],
      [['Delete'], 'Disband (or Backspace)'],
      [['C'], 'Centre on it (or on your capital)'],
      [['Right-click'], 'Move or attack'],
      [['Shift', 'Click'], 'Add another unit (its flag) to a group, sent together'],
      [['Shift', 'Drag'], 'Gather the soldiers in a box into a group'],
      [['Esc'], 'Deselect'],
    ],
  ],
  [
    'The map',
    [
      [['W', 'A', 'S', 'D'], 'Move the view (or the arrows, or drag)'],
      [['+', '−'], 'Zoom (or the wheel)'],
      [['Y'], 'The yields lens: what every tile yields'],
      [['L'], 'The next lens (yields, city sites, resources, religion, borders)'],
      [['Right-click'], 'A tile, with no unit selected: pin it with an icon and a label (on a touch screen, hold a finger on it, then Pin on its card)'],
      [['H'], 'Hide the interface (to look at your empire, or take a picture of it); again to bring it back'],
      [['Alt', 'Click'], 'Ping a tile: point at it for the others a few seconds (the chat sets who sees it)'],
    ],
  ],
  [
    'Panels',
    [
      [['T', 'F6'], 'Technology tree'],
      [['P'], 'Social policies'],
      [['R'], 'Religion'],
      [['F4'], 'Diplomacy'],
      [['O', 'F2'], 'Overview: cities'],
      [['F3'], 'Overview: units'],
      [['F9'], 'Demographics'],
      [['N', 'F7'], 'Notifications'],
      [['V', 'F8'], 'Victory progress'],
      [['F1'], 'Civilopedia (over the map: what’s under the mouse)'],
      [['M'], 'Chat: talk to everyone, your team or one leader, make a face (Enter sends, Esc closes)'],
      [['?'], 'These shortcuts'],
      [['Esc'], 'Close a panel (with nothing open: the menu)'],
    ],
  ],
];

export function renderHotkeys(): El {
  return h(
    'div.cv-diplo.cv-panel.hk-panel',
    {},
    h('button.cv-x', { onclick: () => togglePanel('keys'), html: svg('close', 15), title: 'Close (Esc)' }),
    h('div.cv-row', {}, tile('keyboard', '#3a5a7a', 40), h('div', {}, h('div.cv-h.big', {}, 'Keyboard shortcuts'), h('small.cv-muted', {}, 'Right-click anything with a picture to read about it in the Civilopedia.'))),
    h(
      'div.hk-groups.cv-scroll',
      {},
      ...HOTKEYS.map(([group, keys]) =>
        h('div.hk-group', {}, h('div.cv-label', {}, group), ...keys.map(([k, what]) => h('div.hk-row', {}, h('span.hk-keys', {}, ...k.map((x) => h('kbd', {}, x))), h('span', {}, what)))),
      ),
    ),
  );
}

/** Quick movement and combat's choices. */
const PACE_CHOICES: [Pace, string][] = [
  ['normal', 'Normal'],
  ['fast', 'Fast'],
  ['skip', 'Off'],
];

/** The interface's sizes against what suits the screen. */
const SIZE_CHOICES: [UiSize, string][] = [
  ['small', 'Small'],
  ['normal', 'Normal'],
  ['large', 'Large'],
  ['larger', 'Larger'],
];

/** A setting's row: its name and a chip for each choice, the one in force lit. */
function choice<T extends string>(label: string, values: [T, string][], now: T, set: (v: T) => void, title?: string): El {
  return h(
    'div.mn-choice',
    { title },
    h('span.cv-grow', {}, label),
    ...values.map(([value, name]) =>
      h(
        `button.cv-chip${value === now ? '.on' : ''}`,
        {
          onclick: () => {
            if (value === now) return;
            set(value);
            store.changed++;
          },
        },
        name,
      ),
    ),
  );
}

/** The platform's menu, from the game's: the game's closes behind it, so Resume goes back to the map. */
function platformMenu(pane: 'help' | 'settings') {
  store.panel = null;
  store.changed++;
  openPlatformMenu(pane);
}

/** The game's menu. */
export function renderMenu(): El {
  const L = store.lobby;
  const v = store.view;
  const s = L?.settings;
  const close = () => togglePanel('menu');
  const item = (glyph: string, label: string, act: () => void, keys?: string, cls = '') =>
    h(`button.mn-item${cls}`, { onclick: act }, icon(glyph, 17), h('span.cv-grow', {}, label), keys && h('kbd', {}, keys));
  const on = Object.entries(s?.victories ?? {})
    .filter(([, x]) => x)
    .map(([k]) => k);
  return h(
    'div.cv-diplo.cv-panel.mn-panel',
    {},
    h('button.cv-x', { onclick: close, html: svg('close', 15), title: 'Close (Esc)' }),
    h('div.cv-row', {}, v ? emblemEl(v.self.civ, 40) : tile('menu', '#3a5a7a', 40), h('div', {}, h('div.cv-h.big', {}, 'Blockilization'), h('small.cv-muted', {}, v ? `Turn ${v.turn}` : ''))),
    h(
      'div.mn-cols',
      {},
      h(
        'div.mn-items',
        {},
        item('moves', 'Back to the game', close, 'Esc', '.gold'),
        item('book', 'Civilopedia', () => openPedia(), 'F1'),
        item('chart', 'Overview', () => openOverview(), 'O'),
        item('bell', 'Notifications', () => togglePanel('notes'), 'N'),
        item('pin', 'Map pins', () => (close(), togglePins(true))),
        // (On a small screen these leave the top bar for here.)
        item('faith', 'Religion', () => togglePanel('religion'), 'R', '.fold'),
        item('trade', 'Trade routes & spies', () => togglePanel('espionage'), undefined, '.fold'),
        item('golden', 'Victory', () => togglePanel('victory'), 'V', '.fold'),
        v?.congress && item('vote', 'World Congress', () => openCongress(), undefined, '.fold'),
        item('keyboard', 'Keyboard shortcuts', () => togglePanel('keys'), '?'),
        // (Where the platform lets a game open its own menu.)
        canOpenPlatformMenu() && item('gear', 'Settings…', () => platformMenu('settings')),
        // (A game played at an address of its own: its link brings friends, and the way back to your other games.)
        rooms() && rooms()!.current !== 'public' && item('people', 'Invite friends to this game', () => (close(), copyGameLink())),
        rooms() && item('globe', 'Your games', () => ask('Go to your games? This one is kept as it is: come back to it from there, or by its link.', 'Your games', () => rooms()!.go(null), false)),
        canOpenPlatformMenu() && item('info', 'How to play, invite friends…', () => platformMenu('help')),
        item('close', 'Leave the game', () => ask('Leave the game? Your civilization is kept: come back to carry on.', 'Leave', () => tell('exit', null)), undefined, '.danger'),
      ),
      h(
        'div.mn-side',
        {},
        h(
          'div.mn-settings',
          {},
          h('div.cv-label', {}, 'Your settings'),
          choice('Sound', [['on', 'On'], ['off', 'Off']], isMuted() ? 'off' : 'on', () => toggleMute()),
          choice('Advisor’s tips', [['on', 'On'], ['off', 'Off']], tipsOn() ? 'on' : 'off', (x) => setTips(x === 'on'), 'Turned back on, every tip comes again'),
          choice('After a move', [['next', 'Next unit'], ['stay', 'Stay']], prefs.autoNext ? 'next' : 'stay', (x) => setPrefs({ autoNext: x === 'next' }), 'Select the next unit waiting for orders once one has moved'),
          choice('Unit movement', PACE_CHOICES, prefs.moves, (x) => setPrefs({ moves: x }), 'Quick movement: units march faster, or are simply where they went'),
          choice('Combat', PACE_CHOICES, prefs.combat, (x) => setPrefs({ combat: x }), 'Quick combat: fights play faster, or the blow lands at once'),
          choice('Interface size', SIZE_CHOICES, prefs.uiSize, (x) => setLook({ uiSize: x }), 'Everything on the screen, the map’s flags and banners too: smaller, as it is, larger or larger still (about 90%, 115% and 130%; on a sharp screen 75%, 125% and 150%, for crisp pixels; a big screen starts larger)'),
          choice('Colours', [['standard', 'Standard'], ['colourblind', 'Colour-blind']], prefs.palette, (x) => setLook({ palette: x }), 'Good and bad in blue and orange rather than green and red'),
        ),
        h(
          'div.mn-settings',
          {},
          h('div.cv-label', {}, 'News as it comes'),
          h('small.cv-muted', {}, 'Quietened news is kept in the notifications (N). Choices to make always show.'),
          ...TOPIC_NAMES.map(([topic, name]) =>
            choice(name, [['on', 'Show'], ['off', 'Quiet']], prefs.quiet.includes(topic) ? 'off' : 'on', (x) => setPrefs({ quiet: x === 'off' ? [...prefs.quiet, topic] : prefs.quiet.filter((t) => t !== topic) })),
          ),
        ),
        !!v?.autosaves?.length &&
          h(
            'div.mn-settings',
            {},
            h('div.cv-label', {}, 'Autosaves'),
            h(
              'div.mn-saves',
              {},
              ...v.autosaves.map((turn) =>
                h(
                  'button.cv-btn.small',
                  { onclick: () => ask(`Go back to the start of turn ${turn}? Everything since is lost.`, `Reload turn ${turn}`, () => tell('reload', { turn })), title: turn === v.turn ? 'This turn as it began' : `${v.turn - turn} turn${v.turn - turn === 1 ? '' : 's'} back` },
                  icon('turn', 13),
                  turn === v.turn ? `Turn ${turn} (this one)` : `Turn ${turn}`,
                ),
              ),
            ),
            h('small.cv-muted', {}, 'The game as each of the last few turns began (kept only while you play alone).'),
          ),
        s &&
          h(
            'div.mn-settings',
            {},
            h('div.cv-label', {}, 'This game'),
            h(
              'div.mn-facts',
              {},
              h('span', {}, `${MAP_SIZES[s.size].name} ${mapTypeWord(s.type)} map`),
              // (The map's own word: a game saved before worlds wrapped is flat, whatever the lobby says now.)
              h('span', {}, (store.grid?.wrap ?? s.wrap !== false) ? 'The world wraps' : 'The world has edges'),
              h('span', {}, `${SPEED_NAMES[s.speed]} speed`),
              h('span', {}, `${s.turnLimit} turns`),
              h('span', {}, s.dynamicTimer ? 'Dynamic turn timer' : s.timer ? `${s.timer / 60} min turns` : 'No turn timer'),
              h('span', {}, s.hybridTurns === false ? 'Wars played all at once' : 'People at war take turns'),
              h('span', {}, `${s.cityStates || 'No'} city-states`),
              h('span', {}, s.barbarians ? 'Barbarians' : 'No barbarians'),
              h('span', {}, s.disasters ? 'Disasters' : 'No disasters'),
              L?.seed !== null && L?.seed !== undefined && h('span', { title: 'The same seed (and settings) makes the same map' }, `Map seed ${L.seed}`),
            ),
            h('small.cv-muted', {}, `Victories: ${on.length ? on.join(', ') : 'none'}.`),
          ),
      ),
    ),
  );
}

export const HOTKEYS_CSS = `
.hk-panel { width: min(760px, 96vw); }
.hk-groups { columns: 2 300px; column-gap: 26px; padding: 4px 2px; }
.hk-group { display: flex; flex-direction: column; gap: 4px; break-inside: avoid; margin-bottom: 16px; }
.hk-group .cv-label { margin-bottom: 2px; }
.hk-row { display: flex; align-items: center; gap: 10px; font-size: 12.5px; }
.hk-keys { display: inline-flex; gap: 3px; width: 112px; flex: none; justify-content: flex-end; }
.cv-root kbd { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; height: 22px; padding: 0 6px; border-radius: 6px; font: 700 11px/1 'Inter', system-ui, sans-serif; color: var(--text); background: linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,.06)); border: 1px solid rgba(255,255,255,.16); box-shadow: 0 2px 0 rgba(0,0,0,.4); white-space: nowrap; }
.mn-panel { width: min(820px, 96vw); overflow-y: auto; }
.mn-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 18px; align-items: start; }
.mn-side { display: flex; flex-direction: column; gap: 12px; }
.mn-side > .mn-settings:first-child { border-top: 0; padding-top: 0; }
.mn-items { display: flex; flex-direction: column; gap: 4px; }
.mn-item { display: flex; align-items: center; gap: 11px; padding: 10px 12px; border-radius: 10px; text-align: left; font-weight: 650; background: rgba(255,255,255,.04) !important; border: 1px solid var(--line) !important; transition: background .12s; }
.mn-item:hover { background: rgba(255,255,255,.1) !important; }
.mn-item.gold { background: linear-gradient(180deg, #f6cf62, #dca23a) !important; color: #1b1407; }
.mn-item.gold kbd { color: #1b1407; background: rgba(255,255,255,.35); border-color: rgba(0,0,0,.15); box-shadow: none; }
.mn-item.danger { color: #ffc2bb; }
.mn-choice { display: flex; align-items: center; gap: 4px; }
.mn-choice .cv-chip { cursor: pointer; }
.mn-saves { display: flex; flex-wrap: wrap; gap: 6px; }
.mn-settings { display: flex; flex-direction: column; gap: 6px; padding-top: 6px; border-top: 1px solid var(--line); }
.mn-facts { display: flex; flex-wrap: wrap; gap: 4px; }
@media (max-width: 760px), (max-height: 520px) {
  .mn-item { padding: 6px 10px; }
  .mn-cols { gap: 12px; }
  .hk-keys { width: 90px; }
}
/* (Two columns side by side while there's the width: a phone held sideways has it.) */
@media (max-width: 600px) { .mn-cols { grid-template-columns: 1fr; } }
/* A touch screen has no keys: the menu doesn't show them. */
@media (pointer: coarse) { .mn-item kbd { display: none; } }
.mn-facts span { padding: 3px 9px; border-radius: 99px; background: rgba(255,255,255,.06); font-size: 12px; font-weight: 600; }
`;
