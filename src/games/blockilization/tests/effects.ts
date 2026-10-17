import { CASES, Failure } from './cases';

/**
 * Runs the rules' behaviour tests (`cases.ts`) and says which fail. Bundle and run it with esbuild
 * and Node: `npx esbuild tests/effects.ts --bundle --platform=node --format=esm --outfile=/tmp/effects.mjs && node /tmp/effects.mjs`.
 */

let failed = 0;
for (const c of CASES) {
  try {
    c.run();
    console.log(`ok    ${c.name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${c.name}\n      ${e instanceof Failure ? e.message : e instanceof Error ? e.stack : String(e)}`);
  }
}
console.log(`\n${CASES.length - failed} of ${CASES.length} passed.`);
if (failed) process.exitCode = 1;
