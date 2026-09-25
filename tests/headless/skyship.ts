import { check, launch, lastScreen } from './_harness';

/**
 * Skyship: walk up the pier and aboard, climb to the roof and take the helm, sail out and turn
 * (the helmsman stays at the wheel, a walker stays on deck), fall overboard and get hauled back,
 * go ashore at an island and light its beacon, light the rest and finish the voyage.
 */
export default function skyship() {
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

  // Let go of the helm and step off the side: hauled back aboard.
  h.step(1 / 60, { pressed: ['KeyE'], down: ['KeyE'] });
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
