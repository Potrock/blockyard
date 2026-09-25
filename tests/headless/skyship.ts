import { check, launch, lastScreen } from './_harness';

/**
 * Skyship: walk up the pier and aboard, climb to the roof and take the helm, sail out and turn
 * (the helmsman stays at the wheel, a walker stays on deck), fall overboard and get hauled back,
 * go ashore at an island and light its beacon, light the rest and finish the voyage.
 */
export default function skyship() {
  voyage();
  aground();
}

function voyage() {
  const h = launch('skyship', { seed: 3 });
  const g = h.ctx;
  const me = g.player;
  const ship = () => g.players[0].riding;
  h.run(1);

  // Up the pier (east) and over the gangway onto the deck.
  h.run(5, { pilot: () => ({ down: ['KeyW'], yaw: -Math.PI / 2 }), until: () => ship() !== null });
  check(ship() !== null, `walked aboard: ${JSON.stringify(me.position)}`);
  const deck = ship()!;

  // Stand by the wheel on the roof deck and take the helm.
  const wheel = deck.position.clone().add({ x: 0.5, y: 4, z: 10.2 } as never);
  me.teleport({ x: wheel.x, y: wheel.y, z: wheel.z });
  h.run(0.5);
  h.step(1 / 60, { pressed: ['KeyE'], down: ['KeyE'] });
  h.run(0.5);
  check(h.find('hud', 'toast').some((c) => String(c.args[0]).startsWith('At the helm')), 'took the helm');
  const orbit = h.step(1 / 60).frame!.players[0].orbit;
  check(orbit?.prop === (deck as unknown as { id: number }).id && orbit.max > 20, `the helm's camera can zoom out round the ship: ${JSON.stringify(orbit)}`);
  // Where the helmsman is on the ship (its own space).
  const helmLocal = () => deck.position.clone().set(me.position.x, me.position.y, me.position.z).sub(deck.position).applyQuaternion(deck.quaternion.clone().invert());
  const start = deck.position.clone();

  // Full ahead for 10 s, turning to port for the last 5.
  h.run(5, { pilot: () => ({ down: ['KeyW'] }) });
  h.run(5, { pilot: () => ({ down: ['KeyW', 'KeyA'] }) });
  const sailed = deck.position.distanceTo(start);
  const at = helmLocal();
  check(sailed > 45, `sailed ${sailed.toFixed(1)} blocks`);
  check(Math.abs(at.x - 0.5) < 0.1 && Math.abs(at.y - 4) < 0.1 && Math.abs(at.z - 12.5) < 0.1, `the helmsman stayed at the wheel: ${JSON.stringify(at)}`);
  check(me.riding === deck, 'still riding at the helm');

  // Let go of the helm (first person again) and step off the side: hauled back aboard.
  h.step(1 / 60, { pressed: ['KeyE'], down: ['KeyE'] });
  check(h.step(1 / 60).frame!.players[0].orbit === null, 'first person again off the helm');
  me.teleport({ x: deck.position.x + 30, y: deck.position.y, z: deck.position.z });
  h.run(4);
  check(me.riding === deck, `back aboard after falling: ${JSON.stringify(me.position)}`);

  // Warp alongside Lantern Rock, go ashore and stand on its beacon.
  g.commands.run('warp 1');
  h.run(1);
  me.teleport({ x: 10.5, y: 95, z: -149.5 });
  h.run(2);
  check(h.calls.some((c) => c.method === 'banner' && String(c.args[0]) === 'Lantern Rock is lit'), 'lit the beacon on Lantern Rock');
  check(g.world.blockName(g.world.getBlock(10, 97, -150)) === 'sea_lantern', 'its lamp burns');

  // The rest, and the voyage is over.
  for (const [x, y, z] of [
    [150.5, 111, -214.5],
    [235.5, 87, -54.5],
    [165.5, 127, 115.5],
    [-44.5, 101, 165.5],
  ]) {
    me.teleport({ x, y, z });
    h.run(2);
  }
  h.run(3);
  check(lastScreen(h) === 'Voyage complete', `voyage complete: ${lastScreen(h)}`);
  console.log(`  boarded, took the helm, sailed ${sailed.toFixed(0)} blocks with the helmsman at the wheel, fell overboard and got hauled back, lit five beacons`);
}

/**
 * Run aground and get off again: turn in place until the bow swings into an island, keep driving
 * into it turning, then back off. The ship never jumps (its bank and pitch ease; a move into rock
 * changes nothing about it) and always gets clear: backing off, it scrapes along the rock.
 */
function aground() {
  const h = launch('skyship', { seed: 3 });
  const g = h.ctx;
  const me = g.player;
  h.run(1);
  h.run(5, { pilot: () => ({ down: ['KeyW'], yaw: -Math.PI / 2 }), until: () => me.riding !== null });
  const ship = me.riding!;
  g.commands.run('warp 1');
  h.run(0.5);
  const w = ship.position.clone().add({ x: 0.5, y: 4.2, z: 10.2 } as never);
  me.teleport({ x: w.x, y: w.y, z: w.z });
  h.run(0.5);
  h.step(1 / 60, { pressed: ['KeyE'], down: ['KeyE'] });
  let worst = 0;
  const q = ship.quaternion.clone();
  const pilot = (keys: string[]) => () => {
    worst = Math.max(worst, ship.quaternion.angleTo(q));
    q.copy(ship.quaternion);
    return { down: keys };
  };
  h.run(14, { pilot: pilot(['KeyA']) });
  h.run(10, { pilot: pilot(['KeyW', 'KeyA']) });
  const at = ship.position.clone();
  // Full astern: time to stop if it's still going ahead (it may have scraped along clear), then back off.
  h.run(12, { pilot: pilot(['KeyS']) });
  const backed = ship.position.distanceTo(at);
  check(backed > 5, `backed off the island: ${backed.toFixed(2)} blocks`);
  check(worst < 0.01, `the ship never jerked round: worst turn in a tick ${worst.toFixed(4)} rad`);
  check(me.riding === ship, 'the helmsman is still aboard');
  console.log(`  ran aground turning into an island, backed off ${backed.toFixed(0)} blocks; worst turn in a tick ${worst.toFixed(4)} rad`);
}
