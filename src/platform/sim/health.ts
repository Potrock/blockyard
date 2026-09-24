import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { AudioApi, DamageOptions, FxApi, GameEvents, Player, PlayerOptions, Vec3 } from '../api/types';

/**
 * A player's health, damage, knockback, regeneration, fall damage and death. The hearts are
 * shown from the player frame; the hurt sound, red flash and shake go to that player's client.
 */
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
  /** Armour points (0..20), each blocking 4% of damage. */
  armor = 0;

  constructor(
    private world: VoxelWorld,
    /** This player's own sound and screen effects. */
    private audio: AudioApi,
    private fx: FxApi,
    private emit: <K extends keyof GameEvents>(event: K, e: GameEvents[K]) => void,
    private playerPos: () => Vec3,
    /** The player this health belongs to (named in the events). */
    private player: () => Player,
    /** Hit: the first-person view flinches. */
    private onHurt: () => void,
  ) {}

  configure(opts: PlayerOptions) {
    this.enabled = opts.health !== false;
    this.max = typeof opts.health === 'number' ? opts.health : 20;
    this.health = this.max;
    this.regen = opts.regen ?? null;
    this.fallDamage = opts.fallDamage ?? false;
    this.refresh();
  }

  /** Kept for callers that change health directly (shown from the frame, so nothing to do). */
  refresh() {}

  damage(amount: number, opts: DamageOptions = {}): boolean {
    if (!this.enabled || this.dead || this.invuln > 0 || amount <= 0) return false;
    amount *= 1 - Math.min(20, Math.max(0, this.armor)) * 0.04;
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
    this.audio.play('hurt');
    this.onHurt();
    this.fx.flash('rgba(180, 10, 10, 1)', Math.min(0.5, 0.15 + amount * 0.04), 0.45);
    this.fx.shake(0.06 + amount * 0.012, 0.3);
    this.emit('playerDamage', { player: this.player(), amount, source: opts.source });
    if (this.health <= 0) {
      this.dead = true;
      this.deathTime = 0;
      this.world.set_frozen(true);
      this.emit('playerDeath', { player: this.player(), source: opts.source });
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
