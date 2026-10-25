import type { PlayerSummary } from '../protocol';
import { CIVS } from '../rules/civs';
import { emblemEl, svg } from './icons';
import { PICTURES, type PictureId } from './picturefiles';
import { openCityState, openQuests } from './citystates';
import { openDiplomacy } from './diplomacy';
import { faceEl } from './chat';
import { store, tone } from './store';
import { h, type El } from './ui';

/**
 * The leaders down the right of the screen, Civilization's way: each civ met, its leader in a frame of
 * its colours; how they feel about you (a strip of blocks), what's between you (marks at the portrait's
 * corners: war or a denouncement, friendship or a pact, a team, a person's turn done), and their score;
 * the civs not met yet as a "?" each, and the city-states as a group under them, opened with a click. A
 * click on a leader opens diplomacy with them; a right-click (or the mouse resting) their Civilopedia.
 */

const STANCES: Record<string, { word: string; color: string; blocks: number }> = {
  hostile: { word: 'Hostile', color: '#ff6b5e', blocks: 1 },
  guarded: { word: 'Guarded', color: '#f0a24a', blocks: 2 },
  neutral: { word: 'Neutral', color: '#b7c3cf', blocks: 3 },
  favorable: { word: 'Favorable', color: '#a6dd8a', blocks: 4 },
  friendly: { word: 'Friendly', color: '#6fd27a', blocks: 5 },
};

const STANDING: Record<string, string> = { ally: '#f2c14e', friend: '#6fd27a', neutral: '#5d6884', war: '#ff6b5e' };

/** The city-states' group: open or shut. */
let statesOpen = false;

const badge = (corner: string, glyph: string, cls: string) => h(`span.lr-badge.${corner}.${cls}`, { html: svg(glyph, 12) });

/** With people at war taking turns one side at a time: whether a player's side is yet to play its segment, or playing it now. */
function sequenceAwaits(i: number): boolean {
  const q = store.view?.sequence;
  return !!q && q.sides.findIndex((x) => x.includes(i)) > q.at;
}
const sequencePlays = (i: number) => !!store.view?.sequence?.sides[store.view.sequence.at]?.includes(i);

/** A civ met: its leader framed in its colours, its marks, its mood and its score. */
function leader(p: PlayerSummary): El {
  const civ = CIVS[p.civ];
  const r = p.relation;
  const stance = r?.opinion ? (STANCES[r.opinion.stance] ?? STANCES.neutral) : null;
  // (A team, where the game has them.)
  const team = (p as PlayerSummary & { team?: number | null }).team;
  const person = !p.bot;
  const done = person && (p.ready || p.here === false);
  const words = [
    `${p.name} of ${civ?.name ?? p.civ}`,
    p.war ? 'At war with you' : stance ? `${stance.word} toward you (${r!.opinion!.total > 0 ? '+' : ''}${r!.opinion!.total})` : 'A person',
    r && r.pact > 0 ? `Defensive pact (${r.pact} turns)` : '',
    r && r.friends > 0 ? `Friends (${r.friends} turns)` : '',
    r && r.denouncedYou > 0 ? 'They have denounced you' : '',
    r && r.youDenounced > 0 ? 'You have denounced them' : '',
    typeof team === 'number' ? `Team ${team + 1}` : '',
    p.master !== undefined ? (p.master === store.view?.you ? 'Your vassal' : `${store.view?.players[p.master]?.name ?? 'Another'}’s vassal`) : '',
    store.view?.self.vassal?.master === p.index ? 'Your master' : '',
    `Score ${p.score}`,
    person ? (p.here === false ? 'Away' : p.ready ? 'Done with the turn' : sequenceAwaits(p.index) ? 'Waits for their turn (at war: one side at a time)' : sequencePlays(p.index) ? 'Taking their turn (at war: one side at a time)' : 'Still deciding') : '',
  ].filter(Boolean);
  const pic = PICTURES[`l_${p.civ}` as PictureId];
  const el = h(
    `button.lr-civ${p.war ? '.war' : ''}${person && p.here === false ? '.away' : ''}`,
    { style: `--civ:${civ?.color ?? '#555'};--acc:${civ?.accent ?? '#fff'}`, 'data-pedia': `civ:${p.civ}`, 'data-note': words.join(' · '), 'aria-label': words.join(', ') },
    h('span.lr-face', {}, pic ? h('img', { src: pic, alt: '', draggable: 'false' }) : emblemEl(p.civ, 34)),
    p.war ? badge('tl', 'war', 'bad') : r && r.denouncedYou > 0 ? badge('tl', 'skull', 'bad') : null,
    r && r.pact > 0 ? badge('tr', 'shield', 'good') : r && r.friends > 0 ? badge('tr', 'peace', 'good') : null,
    typeof team === 'number' ? h('span.lr-badge.bl.team', {}, String(team + 1)) : p.master !== undefined || store.view?.self.vassal?.master === p.index ? badge('bl', 'crown', 'crown') : null,
    person ? badge('br', done ? 'check' : 'turn', done ? 'good' : 'wait') : null,
    stance && h('span.lr-mood', { style: `--mood:${tone(stance.color)}` }, ...[1, 2, 3, 4, 5].map((i) => h(`i${i <= stance.blocks ? '.on' : ''}`))),
    h('b.lr-score', {}, String(p.score)),
    // (A face their leader's just made, `chat.ts`.)
    faceEl(p.index),
  );
  el.addEventListener('click', () => openDiplomacy(p.index));
  return el;
}

