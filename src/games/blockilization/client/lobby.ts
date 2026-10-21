import { lobbySides, TEAMS, type LobbyAction, type LobbySeat, type LobbyView } from '../protocol';
import { KEEP_DISCARDED, roomCode, type GameMap, type SavedGame } from '../saves';
import { CIVS } from '../rules/civs';
import { MAP_SIZES, mapTypeWord, SPEED_NAMES, type MapSize, type MapType, type Settings, type Speed } from '../rules/state';
import { VICTORIES } from './concepts';
import { emblemEl, icon } from './icons';
import { openPedia } from './pedia';
import { ask, store, TEAM_COLORS } from './store';
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

/** A game's map in a few words, to tell one's games apart: "Small continents, quick" (Standard speed unsaid). */
function mapWords(m: GameMap | undefined): string {
  const size = MAP_SIZES[m?.size as MapSize]?.name;
  const type = m && m.type in MAP_TYPE_TEXT ? mapTypeWord(m.type as MapType) : null;
  if (!size || !type) return '';
  const speed = m!.speed !== 'standard' ? SPEED_NAMES[m!.speed as Speed]?.toLowerCase() : null;
  return `${size} ${type}${speed ? `, ${speed}` : ''}`;
}

/** Who else is in a game and whether they're playing it now: "Bob is playing now", "with Bob and Cat", "you and the bots". */
function whoWords(g: SavedGame): string {
  const and = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]);
  if (g.live && g.playing.length) return `${and(g.playing)} ${g.playing.length > 1 ? 'are' : 'is'} playing now`;
  return g.with.length ? `with ${and(g.with)}` : 'you and the bots';
}

/** Going to a game at its own address, and copying its link (none on a platform whose screens can't go to another room). */
export interface GameLinks {
  open(g: SavedGame): void;
  copy(g: SavedGame): void;
}

/**
 * The games a person has a seat in, to go back to: each with their civ in it, which turn it's at, who
 * else is in it and when it was last played (or that it's being played now). Each is played at an
 * address of its own: Play goes there (Join, while it's being played), and its link brings friends.
 * Anyone in one can take it back to the start of an earlier turn while nobody's playing it (its
 * backups), or discard it: off their list, the others' still, for a week to bring back. (On a
 * platform whose screens can't go to another room, the host carries a game on here instead.)
 */
export function savedGamesBox(L: LobbyView, isHost: boolean, send: (a: LobbyAction) => void, links: GameLinks | null): El | null {
  const games = (L.saves ?? []).filter((g) => !g.discarded);
  if (!games.length) return null;
  const discard = (g: SavedGame) =>
    ask(
      g.with.length
        ? `Take this game off your list (turn ${g.turn}, with ${g.with.join(', ')})? They can play on without you, and you can bring it back from Discarded for a week.`
        : `Discard this game (turn ${g.turn})? You can bring it back from Discarded for a week; then it’s gone.`,
      'Discard',
      () => send({ a: 'discard', id: g.id }),
    );
  const restore = (g: SavedGame, turn: number) =>
    ask(`Take this game back to the start of turn ${turn}? Everything played since is lost${g.with.length ? ', for everyone in it: they’re told who did' : ''}.`, `Back to turn ${turn}`, () => {
      turnsOf = null;
      send({ a: 'restore', id: g.id, turn });
    });
  const toggleTurns = (g: SavedGame) => {
    turnsOf = turnsOf === g.id ? null : g.id;
    store.changed++;
  };
  return h(
    'div.lb-saves',
    {},
    h('div.cv-label.sect', {}, games.length === 1 ? 'Your game' : 'Your games'),
    ...games.flatMap((g) => {
      const civ = g.civ ? CIVS[g.civ] : null;
      // (Taken back only while nobody's playing it.)
      const earlier = g.backups.length > 0 && !g.live;
      const row = h(
        `div.lb-save${g.live ? '.live' : ''}`,
        {},
        civ ? emblemEl(civ.id, 26) : h('span.lb-nociv.small', {}, '?'),
        h(
          'div.cv-grow',
          {},
          h('b', {}, `Turn ${g.turn}${civ ? ` · ${civ.name}` : ''}`),
          h('small.cv-muted', {}, [whoWords(g), mapWords(g.map), g.live ? (g.playing.length ? '' : 'being played now') : playedWhen(g.at)].filter(Boolean).join(' · ')),
        ),
        links && h('button.cv-btn.gold.small', { onclick: () => links.open(g), title: g.live ? 'Join the others playing it' : 'Go to this game' }, g.live ? 'Join' : 'Play'),
        // (A game from before games had addresses has none until it's opened.)
        links && roomCode(g.id) && h('button.cv-btn.small', { onclick: () => links.copy(g), title: 'Copy the link to this game, for friends to join you' }, 'Copy link'),
        !links && isHost && !g.live && h('button.cv-btn.gold.small', { onclick: () => send({ a: 'resume', id: g.id }) }, 'Carry on'),
        !links && !isHost && h('small.cv-muted', {}, 'The host can carry it on'),
        earlier && h('button.cv-btn.small', { onclick: () => toggleTurns(g), title: 'Take the game back to the start of an earlier turn' }, turnsOf === g.id ? 'Hide turns' : 'Earlier turns'),
        h('button.cv-btn.small', { onclick: () => discard(g), title: g.with.length ? 'Take this game off your list: the others play on' : 'Discard this game (for a week you can bring it back)' }, 'Discard'),
      );
      if (!earlier || turnsOf !== g.id) return [row];
      return [
        row,
        h(
          'div.lb-turns',
          {},
          h('small.cv-muted', {}, 'Back to the start of'),
          ...g.backups.map((t) => h('button.cv-btn.small', { onclick: () => restore(g, t), title: t === g.turn ? 'This turn, as it began' : `${g.turn - t} turn${g.turn - t === 1 ? '' : 's'} back` }, `Turn ${t}`)),
        ),
      ];
    }),
  );
}

