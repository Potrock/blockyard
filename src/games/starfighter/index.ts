import { defineGame, math, type GameContext, type Vec3 } from '@platform';
import { tieFighter, tieInterceptor, xwing } from './ships';
import { buildDestroyer } from './destroyer';
import { shipType, angleDiff, headingTo, type ShipType } from './craft';
import { Weapons, type Target } from './weapons';
import { Pilot } from './pilot';
import { Enemy, type EnemyKind } from './enemies';
import { Capital } from './capital';
import { defineSounds } from './sounds';
import { ARENA, DESTROYER_CENTER, PLAYER_START, SEED } from './layout';

const destroyer = buildDestroyer(DESTROYER_CENTER);
// South of the stern, looking north at its engines (the films' opening shot).
const START = new math.Vector3(PLAYER_START.x, PLAYER_START.y, PLAYER_START.z);

interface Wave {
  title: string;
  sub: string;
  ties: number;
  interceptors: number;
  boss?: boolean;
}

const WAVES: Wave[] = [
  { title: 'WAVE 1', sub: 'TIE squadron inbound', ties: 5, interceptors: 0 },
  { title: 'WAVE 2', sub: 'Interceptors on your tail', ties: 5, interceptors: 3 },
  { title: 'THE STAR DESTROYER', sub: 'Knock out its shield generators', ties: 3, interceptors: 2, boss: true },
];

// Game state (reset in start).
let types: { xwing: ShipType; tie: EnemyKind; interceptor: EnemyKind } | null = null;
let weapons: Weapons;
let pilot: Pilot;
let capital: Capital;
let enemies: Enemy[] = [];
let wave = 0;
let phase: 'intro' | 'fight' | 'between' | 'won' | 'lost' = 'intro';
let startedAt = 0;
let reinforce = 0;
let warnTimer = 0;
/** Victory cinematic: seconds since the bridge blew (-1 = off). */
let cine = -1;
let cineAngle = 0;
const lastPos = new math.Vector3();
const vel = new math.Vector3();

function kinds(game: GameContext) {
  if (types) return types;
  const tie = shipType(game, tieFighter());
  const interceptor = shipType(game, tieInterceptor());
  types = {
    xwing: shipType(game, xwing()),
    tie: { type: tie, hp: 24, speed: 40, agility: 1.35, fireRate: 0.16, score: 100 },
    interceptor: { type: interceptor, hp: 32, speed: 52, agility: 1.9, fireRate: 0.12, score: 150 },
  };
  return types;
}

function spawnEnemy(game: GameContext, kind: EnemyKind, fromHangar: boolean) {
  const c = DESTROYER_CENTER;
  let at: Vec3;
  if (fromHangar) {
    // Out of the hangar under the keel.
    at = { x: c.x + (Math.random() - 0.5) * 30, y: c.y - 24 - Math.random() * 6, z: c.z + 10 + (Math.random() - 0.5) * 50 };
  } else {
    // In from the far side of the arena.
    const a = Math.atan2(START.x - c.x, START.z - c.z) + Math.PI + (Math.random() - 0.5) * 1.6;
    at = { x: c.x + Math.sin(a) * 240, y: 125 + Math.random() * 45, z: c.z + Math.cos(a) * 240 };
  }
  const e = new Enemy(game, kind, weapons, at, headingTo(at, pilot.craft.pos).yaw);
  e.onDeath = () => {
    pilot.kills++;
    game.hud.marker(`e${enemies.indexOf(e)}`, null);
  };
  enemies.push(e);
  weapons.targets.push(e);
}

function startWave(game: GameContext) {
  const w = WAVES[wave];
  phase = 'fight';
  game.hud.banner(w.title, w.sub, { duration: 3, color: w.boss ? '#ff6b5b' : '#ffd23f' });
  game.audio.play(w.boss ? 'capital_horn' : 'wave');
  const k = kinds(game);
  for (let i = 0; i < w.ties; i++) game.clock.after(i * 0.6, () => spawnEnemy(game, k.tie, !!w.boss || i % 2 === 0));
  for (let i = 0; i < w.interceptors; i++) game.clock.after(1.5 + i * 0.8, () => spawnEnemy(game, k.interceptor, false));
  if (w.boss) {
    capital.active = true;
    reinforce = 12;
  }
}

function waveCleared(game: GameContext) {
  phase = 'between';
  pilot.torpedoes += 3;
  pilot.shields = 100;
  game.hud.banner('WAVE CLEARED', '+3 proton torpedoes, shields recharged', { duration: 2.6, color: '#7ce0ff' });
  game.audio.play('victory', { volume: 0.6 });
  wave++;
  game.clock.after(4, () => startWave(game));
}

