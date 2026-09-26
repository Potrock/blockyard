import { matchState } from '../../src/games/highnoon/server';
import { check, launch } from './_harness';

/**
 * High Noon (a dev game: `launch` finds those too) with the local player standing idle at their
 * mark: five bots fill Dry Gulch, wait out the standoff, draw, and shoot it out round after round
 * with the Peacemaker and the Yellowboy until one of them takes three rounds and the town. Nothing
 * may land during a standoff (the game's `damage` listener cancels it), the round and match
 * structure has to run, and the widgets have to go up.
 */
export default function highNoon() {
  const t0 = performance.now();
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => (warnings.push(a.join(' ')), warn(...a));
  const h = launch('highnoon', { seed: 5, radius: 5 });
  const g = h.ctx;
  check(g.players.length === 6, `expected 6 gunslingers (1 person + 5 bots), got ${g.players.length}`);
  let shots = 0;
  let deaths = 0;
  let heads = 0;
  let early = 0;
  let rolls = 0;
  const byWeapon = new Map<string, number>();
  g.events.on('shot', () => shots++);
  g.events.on('ability', ({ name }) => name === 'roll' && rolls++);
  g.events.on('playerDeath', (e) => {
    deaths++;
    if (e.headshot) heads++;
    if (e.weapon) byWeapon.set(e.weapon, (byWeapon.get(e.weapon) ?? 0) + 1);
  });
  let deadEyes = 0;
  // Added after the game's own listener: it sees what's left of each hit (a cancelled one never reaches it).
  g.events.on('damage', (hit) => {
    if (hit.amount >= 500) deadEyes++;
  });
  // The standoff: a shot now doesn't land (the house rules cancel it).
  check(matchState().phase === 'standoff', `a round should open with a standoff, not ${matchState().phase}`);
  // Rooted to the mark, hands off the guns (a weapons-locked freeze): 1 doesn't draw the Peacemaker.
  const me = g.player;
  h.step(1 / 60, { down: ['Digit1'], pressed: ['Digit1'] });
  check(me.frozen && me.inventory.selected === 2 && me.inventory.ammo('revolver')?.magazine === 6, `no drawing in the standoff: frozen ${me.frozen}, slot ${me.inventory.selected}`);
  // Their outfit picker went up as they came into play (`playerReady`).
  check(h.find('hud', 'widget').some((c) => c.args[0] === 'outfits' && c.to === me.id), 'the outfit picker should be up on their screen');
  const [, a, b] = g.players;
  check(!a.damage(30, { source: b, cause: 'gun', part: 'body', weapon: 'revolver' }), 'a hit landed in the standoff');
  check(a.health === a.maxHealth, 'the standoff hit hurt');
  // A hit that lands outside a fight (the standoff, between rounds) would be a bug in the house rules.
  g.events.on('playerDamage', () => {
    if (matchState().phase !== 'fight') early++;
  });
  const simulated = h.run(600, {
    pilot: () => null,
    until: (hh) => hh.find('hud', 'banner').some((c) => c.args[0] === 'THE TOWN IS YOURS' || c.args[0] === 'RIDE ON, STRANGER'),
  });
  console.warn = warn;
  const wall = (performance.now() - t0) / 1000;
  const rounds = h.find('hud', 'feed').filter((c) => /takes round|Nobody walks away/.test(JSON.stringify(c.args[0]))).length;
  const won = h.find('hud', 'banner').some((c) => c.args[0] === 'RIDE ON, STRANGER' || c.args[0] === 'THE TOWN IS YOURS');
  const widgets = new Set(h.find('hud', 'widget').map((c) => String(c.args[0])));
  const weapons = [...byWeapon].map(([w, n]) => `${w} ${n}`).join(', ');
  console.log(
    `  ${simulated.toFixed(0)} s in ${wall.toFixed(1)} s: ${rounds} rounds, ${shots} shots, ${deaths} deaths (${heads} headshots; ${weapons}), ${rolls} rolls, ${deadEyes} dead-eyes; widgets ${[...widgets].join(', ')}`,
  );
  check(
    warnings.every((w) => !w.includes('hud.define')),
    `a widget lost markup or styles: ${warnings.join(' | ')}`,
  );
  check(shots > 30, `bots hardly fired (${shots} shots)`);
  check(deaths >= 5, `bots should kill each other (${deaths} deaths)`);
  check(rounds >= 3, `rounds should end (${rounds})`);
  check(won, 'the match should end with someone taking the town');
  check(early === 0, `${early} hits landed during a standoff`);
  for (const w of ['cylinder', 'wanted', 'duel', 'roundbar', 'outfits']) check(widgets.has(w), `the ${w} widget never went up`);
}
