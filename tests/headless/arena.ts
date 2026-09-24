import type { Pilot } from '../../src/platform/host/headless';
import { check, launch, lastScreen } from './_harness';

/**
 * A bot plays the Arena from the first wave to the Warden: it walks at the nearest monster (or
 * reward), attacks, hops over obstacles and holds its best weapon. It gets extra health, and
 * monsters hanging back take chip damage so the run doesn't depend on chasing archers.
 */
export default function arena() {
  const t0 = performance.now();
  const h = launch('arena', { seed: 1337 });
  const game = h.ctx;
  const me = game.player;
  me.maxHealth = 800;
  me.health = 800;
  game.clock.every(0.7, () => {
    for (const e of game.entities.all()) if (e.type !== 'warden' && e.distanceTo(me) > 4) e.damage(4, { source: me, knockback: 0 });
  });

  let hop = 0;
  let think = 0;
  let last: ReturnType<Pilot> = {};
  const pilot: Pilot = () => {
    // Decide every 80 ms, like a person's reactions; hold the controls in between.
    if ((think += 1 / 60) < 0.08) return { ...last, clicked: 0, pressed: [] };
    think = 0;
    const eye = me.eye;
    let target: { x: number; y: number; z: number } | null = null;
    let best = Infinity;
    let height = 1.3;
    for (const e of game.entities.all()) {
      const d = Math.hypot(e.position.x - eye.x, e.position.z - eye.z);
      if (d < best) {
        best = d;
        target = e.position;
        height = e.type === 'spider' ? 0.5 : e.type === 'warden' ? 2.6 : e.type === 'brute' ? 1.6 : 1.3;
      }
    }
    const fighting = !!target;
    if (!target) {
      for (const p of h.sim.items.frame()) {
        const d = Math.hypot(p.x - eye.x, p.z - eye.z);
        if (d < best) {
          best = d;
          target = { x: p.x, y: p.y - 1.3, z: p.z };
          height = 0.5;
        }
      }
    }
    if (!target) return (last = {});
    const dx = target.x - eye.x;
    const dy = target.y + height - eye.y;
    const dz = target.z - eye.z;
    const down = best > 2.4 ? ['KeyW'] : [];
    if (down.length && Math.hypot(me.velocity.x, me.velocity.z) < 0.5) hop = 2;
    if (hop > 0 && hop--) down.push('Space');
    // Hold the best melee weapon.
    const inv = me.inventory;
    let slot = inv.selected;
    let rank = -1;
    inv.slots.forEach((s, i) => {
      const d = s && game.items.get(s.item);
      if (d && d.kind === 'melee' && (d.rank ?? 0) > rank) {
        rank = d.rank ?? 0;
        slot = i;
      }
    });
    if (slot !== inv.selected) inv.select(slot);
    last = { down, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
    return { ...last, clicked: fighting ? 1 : 0 };
  };

  const simulated = h.run(900, { pilot, until: () => lastScreen(h) !== undefined });
  const result = lastScreen(h);
  const wall = (performance.now() - t0) / 1000;
  console.log(`  ${result ?? 'no result'} after ${simulated.toFixed(0)} s of game time, ${wall.toFixed(1)} s wall clock (${(simulated / wall).toFixed(0)}× real time)`);
  check(result === 'Victory!', `expected Victory!, got ${result ?? 'nothing'} (objective calls: ${h.find('hud', 'objective').length})`);
}