function finish(game: GameContext, won: boolean) {
  phase = won ? 'won' : 'lost';
  const t = Math.round(game.clock.now - startedAt);
  const stats: [string, string][] = [
    ['Time', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`],
    ['Kills', String(pilot.kills)],
    ['Hull', `${Math.round(pilot.hull)}%`],
  ];
  game.clock.after(won ? 6.5 : 2.5, () =>
    game.hud.screen({
      title: won ? 'Victory!' : 'Shot Down',
      subtitle: won ? 'The Star Destroyer is finished. Great shot, kid.' : `You fell during ${WAVES[wave].title.toLowerCase()}.`,
      tone: won ? 'victory' : 'defeat',
      stats,
      buttons: [
        { label: won ? 'Fly again' : 'Try again', primary: true, onClick: () => game.restart() },
        { label: 'Switch game', onClick: () => game.exit() },
      ],
    }),
  );
  if (won) game.audio.play('victory');
  else game.audio.play('defeat');
}

function updateHud(game: GameContext) {
  const h = game.hud;
  const c = pilot.craft;
  h.meter('shield', 'SHIELD', pilot.shields / 100, { color: '#63c7ff', text: `${Math.round(pilot.shields)}` });
  h.meter('hull', 'HULL', pilot.hull / 100, { color: pilot.hull > 40 ? '#7ee07a' : '#ff5a4a', text: `${Math.round(pilot.hull)}` });
  h.meter('boost', 'BOOST', pilot.boost, { color: '#ffb14a' });
  h.stat('kills', 'KILLS', pilot.kills);
  h.stat('torps', 'TORPEDOES', pilot.torpedoes);
  if (!pilot.alive) {
    h.marker('r1', null);
    h.marker('r2', null);
  } else {
    h.marker('r1', pilot.reticle(30), { shape: 'reticle', color: '#9dff7a', size: 34 });
    h.marker('r2', pilot.reticle(80), { shape: 'reticle', color: '#9dff7a', size: 20 });
  }
  enemies.forEach((e, i) => {
    if (!e.alive) return;
    const locked = pilot.lock === e;
    const locking = pilot.locking === e;
    h.marker(`e${i}`, e.pos, {
      shape: 'box',
      color: locked ? '#ffd23f' : locking ? '#ffa23f' : '#ff4d4d',
      size: { world: e.radius * 2.4, min: 16, max: 90 },
      edge: true,
      pulse: locked || locking,
      label: locked ? 'LOCKED' : locking ? 'LOCKING…' : undefined,
    });
  });
  const boss = WAVES[wave]?.boss;
  capital.generators.forEach((g, i) => {
    const show = boss && g.alive;
    h.marker(`g${i}`, show ? g.pos : null, { shape: 'diamond', color: pilot.lock === g ? '#ffd23f' : '#ff9a3c', size: 30, edge: true, label: `SHIELD GEN ${Math.ceil((g.hp / g.maxHp) * 100)}%`, pulse: pilot.lock === g });
  });
  const b = capital.bridge;
  h.marker('bridge', boss && b.alive && !b.shielded ? b.pos : null, { shape: 'diamond', color: '#ff4d4d', size: 36, edge: true, label: `BRIDGE ${Math.ceil((b.hp / b.maxHp) * 100)}%`, pulse: true });
  // Radar: fighters red, weak points orange, the capital ship grey.
  h.radar({
    center: c.pos,
    heading: c.yaw,
    range: 320,
    blips: [
      { x: DESTROYER_CENTER.x, z: DESTROYER_CENTER.z, color: '#9aa4b5', size: 8 },
      ...capital.generators.filter((g) => g.alive).map((g) => ({ x: g.pos.x, z: g.pos.z, color: '#ff9a3c', size: 4 })),
      ...enemies.filter((e) => e.alive).map((e) => ({ x: e.pos.x, z: e.pos.z, y: e.pos.y, color: '#ff4d4d', size: 4 })),
    ],
  });
}

/**
 * Ships bumping into ships: pushed apart and knocked away from each other. Ramming a fighter
 * hurts it (and you); fighters just jostle each other.
 */
function shipContacts() {
  const alive = enemies.filter((e) => e.alive);
  const me = pilot.craft;
  const push = (a: typeof me, b: typeof me, strength: number) => {
    const d = b.pos.clone().sub(a.pos);
    if (d.lengthSq() < 1e-4) d.set(1, 0, 0);
    d.normalize();
    a.pos.addScaledVector(d, -0.4);
    b.pos.addScaledVector(d, 0.4);
    a.knock.addScaledVector(d, -strength);
    b.knock.addScaledVector(d, strength);
    return a.pos.clone().add(b.pos).multiplyScalar(0.5);
  };
  for (const e of alive) {
    if (pilot.alive && me.touches(e.craft)) {
      // Ramming is a last resort: it only half-wrecks a fighter and hurts you more.
      const at = push(me, e.craft, 14);
      e.hit(13, at);
      pilot.crash(at, 0.7);
    }
  }
  for (let i = 0; i < alive.length; i++)
    for (let j = i + 1; j < alive.length; j++) if (alive[i].craft.touches(alive[j].craft)) push(alive[i].craft, alive[j].craft, 6);
}

/** Orbit the capital ship as it breaks up; the fighters fly on (and the world keeps exploding). */
function cinematic(game: GameContext, dt: number) {
  cine += dt;
  cineAngle -= dt * 0.16;
  const b = capital.ship.bridge;
  const k = Math.min(1, cine / 1.5);
  const ease = k * k * (3 - 2 * k);
  const dist = 50 + 85 * ease;
  const cam = { x: b.x + Math.sin(cineAngle) * dist, y: b.y + 12 + 18 * ease, z: b.z + Math.cos(cineAngle) * dist };
  const look = { x: b.x, y: b.y - 25 * ease, z: b.z - 60 * ease };
  game.camera.set(cam, look);
  game.camera.fov = 70;
  if (pilot.craft.alive) {
    pilot.craft.steer(dt, 0, 0, 0);
    pilot.craft.move(dt);
    pilot.craft.sync(0.6);
  }
  const target = { pos: pilot.craft.pos, vel, alive: false, hit: () => {}, rolling: false };
  for (const e of enemies) e.update(dt, target, ARENA, enemies);
  capital.update(dt, target);
  weapons.update(dt);
  for (const id of ['r1', 'r2', 'bridge', 'g0', 'g1']) game.hud.marker(id, null);
  enemies.forEach((_, i) => game.hud.marker(`e${i}`, null));
  game.hud.stat('kills', '', null);
  game.hud.stat('torps', '', null);
  game.hud.objective(null);
}

export default defineGame({
  id: 'starfighter',
  title: 'Starfighter',
  tagline: 'Dogfight TIEs and take down a Star Destroyer',
  accent: '#ff5a4a',
  controls: [
    ['Mouse', 'steer'],
    ['LMB', 'lasers'],
    ['RMB', 'torpedo'],
    ['W / S', 'boost / brake'],
    ['Q / E', 'barrel roll'],
    ['A / D', 'bank'],
  ],
  world: {
    seed: SEED,
    structures: [destroyer.blueprint],
    spawn: { x: START.x, y: START.y, z: START.z },
    spawnYaw: 0,
    time: 0.4,
    freezeTime: true,
    viewDistance: 18,
  },
  player: { controller: 'none', health: false },

  setup(game) {
    defineSounds(game);
    game.commands.register('wave', {
      usage: '<1-3>',
      help: 'Jump to a wave',
      complete: () => ['1', '2', '3'],
      run: ([n]) => {
        const w = Number(n) - 1;
        if (!(w >= 0 && w < WAVES.length)) throw new Error('Waves are 1 to 3');
        for (const e of enemies) if (e.alive) e.hit(1e6, e.pos);
        wave = w;
        startWave(game);
        return `Wave ${n}`;
      },
    });
  },

  start(game) {
    weapons?.clear();
    pilot?.dispose();
    enemies = [];
    wave = 0;
    cine = -1;
    phase = 'intro';
    startedAt = game.clock.now;
    game.hud.crosshair(false);
    const k = kinds(game);
    weapons = new Weapons(game);
    pilot = new Pilot(game, k.xwing, weapons, START.clone(), 0);
    pilot.craft.pitch = 0.06; // the opening shot: the stern towering ahead
    lastPos.copy(pilot.craft.pos);
    capital = new Capital(game, destroyer, weapons, {
      generatorDown: (left) => {
        if (!left) pilot.torpedoes += 2;
        game.hud.banner(left ? 'SHIELD GENERATOR DOWN' : 'SHIELDS ARE DOWN', left ? 'One more to go' : 'Hit the bridge! +2 torpedoes', { duration: 2.6, color: '#ffd23f' });
      },
      bridgeDown: () => {
        game.hud.banner('DIRECT HIT', 'The Star Destroyer is breaking up', { duration: 3.5, color: '#ffd23f' });
        // Swing the camera out to watch it go.
        cine = 0;
        // Start south-west of the tower and swing west, over the sea (the ridge is to the east).
        cineAngle = -0.5;
        game.hud.radar(null);
        for (const id of ['shield', 'hull', 'boost']) game.hud.meter(id, '', null);
        for (const e of enemies) if (e.alive) game.clock.after(0.5 + Math.random() * 2, () => e.hit(1e6, e.pos));
        finish(game, true);
      },
    });
    weapons.targets.push(...capital.targets());
    // You're a target too: barrel rolls shrug off lasers.
    const me: Target = {
      get pos() {
        return pilot.craft.pos;
      },
      get radius() {
        return pilot.craft.radius * 0.8;
      },
      get alive() {
        return pilot.alive;
      },
      team: 'rebel',
      hit: (d) => {
        if (!pilot.rolling) pilot.damage(d);
      },
    };
    weapons.targets.push(me);
    weapons.onWorldHit = (at, kind, team) => {
      if (team === 'rebel') capital.worldHit(at, kind);
    };
    if (import.meta.env.DEV) (globalThis as unknown as { __sf: unknown }).__sf = { pilot, get enemies() { return enemies; }, capital, weapons };
    game.hud.banner('RED FIVE', 'Standing by', { duration: 2.5, color: '#ff6b5b' });
    game.clock.after(3, () => startWave(game));
  },

  update(game, dt) {
    if (!pilot) return;
    if (cine >= 0) {
      cinematic(game, dt);
      return;
    }
    if (pilot.alive) {
      pilot.update(dt, weapons.targets.filter((t) => t.team === 'empire'));
      vel.copy(pilot.craft.pos).sub(lastPos).divideScalar(Math.max(dt, 1e-3));
      lastPos.copy(pilot.craft.pos);
      // Keep the player body with the ship (audio, anything that targets the player).
      game.player.teleport(pilot.craft.pos);
      // The edge of the battle: warn, then steer back.
      const c = pilot.craft;
      const out = Math.hypot(c.pos.x - ARENA.center.x, c.pos.z - ARENA.center.z) - ARENA.radius;
      warnTimer -= dt;
      if (out > 0) {
        const want = headingTo(c.pos, ARENA.center).yaw;
        c.yaw += angleDiff(c.yaw, want) * Math.min(1, dt * (0.6 + out * 0.02));
        if (warnTimer <= 0) {
          game.hud.toast('Return to the battle!');
          warnTimer = 2;
        }
      }
      if (c.pos.y > ARENA.ceiling) c.pitch = Math.min(c.pitch, c.pitch - (c.pos.y - ARENA.ceiling) * 0.02 * dt * 10);
    }
    if (pilot.hull <= 0 && pilot.craft.alive) {
      pilot.explode();
      if (phase !== 'won') finish(game, false);
    }
    const target = { pos: pilot.craft.pos, vel, alive: pilot.alive, hit: (d: number) => pilot.damage(d), rolling: pilot.rolling };
    for (const e of enemies) e.update(dt, target, ARENA, enemies);
    shipContacts();
    capital.update(dt, target);
    weapons.update(dt);
    updateHud(game);

    if (phase === 'fight' && pilot.alive) {
      const w = WAVES[wave];
      const alive = enemies.filter((e) => e.alive).length;
      if (w.boss) {
        // Fighters keep launching while the capital ship stands.
        reinforce -= dt;
        if (reinforce <= 0 && alive < 5) {
          reinforce = 9;
          const k = kinds(game);
          spawnEnemy(game, Math.random() < 0.35 ? k.interceptor : k.tie, true);
        }
        game.hud.objective(capital.bridge.shielded ? `Shield generators: ${capital.generators.filter((g) => g.alive).length} left` : 'Destroy the bridge!');
      } else {
        game.hud.objective(`${w.title}  ·  ${alive} fighters left`);
        if (alive === 0 && enemies.length > 0 && game.clock.now - startedAt > 5) waveCleared(game);
      }
    } else if (phase !== 'fight') {
      game.hud.objective(null);
    }
    // Forget dead fighters (keeps marker ids stable until the wave ends).
    if (phase === 'between') {
      enemies.forEach((_, i) => game.hud.marker(`e${i}`, null));
      enemies = enemies.filter((e) => e.alive);
      weapons.targets = weapons.targets.filter((t) => t.alive || t.team === 'rebel');
    }
  },
});
