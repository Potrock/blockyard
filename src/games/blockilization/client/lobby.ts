import { lobbySides, TEAMS, type LobbyAction, type LobbySeat, type LobbyView } from '../protocol';
import { CIVS } from '../rules/civs';
import { MAP_SIZES, mapTypeWord, type MapType, type Settings, type Speed } from '../rules/state';
import { VICTORIES } from './concepts';
import { emblemEl, icon } from './icons';
import { openPedia } from './pedia';
import { TEAM_COLORS } from './store';
import { h, tile, type El } from './ui';

/**
 * The lobby's setup beyond the map's size: what each map type and speed is like, the ways to win
 * (each on or off, and how it's won), the map's seed (the same seed and settings make the same
 * world; blank for a new one each game), and the teams.
 */

const MAP_TYPE_TEXT: Record<MapType, string> = {
  continents: 'Two or three great landmasses with sea between: room to grow before you meet your rivals across the water.',
  pangaea: 'One great landmass that everyone shares: neighbours from the start, and wars over land.',
  archipelago: 'Many islands, large and small: ships, the coast and the sea matter from the first turns.',
  fractal: 'Land of every shape and size, from islands to sprawling continents: no two worlds alike.',
  inland_sea: 'Land all round one great sea in the middle: armies march round it, fleets cross it.',
  highlands: 'Hills and mountains nearly everywhere, with lakes and valleys between: hard country to cross and to take, rich in production.',
  earth: 'The Earth as it is, its continents, ranges, deserts and great rivers. With true starting places, every civ begins where it really did.',
};

const SPEED_TEXT: Record<Speed, string> = {
  quick: 'Everything takes about two-thirds as long: a game of an evening.',
  standard: 'Civilization V’s pace: longer to build, research and grow.',
  epic: 'Half as long again as Standard: more turns in every era, 750 in all.',
  marathon: 'Three times as long as Standard: wars and wonders that take an age, 1500 turns in all.',
};

/** A line under the map type's choices, and under the speed's. */
export const mapTypeText = (t: MapType) => h('div.lb-desc', {}, MAP_TYPE_TEXT[t]);
export const speedText = (s: Speed) => h('div.lb-desc', {}, SPEED_TEXT[s]);

/** The ways to win: a card for each, lit when it's on (the host turns them on and off). */
export function victoryCards(L: LobbyView, isHost: boolean, send: (a: LobbyAction) => void): El {
  const on = L.settings.victories;
  const count = Object.values(on).filter(Boolean).length;
  return h(
    'div',
    {},
    h(
      'div.lb-wins',
      {},
      ...VICTORIES.map((v) => {
        const key = v.id as keyof Settings['victories'];
        const lit = on[key];
        return h(
          `button.lb-win${lit ? '.on' : ''}`,
          { onclick: isHost ? () => send({ a: 'victories', victories: { [key]: !lit } }) : undefined, disabled: !isHost, title: isHost ? (lit ? 'Turn this way to win off' : 'Turn this way to win on') : undefined },
          tile(v.glyph, lit ? v.color : '#3a4450', 34),
          h('div.cv-grow', {}, h('b', {}, v.name), h('small', {}, key === 'score' ? `Highest score at turn ${L.settings.turnLimit}` : v.sub)),
          h('span.lb-check', {}, lit ? icon('check', 13) : null),
        );
      }),
    ),
    h(
      'div.lb-how',
      {},
      count ? `${count} way${count === 1 ? '' : 's'} to win.` : 'No way to win is on: the game goes on until you stop.',
      ' ',
      h('a.pd-inline', { onclick: () => openPedia('concept:basics') }, 'How to play'),
    ),
  );
}

/**
 * The lobby's foot, always in sight however far the setup's scrolled: the civilization you'll play
 * (or that one's to be picked for you), the game in a line, and Begin (or who it's waiting for).
 */
export function lobbyFoot(L: LobbyView, isHost: boolean, send: (a: LobbyAction) => void): El {
  const mine = L.seats.find((s) => s.key === L.you);
  const civ = mine?.civ ? CIVS[mine.civ] : null;
  const s = L.settings;
  const bots = L.seats.filter((x) => x.bot).length;
  const people = L.seats.filter((x) => !x.bot).length;
  const stuck = L.teams && lobbySides(L.seats) < 2;
  return h(
    'div.lb-foot',
    {},
    civ ? emblemEl(civ.id, 34) : h('span.lb-nociv', {}, '?'),
    h(
      'div.cv-grow',
      {},
      h('b', {}, civ ? `${civ.name}, led by ${civ.leader}` : 'A civilization chosen for you'),
      h('small.cv-muted', {}, `${civ ? '' : 'Or pick one above · '}${MAP_SIZES[s.size].name} ${mapTypeWord(s.type)} map · ${people > 1 ? `${people} people, ` : ''}${bots} bot${bots === 1 ? '' : 's'}`),
    ),
    isHost
      ? h('button.cv-btn.gold.lb-begin', { onclick: () => send({ a: 'start' }), disabled: stuck, title: stuck ? 'Everyone is on one team' : undefined }, 'Begin')
      : h('span.cv-muted', {}, 'Waiting for the host to begin…'),
  );
}

