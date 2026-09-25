import type { WidgetDefinition } from '@platform';

/**
 * Each fighter's corner of the screen (top right), a HUD widget of the game's own: their kills,
 * their place and the leader, their streak toward the UAV (three) and the Adrenaline Shot
 * (five), and how long those have left. The markup and styles are here; `personalHud` fills it
 * in every tick with `player.hud.widget('dossier', data)`, and only what changed goes to their
 * screen. It's inked on paper like the rest of the HUD, from the theme's colours.
 */
export const DOSSIER: WidgetDefinition = {
  at: 'top-right',
  html: `
    <div class="chip"><span class="label">Kills</span><span class="value">{{kills}} / {{limit}}</span></div>
    <div class="chip"><span class="label">Place</span><span class="value">{{place}} of {{fighters}}</span></div>
    <div class="chip" data-if="leading"><span class="label">Leading by</span><span class="value">{{margin}}</span></div>
    <div class="chip" data-if="!leading"><span class="label">Leader</span><span class="value">{{leader}} · {{leaderKills}}</span></div>
    <div class="chip streak">
      <span class="label">Streak</span>
      <span class="pips"><i data-each="pips" class="pip {{.}}"></i></span>
      <span class="value more" data-if="extra > 0">+{{extra}}</span>
    </div>
    <div class="perk uav" data-if="uav > 0" style="--left: {{uav}}; --of: {{uavFor}}">
      <span class="perk-name">UAV</span><span class="perk-bar"><span></span></span><span class="perk-time">{{uav}}s</span>
    </div>
    <div class="perk rush" data-if="rush > 0" style="--left: {{rush}}; --of: {{rushFor}}">
      <span class="perk-name">Adrenaline</span><span class="perk-bar"><span></span></span><span class="perk-time">{{rush}}s</span>
    </div>`,
  css: `
    /* Where the platform's stat chips were: under the frame counter. */
    :scope {
      margin: 16px -6px 0 0;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
    }
    .chip {
      display: flex;
      gap: 10px;
      align-items: baseline;
      padding: 6px 12px;
      background: var(--hud-paper, #fdf1d6);
      color: var(--hud-fg, #111);
      border: 3px solid var(--hud-ink, #111);
      border-radius: 4px;
      box-shadow: 6px 6px 0 var(--hud-ink, #111);
    }
    .label {
      font: 600 10px var(--sans);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      opacity: 0.7;
    }
    .value {
      font: 700 20px var(--pixel);
      font-variant-numeric: tabular-nums;
    }
    /* The streak: five cards, the third lights the UAV, the fifth the Adrenaline Shot. */
    .streak {
      align-items: center;
    }
    .pips {
      display: flex;
      gap: 5px;
    }
    .pip {
      width: 13px;
      height: 16px;
      border: 2px solid var(--hud-ink, #111);
      transform: skewX(-10deg);
      background: rgba(0, 0, 0, 0.08);
    }
    .pip.uav:not(.on) {
      background: repeating-linear-gradient(45deg, #ff5c8a 0 2px, transparent 2px 5px);
    }
    .pip.rush:not(.on) {
      background: repeating-linear-gradient(45deg, var(--hud-danger, #e63946) 0 2px, transparent 2px 5px);
    }
    .pip.on {
      background: var(--hud-accent, #ffcc00);
      animation: pip-in 260ms cubic-bezier(0.3, 1.8, 0.5, 1);
    }
    .more {
      font-size: 16px;
    }
    /* A streak reward running: a black tag, its colour, the time draining. */
    .perk {
      --c: var(--hud-accent, #ffcc00);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 10px;
      background: var(--hud-ink, #111);
      color: #fff;
      border-radius: 4px;
      box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.35);
      animation: perk-in 320ms cubic-bezier(0.3, 1.8, 0.5, 1);
    }
    .perk.uav {
      --c: #ff5c8a;
    }
    .perk-name {
      font: 700 17px var(--pixel);
      letter-spacing: 0.04em;
      color: var(--c);
    }
    .perk-bar {
      width: 84px;
      height: 8px;
      background: rgba(255, 255, 255, 0.18);
      overflow: hidden;
    }
    .perk-bar > span {
      display: block;
      height: 100%;
      width: calc(var(--left) / var(--of) * 100%);
      background: var(--c);
      transition: width 1s linear;
    }
    .perk-time {
      font: 700 15px var(--pixel);
      min-width: 28px;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    @keyframes pip-in {
      from { transform: skewX(-10deg) scale(1.6); }
    }
    @keyframes perk-in {
      from { transform: scale(1.35); opacity: 0; }
    }`,
};

/** The five streak cards: lit up to the streak; the third and fifth marked (UAV, Adrenaline Shot). */
export function streakPips(streak: number): string[] {
  return [0, 1, 2, 3, 4].map((i) => `${i < streak ? 'on' : 'off'}${i === 2 ? ' uav' : i === 4 ? ' rush' : ''}`);
}
