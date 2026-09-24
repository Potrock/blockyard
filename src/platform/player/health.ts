import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { DamageOptions, GameEvents, PlayerOptions, Vec3 } from '../api/types';
import type { Sfx } from '../audio/sfx';
import type { Effects } from '../fx/effects';
import type { GameHud } from '../ui/hudkit';

/** Player health, damage, knockback, regeneration, fall damage and death. */
export class PlayerHealth {
  enabled = true;
  health = 20;
  max = 20;
  dead = false;
  deathTime = 0;
  private invuln = 0;
  private sinceHurt = 99;
  private regen: { delay: number; perSecond: number } | null = null;
  private fallDamage = false;
  private prevVy = 0;
  private prevGround = true;

  constructor(
    private world: VoxelWorld,
    private sfx: Sfx,
    private fx: Effects,
    private hud: GameHud,
    private emit: <K extends keyof GameEvents>(event: K, e: GameEvents[K]) => void,
    private playerPos: () => Vec3,
  ) {}

  configure(opts: PlayerOptions) {
    this.enabled = opts.health !== false;
    this.max = typeof opts.health === 'number' ? opts.health : 20;
    this.health = this.max;
    this.regen = opts.regen ?? null;
    this.fallDamage = opts.fallDamage ?? false;
    this.refresh();
  }

  refresh() {
    this.hud.setHealth(this.health, this.enabled ? this.max : 0);
  }

  damage(amount: number, opts: DamageOptions = {}): boolean {
    if (!this.enabled || this.dead || this.invuln > 0 || amount <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.invuln = 0.45;
    this.sinceHurt = 0;
    const p = this.playerPos();
    const from = opts.from ?? (typeof opts.source === 'object' ? opts.source.position : null);
    const kb = opts.knockback ?? 1;
    if (from && kb > 0) {
      const dx = p.x - from.x;
      const dz = p.z - from.z;
      const l = Math.hypot(dx, dz) || 1;
      this.world.player_impulse((dx / l) * 7 * kb, 5.5 * kb, (dz / l) * 7 * kb);
    }
    this.sfx.play('hurt');
    this.fx.flash('rgba(180, 10, 10, 1)', Math.min(0.5, 0.15 + amount * 0.04), 0.45);
    this.fx.shake(0.06 + amount * 0.012, 0.3);
    this.emit('playerDamage', { amount, source: opts.source });
    if (this.health <= 0) {
      this.dead = true;
      this.deathTime = 0;
      this.world.set_frozen(true);
      this.emit('playerDeath', { source: opts.source });
    }
    this.refresh();
    return true;
  }

  heal(amount: number) {
    if (this.dead) return;
    this.health = Math.min(this.max, this.health + amount);
    this.refresh();
  }

  revive() {
    this.dead = false;
    this.health = this.max;
    this.invuln = 1;
    this.prevGround = true;
    this.prevVy = 0;
    this.world.set_frozen(false);
    this.refresh();
  }

  update(dt: number, onGround: boolean, vy: number) {
    this.invuln = Math.max(0, this.invuln - dt);
    this.sinceHurt += dt;
    if (this.dead) {
      this.deathTime += dt;
      return;
    }
    if (this.regen && this.enabled && this.health < this.max && this.sinceHurt > this.regen.delay) {
      this.health = Math.min(this.max, this.health + this.regen.perSecond * dt);
      this.refresh();
    }
    if (this.fallDamage && onGround && !this.prevGround && this.prevVy < -15) {
      this.damage(Math.round((-this.prevVy - 13) * 0.8), { source: 'world', knockback: 0 });
    }
    this.prevGround = onGround;
    this.prevVy = vy;
  }
}
