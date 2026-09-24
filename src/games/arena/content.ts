import { Behaviors, HeldModels, Models, type Behavior, type GameContext, type ModelPart, type ProjectileSpec } from '@platform';
import { FLOOR, GATES, GATE_SPAWN_RADIUS } from './structure';
import { ARENA_ATLAS, AXE_MODEL, PIKE_MODEL, Skin, Sprite, paintArenaAtlas } from './art';

/** The Arena's own art: mob skins and item sprites painted into the `arena` atlas. */
export function defineArt(game: GameContext) {
  const a = paintArenaAtlas();
  game.items.atlas(ARENA_ATLAS, { width: a.width, height: a.height, pixels: a.albedo, emissive: a.emissive });
}

/** The Warden's crown: an open 10x4x10 ring on the head (UVs relative to the Warden's skin). */
const CROWN: ModelPart = { name: 'crown', size: [10, 4, 10], uv: [24, 42], pivot: [0, 10, 0], offset: [-5, 0, -5], parent: 'head' };
const skin = (s: readonly [number, number]): [number, number] => [s[0], s[1]];

export function defineItems(game: GameContext) {
  const it = game.items;
  it.define('wooden_sword', { kind: 'melee', name: 'Wooden Sword', icon: 'wooden_sword', damage: 4, cooldown: 0.45, reach: 3.3, rank: 1, hold: { model: HeldModels.woodenSword } });
  it.define('stone_sword', { kind: 'melee', name: 'Stone Sword', icon: 'stone_sword', damage: 5, cooldown: 0.45, reach: 3.4, rank: 2, hold: { model: HeldModels.stoneSword } });
  it.define('iron_sword', { kind: 'melee', name: 'Iron Sword', icon: 'iron_sword', damage: 6.5, cooldown: 0.42, reach: 3.5, knockback: 1.1, rank: 3, hold: { model: HeldModels.ironSword } });
  // Two-handed: long reach and a heavy shove, but a slower thrust.
  it.define('pike', { kind: 'melee', name: 'Pike', icon: Sprite.pike, damage: 7.5, cooldown: 0.7, reach: 5, knockback: 2.2, rank: 3.5, hold: { style: 'polearm', model: PIKE_MODEL } });
  it.define('battle_axe', { kind: 'melee', name: 'Battle Axe', icon: Sprite.battle_axe, damage: 10, cooldown: 0.85, reach: 3.3, knockback: 1.8, sweep: true, rank: 4, hold: { style: 'axe', model: AXE_MODEL } });
  it.define('diamond_sword', { kind: 'melee', name: 'Diamond Sword', icon: 'diamond_sword', damage: 9, cooldown: 0.4, reach: 3.7, knockback: 1.2, sweep: true, rank: 5, hold: { model: HeldModels.diamondSword } });
  it.define('bow', { kind: 'bow', name: 'Bow', icon: 'bow', drawIcon: 'bow_pulling', ammo: 'arrow', damage: [2, 9], drawTime: 0.9, speed: 42, rank: 0 });
  it.define('arrow', { kind: 'misc', name: 'Arrow', icon: 'arrow', stack: 64 });
  it.define('health_potion', {
    kind: 'consumable',
    name: 'Health Potion',
    icon: 'health_potion',
    hold: { model: HeldModels.healthPotion },
    stack: 4,
    use(g) {
      if (g.player.health >= g.player.maxHealth) return false;
      g.player.heal(10);
      g.audio.play('heal');
      g.fx.burst(g.player.eye, { color: '#ff4f6d', count: 16, speed: 2, gravity: -3 });
      return true;
    },
  });
  it.define('heart', {
    kind: 'misc',
    name: 'Heart',
    icon: 'heart',
    onPickup(g) {
      g.player.heal(4);
      g.audio.play('heal', { volume: 0.8 });
      return true;
    },
  });
  it.define('arrow_bundle', {
    kind: 'misc',
    name: 'Arrows',
    icon: Sprite.arrow_bundle,
    onPickup(g, count) {
      g.player.inventory.give('arrow', 6 * count);
      g.hud.toast(`+${6 * count} Arrows`);
      g.audio.play('pickup');
      return true;
    },
  });
}

