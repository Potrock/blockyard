/**
 * The interface on phones and touch screens, laid over the pixel look (`pixel.ts`; it comes after it,
 * so its rules win): on a touch screen, everything a finger presses at least 44 pixels across (the
 * look the same, only bigger); on a small screen (a phone), the map given the room. The research a
 * tile with its turns and a bar, the advisor a chip, the notes and the decisions a column of their
 * icons, the end-turn button its words alone, and what hangs under the top bar starting where the bar
 * ends (`--bar-bottom`, which `fitTop` in ui.ts keeps: held upright, the bar takes two rows).
 */

/** Small screens: a phone either way up, a small window. */
const SMALL = '(max-width: 760px), (max-height: 520px)';
/** A touch screen: no mouse to hover with, a finger to press with. */
const TOUCH = '(hover: none) and (pointer: coarse)';
/** Under the top bar on a small screen. */
const BELOW = 'calc(var(--bar-bottom, 48px) + 6px)';

/** The top bar in two rows (the civ and the menu, then the numbers), for a bar under `under`. */
const twoRows = (under: string) => `
  ${under} .cv-top { height: auto !important; flex-wrap: wrap !important; row-gap: 2px; padding-top: 3px !important; padding-bottom: 3px !important; overflow: visible !important; }
  ${under} .cv-top::before { content: ''; order: 3; flex-basis: 100%; height: 0; }
  ${under} .cv-top .civ { order: 0; }
  ${under} .cv-top .spacer { order: 1; display: block !important; flex: 1 !important; }
  ${under} .cv-top .menu { order: 2; position: static !important; box-shadow: none !important; background: none !important; padding-left: 0 !important; }
  ${under} .cv-top .cv-stat { order: 4; }
  .cv-root.top-scroll .cv-top { overflow: visible !important; }`;