/** The map's seed: the host can set one (blank: a new world each game); everyone sees it. */
export function seedRow(L: LobbyView, isHost: boolean, send: (a: LobbyAction) => void): El {
  const shown = L.seed === null ? '' : String(L.seed);
  const field = h('input.cv-input.lb-seed', { value: shown, placeholder: 'A new world', inputmode: 'numeric', maxlength: '9', disabled: !isHost }) as HTMLInputElement;
  // Digits only (or nothing, for a new world each game); anything else puts back what it was.
  const commit = () => {
    const typed = field.value.trim();
    if (!typed) send({ a: 'seed', seed: null });
    else if (/^\d+$/.test(typed)) {
      field.value = String(Number(typed));
      send({ a: 'seed', seed: Number(typed) });
    } else field.value = shown;
  };
  field.addEventListener('change', commit);
  field.addEventListener('keydown', (e) => e.key === 'Enter' && field.blur());
  return h(
    'div.row',
    {},
    h('label', {}, 'Map seed'),
    field,
    isHost && L.seed !== null && h('button.cv-btn.small', { onclick: () => send({ a: 'seed', seed: null }) }, 'New world each game'),
    h('small.cv-muted', {}, 'The same seed and settings make the same world.'),
  );
}

/** A team's small mark: its number on its colour. */
export const teamMark = (team: number) => h('span.lb-team', { style: `background:${TEAM_COLORS[team] ?? '#555'}`, title: `Team ${team + 1}` }, String(team + 1));

/** Teams, Civilization V's: on or off (the host), set up at once (the host), and what teams mean; and a word when there aren't two sides. */
export function teamsRow(L: LobbyView, isHost: boolean, send: (a: LobbyAction) => void): El {
  const preset = (label: string, preset: 'people' | 'pairs' | 'none', title: string) => h('button.cv-btn.small', { onclick: () => send({ a: 'teamPreset', preset }), title }, label);
  return h(
    'div',
    {},
    h(
      'div.row',
      {},
      h('label', {}, 'Teams'),
      h(`button.chip${L.teams ? '' : '.on'}`, { onclick: isHost ? () => send({ a: 'teams', on: false }) : undefined, disabled: !isHost && L.teams }, 'Every civ for itself'),
      h(`button.chip${L.teams ? '.on' : ''}`, { onclick: isHost ? () => send({ a: 'teams', on: true }) : undefined, disabled: !isHost && !L.teams }, 'Teams'),
      L.teams && isHost && preset('People vs bots', 'people', 'The people on one team, the bots on the other'),
      L.teams && isHost && preset('Each with a bot', 'pairs', 'Each person on a team with a bot (the other bots in twos)'),
    ),
    L.teams &&
      h(
        'div.lb-desc',
        {},
        lobbySides(L.seats) < 2
          ? h('b', { style: 'color:#ff8a7a' }, 'Everyone is on one team: put someone on another to begin. ')
          : null,
        'Teammates are at peace for good, see what each other sees, go to war and make peace together, and win together. Pick each seat’s team by its number (yours, or anyone’s as the host).',
      ),
  );
}

/** A seat's team, as numbers to pick from (none: –); only the marked one shown to someone who can't change it. */
export function seatTeam(seat: LobbySeat, canPick: boolean, send: (a: LobbyAction) => void): El {
  const now = typeof seat.team === 'number' ? seat.team : null;
  if (!canPick) return now === null ? h('span.lb-team.none', { title: 'On no team' }, '–') : teamMark(now);
  const pick = (team: number | null) =>
    h(`button.lb-team${team === now ? '.on' : ''}${team === null ? '.none' : ''}`, { onclick: () => send({ a: 'team', seat: seat.key, team }), style: team === null ? '' : `background:${TEAM_COLORS[team]}`, title: team === null ? 'No team' : `Team ${team + 1}` }, team === null ? '–' : String(team + 1));
  return h('span.lb-teams', {}, pick(null), ...Array.from({ length: TEAMS }, (_, t) => pick(t)));
}

