import { defineServer, type GameContext, type Player } from '@platform';
import { bows, consumables, melee } from '@platform/kits';
import { FLOOR, GATES, GATE_SPAWN_RADIUS } from './structure';
import { defineArt, defineItems, defineMonsters } from './content';
import { Sprite } from './art';
import { CENTER, shared } from './shared';

interface Wave {
  name: string;
  spawns: Record<string, number>;
  /** Reward dropped on the dais once the wave is cleared. */
  reward?: { item: string; count?: number }[];
}

const WAVES: Wave[] = [
  { name: 'The Dead Rise', spawns: { zombie: 5 }, reward: [{ item: 'bow' }, { item: 'arrow_bundle', count: 3 }] },
  { name: 'Bone Archers', spawns: { zombie: 4, skeleton: 3 }, reward: [{ item: 'stone_sword' }, { item: 'health_potion' }] },
  { name: 'Crawlers', spawns: { spider: 6, zombie: 3 }, reward: [{ item: 'iron_sword' }, { item: 'pike' }, { item: 'arrow_bundle', count: 2 }] },
  { name: 'The Brute', spawns: { brute: 1, skeleton: 4, zombie: 3 }, reward: [{ item: 'battle_axe' }, { item: 'health_potion' }] },
  { name: 'The Horde', spawns: { zombie: 6, spider: 4, skeleton: 4, brute: 1 }, reward: [{ item: 'diamond_sword' }, { item: 'health_potion', count: 2 }, { item: 'arrow_bundle', count: 2 }] },
  { name: 'The Warden', spawns: { warden: 1, zombie: 2 } },
];

const MAX_ALIVE = 12;
const INTERMISSION = 12;
/** Where someone who's fallen watches from until the wave is over: high over the south stands. */
const LOOKOUT = { x: 0.5, y: FLOOR + 20, z: 31 };

/** `intro`: not begun. `waiting`: everyone left, and the next to arrive begins it afresh. */
type Phase = 'intro' | 'waiting' | 'countdown' | 'fighting' | 'intermission' | 'victory' | 'defeat';

const fresh = () => ({
  phase: 'intro' as Phase,
  wave: 0,
  queue: [] as string[],
  spawnTimer: 0,
  nextWaveAt: 0,
  kills: 0,
  damageDealt: 0,
  damageTaken: 0,
  startedAt: 0,
  lastBeep: 0,
});
const state = fresh();

/** Monsters per wave grow with the party: half as many again for each extra fighter. */
const crowd = (game: GameContext) => 1 + 0.5 * Math.max(0, game.players.length - 1);

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function startWave(game: GameContext, n: number) {
  const w = WAVES[n - 1];
  state.wave = n;
  state.phase = 'fighting';
  state.queue = [];
  for (const [type, count] of Object.entries(w.spawns)) {
    const n = type === 'warden' || type === 'brute' ? count : Math.round(count * crowd(game));
    for (let i = 0; i < n; i++) state.queue.push(type);
  }
  // Bosses make their entrance first; everything else arrives shuffled.
  const boss = state.queue.filter((t) => t === 'warden');
  const rest = state.queue.filter((t) => t !== 'warden').sort(() => game.rng.next() - 0.5);
  state.queue = [...boss, ...rest];
  state.spawnTimer = 1.2;
  game.hud.banner(n === WAVES.length ? 'Final Wave' : `Wave ${n}`, w.name, { duration: 2.6, color: n === WAVES.length ? '#c9a2ff' : undefined });
  game.audio.play('wave');
  // Dusk falls as the fight goes on.
  game.env.time = 0.66 + (n - 1) * 0.013;
}

/** The banner and countdown to the first wave. */
function begin(game: GameContext) {
  state.phase = 'countdown';
  state.startedAt = game.clock.now;
  game.hud.banner('ARENA', 'Survive six waves', { duration: 2.8, color: '#ffb36b' });
  let n = 3;
  const tick = () => {
    if (n > 0) {
      game.hud.objective(`First wave in ${n}…`);
      game.audio.play('countdown');
      n--;
      game.clock.after(1, tick);
    } else {
      startWave(game, 1);
    }
  };
  game.clock.after(1.5, tick);
}