/** The game whose earlier turns are shown, under its row (its id). */
let turnsOf: string | null = null;

/** The games a person has discarded this last week, to bring back to their list (then they're gone from it). */
export function discardedBox(L: LobbyView, send: (a: LobbyAction) => void): El | null {
  const gone = (L.saves ?? []).filter((g) => g.discarded);
  if (!gone.length) return null;
  const until = (at: string) => new Date(Date.parse(at) + KEEP_DISCARDED).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return h(
    'div.lb-saves',
    {},
    h('div.cv-label.sect', {}, 'Discarded'),
    ...gone.map((g) => {
      const civ = g.civ ? CIVS[g.civ] : null;
      return h(
        'div.lb-save.gone',
        {},
        civ ? emblemEl(civ.id, 26) : h('span.lb-nociv.small', {}, '?'),
        h('div.cv-grow', {}, h('b', {}, `Turn ${g.turn}${civ ? ` · ${civ.name}` : ''}`), h('small.cv-muted', {}, [g.with.length ? `with ${g.with.join(', ')}` : 'you and the bots', mapWords(g.map), `bring it back by ${until(g.discarded!)}`].filter(Boolean).join(' · '))),
        h('button.cv-btn.small', { onclick: () => send({ a: 'keep', id: g.id }), title: 'Back on your list of games' }, 'Bring back'),
      );
    }),
  );
}

/** The public lobby's top, where a visit begins: a new game, set up in a room of its own (whose link is its address from then on). */
export function hubTop(start: () => void): El {
  return h(
    'div.lb-new',
    {},
    tile('city', '#c8963a', 40),
    h('div.cv-grow', {}, h('b', {}, 'A new game'), h('small.cv-muted', {}, 'Set it up in a room of its own and send friends its link to join you. The game stays at that link, saved every turn, until it’s won.')),
    h('button.cv-btn.gold.lb-start', { onclick: start }, 'New game'),
  );
}

/** In a room of one's own, before its game begins: its link, for friends (the game is played and kept at it), and the way back to one's games. */
export function inviteRow(copy: () => void, back: () => void): El {
  return h(
    'div.lb-invite',
    {},
    icon('people', 20, '#6ab8ff'),
    h('div.cv-grow', {}, h('b', {}, 'This game’s own room'), h('small.cv-muted', {}, 'Friends join with its link, now or later: the game is played and kept here.')),
    h('button.cv-btn.small', { onclick: copy }, 'Copy invite link'),
    h('button.cv-btn.small', { onclick: back }, 'Your games'),
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
.lb-save.live { border-color: rgba(120,220,140,.45); background: rgba(120,220,140,.07); }
.lb-save.gone { background: rgba(255,255,255,.03); border-color: var(--line); }
.lb-save.gone b { color: var(--muted); }
.lb-turns { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 5px 0 2px 46px; }
.lb-new, .lb-invite { display: flex; align-items: center; gap: 12px; margin: 4px 0 8px; padding: 10px 12px; background: rgba(242,193,78,.07); border: 1px solid rgba(242,193,78,.35); border-radius: 10px; }
.lb-invite { background: rgba(106,184,255,.06); border-color: rgba(106,184,255,.3); }
.lb-new b, .lb-invite b { display: block; font-size: 16px; }
.lb-start { font-size: 22px !important; padding: 5px 26px 6px !important; }
.lb-none { margin: 6px 0 10px; font-size: 12.5px; }
.lb-nociv.small { width: 26px; height: 26px; font-size: 16px; }
@media (max-width: 760px), (max-height: 520px) {
  .lb-foot { bottom: -14px; margin: 12px -14px -14px; padding: 8px 14px; }
  .lb-desc { margin-left: 90px; }
  .lb-wins { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
}
`;