/** When a game was last played, in a few words. */
function playedWhen(at: string): string {
  const mins = (Date.now() - Date.parse(at)) / 60000;
  if (!(mins >= 0)) return '';
  if (mins < 60) return 'played just now';
  if (mins < 60 * 24) return `played ${Math.round(mins / 60)} h ago`;
  return `played ${new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

/**
 * Every unfinished game this person has a seat in, wherever it was played: its turn, their civ, who
 * else is in it and when it was last played. The host carries one on here (the others in it join
 * them once it's under way); anyone with a seat in one can throw it away.
 */
export function savedGamesBox(L: LobbyView, isHost: boolean, send: (a: LobbyAction) => void): El | null {
  if (!L.saves?.length) return null;
  return h(
    'div.lb-saves',
    {},
    h('div.cv-label.sect', {}, L.saves.length === 1 ? 'Your saved game' : 'Your saved games'),
    ...L.saves.map((g) => {
      const civ = g.civ ? CIVS[g.civ] : null;
      return h(
        'div.lb-save',
        {},
        civ ? emblemEl(civ.id, 26) : h('span.lb-nociv.small', {}, '?'),
        h(
          'div.cv-grow',
          {},
          h('b', {}, `Turn ${g.turn}${civ ? ` · ${civ.name}` : ''}`),
          h('small.cv-muted', {}, [g.with.length ? `with ${g.with.join(', ')}` : 'you and the bots', g.elsewhere ? 'being played in another room now' : playedWhen(g.at)].filter(Boolean).join(' · ')),
        ),
        isHost && !g.elsewhere && h('button.cv-btn.gold.small', { onclick: () => send({ a: 'resume', id: g.id }) }, 'Carry on'),
        !isHost && h('small.cv-muted', {}, 'The host can carry it on'),
        h('button.cv-btn.small', { onclick: () => send({ a: 'discard', id: g.id }), title: 'Throw this game away, for everyone in it' }, 'Discard'),
      );
    }),
  );
}

export const LOBBY_CSS = `
.lb-desc { margin: -2px 0 6px 114px; color: var(--muted); font-size: 12px; }
.lb-wins { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; }
.lb-win { display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 8px; text-align: left; border-radius: 12px; background: rgba(255,255,255,.035) !important; border: 1px solid var(--line) !important; transition: background .12s, border-color .12s; }
.lb-win:hover:not(:disabled) { background: rgba(255,255,255,.08) !important; }
.lb-win:disabled { cursor: default; }
.lb-win b { display: block; font-size: 13.5px; } .lb-win small { display: block; color: var(--muted); font-size: 11.5px; line-height: 1.3; }
.lb-win:not(.on) b { color: var(--muted); }
.lb-win.on { border-color: rgba(242,193,78,.55) !important; background: rgba(242,193,78,.08) !important; }
.lb-check { width: 20px; height: 20px; border-radius: 50%; flex: none; display: flex; align-items: center; justify-content: center; border: 1px solid var(--line2); }
.lb-win.on .lb-check { background: var(--gold); border-color: var(--gold); color: #1b1407; }
.lb-how { margin-top: 8px; color: var(--muted); font-size: 12.5px; }
.lb-seed { width: 150px; }
.lb-foot { position: sticky; bottom: -22px; margin: 16px -26px -22px; padding: 10px 26px 12px; display: flex; align-items: center; gap: 12px; background: #252a35; border-top: 2px solid #07090c; box-shadow: 0 -2px 0 #3a4252; z-index: 2; }
.lb-foot b { display: block; font-size: 18px; }
.lb-nociv { width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; background: #343b4a; color: var(--muted); font-size: 20px; }
.lb-begin { font-size: 24px !important; padding: 6px 34px 7px !important; }
.lb-teams { display: inline-flex; gap: 3px; margin-left: 4px; }
.lb-team { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 4px; color: #fff; font: 400 16px/1 'Jersey 10', monospace; text-shadow: 1px 1px 0 #07090c; border: 2px solid #07090c; flex: none; }
.lb-team.none { background: #3a4450; color: var(--muted); }
button.lb-team { opacity: .45; cursor: pointer; } button.lb-team.on { opacity: 1; outline: 2px solid #f2c14e; } button.lb-team:hover { opacity: .85; }
.lb-seed:disabled { opacity: .7; }
.lb-saves { margin-bottom: 4px; }
.lb-save { display: flex; align-items: center; gap: 10px; margin-top: 6px; padding: 6px 10px; border-radius: 10px; background: rgba(106,184,255,.06); border: 1px solid rgba(106,184,255,.25); }
.lb-save b { display: block; font-size: 14px; }
.lb-nociv.small { width: 26px; height: 26px; font-size: 16px; }
@media (max-width: 760px), (max-height: 520px) {
  .lb-foot { bottom: -14px; margin: 12px -14px -14px; padding: 8px 14px; }
  .lb-desc { margin-left: 90px; }
  .lb-wins { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
}
`;
