import type { View } from '../protocol';
import { BUILDINGS } from '../rules/buildings';
import { CIVS } from '../rules/civs';
import { FIRST_FINDER_GOLDEN, FOUND_HAPPINESS, NATURAL_WONDERS } from '../rules/nature';
import { SPEEDS } from '../rules/state';
import { ERA_NAMES, ERAS } from '../rules/techs';
import { isGreatPerson, UNITS } from '../rules/units';
import { PROJECT_LOOK } from './congress';
import { wonderPicture } from './icons';
import { unitModel } from './models3d';
import { prefs } from './prefs';
import { play, soon } from './sound';
import { endingMoments } from './ending';
import { momentPace } from './splash';
import { store, type Splash } from './store';
import { WONDER_LINES } from './wonderlines';

/**
 * The big moments, seen in what changed from one view to the next: a new era (its room behind its
 * name), a wonder of yours finished (turning on its card, the camera gone to see it in its city), a
 * natural wonder found, first contact with a civ, war and peace, your first city; each a card in the
 * middle of the screen, one at a time (`splash.ts`), and a sound. Lighter ones are a small card at
 * the top for a few seconds: a great person born, a golden age, a religion founded, another civ's
 * wonder (with a short flyover if its city's in sight), a World Congress project done (a full card for
 * its gold). With quick movement or combat off, every
 * moment is a light one and the camera stays put. Other changes just sound: a new turn, a city
 * founded, and your empire's news (a tech learned, a policy adopted, a building or a unit finished),
 * spaced out as it comes together.
 */
/** What each era brings, said on its card (from the Classical on: the Ancient is where every game begins). */
const ERA_LINES = [
  '',
  'Marble and roads, philosophers and legions: your people build to last.',
  'Castles and cathedrals rise, and knights ride out under your banner.',
  'Sails on every sea, and new ideas in every square.',
  'Steam and iron: the factories roar and the railways run.',
  'Electric light, the radio, the motor car: the world grows small.',
  'The atom split and the sky crossed: power beyond imagining.',
  'A world wired together, and the stars within reach.',
];