export const PHONE_CSS = `
/* ---- Fingers: everything pressed at least 44 pixels across. */
@media ${TOUCH} {
  .cv-btn { min-height: 44px !important; padding-top: 0 !important; padding-bottom: 0 !important; }
  .cv-btn.small { min-height: 44px !important; padding-left: 11px !important; padding-right: 11px !important; font-size: 19px !important; }
  .cv-btn.icon { min-width: 44px !important; }
  .cv-x { width: 40px !important; height: 40px !important; }
  .cv-x::before, .cv-top .menu button::before, .nt-x::before { content: ''; position: absolute; inset: -4px; }
  .cv-chip, .cv-lobby .chip, .cv-repeat { min-height: 40px !important; padding-left: 10px !important; padding-right: 10px !important; }
  .cv-tabs button, .ov-tabs button { min-height: 44px !important; }
  .mn-item { min-height: 50px !important; }
  .cv-opt { min-height: 52px !important; }
  .cv-queue .q { min-height: 44px !important; }
  .cv-note, .nt-decide { min-height: 44px !important; }
  .nt-x, .cv-deal-item .x { position: relative; width: 36px !important; height: 36px !important; opacity: 1 !important; }
  .cv-spec .slots button { width: 40px !important; height: 40px !important; }
  .cv-cargo button { min-height: 44px !important; min-width: 52px; justify-content: center; }
  .cv-focus .row { min-height: 44px !important; }
  .pd-cat, .pd-entry, .pd-link { min-height: 40px !important; }
  .ov-table tr.go td { padding-top: 12px !important; padding-bottom: 12px !important; }
  .cv-trade-opt, .cv-trade-amt { min-height: 44px !important; }
  .cv-pol { min-height: 44px !important; }
  .cv-input { min-height: 40px !important; font-size: 16px !important; }
  .cv-lenses { left: 6px !important; right: 6px !important; }
  .cv-lenses button { height: 38px !important; flex: 1; justify-content: center; min-width: 0; }
  .lr-cs-head { min-height: 44px !important; min-width: 44px !important; justify-content: center; }
  .pd-cat { min-width: 44px !important; min-height: 44px !important; justify-content: center; }
  .cv-next { min-width: 48px !important; }
  /* Map pins (pins.ts): the editor's icons, the list's rows and crosses, the toggle, a finger's size. */
  .pn-menu { width: 300px !important; }
  .pn-icon { height: 44px !important; }
  .pn-item { min-height: 44px !important; }
  .pn-go { min-height: 44px !important; }
  .pn-del { width: 40px !important; height: 40px !important; }
  .pn-toggle { height: 40px !important; padding: 0 10px !important; }
  /* Nothing to hover with: the tips of the interface that need a mouse go. */
  .cv-yields > div:hover .bd { display: none !important; }
}

/* ---- A screen between a phone and a wide one (a tablet, a narrow window): the advisor and a fight's
   preview at the bottom left, where the unit's card goes (it steps aside for the preview), clear of
   the minimap and End turn. */
@media (min-width: 761px) and (max-width: 1180px) and (min-height: 521px) {
  .cv-advisor { left: 8px !important; transform: none !important; width: min(470px, calc(100vw - 304px)) !important; min-width: 0 !important; }
  .cv-advisor .acts { flex-wrap: wrap; }
  .cv-preview { left: 8px !important; transform: none !important; width: min(500px, calc(100vw - 304px)) !important; min-width: 0 !important; }
  .cv-root:has(.cv-preview) .cv-unit { visibility: hidden; }
}
/* ---- Fingers, where the Civilopedia's categories are a column of icons: the column wide enough for them. */
@media ${TOUCH} and (max-width: 900px) { .pd-body { grid-template-columns: 64px 200px 1fr !important; } }
@media ${TOUCH} and (max-width: 620px) { .pd-body { grid-template-columns: 64px 1fr !important; } }
/* ---- Fingers on a phone: the leaders' ribbon wide enough for the city-states' chip. */
@media ${TOUCH} and (max-width: 760px), ${TOUCH} and (max-height: 520px) {
  .lr { width: 48px !important; }
}
/* ---- Fingers on a phone that shows the minimap (one shorter hides it): its lens buttons and the pins'
   toggle in a row under it, not over it (a finger's buttons would cover nearly all of a map that small),
   the map and the row a little shorter so the corner stands no taller than it did. */
@media ${TOUCH} and (max-width: 760px) and (min-height: 421px), ${TOUCH} and (min-height: 421px) and (max-height: 520px) {
  .cv-minimap { height: auto !important; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px; }
  .cv-minimap canvas { grid-column: 1 / -1; width: 100% !important; height: 50px !important; }
  .cv-lenses, .pn-toggle { position: static !important; }
  .cv-lenses button, .pn-toggle { height: 34px !important; }
}

/* ---- Fingers on a bigger screen: the top bar's icons a finger's size too. */
@media ${TOUCH} {
  .cv-top .menu button { width: 42px !important; height: 42px !important; }
  .cv-advisor .acts { flex-wrap: wrap; }
}

/* ---- A phone: the map given the room. */
@media ${SMALL} {
  /* The Hall of Fame's games in the lobby's own scroll (one thing to scroll with a thumb, not a box in a box). */
  .hf-rows { max-height: none !important; overflow: visible !important; }
  /* What hangs under the top bar starts where the bar ends. */
  .cv-notes, .cv-city, .nt-panel, .nt-digest, .cv-big, .lr, .cv-preview { top: ${BELOW} !important; }
  .cv-research, .cv-advisor { top: ${BELOW} !important; }
  .cv-big, .cv-city, .nt-panel { bottom: 4px !important; }

  /* The research: its tile, its turns, its bar (a tap opens the tree). */
  .cv-research { width: auto !important; padding: 4px 5px 5px !important; flex-direction: column !important; align-items: center !important; gap: 3px !important; }
  .cv-research > .cv-tile { width: 40px !important; height: 40px !important; }
  .cv-research .cv-grow { flex: none !important; width: 48px; }
  .cv-research .cv-grow > .cv-row { justify-content: center !important; }
  .cv-research .name, .cv-research .cv-grow > small, .cv-research .adv-hint { display: none !important; }
  .cv-research .cv-row small { font-size: 12px !important; line-height: 1 !important; }
  .cv-research .cv-bar { margin: 3px 0 0 !important; height: 10px !important; }
  .cv-research.none > .cv-tile { animation: phoneNudge 1.6s steps(2, end) infinite; }
  @keyframes phoneNudge { 50% { box-shadow: inset 0 0 0 2px #07090c, 0 0 0 3px #f2c14e !important; } }

  /* The advisor: a chip beside the research (a tap opens the tip). */
  .cv-advisor:not(.open) { left: 72px !important; right: auto !important; width: auto !important; min-width: 0 !important; max-width: min(300px, calc(100vw - 72px - 112px)) !important; min-height: 44px; padding: 4px 26px 4px 4px !important; transform: none !important; }
  .cv-advisor:not(.open) .cv-grow > b { font-size: 18px !important; }
  .cv-advisor.open { left: 72px !important; right: 112px !important; width: auto !important; transform: none !important; }

  /* The notes and the decisions: a column of their icons at the right (a tap does what the note says). */
  .cv-notes { width: 44px !important; right: 4px !important; gap: 4px !important; max-height: calc(var(--corner-top, 100vh) - var(--bar-bottom, 48px) - 14px) !important; overflow: hidden; }
  /* The map pins' list: three rows and then it scrolls, so the corner doesn't climb into the notes and the ribbon. */
  .pn-rows { max-height: min(230px, calc(100vh - var(--bar-bottom, 48px) - 200px)) !important; }
  .cv-root.ribbon-on .cv-notes { right: 54px !important; }
  .cv-notes :is(.cv-note, .nt-decide) { width: 44px !important; height: 44px !important; min-height: 0 !important; padding: 0 !important; justify-content: center !important; position: relative; }
  .cv-notes :is(.cv-note, .nt-decide) > :not(.ico) { display: none !important; }
  .cv-notes :is(.cv-note, .nt-decide) .ico { width: 32px !important; height: 32px !important; }
  .cv-notes .nt-decide { overflow: visible !important; }
  .cv-notes .nt-decide.needed::after { content: '!'; position: absolute; top: -5px; right: -5px; width: 16px; height: 16px; background: #f2c14e; color: #1b1407; font: 400 16px/16px 'Jersey 10', monospace; text-align: center; box-shadow: 0 0 0 2px #07090c; }
  .cv-notes .nt-more { display: none !important; }
  /* The turn's summary: between the research and the icons. */
  .nt-digest { left: 72px !important; right: 104px !important; width: auto !important; transform: none !important; max-height: calc(100vh - var(--bar-bottom, 48px) - 80px); overflow-y: auto; }

  /* The end-turn button: its words alone (two lines if need be), the unit count on the button beside it. */
  .cv-corner { width: 176px !important; }
  .cv-endturn { min-height: 52px; padding: 4px 10px !important; }
  .cv-endturn small { display: none !important; }
  .cv-endturn .t, .cv-endturn.need .t { font-size: 20px !important; line-height: .95 !important; white-space: normal !important; overflow: hidden; display: -webkit-box !important; -webkit-line-clamp: 2; -webkit-box-orient: vertical; text-overflow: clip !important; }

  /* A fight being weighed (a finger's first tap on an enemy): the preview alone at the top, the unit's card and the tile's tooltip out of its way. */
  .cv-root:has(.cv-preview) .cv-unit, .cv-root:has(.cv-preview) .cv-tip { display: none !important; }
  .cv-preview { padding: 8px 10px !important; gap: 6px !important; }

  /* How to win, on a short screen: the ways two to a row, so Begin shows without scrolling. */
  .gd-win { width: min(700px, calc(100vw - 8px)) !important; }
  .gd-ways { display: grid !important; grid-template-columns: 1fr 1fr; gap: 6px !important; }
  .gd-way { padding: 6px 8px !important; gap: 8px !important; }
  .gd-way .cv-tile { width: 30px !important; height: 30px !important; }
  .gd-win > small { display: none; }

  /* A deal's lines and amounts readable (they were set small for a wide screen's three columns). */
  .cv-trade-opt, .cv-trade-amt { font-size: 14px !important; }
  .cv-trade-opt small, .cv-trade-amt small { font-size: 13px !important; }

  /* The unit's card: room for its bigger buttons. */
  .cv-unit { max-height: calc(100vh - var(--bar-bottom, 48px) - 12px) !important; }
  .cv-unit .top .cv-pic { width: 48px !important; height: 48px !important; }
}

/* ---- A phone on its side, with fingers: the bar's buttons big enough to press. */
@media ${SMALL} {
  @media ${TOUCH} {
    .cv-top { height: 46px !important; }
    .cv-top .menu button { width: 40px !important; height: 40px !important; }
    .cv-top .menu button .cv-ico { width: 22px !important; height: 22px !important; }
  }
}

/* ---- Narrow (a phone held upright): the Hall of Fame's games in two lines (the score beside the name, how
   it ended under it), and the civilizations' cards a little smaller inside (the portrait and the leader's
   name), so a long name fits, or breaks where its soft hyphen is (Nebuchad-nezzar, ui.ts breakable). */
@media (max-width: 600px) {
  .hf-row { grid-template-columns: auto auto minmax(0, 1fr) auto !important; row-gap: 2px; }
  .hf-row:not(:has(.hf-rank)) { grid-template-columns: auto minmax(0, 1fr) auto !important; }
  .hf-score { grid-row: 1; grid-column: -2 / -1; }
  .hf-res { grid-row: 2; grid-column: -3 / -1; white-space: normal !important; }
  .cv-civ { gap: 8px !important; padding: 6px !important; }
  .cv-civ .cv-portrait { width: 44px !important; height: 44px !important; }
  .cv-civ .txt { min-width: 0; overflow-wrap: break-word; }
  .cv-civ .txt small:first-of-type { font-size: 12.5px !important; }
}

/* ---- Held upright: the top bar in two rows (the civ and the menu, then the numbers), nothing scrolling under anything. */
@media (orientation: portrait) and (max-width: 600px) {
  ${twoRows('')}
  /* The advisor: under the research, the width of the screen but for the icons at the right. */
  .cv-advisor:not(.open), .cv-advisor.open { left: 4px !important; right: 54px !important; top: calc(var(--bar-bottom, 48px) + 84px) !important; max-width: none !important; width: auto !important; }
  .cv-root.ribbon-on .cv-advisor:not(.open), .cv-root.ribbon-on .cv-advisor.open { right: 100px !important; }
  .nt-digest { left: 4px !important; top: calc(var(--bar-bottom, 48px) + 84px) !important; }
  /* A city's screen the width of the screen (a strip of map beside it would be no use). */
  .cv-city { left: 4px !important; width: auto !important; }
}

/* ---- Upright on a bigger screen (a tablet held upright): a bar too full for one row takes two, and what hangs under it starts where it ends. */
@media (orientation: portrait) and (min-width: 601px) {
  ${twoRows('.cv-root.top-scroll')}
  .cv-root.top-scroll :is(.cv-research, .cv-notes, .cv-city, .nt-panel, .nt-digest, .cv-big, .lr) { top: calc(var(--bar-bottom, 58px) + 6px) !important; }
}
`;
