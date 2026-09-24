import { defineGame, type GameContext } from '@platform';
import { buildArena, FLOOR, GATES, GATE_SPAWN_RADIUS, PIT } from './structure';
import { defineArt, defineItems, defineMonsters } from './content';
import { Sprite } from './art';
import { defineSounds } from './sounds';

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
const CENTER = { x: 0.5, y: FLOOR + 2, z: 0.5 };

type Phase = 'intro' | 'fighting' | 'intermission' | 'victory' | 'defeat';

const state = {
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
};

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function startWave(game: GameContext, n: number) {
  const w = WAVES[n - 1];
  state.wave = n;
  state.phase = 'fighting';
  state.queue = [];
  for (const [type, count] of Object.entries(w.spawns)) for (let i = 0; i < count; i++) state.queue.push(type);
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
  if (state.wave >= WAVES.length) return victory(game);
  state.phase = 'intermission';
  state.nextWaveAt = game.clock.now + INTERMISSION;
  game.hud.banner('Wave cleared!', w.reward ? 'A reward awaits on the dais' : undefined, { duration: 2.4, color: '#9dff8a' });
  game.audio.play('victory', { volume: 0.5 });
  game.player.heal(6);
  let i = 0;
  for (const r of w.reward ?? []) {
    const a = (i++ / (w.reward!.length || 1)) * Math.PI * 2;
    game.items.spawnPickup(r.item, { x: CENTER.x + Math.cos(a) * 1.2, y: CENTER.y + 0.5, z: CENTER.z + Math.sin(a) * 1.2 }, { count: r.count ?? 1, beam: '#ffd36b', despawn: 600 });
  }
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
  game.clock.after(1.6, () =>
    game.hud.screen({
      title: 'Defeated',
      subtitle: `You fell on wave ${state.wave}: ${WAVES[Math.max(0, state.wave - 1)].name}.`,
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
 * and defeat the Warden. Built entirely on the public platform API.
 */
export default defineGame({
  id: 'arena',
  title: 'Arena',
  tagline: 'Survive six waves and slay the Warden',
  accent: '#ff8a4c',
  controls: [
    ['LMB', 'attack · hold to draw bow'],
    ['RMB', 'drink potion'],
    ['1-9', 'weapons'],
  ],
  world: {
    structures: [buildArena()],
    terraform: [{ x: 0, z: 0, radius: PIT + 16, blend: 28, height: FLOOR + 0.5 }],
    spawn: { x: CENTER.x, y: CENTER.y + 0.05, z: CENTER.z },
    spawnYaw: 0,
    time: 0.66,
    freezeTime: true,
  },
  player: { health: 20, regen: { delay: 6, perSecond: 0.35 }, fallDamage: true, hotbar: 'items' },

  setup(game) {
    defineSounds(game);
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
    game.events.on('playerDeath', () => defeat(game));
  },

  start(game) {
    Object.assign(state, { phase: 'intro', wave: 0, queue: [], spawnTimer: 0, nextWaveAt: 0, kills: 0, damageDealt: 0, damageTaken: 0, startedAt: game.clock.now, lastBeep: 0 });
    game.player.inventory.give('wooden_sword');
    game.env.time = 0.66;
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
