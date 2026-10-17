import type { View } from '../protocol';
import type { ResolutionKind } from '../rules/congress';
import { RESOURCES } from '../rules/terrain';
import { emblemEl, icon, resourceGlyph } from './icons';
import { store } from './store';
import { h, send, tile, togglePanel, type El } from './ui';

/**
 * The World Congress, Civ V's (Brave New World) as the rules have it, simply: its host and the turns
 * to its next session; the proposals before it, each with how it would go now (each civ's expected
 * way and delegates) and your vote (for, against, or abstaining: a person who doesn't vote
 * abstains); a resolution of your own to put to it when you may (the host and the civ with the most
 * delegates besides), or the repeal of one in force; the international projects it has opened, with
 * each civ's share and its tier as it stands; the resolutions in force, each with what it
 * does; the last session's results; and each civ's delegates (yours marked, and where they come from).
 */

type Congress = NonNullable<View['congress']>;
type Proposal = Congress['proposals'][number];

/** Each international project's glyph and colour (its build option's too). */
export const PROJECT_LOOK: Record<string, [glyph: string, color: string]> = {
  worlds_fair: ['frame', '#a85ab8'],
  international_games: ['medal', '#c8892a'],
  space_station: ['satellite', '#2f6fc0'],
};

/** Each kind of resolution's glyph and colour. */
const LOOK: Record<string, [glyph: string, color: string]> = {
  embargo: ['trade', '#b8432f'],
  ban_luxury: ['gems', '#8a4aa8'],
  arts_funding: ['culture', '#a85ab8'],
  sciences_funding: ['science', '#2f6fc0'],
  standing_army_tax: ['coins', '#b8892a'],
  non_proliferation: ['atom', '#3f8f6f'],
  ...PROJECT_LOOK,
};
const kindTile = (kind: string, size: number) => tile(...(LOOK[kind] ?? ['vote', '#3a6a9a']), size);

/** A resolution being drawn up to propose: its kind, and the civ or luxury it names. */
const draft: { kind: string | null; civ: number | null; luxury: string | null } = { kind: null, civ: null, luxury: null };

const nameOf = (i: number) => {
  const p = store.view?.players[i];
  return i === store.view?.you ? 'You' : p?.met ? p.name : 'a civilization you haven’t met';
};

/** Diplomacy, open at the World Congress. */
export function openCongress() {
  store.diplo.with = -3;
  store.diplo.deal = null;
  if (store.panel !== 'diplomacy') togglePanel('diplomacy');
  else store.changed++;
}

/** Turns to the next session, in words (it meets at the end of its turn). */
export function sessionWhen(c: Congress, turn: number): string {
  const left = c.next - turn;
  return left <= 0 ? 'meets at the end of this turn' : left === 1 ? 'meets at the end of next turn' : `meets in ${left} turns (turn ${c.next})`;
}

/** The proposals you haven't voted on yet. */
export const unvoted = (c: Congress) => c.proposals.filter((o) => o.vote === null);