/** The city-states met: a group, opened with a click; each with how it stands with you and your influence. */
function cityStates(list: PlayerSummary[]): El | null {
  if (!list.length) return null;
  const allies = list.filter((p) => p.cityState?.standing === 'ally').length;
  const asks = openQuests(list);
  const head = h(
    `button.lr-cs-head${statesOpen ? '.on' : ''}`,
    { title: `City-states: ${list.length} met${allies ? `, ${allies} your ally` : ''}${asks ? `, ${asks} asking something of you` : ''}${statesOpen ? '' : ' (click to show them)'}` },
    h('span', { html: svg('crown', 14) }),
    h('b', {}, String(list.length)),
    asks > 0 && h('i.lr-ask', {}, '!'),
  );
  head.addEventListener('click', () => ((statesOpen = !statesOpen), store.changed++));
  return h(
    'div.lr-cs',
    {},
    head,
    ...(statesOpen
      ? list.map((p) => {
          const cs = p.cityState!;
          const el = h(
            'button.lr-state',
            { style: `--stand:${tone(STANDING[cs.standing] ?? STANDING.neutral)}`, 'data-pedia': `citystate:${cs.kind}`, 'data-note': `${p.name}: ${cs.standing === 'war' ? 'at war with you' : cs.standing === 'neutral' ? 'neutral' : `your ${cs.standing}`} · influence ${Math.round(cs.influence)}` },
            emblemEl(p.civ, 26, cs.kind),
            h('b', {}, String(Math.round(cs.influence))),
          );
          el.addEventListener('click', () => openCityState(p.index));
          return el;
        })
      : []),
  );
}

/** The ribbon's foot faded while there's more of it to scroll to (marked on its part, so the ribbon keeps its scroll through a redraw). */
function hintMore(el: El) {
  const more = () => el.parentElement?.classList.toggle('lr-more', el.scrollTop + el.clientHeight < el.scrollHeight - 2);
  el.addEventListener('scroll', more, { passive: true });
  requestAnimationFrame(more);
}

/** The ribbon fitted to the room between its top and the bottom-right corner's (after both are drawn). */
export function fitRibbon(ribbon: Element | null, corner: Element | null) {
  const el = ribbon as HTMLElement | null;
  if (!el || !corner) return;
  const room = Math.floor((corner.getBoundingClientRect().top - el.getBoundingClientRect().top) / store.uiScale - 8);
  el.style.maxHeight = `${Math.max(60, room)}px`;
  el.dispatchEvent(new Event('scroll'));
}

