import type { CityInfo, CityWire, PlayerSummary } from '../protocol';
import { CIVS } from '../rules/civs';
import { neighbours } from '../rules/hex';
import { isGreatPerson, isMilitary, UNITS } from '../rules/units';
import { store, teammate } from './store';

/**
 * The military advisor's warning, Civ V's: a city of yours with no soldier in it or beside it, while a
 * civilization you know is at war with you, hostile or guarded toward you, or has an army far
 * greater than yours (as the demographics measure it). Once for each city in twenty turns (and never
 * in a duel's first thirty), it stays among the decisions until the city's defended or you look;
 * looking opens the city with a defender advised. Only what you can see goes into it.
 */

/** Turns before a city is warned of again, and the turns a duel is left alone at its start. */
const AGAIN = 20;
const DUEL_GRACE = 30;
/** An army this many times yours is a danger, whatever its leader thinks of you. */
const MUCH_STRONGER = 2;

/** Each city's last warning: the turn it began, and whether you've looked. */
const warned = new Map<number, { turn: number; seen: boolean }>();

/** A civ that could take an undefended city: who, how things stand, and its army against yours. */
interface Threat {
  p: PlayerSummary;
  mood: 'war' | 'hostile' | 'guarded' | null;
  times: number;
}

/** The known civs that are a danger to an undefended city now, the worst first. */
function threats(): Threat[] {
  const v = store.view!;
  const mine = v.players[v.you]?.army ?? 0;
  const out: Threat[] = [];
  for (const p of v.players) {
    if (p.index === v.you || !p.alive || !p.met || p.cityState || p.civ === 'barbarian' || teammate(p.index)) continue;
    const stance = p.relation?.opinion?.stance;
    const mood = p.war ? 'war' : stance === 'hostile' || stance === 'guarded' ? stance : null;
    // (No army at all of yours: any army of theirs is far greater.)
    const times = mine > 0 ? (p.army ?? 0) / mine : (p.army ?? 0) > 0 ? Infinity : 0;
    if (mood || times >= MUCH_STRONGER) out.push({ p, mood, times });
  }
  const rank = (t: Threat) => (t.mood === 'war' ? 3 : t.mood === 'hostile' ? 2 : t.mood === 'guarded' ? 1 : 0);
  return out.sort((a, b) => rank(b) - rank(a) || b.times - a.times);
}

/** Whether a city has a soldier of yours in it or beside it (an aircraft or a great person doesn't count). */
function defended(c: CityWire): boolean {
  const v = store.view!;
  const near = new Set([c.tile, ...neighbours(store.grid!, c.tile)]);
  return v.units.some((u) => u.owner === v.you && near.has(u.tile) && !!UNITS[u.type] && isMilitary(UNITS[u.type]) && !isGreatPerson(u.type) && UNITS[u.type].domain !== 'air');
}

/** An army against yours, in words ('three times yours'). */
function timesWords(x: number): string {
  const n = Math.round(x);
  return `${['', '', 'twice', 'three times', 'four times', 'five times'][n] ?? `${n} times`} yours`;
}

/** The warning, in words: the city, who, and why ('Seoul has no defenders, and Germany's army is three times yours'). */
function warning(c: CityWire, t: Threat): string {
  const name = CIVS[t.p.civ]?.name ?? t.p.name;
  const mood = t.mood === 'war' ? 'at war with you' : t.mood ? `${t.mood} toward you` : '';
  if (t.times === Infinity) return `${c.name} has no defenders, and ${name}${mood ? `, ${mood},` : ''} has an army while you have none`;
  if (t.times >= MUCH_STRONGER) return `${c.name} has no defenders, and ${name}${mood ? `, ${mood},` : ''} has an army ${timesWords(t.times)}`;
  return `${c.name} has no defenders, and ${name} is ${mood}`;
}

/** The cities to warn of now, each with its words (`decisions` shows them; `look` is what its button does). */
export function defenceWarnings(): { city: CityWire; text: string }[] {
  const v = store.view;
  if (!v || v.spectator || v.over || !store.grid) return [];
  if (store.lobby?.settings.size === 'duel' && v.turn < DUEL_GRACE) return [];
  const mine = v.cities.filter((c) => c.owner === v.you && !defended(c));
  if (!mine.length) return [];
  const worst = threats()[0];
  if (!worst) return [];
  const out: { city: CityWire; text: string }[] = [];
  for (const c of mine) {
    let w = warned.get(c.id);
    if (!w || v.turn - w.turn >= AGAIN) warned.set(c.id, (w = { turn: v.turn, seen: false }));
    if (!w.seen) out.push({ city: c, text: warning(c, worst) });
  }
  return out;
}

/** The city warned of is looked at: its warning goes (for twenty turns), and its build list advises a defender this turn. */
export function lookAtDefence(city: number) {
  const w = warned.get(city);
  if (w) w.seen = true;
  store.defend = { city, turn: store.view!.turn };
}

/**
 * A defender for a city warned of: the strongest soldier for the land it can train now (a ranged one
 * if it's stronger), as the city's advice while its screen is open from the warning.
 */
export function defenceAdvice(city: CityWire, info: CityInfo | null): CityInfo['advice'] {
  if (store.defend?.city !== city.id || store.defend.turn !== store.view?.turn || !info) return null;
  const soldiers = info.options.filter((o) => o.kind === 'unit' && UNITS[o.id] && isMilitary(UNITS[o.id]) && !isGreatPerson(o.id) && UNITS[o.id].domain === 'land');
  const best = soldiers.sort((a, b) => Math.max(UNITS[b.id].strength, UNITS[b.id].ranged ?? 0) - Math.max(UNITS[a.id].strength, UNITS[a.id].ranged ?? 0))[0];
  return best ? { kind: 'unit', id: best.id, why: `${city.name} has no defenders: buy one now if you can (gold), or build one first` } : null;
}