/** How a proposal would go if the session were now: its delegates for and against on a bar, and each civ's way. */
function forecast(o: Proposal, total: number): El {
  const v = store.view!;
  const { yes, no } = o.projected;
  const unsaid = o.forecast.filter((f) => f.vote === null && f.player !== v.you).reduce((n, f) => n + f.delegates, 0);
  // The civs you haven't met vote too (no chip for them): what's in the totals that the chips don't show.
  const shown = (way: 'yes' | 'no') => o.forecast.filter((f) => (f.vote ?? (f.player === v.you ? 'abstain' : null)) === way).reduce((n, f) => n + f.delegates, 0);
  const unmet = [yes - shown('yes') > 0 && `+${yes - shown('yes')} for`, no - shown('no') > 0 && `+${no - shown('no')} against`].filter(Boolean).join(', ');
  const verdict = yes > no ? 'it would pass' : yes === no ? 'a tie: it would fail (a resolution needs more for than against)' : 'it would fail';
  const glyph = { yes: 'check', no: 'close', abstain: 'moves' } as const;
  return h(
    'div.cg-forecast',
    {},
    h('div.cg-tally', { title: `${yes} for, ${no} against, of ${total} delegates` }, h('i.yes', { style: `width:${(yes / Math.max(1, total)) * 100}%` }), h('i.no', { style: `width:${(no / Math.max(1, total)) * 100}%` })),
    h('small.cv-muted', {}, `As it stands: ${yes} for, ${no} against: ${verdict}${unsaid ? ` (${unsaid} of other people's delegates not counted: how they vote is theirs until the session)` : ''}.`),
    h(
      'div.cg-ways',
      {},
      ...o.forecast.map((f) => {
        const p = v.players[f.player];
        const way = f.vote ?? (f.player === v.you ? 'abstain' : null);
        return h(
          `span.cg-way${way ? `.${way}` : ''}`,
          { title: `${nameOf(f.player)}: ${f.delegates} delegates${way === null ? ', their vote kept until the session' : way === 'abstain' ? ', abstaining' : `, ${way === 'yes' ? 'for' : 'against'}`}` },
          p ? emblemEl(p.civ, 16) : null,
          way ? icon(glyph[way], 12) : h('span', {}, '?'),
          String(f.delegates),
        );
      }),
      unmet && h('span.cg-way.unmet', { title: 'Delegates of civilizations you haven’t met, counted in the totals' }, h('span', {}, '?'), `${unmet} from civs you haven’t met`),
    ),
  );
}

/** A proposal before the next session: what it would do, who put it, how it would go, and your vote. */
function proposalCard(o: Proposal, total: number): El {
  const v = store.view!;
  const aimed = (o.kind === 'embargo' && o.civ === v.you) || (o.kind === 'ban_luxury' && !!o.luxury && v.self.luxuries.includes(o.luxury));
  const choice = (vote: 'yes' | 'no' | 'abstain', label: string, glyph: string) =>
    h(`button.cv-btn.small${o.vote === vote ? '.on' : ''}`, { onclick: () => send({ t: 'congressVote', proposal: o.id, vote }) }, icon(glyph, 13), label);
  return h(
    `div.cg-prop${o.vote === null ? '.open' : ''}`,
    {},
    h(
      'div.cg-text',
      {},
      kindTile(o.kind, 30),
      h('div.cv-grow', {}, h('b', {}, o.name.replace(/^Repeal: /, '')), h('small', {}, o.effect), h('small.cv-muted', {}, `${o.repeal ? 'Its repeal, proposed' : 'Proposed'} by ${nameOf(o.by)}`)),
      o.repeal && h('span.cv-chip.on', {}, 'Repeal'),
      aimed && !o.repeal && h('span.cv-chip.bad', {}, o.kind === 'embargo' ? 'Aimed at you' : 'Your luxury'),
    ),
    forecast(o, total),
    h(
      'div.cg-vote',
      {},
      choice('yes', 'For', 'check'),
      choice('no', 'Against', 'close'),
      choice('abstain', 'Abstain', 'moves'),
      h('small.cv-muted', {}, o.vote === null ? 'Not voted: your delegates would abstain' : o.vote === 'abstain' ? 'You abstain' : `Your delegates vote ${o.vote === 'yes' ? 'for' : 'against'}`),
    ),
  );
}

/** The form for a resolution of your own: its kind, then the civ or luxury it names, then put it forward. */
function proposeBlock(c: Congress): El {
  const v = store.view!;
  const kind = c.proposable.find((k) => k.kind === draft.kind) ?? null;
  const civs = c.civs.filter((i) => i !== v.you && v.players[i]?.met);
  const luxuries = [...c.luxuries].sort((a, b) => (RESOURCES[a]?.name ?? a).localeCompare(RESOURCES[b]?.name ?? b));
  const named = kind?.names === 'civ' ? draft.civ !== null : kind?.names === 'luxury' ? draft.luxury !== null : true;
  const inForce = !!kind && c.active.some((a) => a.kind === kind.kind && (kind.names !== 'civ' || a.civ === draft.civ) && (kind.names !== 'luxury' || a.luxury === draft.luxury));
  return h(
    'div.cg-block.cg-propose',
    {},
    h('div.cv-label', {}, 'Put a resolution to the next session'),
    h('small.cv-muted', {}, 'As host, or with the most delegates besides, you may propose one resolution this session.'),
    h(
      'div.cg-kinds',
      {},
      ...c.proposable.map((k) =>
        h(
          `button.cg-kind${draft.kind === k.kind ? '.on' : ''}`,
          { onclick: () => ((draft.kind = k.kind), store.changed++) },
          kindTile(k.kind, 30),
          h('div.cv-grow', {}, h('b', {}, k.name), h('small', {}, k.effect)),
        ),
      ),
    ),
    kind && h('small.cg-chosen', {}, `${kind.name}: ${kind.effect}`),
    kind?.names === 'civ' &&
      h(
        'div.cg-pick',
        {},
        h('small.cv-muted', {}, 'On whom?'),
        ...civs.map((i) => h(`button.cv-chip${draft.civ === i ? '.on' : ''}`, { onclick: () => ((draft.civ = i), store.changed++) }, emblemEl(v.players[i].civ, 16), v.players[i].name)),
        !civs.length && h('small.cv-muted', {}, 'You haven’t met anyone to embargo.'),
      ),
    kind?.names === 'luxury' &&
      h(
        'div.cg-pick',
        {},
        h('small.cv-muted', {}, 'Which luxury?'),
        ...luxuries.map((r) => h(`button.cv-chip${draft.luxury === r ? '.on' : ''}`, { onclick: () => ((draft.luxury = r), store.changed++) }, icon(resourceGlyph(r), 14, RESOURCES[r]?.color), RESOURCES[r]?.name ?? r)),
      ),
    inForce && h('small.cv-muted', {}, 'That is in force already: propose its repeal below instead.'),
    h(
      'button.cv-btn.gold',
      {
        disabled: !kind || !named || inForce,
        onclick: () => {
          if (!kind) return;
          send({ t: 'congressPropose', resolution: kind.kind as ResolutionKind, civ: kind.names === 'civ' ? draft.civ : null, luxury: kind.names === 'luxury' ? draft.luxury : null });
          draft.kind = draft.civ = draft.luxury = null;
        },
      },
      icon('vote', 15),
      'Propose it',
    ),
  );
}

/** The resolutions in force, each with what it does and since when (and, when you may propose, its repeal). */
function activeBlock(c: Congress): El {
  return h(
    'div.cg-block',
    {},
    h('div.cv-label', {}, `In force · ${c.active.length}`),
    ...(c.active.length
      ? c.active.map((a) =>
          h(
            'div.cg-law',
            {},
            kindTile(a.kind, 26),
            h('div.cv-grow', {}, h('b', {}, a.name), h('small', {}, `${a.effect}${a.since ? ` · since turn ${a.since}` : ''}`)),
            c.canPropose &&
              h(
                'button.cv-btn.small',
                { onclick: () => send({ t: 'congressPropose', resolution: a.kind as ResolutionKind, civ: a.civ, luxury: a.luxury, repeal: true }), title: 'Put its repeal to the next session (your one proposal this session)' },
                'Propose repeal',
              ),
          ),
        )
      : [h('small.cv-muted', {}, 'No resolutions are in force.')]),
  );
}

const TIER_COLOR = { gold: '#f2c14e', silver: '#c8d0dc', bronze: '#c8803a' } as const;
const TIER_NAME = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' } as const;

/**
 * The international projects: each one's progress (what's been put in of its cost, and the turns left
 * at the world's pace), each tier's reward, and each civ's share, the most first, with the tier it
 * stands at (or won); yours marked. Done ones after, put away to their result.
 */
function projectsBlock(c: Congress): El | null {
  if (!c.projects.length) return null;
  const v = store.view!;
  const open = c.projects.filter((x) => x.done === null);
  const done = c.projects.filter((x) => x.done !== null);
  const card = (x: Congress['projects'][number]) => {
    const most = Math.max(1, ...x.shares.map((s) => s.put), x.unmet);
    return h(
      'div.cg-prop',
      {},
      h(
        'div.cg-text',
        {},
        kindTile(x.id, 30),
        h('div.cv-grow', {}, h('b', {}, x.name), h('small.cv-muted', {}, `${x.total} of ${x.cost} production · ${x.turns === null ? 'nothing going in yet' : `${x.perTurn} a turn: done in about ${x.turns} turn${x.turns === 1 ? '' : 's'}`}`)),
        x.mine && h('span.cv-chip.on', { style: `color:${TIER_COLOR[x.mine]}` }, `${TIER_NAME[x.mine]} for you`),
      ),
      h('div.cv-bar.orange', {}, h('i', { style: `width:${Math.min(100, Math.round((x.total / Math.max(1, x.cost)) * 100))}%` })),
      h('div.cg-tiers', {}, ...(['gold', 'silver', 'bronze'] as const).map((t) => h('small', {}, h('b', { style: `color:${TIER_COLOR[t]}` }, `${TIER_NAME[t]} `), x.rewards[t]))),
      h(
        'div.cg-shares',
        {},
        ...x.shares.map((s) =>
          h(
            `div.cg-share${s.player === v.you ? '.mine' : ''}`,
            { title: `${nameOf(s.player)}: ${s.put} production${s.tier ? `, ${TIER_NAME[s.tier].toLowerCase()} as it stands` : ''}` },
            emblemEl(v.players[s.player]?.civ ?? '', 16),
            h('span.cv-grow', {}, nameOf(s.player)),
            h('i', { style: `width:${Math.round((s.put / most) * 60)}px` }),
            s.tier ? icon('medal', 13, TIER_COLOR[s.tier]) : h('span.cg-none', {}),
            h('b', {}, String(s.put)),
          ),
        ),
        x.unmet > 0 && h('small.cv-muted', {}, `${x.unmet} put in by civilizations you haven’t met`),
      ),
    );
  };
  return h(
    'div.cg-block',
    {},
    h('div.cv-label', {}, `International projects · ${open.length} under way`),
    h('small.cv-muted', {}, 'Any of your cities may put its production into one (from its build list); it can’t be bought. When the cost is reached, the civ that put in most wins gold, the next silver, and the rest who put in a twentieth or more, bronze.'),
    ...open.map(card),
    ...done.map((x) =>
      h(
        'div.cg-law.passed',
        {},
        kindTile(x.id, 24),
        h('div.cv-grow', {}, h('b', {}, x.name), h('small', {}, `Done on turn ${x.done}: ${x.shares.filter((s) => s.tier).map((s) => `${nameOf(s.player)} ${TIER_NAME[s.tier!].toLowerCase()}`).join(', ') || 'no one you’ve met placed'}`)),
        x.mine && icon('medal', 16, TIER_COLOR[x.mine]),
      ),
    ),
  );
}

/** The last session's results. */
function lastBlock(c: Congress): El | null {
  if (!c.last?.results.length) return null;
  return h(
    'div.cg-block',
    {},
    h('div.cv-label', {}, `The last session · turn ${c.last.turn}`),
    ...c.last.results.map((x) =>
      h(
        `div.cg-law.${x.passed ? 'passed' : 'failed'}`,
        {},
        tile(x.passed ? 'check' : 'close', store.colourBlind ? (x.passed ? '#2f6fc0' : '#a8601e') : x.passed ? '#3f8f4f' : '#8a3a2a', 24),
        h('div.cv-grow', {}, h('b', {}, x.name), h('small', {}, x.effect)),
        h('small.cv-muted', {}, `${x.passed ? 'passed' : 'failed'}: ${x.yes} for, ${x.no} against`),
      ),
    ),
  );
}

/** Each civ's delegates (those you've met), the most first: yours marked, the host crowned; where yours come from. */
function delegatesBlock(c: Congress): El {
  const v = store.view!;
  const m = c.mine;
  const sources = [
    `${m.base} of your own`,
    m.host > 0 && `${m.host} as host`,
    m.un > 0 && `${m.un} for the United Nations`,
    m.cityStates > 0 && `${m.cityStates} from your city-state ${m.cityStates === 1 ? 'ally' : 'allies'}`,
    m.diplomats > 0 && `${m.diplomats} from your diplomat${m.diplomats === 1 ? '' : 's'} abroad`,
  ].filter(Boolean);
  const shown = c.delegates.reduce((n, d) => n + d.delegates, 0);
  const rows = [...c.delegates]
    .sort((a, b) => b.delegates - a.delegates)
    .map((d) =>
      h(
        `div.cg-del${d.player === v.you ? '.mine' : ''}`,
        {},
        emblemEl(v.players[d.player]?.civ ?? '', 18),
        h('span.cv-grow', {}, nameOf(d.player)),
        d.player === c.host && h('span', { title: 'Host of the World Congress' }, icon('crown', 13, '#f2c14e')),
        h('b', {}, String(d.delegates)),
      ),
    );
  return h(
    'div.cg-block',
    {},
    h('div.cv-label', {}, `Delegates · ${c.total} in all`),
    h('small.cv-muted', {}, `Yours: ${m.total} (${sources.join(', ')}). A resolution passes with more delegates for it than against.${shown < c.total ? ` ${c.total - shown} belong to civilizations you haven’t met.` : ''}`),
    h('div.cg-dels', {}, ...rows),
  );
}

/** The World Congress page in Diplomacy. */
export function renderCongress(): El[] {
  const v = store.view!;
  const c = v.congress;
  if (!c) return [h('div.cv-muted', {}, 'The World Congress is founded when the first civilization reaches the Renaissance.')];
  const open = unvoted(c).length;
  return [
    h(
      'div.cg-head',
      {},
      tile('vote', '#3a6a9a', 40),
      h('div.cv-grow', {}, h('b.cg-title', {}, `Hosted by ${nameOf(c.host)}`), h('small.cv-muted', {}, `The World Congress ${sessionWhen(c, v.turn)}.`)),
      open > 0 && h('span.cv-chip.on', {}, `${open} to vote on`),
    ),
    h(
      'div.cg-block',
      {},
      h('div.cv-label', {}, `Before the next session · ${c.proposals.length}`),
      ...(c.proposals.length ? c.proposals.map((o) => proposalCard(o, c.total)) : [h('small.cv-muted', {}, 'Nothing has been proposed yet. The host and the civ with the most delegates besides may each propose one resolution.')]),
    ),
    c.canPropose && proposeBlock(c),
    projectsBlock(c),
    activeBlock(c),
    lastBlock(c),
    delegatesBlock(c),
  ].filter((x): x is El => !!x);
}

export const CONGRESS_CSS = `
.cg-head { display: flex; align-items: center; gap: 10px; }
.cg-title { display: block; font: 400 24px/1 'Jersey 10', monospace; color: #fff; text-shadow: 2px 2px 0 #0b0d12; }
.cg-block { display: flex; flex-direction: column; gap: 6px; }
.cg-block > small, .cg-text small, .cg-law small { font-family: 'Chakra Petch', system-ui, sans-serif; font-size: 13.5px; }
.cg-prop { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; background: rgba(255,255,255,.035); box-shadow: inset 0 0 0 2px #11141a, inset 4px 0 0 #5d6884; }
.cg-prop.open { box-shadow: inset 0 0 0 2px #11141a, inset 4px 0 0 #f2c14e; }
.cg-text { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cg-text b, .cg-law b { display: block; font: 400 20px/1.1 'Jersey 10', monospace; color: #fff; }
.cg-text small { display: block; margin-top: 2px; }
.cg-forecast { display: flex; flex-direction: column; gap: 4px; }
.cg-tally { display: flex; height: 12px; background: #0f1218; box-shadow: inset 0 0 0 2px #07090c; }
.cg-tally i { display: block; height: 100%; }
.cg-tally .yes { background: repeating-linear-gradient(90deg, transparent 0 8px, #0f1218 8px 10px), linear-gradient(180deg, #b4f08c 0 2px, #5cc040 2px calc(100% - 2px), #2e7a20 calc(100% - 2px)); }
.cg-tally .no { margin-left: auto; background: repeating-linear-gradient(90deg, transparent 0 8px, #0f1218 8px 10px), linear-gradient(180deg, #ff9a8a 0 2px, #e04a34 2px calc(100% - 2px), #8a2014 calc(100% - 2px)); }
.cg-ways { display: flex; flex-wrap: wrap; gap: 4px; }
.cg-way { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px 1px 3px; background: #343b4a; box-shadow: inset 0 0 0 2px #07090c; font: 400 16px/1 'Jersey 10', monospace; color: var(--muted); }
.cg-way.yes { background: #24402a; color: #b8f09c; } .cg-way.no { background: #4a2420; color: #ffb4a6; }
.cg-way.unmet { padding-left: 6px; font: 400 14px/1.1 'Tiny5', monospace; }
.cg-vote { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.cg-vote .cv-btn.on { border-image: none !important; background: #5fb042 !important; box-shadow: 0 0 0 2px #07090c, inset 2px 2px 0 #a6ec7c, inset -2px -2px 0 #2c6420 !important; }
.cg-vote small { margin-left: 4px; }
.cg-kinds { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 6px; }
.cg-kind { display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px; text-align: left; background: rgba(255,255,255,.04); box-shadow: inset 0 0 0 2px #11141a; }
.cg-kind:hover { background: rgba(255,255,255,.08); }
.cg-kind.on { background: rgba(242,193,78,.14); box-shadow: inset 0 0 0 2px #f2c14e; }
.cg-kind b { display: block; font: 400 19px/1 'Jersey 10', monospace; color: #fff; }
.cg-kind small { display: block; font-family: 'Chakra Petch', system-ui, sans-serif; font-size: 12.5px; line-height: 1.3; color: var(--muted); margin-top: 2px; }
.cg-chosen { display: none; }
.cg-pick { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.cg-propose > .cv-btn { align-self: flex-start; }
.cg-law { display: flex; align-items: center; gap: 8px; padding: 4px 6px; background: rgba(255,255,255,.035); }
.cg-law b { font-size: 18px; }
.cg-law.failed b { color: var(--muted); }
.cg-tiers { display: flex; flex-direction: column; gap: 1px; }
.cg-tiers small { font-family: 'Chakra Petch', system-ui, sans-serif; font-size: 13px; color: var(--muted); }
.cg-tiers b { font: 400 16px/1 'Jersey 10', monospace; }
.cg-shares { display: flex; flex-direction: column; gap: 3px; }
.cg-share { display: flex; align-items: center; gap: 7px; padding: 3px 8px; background: rgba(255,255,255,.035); font-size: 14px; }
.cg-share i { display: block; height: 8px; background: linear-gradient(180deg, #ffd08a 0 2px, #e0902a 2px calc(100% - 2px), #8a5014 calc(100% - 2px)); box-shadow: 0 0 0 2px #07090c; }
.cg-share .cg-none { width: 13px; }
.cg-share b { min-width: 40px; text-align: right; font: 400 18px/1 'Jersey 10', monospace; }
.cg-share.mine { background: rgba(242,193,78,.14); box-shadow: inset 0 0 0 2px #f2c14e; }
.cg-dels { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 4px; }
.cg-del { display: flex; align-items: center; gap: 7px; padding: 4px 8px; background: rgba(255,255,255,.035); font-size: 14px; }
.cg-del b { font: 400 20px/1 'Jersey 10', monospace; }
.cg-del.mine { background: rgba(242,193,78,.14); box-shadow: inset 0 0 0 2px #f2c14e; }
/* The colour-blind palette (the tally and the ways are pixel.ts's): the vote cast in blue. */
.cv-root.cb .cg-vote .cv-btn.on { background: #3f80c8 !important; box-shadow: 0 0 0 2px #07090c, inset 2px 2px 0 #a8dcff, inset -2px -2px 0 #1e4a80 !important; }
@media (max-width: 760px), (max-height: 520px) {
  .cg-kinds { grid-template-columns: 1fr; }
  .cg-kind small { display: none; }
  .cg-chosen { display: block; color: var(--muted); }
  .cg-dels { grid-template-columns: 1fr 1fr; }
}
`;