const ARROW: ProjectileSpec = { sprite: 'arrow', speed: 26, gravity: 20, damage: 3, knockback: 0.4, sticky: true };
const FIREBALL: ProjectileSpec = { sprite: Sprite.soul_fireball, speed: 17, gravity: 1.5, damage: 5, knockback: 1.1, glow: '#5fe8ff' };

export function defineMonsters(game: GameContext) {
  const e = game.entities;
  e.define('zombie', {
    name: 'Zombie',
    model: Models.humanoid({ skin: skin(Skin.zombie), atlas: ARENA_ATLAS }),
    hitbox: { width: 0.6, height: 1.95 },
    health: 20,
    speed: 3.2,
    ai: Behaviors.melee({ damage: 3, reach: 1.9, cooldown: 1.1, windup: 0.25 }),
    drops: [{ item: 'heart', chance: 0.18 }],
    sounds: { ambient: 'zombie' },
    bloodColor: '#6b8f3a',
  });
  e.define('skeleton', {
    name: 'Skeleton',
    model: Models.humanoid({ skin: skin(Skin.skeleton), atlas: ARENA_ATLAS, build: 'thin' }),
    hitbox: { width: 0.6, height: 1.95 },
    health: 16,
    speed: 3.4,
    ai: Behaviors.ranged({ projectile: ARROW, range: 22, preferred: 10, cooldown: 2.1 }),
    drops: [
      { item: 'arrow_bundle', chance: 0.6 },
      { item: 'heart', chance: 0.08 },
    ],
    sounds: { ambient: 'skeleton', hurt: 'skeleton' },
    bloodColor: '#e8e2d0',
  });
  e.define('spider', {
    name: 'Spider',
    model: Models.spider({ skin: skin(Skin.spider), atlas: ARENA_ATLAS }),
    hitbox: { width: 1.3, height: 0.9 },
    health: 14,
    speed: 5.2,
    jump: 9,
    ai: Behaviors.leaper({ damage: 2.5, range: [2.5, 7.5], cooldown: 2.2, speed: 10, height: 6 }),
    drops: [{ item: 'heart', chance: 0.12 }],
    sounds: { ambient: 'spider', hurt: 'spider' },
    bloodColor: '#3d6b2a',
  });
  e.define('brute', {
    name: 'Brute',
    model: Models.humanoid({ skin: skin(Skin.brute), atlas: ARENA_ATLAS, build: 'large', scale: 1.15 }),
    hitbox: { width: 1.1, height: 2.55 },
    health: 70,
    speed: 2.9,
    knockbackResistance: 0.6,
    ai: Behaviors.melee({ damage: 7, reach: 2.7, cooldown: 1.7, windup: 0.55, knockback: 1.8 }),
    drops: [
      { item: 'health_potion', chance: 1 },
      { item: 'arrow_bundle', chance: 0.7, count: 2 },
    ],
    sounds: { ambient: 'brute', hurt: 'brute' },
    bloodColor: '#7a2f22',
  });
  e.define('warden', {
    name: 'The Warden',
    model: Models.humanoid({ skin: skin(Skin.warden), atlas: ARENA_ATLAS, build: 'large', scale: 1.9, extras: [CROWN] }),
    hitbox: { width: 1.7, height: 4.2 },
    health: 340,
    speed: 2.6,
    knockbackResistance: 0.9,
    boss: true,
    ai: wardenAI,
    sounds: { ambient: 'boss', hurt: 'brute', death: 'boss' },
    bloodColor: '#6a2bd9',
  });
}

interface WardenState {
  phase?: 'chase' | 'windup' | 'slam' | 'recover';
  timer?: number;
  slamCd?: number;
  fireCd?: number;
  meleeCd?: number;
  summoned?: number;
  enraged?: boolean;
}

