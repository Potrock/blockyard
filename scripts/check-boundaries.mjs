// Keeps games and kits on the public API.
//
// - Games (src/games/<name>/) may import only '@platform', '@platform/art', '@platform/kits' and
//   files inside their own folder. Their build tools (`tools/`, Node scripts that write the game's
//   models and art, never part of the game itself) may also use Node's built-ins (`node:*`).
// - Kits and the art toolkit (src/platform/kits/, src/platform/art/) may import only
//   '@platform' (and '@platform/art') and files inside their own folder: they get no access a
//   game doesn't have, so any kit could be copied into a game unchanged.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|js|mjs)$/.test(f) ? [p] : [];
  });
const code = (file) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const imports = (file) =>
  [...code(file).matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
const inside = (file, spec, folder) => spec.startsWith('.') && (resolve(dirname(file), spec) + sep).startsWith(folder + sep);

const problems = [];
/** A game's own build tools (`src/games/<name>/tools/`: Node scripts that write its models and art) may use Node's built-ins; they never run in the game. */
const tool = (file, folder, spec) => spec.startsWith('node:') && (file + sep).startsWith(join(folder, 'tools') + sep);

function check(folder, allowed, what) {
  for (const file of files(folder)) {
    for (const spec of imports(file)) {
      if (allowed.includes(spec) || inside(file, spec, folder) || tool(file, folder, spec)) continue;
      problems.push(`${relative(root, file)}: ${what} may not import '${spec}'`);
    }
  }
}

const games = join(root, 'src/games');
for (const name of readdirSync(games)) {
  const dir = join(games, name);
  if (statSync(dir).isDirectory()) check(dir, ['@platform', '@platform/art', '@platform/kits'], `game '${name}'`);
}
check(join(root, 'src/platform/kits'), ['@platform', '@platform/art'], 'a kit');
check(join(root, 'src/platform/art'), ['@platform'], 'the art toolkit');

if (problems.length) {
  console.error(`Boundary check failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('Boundaries OK: games and kits use only the public API.');