/** The ribbon (null before anyone's been met). */
export function renderRibbon(): El | null {
  const v = store.view!;
  const others = v.players.filter((p) => p.index !== v.you && p.alive && !p.cityState && p.civ !== 'barbarian');
  const met = others.filter((p) => p.met && p.relation);
  const unmet = others.length - met.length;
  const states = v.players.filter((p) => p.cityState && p.met && p.alive);
  if (!met.length && !states.length) return null;
  const el = h(
    'div.lr.cv-scroll',
    {},
    ...met.map(leader),
    ...Array.from({ length: unmet }, () => h('span.lr-unmet', { title: "A civilization you haven't met yet" }, '?')),
    cityStates(states),
  );
  hintMore(el);
  return el;
}

export const RIBBON_CSS = `
.lr { position: absolute; right: 8px; top: 64px; width: 68px; max-height: calc(100vh - 372px); padding: 4px 0 6px; display: flex; flex-direction: column; align-items: center; gap: 3px; overflow-y: auto; overflow-x: hidden; scrollbar-width: none; pointer-events: auto; }
.lr::-webkit-scrollbar { display: none; }
.lr-more > .lr { -webkit-mask-image: linear-gradient(#000 calc(100% - 26px), transparent); mask-image: linear-gradient(#000 calc(100% - 26px), transparent); }
.cv-root.ribbon-on .cv-notes { right: 82px; }
.lr-civ { position: relative; width: 60px; display: flex; flex-direction: column; align-items: center; gap: 0; padding: 2px 0 0; cursor: pointer; }
/* The frame: an edge of black, the civ's colour lit along its top and left, then the portrait on dark. */
.lr-face { position: relative; width: 48px; height: 48px; padding: 6px; display: block; background: var(--civ);
  box-shadow: inset 0 0 0 2px #07090c, inset 4px 4px 0 rgba(255,255,255,.3), inset -4px -4px 0 rgba(0,0,0,.3), 3px 3px 0 rgba(4,6,10,.55); }
.lr-face::after { content: ''; position: absolute; inset: 5px; box-shadow: 0 0 0 1px #07090c; pointer-events: none; }
.lr-face img, .lr-face .cv-em { display: block; width: 36px; height: 36px; object-fit: cover; object-position: 50% 22%; background: radial-gradient(circle at 50% 40%, #3a4252, #181c24 75%); image-rendering: pixelated; }
.lr-face .cv-em { display: flex; align-items: center; justify-content: center; }
.lr-civ:hover .lr-face { transform: translateX(-3px); box-shadow: inset 0 0 0 2px #07090c, inset 4px 4px 0 rgba(255,255,255,.3), inset -4px -4px 0 rgba(0,0,0,.3), 3px 3px 0 rgba(4,6,10,.55), 0 0 0 2px #f2c14e; }
.lr-civ.away .lr-face img { filter: grayscale(.8) brightness(.7); }
.lr-badge { position: absolute; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; color: #fff; box-shadow: 0 0 0 2px #07090c, inset 2px 2px 0 rgba(255,255,255,.25), inset -2px -2px 0 rgba(0,0,0,.3); z-index: 1; }
.lr-badge.tl { left: -2px; top: -2px; } .lr-badge.tr { right: -2px; top: -2px; } .lr-badge.bl { left: -1px; top: 36px; } .lr-badge.br { right: -1px; top: 36px; }
.lr-badge.bad { background: #b0412d; } .lr-badge.good { background: #3f8a2c; } .lr-badge.wait { background: #343c4d; color: #9aa4b5; }
.lr-badge.crown { background: #9a7a1a; color: #fff3c4; }
.lr-badge.team { background: #2a5a9a; font: 400 15px/1 'Jersey 10', monospace; text-shadow: 1px 1px 0 #07090c; }
.lr-mood { display: flex; gap: 2px; padding: 2px; background: #07090c; }
.lr-mood i { display: block; width: 8px; height: 4px; background: #262c37; }
.lr-mood i.on { background: var(--mood); box-shadow: inset 0 1px 0 rgba(255,255,255,.35); }
/* The score: a tag over the frame's bottom edge. */
.lr-score { position: absolute; left: 50%; top: 37px; transform: translateX(-50%); padding: 0 3px 1px; background: #11141a; box-shadow: 0 0 0 2px #07090c; font: 400 16px/1 'Jersey 10', monospace; letter-spacing: .03em; color: #eef1f5; text-shadow: 1px 1px 0 #0b0d12; z-index: 1; }
.lr-civ:hover .lr-score { transform: translateX(calc(-50% - 3px)); }
.lr-mood { margin-top: 7px; }
.lr-civ.war .lr-score { color: #ffb4a6; }
.lr-unmet { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; font: 400 28px/1 'Jersey 10', monospace; color: #6c7688; background: #181c24; box-shadow: inset 2px 2px 0 #0b0d12, inset -2px -2px 0 #343c4d, 0 0 0 2px #07090c; opacity: .85; }
.lr-cs { display: flex; flex-direction: column; align-items: center; gap: 6px; margin-top: 2px; }
.lr-cs-head { display: flex; align-items: center; gap: 4px; padding: 3px 7px 4px; color: #f2c14e; background: linear-gradient(180deg, #4a5368 0 50%, #434b5e 50%); box-shadow: 0 0 0 2px #07090c, inset 2px 2px 0 #6a7590, inset -2px -2px 0 #232833; cursor: pointer; }
.lr-cs-head b { font: 400 18px/1 'Jersey 10', monospace; color: #fff; text-shadow: 2px 2px 0 #0b0d12; }
.lr-cs-head { position: relative; }
.lr-ask { position: absolute; top: -6px; right: -6px; width: 14px; height: 14px; background: #f2c14e; color: #1b1407; font: 400 14px/14px 'Jersey 10', monospace; font-style: normal; text-align: center; box-shadow: 0 0 0 2px #07090c; }
.lr-cs-head.on { background: #5fb042; box-shadow: 0 0 0 2px #07090c, inset 2px 2px 0 #a6ec7c, inset -2px -2px 0 #2c6420; }
.lr-state { display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 3px; background: #181c24; box-shadow: 0 0 0 2px #07090c, inset 0 0 0 2px var(--stand); cursor: pointer; }
.lr-state b { font: 400 15px/1 'Jersey 10', monospace; color: #eef1f5; }

/* A small screen: portraits only, smaller (the mood a thin strip, the score on the card a tap away). */
@media (max-width: 760px), (max-height: 520px) {
  .lr { right: 4px; top: 48px; width: 42px; gap: 4px; max-height: calc(100vh - 176px); padding: 2px 0 4px; }
  .cv-root.ribbon-on .cv-notes { right: 50px; }
  .lr-civ { width: 40px; gap: 2px; padding-top: 2px; }
  .lr-face { width: 38px; height: 38px; padding: 5px; box-shadow: inset 0 0 0 2px #07090c, inset 3px 3px 0 rgba(255,255,255,.3), inset -3px -3px 0 rgba(0,0,0,.3), 2px 2px 0 rgba(4,6,10,.55); }
  .lr-face img, .lr-face .cv-em { width: 28px; height: 28px; }
  .lr-face::after { inset: 4px; }
  .lr-mood { margin-top: 0; }
  .lr-badge { width: 14px; height: 14px; } .lr-badge svg { width: 10px; height: 10px; }
  .lr-badge.bl, .lr-badge.br { top: 26px; }
  .lr-badge.team { font-size: 13px; }
  .lr-score, .lr-unmet { display: none; }
  .lr-mood { padding: 1px; gap: 1px; } .lr-mood i { width: 6px; height: 3px; }
  .lr-cs-head { padding: 2px 4px 3px; } .lr-cs-head b { font-size: 15px; }
  /* The advisor's line between the research and the notes, which have moved over for the ribbon. */
  .cv-root.ribbon-on .cv-advisor { left: 212px; transform: none; width: calc(100vw - 476px); min-width: 170px; }
}
@media (orientation: portrait) and (max-width: 600px) {
  .cv-root.ribbon-on .cv-advisor { left: 4px; right: 50px; width: auto; }
}
`;
