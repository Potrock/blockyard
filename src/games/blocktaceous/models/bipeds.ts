/**
 * The two-legged animals' models as `tools/bipeds/build.mjs` last wrote them (it writes this file too).
 * - `scale`: what to give `Models.gltf(url, { scale })` (or a prop) to show the file life-size: 1,
 *   unless the files were built with `--stride-scale` (see the build script), which makes the
 *   engine play the walk and the run in step with the ground.
 * - `stride`: the blocks a loop of the walk or the run covers with its feet not sliding.
 * - `steps`: the footfalls in a loop of each.
 */
export const BIPED_MODELS = {
  tyrannosaurus: { scale: 1, stride: 8.55, steps: { walk: 4, run: 2 } },
  utahraptor: { scale: 1, stride: 3.78, steps: { walk: 4, run: 2 } },
  carnotaurus: { scale: 1, stride: 6.66, steps: { walk: 4, run: 2 } },
  dilophosaurus: { scale: 1, stride: 4.08, steps: { walk: 4, run: 2 } },
  spinosaurus: { scale: 1, stride: 6.9, steps: { walk: 4, run: 2 } },
  parasaurolophus: { scale: 1, stride: 7.35, steps: { walk: 4, run: 2 } },
  compsognathus: { scale: 1, stride: 1.5, steps: { walk: 8, run: 4 } },
  dodo: { scale: 1, stride: 1.5, steps: { walk: 8, run: 6 } },
} as const;
