// Keeps game vocabulary out of the engine's presentation core (docs/REDESIGN-CLIENT-SERVER.md,
// "Mechanisms in the engine, policy in the game"): the engine never decides how something looks
// by an item's kind or a hold style. That's for kits (src/platform/client-kits/) and games.
//
// Each file listed is read without its comments (docs may name what kits do with a primitive),
// and fails on:
// - an item kind or hold style as a string (`'gun'`, `'sword'`, ...);
// - a kind test (`kind ===`, `kind !==`);
// - a word of the kits' vocabulary in any name or string, camelCase and snake_case split
//   (`styleName`, `stance`, `ads`, `pump`, `bolt`, `lever`, `hammer`, `scope`: `adsBlend`,
//   `lever_time` and `'scope'` all fail).
//
// Run by `npm run check:boundaries` (and so `typecheck` and `build`). Each port adds its files in
// its own section, and any words of its own to WORDS.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectRoot } from './import-graph.mjs';

/** The presentation core's files (a file that's gone is skipped). */
const FILES = [
  // First person.
  'src/platform/render/viewmodel.ts',
  'src/platform/render/viewarms.ts',
  'src/platform/client/api/view.ts',
  // Figures.
  'src/platform/client/humanoid.ts',
  'src/platform/client/entities.ts',
  'src/platform/client/figures.ts',
  // HUD and effects.
];

/** Item kinds and hold styles, as strings. */
const LITERALS = ['gun', 'sword', 'bow', 'throw', 'axe', 'polearm', 'melee', 'throwable', 'rifle', 'pistol'];
/** Words of the kits' vocabulary, in names and strings. */
const WORDS = ['stylename', 'stance', 'ads', 'pump', 'bolt', 'lever', 'hammer', 'scope', 'rifle', 'pistol'];

/** The code without its comments (strings kept). */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** A name's words: `adsBlend` is `ads`, `blend`; `styleName` is also `stylename`. */
function words(name) {
  const parts = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s_$]+/)
    .filter(Boolean);
  return [...parts, name.toLowerCase().replace(/[_$]/g, '')];
}

const problems = [];
for (const file of FILES) {
  const path = join(projectRoot, file);
  if (!existsSync(path)) continue;
  const lines = code(readFileSync(path, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    const at = `${file}:${i + 1}`;
    for (const lit of LITERALS) if (new RegExp(`(['"\`])${lit}\\1`).test(line)) problems.push(`${at}: the item kind or hold style '${lit}'`);
    if (/\bkind\s*[!=]==?/.test(line) || /[!=]==?\s*[\w.?]*\bkind\b/.test(line)) problems.push(`${at}: a test of an item's kind`);
    for (const name of line.match(/[A-Za-z_$][\w$]*/g) ?? []) {
      const hit = words(name).find((w) => WORDS.includes(w));
      if (hit) problems.push(`${at}: '${name}' (a kit's word: ${hit})`);
    }
  });
}

if (problems.length) {
  console.error(`Presentation check failed: the engine decides how things look by game vocabulary (that's a kit's to decide; see docs/REDESIGN-CLIENT-SERVER.md):\n  ${[...new Set(problems)].join('\n  ')}`);
  process.exit(1);
}
console.log('Presentation OK: the engine names no item kinds or hold styles.');