function spawnNext(game: GameContext) {
  const type = state.queue.shift();
  if (!type) return;
  const gate = game.rng.pick(GATES);
  const r = type === 'warden' ? GATE_SPAWN_RADIUS - 5 : GATE_SPAWN_RADIUS + game.rng.range(-1.5, 1.5);
  const side = game.rng.range(-1.5, 1.5);
  const pos = { x: Math.cos(gate) * r - Math.sin(gate) * side, y: FLOOR + 1.05, z: Math.sin(gate) * r + Math.cos(gate) * side };
  game.entities.spawn(type, pos, { yaw: gate + Math.PI });
  game.fx.burst({ x: pos.x, y: pos.y + 1, z: pos.z }, { color: type === 'warden' ? '#a26bff' : '#8fd6ff', count: 24, speed: 2.5, gravity: -1 });
  game.audio.play(type === 'warden' ? 'boss' : 'spawn', { at: pos, volume: type === 'warden' ? 1.4 : 0.8 });
  if (type === 'warden') game.fx.shake(0.2, 1.2);
}

function waveCleared(game: GameContext) {
  const w = WAVES[state.wave - 1];
  const last = state.wave >= WAVES.length;
  for (const p of game.players) if (!p.alive) rejoin(game, p, !last);
  if (last) return victory(game);
  state.phase = 'intermission';
  state.nextWaveAt = game.clock.now + INTERMISSION;
  game.hud.banner('Wave cleared!', w.reward ? 'A reward awaits on the dais' : undefined, { duration: 2.4, color: '#9dff8a' });
  game.audio.play('victory', { volume: 0.5 });
  for (const p of game.players) p.heal(6);
  // A reward for each fighter, in a ring on the dais: each can take only their own.
  const rewards = game.players.flatMap((p) => (w.reward ?? []).map((r) => ({ ...r, p })));
  const radius = 1.2 + 0.4 * (game.players.length - 1);
  rewards.forEach((r, i) => {
    const a = (i / rewards.length) * Math.PI * 2;
    const at = { x: CENTER.x + Math.cos(a) * radius, y: CENTER.y + 0.5, z: CENTER.z + Math.sin(a) * radius };
    game.items.spawnPickup(r.item, at, { count: r.count ?? 1, beam: '#ffd36b', despawn: 600, for: game.players.length > 1 ? r.p : undefined });
  });
}

/** A starting sword, and (arriving late) the weapons and arrows the waves so far gave out. */
function arm(p: Player) {
  p.inventory.give('wooden_sword');
  const cleared = state.phase === 'fighting' ? state.wave - 1 : state.phase === 'intermission' || state.phase === 'victory' ? state.wave : 0;
  for (const w of WAVES.slice(0, cleared)) {
    for (const r of w.reward ?? []) {
      if (r.item === 'arrow_bundle') p.inventory.give('arrow', 6 * (r.count ?? 1));
      else if (r.item !== 'health_potion') p.inventory.give(r.item);
    }
  }
  p.inventory.select(0);
}

/** Someone fell with others still fighting: they watch from the stands until the wave's won. */
function fall(game: GameContext, p: Player) {
  p.hud.banner('YOU FELL', "You'll be back when this wave is cleared", { duration: 3, color: '#ff6b6b' });
  game.hud.feed(`${p.name} is down`, { color: '#ff8a4c' });
  game.clock.after(1.5, () => {
    if (p.alive || !game.players.includes(p)) return;
    p.teleport(LOOKOUT, 0, -0.62);
    p.freeze(true);
  });
}

/** Back on the arena floor after sitting a wave out. */
function rejoin(game: GameContext, p: Player, announce: boolean) {
  p.revive();
  p.freeze(false);
  p.teleport(CENTER, game.rng.range(0, Math.PI * 2), 0);
  if (!announce) return;
  p.hud.banner('BACK IN THE FIGHT', undefined, { duration: 1.6, color: '#9dff8a' });
  p.audio.play('heal');
}

/** Everyone's down: the arena wins. */
function checkWipe(game: GameContext) {
  if (game.players.length && game.players.every((p) => !p.alive)) defeat(game);
}

function victory(game: GameContext) {
  state.phase = 'victory';
  const time = game.clock.now - state.startedAt;
  game.hud.banner('VICTORY', 'The arena is yours', { duration: 3.5, color: '#ffd36b' });
  game.audio.play('victory');
  const burst = () => game.fx.fireworks({ x: 0, y: FLOOR + 2, z: 0 }, 6);
  burst();
  game.clock.every(1.1, burst);
  game.clock.after(3.2, () =>
    game.hud.screen({
      title: 'Victory!',
      subtitle: 'You defeated the Warden and conquered the arena.',
      tone: 'victory',
      icon: Sprite.golden_trophy,
      stats: [
        ['Time', fmtTime(time)],
        ['Monsters slain', String(state.kills)],
        ['Damage dealt', String(Math.round(state.damageDealt))],
        ['Damage taken', String(Math.round(state.damageTaken))],
      ],
      buttons: [
        { label: 'Play again', primary: true, onClick: () => game.restart() },
        { label: 'Switch game', onClick: () => game.exit() },
      ],
    }),
  );
}