/** Final boss: melee swipes, telegraphed ground slams, soul fireballs, summons and an enrage phase. */
const wardenAI: Behavior = (self, game, dt) => {
  const s = self.data as WardenState;
  s.phase ??= 'chase';
  s.timer = (s.timer ?? 0) - dt;
  s.slamCd = (s.slamCd ?? 5) - dt;
  s.fireCd = (s.fireCd ?? 3) - dt;
  s.meleeCd = (s.meleeCd ?? 0) - dt;
  s.summoned ??= 0;
  const hp = self.health / self.maxHealth;
  const d = self.distanceToPlayer();

  // Summons at 66% and 33% health.
  const thresholds = [0.66, 0.33];
  if (s.summoned < thresholds.length && hp < thresholds[s.summoned]) {
    s.summoned++;
    game.audio.play('boss', { at: self.position, volume: 1.2 });
    game.hud.banner('The Warden calls for aid!', undefined, { duration: 2, color: '#c9a2ff' });
    for (let i = 0; i < 4; i++) {
      const a = GATES[i];
      const type = i % 2 === 0 ? 'skeleton' : 'zombie';
      game.entities.spawn(type, { x: Math.cos(a) * GATE_SPAWN_RADIUS, y: FLOOR + 1, z: Math.sin(a) * GATE_SPAWN_RADIUS });
    }
  }
  if (!s.enraged && hp < 0.3) {
    s.enraged = true;
    self.setSpeed(1.45);
    game.hud.banner('ENRAGED', undefined, { duration: 1.6, color: '#ff5a5a' });
    game.audio.play('boss', { at: self.position, pitch: 1.2 });
  }
  const tempo = s.enraged ? 0.7 : 1;

  switch (s.phase) {
    case 'chase': {
      self.moveTo('player');
      self.lookAt('player');
      self.glow(s.enraged ? '#ff2a2a' : null);
      if (d < 3.4 && s.meleeCd <= 0 && self.canSeePlayer()) {
        // Heavy swipe.
        s.meleeCd = 1.4 * tempo;
        self.animate('attack');
        game.player.damage(7, { source: self, knockback: 1.8 });
        game.fx.shake(0.12, 0.25);
      } else if (d < 11 && s.slamCd <= 0) {
        s.phase = 'windup';
        s.timer = 0.95 * tempo;
        self.stop();
        self.animate('raise');
        self.glow('#b76bff');
        game.audio.play('brute', { at: self.position, pitch: 0.7 });
      } else if (d > 9 && s.fireCd <= 0 && self.canSeePlayer()) {
        s.fireCd = 3.2 * tempo;
        self.animate('cast');
        for (const spread of [0, -0.08, 0.08]) self.shoot(FIREBALL, 'player', { lead: true, spread: 0.02 + Math.abs(spread) });
        game.audio.play('spawn', { at: self.position, pitch: 0.6 });
        game.clock.after(0.4, () => self.alive && self.animate('none'));
      }
      break;
    }
    case 'windup': {
      self.stop();
      self.lookAt('player');
      if (s.timer <= 0) {
        // Slam: shockwave that only hits grounded players — jump to dodge.
        const p = self.position;
        self.animate('attack');
        game.fx.shockwave({ x: p.x, y: p.y, z: p.z }, 8, '#b76bff');
        game.fx.shake(0.35, 0.6);
        game.audio.play('slam', { at: p, volume: 1.3 });
        const pp = game.player.position;
        const dist = Math.hypot(pp.x - p.x, pp.z - p.z);
        if (dist < 8 && game.player.onGround) game.player.damage(Math.round(10 * (1 - dist / 10)), { source: self, knockback: 2.2 });
        s.phase = 'recover';
        s.timer = 1.1 * tempo;
        s.slamCd = game.rng.range(6.5, 9) * tempo;
        self.glow(null);
      }
      break;
    }
    case 'recover': {
      self.stop();
      if (s.timer <= 0) {
        s.phase = 'chase';
        self.animate('none');
      }
      break;
    }
  }
};
