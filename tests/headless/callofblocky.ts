import { check, launch } from './_harness';

/**
 * Call of Blocky with the local player standing idle: the bots fill the street, find each other
 * along the walking grid, and shoot it out with the platform's guns (bots fire from the trigger,
 * the host casts every bullet).
 */
export default function callofblocky() {
  const t0 = performance.now();
  const h = launch('callofblocky', { seed: 3, radius: 5 });
  const g = h.ctx;
  check(g.players.length === 6, `expected 6 fighters (1 person + 5 bots), got ${g.players.length}`);
  let shots = 0;
  let deaths = 0;
  let heads = 0;
  let mine = 0;
  const byWeapon = new Map<string, number>();
  g.events.on('shot', () => shots++);
  g.events.on('playerDeath', (e) => {
    deaths++;
    if (!e.player.bot) mine++;
    if (e.headshot) heads++;
    if (e.weapon) byWeapon.set(e.weapon, (byWeapon.get(e.weapon) ?? 0) + 1);
  });
  // Where the bots go: they should cover the map, not stand at their spawns.
  const visited = new Set<string>();
  const simulated = h.run(90, {
    pilot: () => null,
    until: (hh) => {
      for (const p of hh.ctx.players) if (p.bot) visited.add(`${Math.floor(p.position.x / 4)},${Math.floor(p.position.z / 4)}`);
      return false;
    },
  });
  const wall = (performance.now() - t0) / 1000;
  const cases = h.find('hud', 'feed').filter((c) => JSON.stringify(c.args[0]).includes('has the briefcase')).length;
  const weapons = [...byWeapon].map(([w, n]) => `${w} ${n}`).join(', ');
  console.log(`  ${simulated.toFixed(0)} s in ${wall.toFixed(1)} s: ${shots} shots, ${deaths} deaths (${mine} of them the idle player; ${heads} headshots; ${weapons}), bots visited ${visited.size} 4x4 cells, the briefcase taken ${cases}×`);
  check(shots > 40, `bots hardly fired (${shots} shots)`);
  check(deaths >= 3, `bots should kill each other (${deaths} deaths)`);
  check(visited.size > 25, `bots should roam the map (${visited.size} cells)`);
}