function defeat(game: GameContext) {
  if (state.phase === 'defeat' || state.phase === 'victory') return;
  state.phase = 'defeat';
  game.audio.play('defeat');
  const who = game.players.length > 1 ? 'Your party' : 'You';
  game.clock.after(1.6, () =>
    game.hud.screen({
      title: 'Defeated',
      subtitle: `${who} fell on wave ${state.wave}: ${WAVES[Math.max(0, state.wave - 1)].name}.`,
      tone: 'defeat',
      stats: [
        ['Wave reached', `${state.wave} / ${WAVES.length}`],
        ['Monsters slain', String(state.kills)],
        ['Time survived', fmtTime(game.clock.now - state.startedAt)],
      ],
      buttons: [
        { label: 'Try again', primary: true, onClick: () => game.restart() },
        { label: 'Switch game', onClick: () => game.exit() },
      ],
    }),
  );
}

/**
 * Arena: survive six waves of monsters in a colosseum, collect better weapons between waves,
 * and defeat the Warden. Alone or together: more fighters bring more monsters, anyone who falls
 * sits out the rest of the wave, and the fight is lost when everyone's down. Built entirely on the
 * public platform API.
 */
export default defineServer(shared, {
  // Its kinds of item: bows, swords and axes (and the bare fist), potions.
  items: [bows(), melee(), consumables()],
  setup(game) {
    Object.assign(state, fresh());
    // (Its voices and its items' looks are each screen's, `client/`: played and named here.)
    defineArt(game);
    defineItems(game);
    defineMonsters(game);
    game.events.on('entityDeath', ({ killer }) => {
      if (killer !== 'world' && killer?.kind === 'player') state.kills++;
    });
    game.events.on('entityDamage', ({ amount, source }) => {
      if (source !== 'world' && source?.kind === 'player') state.damageDealt += amount;
    });
    game.events.on('playerDamage', ({ amount }) => {
      state.damageTaken += amount;
    });
    game.events.on('playerDeath', ({ player }) => {
      if (state.phase !== 'countdown' && state.phase !== 'fighting' && state.phase !== 'intermission') return;
      if (game.players.some((p) => p.alive)) fall(game, player);
      else defeat(game);
    });
    game.events.on('playerJoin', ({ player }) => {
      // Before the fight, `start` arms everyone; after everyone left, the next one starts it.
      if (state.phase === 'intro') return;
      arm(player);
      if (state.phase === 'waiting') return begin(game);
      player.hud.banner('ARENA', state.phase === 'fighting' ? `Joining wave ${state.wave}` : 'Survive six waves', { duration: 2.4, color: '#ffb36b' });
      game.hud.feed(`${player.name} joins the fight`, { color: '#ffb36b' });
    });
    game.events.on('playerLeave', () => {
      // The last one out: the arena resets for whoever comes next.
      if (!game.players.length) {
        if (state.phase !== 'waiting' && state.phase !== 'intro') game.restart();
      } else if (state.phase === 'countdown' || state.phase === 'fighting' || state.phase === 'intermission') {
        checkWipe(game);
      }
    });
  },

  start(game) {
    Object.assign(state, fresh(), { startedAt: game.clock.now });
    game.env.time = 0.66;
    if (!game.players.length) {
      state.phase = 'waiting';
      return;
    }
    for (const p of game.players) arm(p);
    begin(game);
  },

  update(game, dt) {
    const alive = game.entities.count();
    if (state.phase === 'fighting') {
      state.spawnTimer -= dt;
      if (state.queue.length > 0 && alive < MAX_ALIVE && state.spawnTimer <= 0) {
        spawnNext(game);
        state.spawnTimer = state.wave === WAVES.length ? 2.5 : 0.9;
      }
      if (state.queue.length === 0 && alive === 0) waveCleared(game);
      const left = alive + state.queue.length;
      game.hud.objective(`Wave ${state.wave}/${WAVES.length} · ${left} ${left === 1 ? 'enemy' : 'enemies'} left`);
    } else if (state.phase === 'intermission') {
      const t = Math.ceil(state.nextWaveAt - game.clock.now);
      game.hud.objective(`Next wave in ${t}s — grab the reward on the dais`);
      if (t <= 3 && t > 0 && t !== state.lastBeep) {
        state.lastBeep = t;
        game.audio.play('countdown');
      }
      if (game.clock.now >= state.nextWaveAt) startWave(game, state.wave + 1);
    } else if (state.phase === 'victory') {
      game.hud.objective(null);
    }
    game.hud.stat('kills', 'Kills', state.kills);
    game.hud.stat('time', 'Time', fmtTime(Math.max(0, game.clock.now - state.startedAt)));
  },
});
