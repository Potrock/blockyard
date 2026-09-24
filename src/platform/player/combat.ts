import * as THREE from 'three';
import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { BowItem, GameContext, IconRef, MeleeItem, SpriteRef } from '../api/types';
import type { EntitySim } from '../sim/entities';
import type { ItemSim } from '../sim/items';
import type { Input } from './input';
import type { Sfx } from '../audio/sfx';
import type { Effects } from '../fx/effects';
import type { GameHud } from '../ui/hudkit';
import type { ViewModel } from '../render/viewmodel';

/** What a melee attack needs (the bare fist is one, with no item behind it). */
type Strike = Pick<MeleeItem, 'damage' | 'cooldown' | 'reach' | 'knockback' | 'sweep' | 'sounds'>;
const FIST: Strike = { damage: 1, cooldown: 0.3, reach: 3, knockback: 0.6 };

/** Player attacks: melee swings, charged bow shots and consumables. */
export class Combat {
  private cooldown = 0;
  private cooldownMax = 1;
  private drawing = false;
  charge = 0;
  hits = 0;
  shots = 0;

  constructor(
    private world: VoxelWorld,
    private entities: EntitySim,
    private items: ItemSim,
    private camera: THREE.PerspectiveCamera,
    private sfx: Sfx,
    private fx: Effects,
    private hud: GameHud,
    private held: ViewModel,
    private ctx: () => GameContext,
    private falling: () => boolean,
  ) {}

  reset() {
    this.cooldown = 0;
    this.drawing = false;
    this.charge = 0;
  }

  get isDrawing(): boolean {
    return this.drawing;
  }

  /** Melee readiness 0..1 (Minecraft's attack strength). */
  get strength(): number {
    return 1 - this.cooldown / this.cooldownMax;
  }

  update(dt: number, input: Input, active: boolean) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const inv = this.items.inventory;
    if (active) {
      if (input.wheel !== 0) inv.select(inv.selected + input.wheel);
      for (let i = 0; i < 9; i++) if (input.pressed(`Digit${i + 1}`)) inv.select(i);
    }
    const stack = inv.held;
    const def = stack ? this.items.get(stack.item) : undefined;
    if (!active) {
      this.drawing = false;
      this.charge = 0;
      return;
    }
    if (def?.kind === 'bow') {
      this.bow(dt, input, def);
    } else {
      this.drawing = false;
      this.charge = 0;
      if (input.buttonPressed(0) || (input.button(0) && this.cooldown <= 0)) {
        // Weapons and the bare fist use their own animation; anything else just swings.
        if (this.cooldown <= 0) this.melee(def?.kind === 'melee' ? def : FIST, !def || def.kind === 'melee');
      }
    }
    if (def?.kind === 'consumable' && input.buttonPressed(2)) {
      if (def.use(this.ctx(), this.ctx().player)) {
        inv.take(stack!.item, 1);
        this.held.use();
        if (def.sounds?.use) this.sfx.play(def.sounds.use);
      }
    }
  }

  private melee(def: Strike, weapon: boolean) {
    this.cooldown = this.cooldownMax = def.cooldown;
    if (weapon) this.held.use();
    else this.held.swing();
    this.sfx.play(def.sounds?.use ?? 'swing', { pitch: 0.9 + Math.random() * 0.2 });
    const cam = this.camera.position;
    const dir = this.camera.getWorldDirection(this.dirTmp);
    const hit = this.world.pick_body(cam.x, cam.y, cam.z, dir.x, dir.y, dir.z, def.reach ?? 3.3, 0.25);
    if (hit[0] < 0) return;
    const target = this.entities.byBody(hit[0]);
    if (!target || !target.alive) return;
    const crit = this.falling();
    const dmg = def.damage * (crit ? 1.5 : 1);
    target.damage(dmg, { source: this.ctx().player, knockback: def.knockback ?? 1, crit });
    this.hits++;
    const hitSound = def.sounds?.hit;
    this.sfx.play(hitSound ?? (crit ? 'crit' : 'hit'), { at: target.position, pitch: hitSound && crit ? 1.25 : 1 });
    this.hud.hitMarker(crit);
    this.fx.shake(crit ? 0.05 : 0.025, 0.12);
    if (def.sweep) {
      const tp = target.position;
      for (const e of this.entities.near(tp, 2.4)) {
        if (e === target) continue;
        const p = e.position;
        if (Math.hypot(p.x - cam.x, p.z - cam.z) > (def.reach ?? 3.3) + 1) continue;
        e.damage(dmg * 0.5, { source: this.ctx().player, knockback: 0.6 });
      }
      this.fx.burst({ x: tp.x, y: tp.y + 1, z: tp.z }, { color: '#e8f4ff', count: 14, speed: 4, gravity: 2 });
    }
  }

  private dirTmp = new THREE.Vector3();

  private bow(dt: number, input: Input, def: BowItem) {
    const inv = this.items.inventory;
    const hasAmmo = !def.ammo || inv.count(def.ammo) > 0;
    if (input.button(0) && hasAmmo) {
      if (!this.drawing) {
        this.drawing = true;
        this.charge = 0;
        this.sfx.play(def.sounds?.draw ?? 'bow_draw', { volume: 0.7 });
      }
      this.charge = Math.min(1, this.charge + dt / def.drawTime);
    } else if (this.drawing) {
      // Released: fire.
      this.drawing = false;
      if (this.charge > 0.1 && (!def.ammo || inv.take(def.ammo, 1))) {
        const c = this.charge;
        const cam = this.camera.position;
        const dir = this.camera.getWorldDirection(this.dirTmp);
        const crit = c >= 1;
        this.entities.spawnProjectile(
          {
            sprite: def.projectile ?? spriteOf(def.ammo ? this.items.get(def.ammo)?.icon : undefined),
            glow: def.projectile || def.ammo ? undefined : '#bfe7ff',
            speed: def.speed * (0.35 + 0.65 * c),
            gravity: 20,
            damage: def.damage[0] + (def.damage[1] - def.damage[0]) * c,
            knockback: 0.3 + c * 0.5,
            sticky: true,
            crit,
          },
          { x: cam.x + dir.x * 0.4, y: cam.y - 0.1 + dir.y * 0.4, z: cam.z + dir.z * 0.4 },
          dir,
          this.ctx().player,
        );
        this.shots++;
        this.sfx.play(def.sounds?.use ?? 'bow_shoot', { pitch: 0.9 + c * 0.2 });
        this.held.use(0.6 + c * 0.6);
      }
      this.charge = 0;
    } else if (input.buttonPressed(0) && !hasAmmo) {
      this.hud.toast('No arrows');
    }
  }
}

/** A sprite icon, or nothing for an item that looks like a block (it can't fly as an arrow). */
function spriteOf(icon: IconRef | undefined): SpriteRef | undefined {
  return typeof icon === 'object' && 'block' in icon ? undefined : icon;
}
