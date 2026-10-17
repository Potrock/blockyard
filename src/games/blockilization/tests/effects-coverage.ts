import { BUILDING_LIST, FAITH_BUILDINGS } from '../rules/buildings';
import { CIV_LIST } from '../rules/civs';
import type { Effects } from '../rules/effects';
import { ALL_POLICIES, IDEOLOGIES } from '../rules/policies';
import { PROMOTION_LIST, PROMOTIONS } from '../rules/promotions';
import { BELIEF_LIST } from '../rules/religion';
import { UNIT_LIST } from '../rules/units';
import { CASES } from './cases';
import { sweep } from './sweep';

/**
 * Nothing in the data may silently do nothing: every effect of every building, wonder, policy,
 * tenet, belief and civ, every promotion's numbers and every unit ability must be read by the
 * rules. This watches every read of the data (each effects object is wrapped in a recording proxy,
 * down to each special asked for by name) while the behaviour tests (`cases.ts`) and a sweep of
 * every rule over a world that has everything (`sweep.ts`) run, then lists what nothing read, by
 * where it's defined. Run it like the tests: bundle with esbuild, run with Node.
 *
 * A read is a read from the very object it's defined on: a building's `combat` read only through
 * the empire's effects (not the building's) doesn't count, so effects can't be in the data and out
 * of the rules' reach.
 */

/** Things read: by owner ("building:walls"), each path ("yields.culture", "special:double_xp", "cities.effects.special:x"). */
const reads = new Map<string, Set<string>>();
const record = (owner: string, path: string) => (reads.get(owner) ?? reads.set(owner, new Set()).get(owner)!).add(path);

/** Fields that are only words for people (read by the screens, not the rules). */
const WORDS = new Set(['id', 'name', 'text']);

/** The recording views made so far (one for each piece of data, so each keeps one identity). */
const views = new WeakMap<object, object>();

/** A recording view of a piece of data: reading through it notes the path read. */
function watch<T extends object>(value: T, owner: string, path: string): T {
  const made = views.get(value);
  if (made) return made as T;
  const view = new Proxy(value, {
    get(target, key, receiver) {
      const v = Reflect.get(target, key, receiver);
      if (typeof key === 'symbol') return v;
      if (Array.isArray(target)) {
        const named = path.endsWith('special') || path === 'abilities';
        if (key === 'includes' && named) return (x: unknown) => (record(owner, `${path}:${String(x)}`), (target as unknown[]).includes(x));
        if (!/^\d+$/.test(key)) return v;
        if (named) record(owner, `${path}:${String(v)}`);
        return v && typeof v === 'object' ? watch(v, owner, path) : v;
      }
      const at = path ? `${path}.${key}` : key;
      record(owner, at);
      return v && typeof v === 'object' ? watch(v, owner, at) : v;
    },
  });
  views.set(value, view);
  return view;
}

/** Every path a piece of data defines (a list of specials: each one by name). */
function defined(value: object, path: string, out: Set<string>) {
  for (const [k, v] of Object.entries(value)) {
    if (WORDS.has(k) && !path) continue;
    const at = path ? `${path}.${k}` : k;
    if (Array.isArray(v)) {
      if (k === 'special') for (const id of v) out.add(`${at}:${id}`);
      else if (v.length && typeof v[0] === 'object') for (const x of v) defined(x, at, out);
      else out.add(at);
    } else if (v && typeof v === 'object') defined(v, at, out);
    else out.add(at);
  }
  return out;
}

// Watch everything that does something.
const watched: { owner: string; data: object }[] = [];
const effects = (owner: string, e: Effects) => {
  watched.push({ owner, data: e });
  return watch(e, owner, '');
};
for (const b of [...BUILDING_LIST, ...FAITH_BUILDINGS]) b.effects = effects(`building:${b.id}`, b.effects);
for (const c of CIV_LIST) c.ability.effects = effects(`civ:${c.id}`, c.ability.effects);
for (const b of BELIEF_LIST) b.effects = effects(`belief:${b.id}`, b.effects);
for (const p of Object.values(ALL_POLICIES)) p.effects = effects(`policy:${p.id}`, p.effects);
for (const ideology of IDEOLOGIES) for (const level of ideology.tenets) for (const t of level) t.effects = ALL_POLICIES[t.id].effects;
PROMOTION_LIST.forEach((p, i) => {
  watched.push({ owner: `promotion:${p.id}`, data: p });
  PROMOTION_LIST[i] = PROMOTIONS[p.id] = watch(p, `promotion:${p.id}`, '');
});
const abilities = new Set<string>();
for (const u of UNIT_LIST) {
  for (const a of u.abilities ?? []) abilities.add(a);
  if (u.abilities) u.abilities = watch(u.abilities, 'units', 'abilities');
}

// Run everything.
let broken = 0;
for (const c of CASES) {
  try {
    c.run();
  } catch (e) {
    broken++;
    console.log(`(a test fails: ${c.name}: ${e instanceof Error ? e.message : String(e)})`);
  }
}
sweep();

// What nothing read.
const unread: string[] = [];
for (const { owner, data } of watched) {
  const seen = reads.get(owner) ?? new Set();
  for (const path of defined(data, '', new Set())) if (!seen.has(path)) unread.push(`${owner}  ${path}`);
}
const seenAbilities = reads.get('units') ?? new Set();
for (const a of abilities) if (!seenAbilities.has(`abilities:${a}`)) unread.push(`ability  ${a}`);

for (const line of unread) console.log(`unread  ${line}`);
console.log(`\n${watched.length} things watched, ${abilities.size} abilities; ${unread.length} effects never read${broken ? `; ${broken} tests failed` : ''}.`);
if (unread.length || broken) process.exitCode = 1;