export function moments(prev: View | null, v: View) {
  // Your own civilization fallen (your screen now watches the rest of the game). Its panels go (one
  // left open isn't drawn for someone watching, and would hold back this card and the game's end), and
  // the moments of its life still waiting to be shown with them.
  if (prev && !prev.spectator && v.fallen !== undefined) {
    store.panel = null;
    store.selectedUnit = store.selectedCity = null;
    store.splashes = [{ kick: 'Defeat', title: 'Your civilization has fallen', text: 'Its last city is lost. You can watch the rest of the game, every civilization’s land shown, or leave.', glyph: { name: 'war', color: '#a03a2a' } }];
    store.splashAt = 0;
    store.changed++;
    play('bad');
    return;
  }
  // The first view after joining (or a reload): nothing's new, it's just here.
  if (!prev || prev.you !== v.you) return;
  const out: Splash[] = [];
  const a = prev.self;
  const b = v.self;
  if (v.turn > prev.turn) play('turn', 0.8);
  if (b.era > a.era) {
    out.push({ kick: 'A new era', title: `The ${ERA_NAMES[ERAS[b.era]]}`, text: ERA_LINES[b.era] || 'Your people step into a new age of discovery.', room: b.era });
    play('era');
  }
  for (const [id, owner] of Object.entries(v.wonders)) {
    if (prev.wonders[id] !== undefined || owner < 0) continue;
    const picture = wonderPicture(id) ?? 'w_palace';
    const city = v.cities.find((c) => c.wonders?.includes(id));
    const name = BUILDINGS[id]?.name ?? id;
    if (owner === v.you) {
      out.push({ kick: 'Wonder completed', title: name, quote: WONDER_LINES[id], text: city ? `Built in ${city.name}: a marvel of your age.` : 'A marvel of your age, built by your people.', turn: `${picture}_turn`, picture, visit: city?.tile });
      play('wonder');
    } else if (city && store.known[city.tile]?.visible && !prefs.quiet.includes('wonders')) {
      // Another civ's, in a city in sight: a light card and a look at it (out of sight, the news says it).
      out.push({ kick: 'A wonder of the world', title: name, text: `Built by ${v.players[owner]?.name ?? 'another civilization'} in ${city.name}.`, turn: `${picture}_turn`, picture, light: true, visit: city.tile, back: true });
    }
  }
  for (const found of b.naturalWonders) {
    const w = NATURAL_WONDERS[found.id];
    if (!w || a.naturalWonders.some((x) => x.id === found.id)) continue;
    const speed = SPEEDS[store.lobby?.settings.speed ?? 'standard'];
    const gifts = found.first ? ` First to find it: +${Math.floor(FIRST_FINDER_GOLDEN * speed)} golden-age points${w.finderGold ? `, ${Math.floor(w.finderGold * speed)} gold` : ''}.` : '';
    out.push({ kick: 'Natural wonder discovered', title: w.name, text: `${w.flavour} +${FOUND_HAPPINESS} happiness for good.${gifts}`, landmark: w.id, at: store.known.findIndex((k) => k?.wonder === w.id) });
    play('discover');
  }
  // A World Congress project done: a card for everyone (a full one for a gold), with where you placed.
  for (const x of v.congress?.projects ?? []) {
    if (x.done === null || prev.congress?.projects.find((y) => y.id === x.id)?.done !== null) continue;
    const first = x.shares.find((s) => s.tier === 'gold');
    const who = first ? (first.player === v.you ? 'you' : v.players[first.player]?.name ?? 'another civilization') : 'a civilization you haven’t met';
    const look = PROJECT_LOOK[x.id] ?? ['vote', '#3a6a9a'];
    const placed = x.mine ? `You take ${x.mine}: ${x.rewards[x.mine].charAt(0).toLowerCase()}${x.rewards[x.mine].slice(1)}.` : 'You put in too little to place.';
    out.push({ kick: 'World Congress project', title: x.name, text: `Done, and ${who} put in the most. ${placed}`, glyph: { name: look[0], color: look[1] }, light: x.mine !== 'gold' });
    play(x.mine ? 'wonder' : 'note');
  }
  if (b.religion && !a.religion) {
    const r = v.religions.find((x) => x.id === b.religion);
    out.push({ kick: 'Religion founded', title: r?.name ?? 'A new faith', text: 'Your prophet has given your people a faith of their own.', glyph: { name: 'faith', color: '#7a6a9a' }, light: true });
    play('faith');
  }
  if (b.goldenTurns > 0 && a.goldenTurns === 0) {
    out.push({ kick: 'Golden age', title: 'A golden age begins', text: `${b.goldenTurns} turns of more production, gold and culture.`, glyph: { name: 'golden', color: '#c8892a' }, light: true });
    play('golden');
  }
  // Great people born (the world shows them too: a column of light, `worldfx.ts`).
  const was = new Set(prev.units.map((u) => u.id));
  for (const u of v.units)
    if (u.owner === v.you && !was.has(u.id) && isGreatPerson(u.type))
      out.push({ kick: 'A great person is born', title: UNITS[u.type]?.name ?? 'A great person', text: 'Their gift is yours to use: select them to see what they can do.', picture: unitModel(u.type), light: true });
  for (const p of v.players) {
    const was = prev.players[p.index];
    if (!was || p.index === v.you || p.civ === 'barbarian') continue;
    if (p.met && !was.met) {
      if (p.cityState) out.push({ kick: 'A city-state', title: p.name, text: 'A free city. Gifts of gold win its friendship, and what it has to give.', emblem: { civ: p.civ, kind: p.cityState.kind } });
      else out.push({ kick: 'First contact', title: `${p.name} of ${CIVS[p.civ]?.name ?? ''}`, text: CIVS[p.civ]?.ability ? `${CIVS[p.civ].ability.name}: ${CIVS[p.civ].ability.text}` : 'A new civilization.', picture: `l_${p.civ}` });
      play('note');
    }
    if (!p.cityState && p.war && !was.war && p.met) {
      out.push({ kick: 'War', title: `War with ${CIVS[p.civ]?.name ?? p.name}`, text: `${p.name} and you are at war.`, picture: `l_${p.civ}_cross`, leader: { player: p.index, kind: 'war' } });
      play('war');
    } else if (!p.cityState && !p.war && was.war && p.alive) {
      out.push({ kick: 'Peace', title: `Peace with ${CIVS[p.civ]?.name ?? p.name}`, text: 'The fighting is over, for now.', picture: `l_${p.civ}`, leader: { player: p.index, kind: 'deal' } });
      play('peace');
    }
    // Denouncements, theirs of you and yours of them.
    if (!p.cityState && (p.relation?.denouncedYou ?? 0) > 0 && !(was.relation?.denouncedYou ?? 0)) {
      out.push({ kick: 'Denounced', title: `${p.name} denounces you`, text: 'Before the whole world. Others will think the less of you for it.', picture: `l_${p.civ}_cross`, leader: { player: p.index, kind: 'denounce' } });
      play('bad');
    } else if (!p.cityState && (p.relation?.youDenounced ?? 0) > 0 && !(was.relation?.youDenounced ?? 0)) {
      out.push({ kick: 'Denunciation', title: `You denounce ${p.name}`, text: 'The world has heard it. They will not forget.', picture: `l_${p.civ}_cross`, leader: { player: p.index, kind: 'denounce' } });
      play('bad');
    }
  }
  const mine = (w: View) => w.cities.filter((c) => c.owner === w.you).length;
  if (mine(v) > mine(prev)) {
    if (mine(prev) === 0) {
      const capital = v.cities.find((c) => c.owner === v.you && c.capital);
      out.push({ kick: 'A capital founded', title: capital?.name ?? 'Your capital', text: 'Here your civilization begins. Grow it, build in it, and found more cities.', picture: 'u_settler' });
    }
    play('found');
  }
  // Your empire's news.
  if (b.techs.length > a.techs.length) soon('tech');
  if (b.policies.length > a.policies.length) soon('policy');
  // (A building finished in a city that was yours already: a new city's palace, or a taken one's, isn't one.)
  const before = new Map(prev.cities.filter((c) => c.owner === prev.you).map((c) => [c.id, c.buildings?.length ?? 0]));
  if (v.cities.some((c) => c.owner === v.you && before.has(c.id) && (c.buildings?.length ?? 0) > before.get(c.id)!)) soon('built');
  const cityTiles = new Set(v.cities.filter((c) => c.owner === v.you).map((c) => c.tile));
  const had = new Set(prev.units.map((u) => u.id));
  if (v.units.some((u) => u.owner === v.you && !had.has(u.id) && cityTiles.has(u.tile) && !isGreatPerson(u.type))) soon('trained');
  // (Quick movement or combat off: every moment a light note, the camera left where it is.)
  if (!momentPace()) for (const s of out) Object.assign(s, { light: true, visit: undefined, back: undefined, at: undefined });
  // The game over: its victory's moment (a card only, with moments off), then for one who lost a sober card.
  if (v.over && !prev.over) {
    play(v.over.winner === v.you ? 'victory' : 'bad');
    out.push(...endingMoments(v, momentPace() > 0));
  }
  if (out.length) {
    store.splashes.push(...out);
    store.changed++;
  }
}
