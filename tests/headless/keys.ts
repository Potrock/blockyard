import { rebind, relabel, sanitize, translation, type KeyBindings } from '../../src/platform/player/keys';
import { check, launch } from './_harness';

/**
 * Rebindable controls: binding a key another action has swaps the two, both Shifts (or Ctrls)
 * count as one key, a default key whose action moved reads as nothing, and saved bindings are
 * cleaned up. Then the translation drives a real player: with Sprint on Shift and Sneak on Ctrl,
 * holding Shift sprints and holding Ctrl sneaks.
 */
export default function keys() {
  // Sprint to Shift: Sneak takes Ctrl.
  const swapped = rebind({}, 'sprint', 'ShiftRight');
  check(swapped.sprint === 'ShiftLeft' && swapped.sneak === 'ControlLeft', `swap: ${JSON.stringify(swapped)}`);
  const t = translation(swapped);
  check(t.get('ShiftLeft') === 'ControlLeft' && t.get('ShiftRight') === 'ControlLeft', 'either Shift reads as sprint');
  check(t.get('ControlLeft') === 'ShiftLeft' && t.get('ControlRight') === 'ShiftLeft', 'either Ctrl reads as sneak');
  check(!t.has('KeyW') && !t.has('Space'), 'keys nobody moved read as themselves');

  // Back to the default key: no override left.
  check(Object.keys(rebind(swapped, 'sprint', 'ControlLeft')).length === 0, 'swapping back clears the bindings');

  // Forward to E: E reads as W, and W reads as nothing.
  const esdf = rebind({}, 'forward', 'KeyE');
  const te = translation(esdf);
  check(te.get('KeyE') === 'KeyW' && te.get('KeyW') === null, 'a moved action leaves its old key idle');

  // Games' control hints follow the bindings, word by word.
  check(relabel(swapped, 'Ctrl') === 'Shift' && relabel(swapped, 'Space / Shift') === 'Space / Ctrl', 'hints name the bound keys');
  check(relabel(esdf, 'W / S') === 'E / S' && relabel(esdf, 'Wheel') === 'Wheel' && relabel(esdf, 'LMB') === 'LMB', 'other words in hints stay');

  // Saved bindings: unknown actions, reserved keys and junk dropped, clashes settled.
  const clean = sanitize({ sprint: 'ShiftLeft', sneak: 'ShiftLeft', jump: 'Escape', fly: 'KeyF', back: 7 });
  check(clean.sprint !== clean.sneak, `no two actions share a key after loading (${JSON.stringify(clean)})`);
  check(clean.jump === undefined && !('fly' in clean) && clean.back === undefined, 'reserved keys and junk are dropped');
  check(Object.keys(sanitize('nonsense')).length === 0 && Object.keys(sanitize(null)).length === 0, 'junk loads as no bindings');

  // What the player's own keys do, through the translation, on a real walking player.
  const speed = (b: KeyBindings, physical: string[]) => {
    const h = launch('heart-hunt', { seed: 2 });
    const me = h.ctx.player;
    h.run(1); // settle on the ground
    const map = translation(b);
    const down = physical.map((k) => (map.has(k) ? map.get(k) : k)).filter((k): k is string => !!k);
    const a = { ...me.position };
    // Away from the pedestal at the spawn, across the flattened ground.
    h.run(1.5, { pilot: () => ({ down, yaw: Math.PI, pitch: 0 }) });
    return Math.hypot(me.position.x - a.x, me.position.z - a.z) / 1.5;
  };
  const walk = speed({}, ['KeyW']);
  const sprintOnShift = speed(swapped, ['KeyW', 'ShiftLeft']);
  const sneakOnCtrl = speed(swapped, ['KeyW', 'ControlLeft']);
  const defaultShift = speed({}, ['KeyW', 'ShiftLeft']);
  check(sprintOnShift > walk * 1.2, `Shift should sprint once it's bound to sprint (${sprintOnShift.toFixed(2)} vs walking ${walk.toFixed(2)} m/s)`);
  check(sneakOnCtrl < walk * 0.6, `Ctrl should sneak once it's bound to sneak (${sneakOnCtrl.toFixed(2)} m/s)`);
  check(defaultShift < walk * 0.6, `by default Shift still sneaks (${defaultShift.toFixed(2)} m/s)`);
  console.log(`  walk ${walk.toFixed(2)} · Shift→sprint ${sprintOnShift.toFixed(2)} · Ctrl→sneak ${sneakOnCtrl.toFixed(2)} m/s`);
}
