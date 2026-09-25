import type { WidgetDefinition } from '@platform';

/**
 * High Noon's own HUD widgets (`hud.define` in setup, filled in with `hud.widget` every tick; only
 * what changed reaches a screen). Printed on the theme's parchment in its inks (`var(--hud-ink)`
 * and the rest, from `hud.theme.colors`).
 *
 * - `cylinder`: the held gun's rounds, bottom right: the Peacemaker's cylinder turning a chamber a
 *   shot (brass where there's a round, black where it's spent), or the Yellowboy's tube as a row
 *   of cartridges. (It replaces the platform's ammo counter, hidden in hud.css.)
 * - `wanted`: the Most Wanted's poster, top right: whoever carries the biggest bounty, their
 *   price, and yours under it.
 * - `duel`: the middle of the screen at a round's start and end: the standoff's clock counting to
 *   DRAW, then who won the round and the tally.
 * - `roundbar`: the round, who's still standing (a pip each) and the clock, top middle.
 * - `outfits`: a modal: choose your gunslinger (O). Its buttons call the game's `pick` action.
 */

export const CYLINDER: WidgetDefinition = {
  at: 'bottom-right',
  html: `
    <div class="gun" data-if="revolver">
      <div class="drum" style="--turn: {{turn}}">
        <i data-each="chambers" class="ch {{.}}" style="--i: {{$i}}"></i>
        <b class="axle"></b>
      </div>
      <div class="info">
        <span class="name">{{name}}</span>
        <span class="spare">{{reserve}} in the belt</span>
        <span class="warn" data-if="reloading">loading…</span>
        <span class="warn empty" data-if="empty">press R to load</span>
      </div>
    </div>
    <div class="gun tube" data-if="rifle">
      <div class="rounds"><i data-each="chambers" class="rd {{.}}"></i></div>
      <div class="info">
        <span class="name">{{name}}</span>
        <span class="spare">{{reserve}} in the belt</span>
        <span class="warn" data-if="reloading">loading…</span>
        <span class="warn empty" data-if="empty">press R to load</span>
      </div>
    </div>`,
  css: `
    :scope { margin: 0 6px 6px 0; }
    .gun { display: flex; align-items: center; gap: 14px; flex-direction: row-reverse; }
    .drum {
      position: relative; width: 96px; height: 96px; border-radius: 50%;
      background: radial-gradient(circle at 38% 32%, #8b8f96, #3b3e44 58%, #1c1d21 72%);
      box-shadow: 0 0 0 3px var(--hud-ink, #2b1a0e), 4px 5px 0 3px rgba(0, 0, 0, 0.35);
      transform: rotate(calc(var(--turn) * 60deg));
      transition: transform 140ms cubic-bezier(0.3, 1.6, 0.5, 1);
    }
    .ch {
      position: absolute; left: 50%; top: 50%; width: 24px; height: 24px; margin: -12px 0 0 -12px; border-radius: 50%;
      transform: rotate(calc(var(--i) * -60deg)) translateY(-29px);
      box-shadow: inset 0 0 0 2px #121214;
    }
    .ch.full { background: radial-gradient(circle at 45% 40%, #f6dc8c 0 22%, #c8902e 23% 52%, #7a5418 53% 70%, #121214 71%); }
    .ch.empty { background: radial-gradient(circle, #050505 0 58%, #2a2b30 59%); }
    .axle { position: absolute; left: 50%; top: 50%; width: 16px; height: 16px; margin: -8px; border-radius: 50%; background: #1a1b1f; box-shadow: inset 0 0 0 3px #5c6068; }
    .rounds { display: flex; gap: 4px; align-items: flex-end; padding: 8px 10px; background: var(--hud-paper, #eadab4); border: 3px solid var(--hud-ink, #2b1a0e); border-radius: 3px; }
    .rd { width: 10px; height: 34px; border-radius: 5px 5px 1px 1px; }
    .rd.full { background: linear-gradient(#e7c56b 0 38%, #b07c26 38% 100%); box-shadow: inset -2px 0 0 rgba(0,0,0,0.25); }
    .rd.empty { background: rgba(43, 26, 14, 0.18); box-shadow: inset 0 0 0 1px rgba(43, 26, 14, 0.4); }
    .info { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; text-shadow: 2px 2px 0 var(--hud-ink, #2b1a0e); color: #f4e6c4; }
    .name { font: 22px var(--pixel); letter-spacing: 0.04em; }
    .spare { font: 700 13px var(--sans); opacity: 0.9; }
    .warn { font: 700 13px var(--sans); color: #ffd27a; text-transform: uppercase; letter-spacing: 0.08em; }
    .warn.empty { color: #ff8a6a; animation: blink 0.7s steps(2) infinite; }
    @keyframes blink { 50% { opacity: 0.25; } }`,
};

export const WANTED: WidgetDefinition = {
  at: 'top-right',
  html: `
    <div class="poster" data-if="name">
      <div class="hd">WANTED</div>
      <div class="sub">dead or alive</div>
      <div class="face" style="--hat: {{hat}}; --shirt: {{shirt}}; --skin: {{skin}}"><i class="crown"></i><i class="brim"></i><i class="head"></i><i class="body"></i></div>
      <div class="who">{{name}}</div>
      <div class="price">\${{bounty}}</div>
      <div class="note">{{note}}</div>
    </div>
    <div class="mine" data-if="mine > 0">Price on your head <b>\${{mine}}</b></div>`,
  css: `
    :scope { margin: 12px 4px 0 0; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
    .poster {
      width: 150px; padding: 8px 10px 10px; text-align: center; color: var(--hud-ink, #2b1a0e);
      background: radial-gradient(ellipse at 50% 40%, #f1e2bd 0 55%, #d9c08c 100%);
      border: 2px solid #8a6a3d; box-shadow: 4px 5px 0 rgba(0, 0, 0, 0.35); transform: rotate(1.5deg);
      animation: nail 420ms cubic-bezier(0.3, 1.7, 0.5, 1);
    }
    .hd { font: 30px/1 var(--pixel); letter-spacing: 0.06em; }
    .sub { font: 700 10px var(--sans); text-transform: uppercase; letter-spacing: 0.3em; margin: 2px 0 6px; }
    .face { position: relative; height: 70px; margin: 0 10px; background: #c9ad78; border: 2px solid var(--hud-ink, #2b1a0e); overflow: hidden; filter: sepia(0.55); }
    .face i { position: absolute; left: 50%; display: block; }
    .crown { width: 36px; height: 16px; top: 4px; margin-left: -18px; background: var(--hat); border-radius: 8px 8px 0 0; }
    .brim { width: 66px; height: 6px; top: 19px; margin-left: -33px; background: var(--hat); border-radius: 3px; }
    .head { width: 30px; height: 28px; top: 24px; margin-left: -15px; background: var(--skin); }
    .body { width: 76px; height: 30px; top: 52px; margin-left: -38px; background: var(--shirt); border-radius: 10px 10px 0 0; }
    .who { font: 700 16px var(--sans); margin-top: 6px; text-transform: uppercase; }
    .price { font: 28px/1.1 var(--pixel); color: var(--hud-danger, #8e1b12); }
    .note { font: italic 11px var(--sans); opacity: 0.8; }
    .mine { font: 700 12px var(--sans); color: #f4e6c4; text-shadow: 2px 2px 0 var(--hud-ink, #2b1a0e); }
    .mine b { font: 18px var(--pixel); color: #ffd27a; }
    @keyframes nail { from { transform: rotate(-8deg) scale(1.3); opacity: 0; } }`,
};

export const DUEL: WidgetDefinition = {
  at: 'center',
  html: `
    <div class="card {{phase}}" data-if="phase">
      <div class="round">Round {{round}} · first to {{target}}</div>
      <div class="title">{{title}}</div>
      <div class="clock" data-if="phase == 'standoff'" style="--t: {{count}}"><i class="hand"></i><i class="noon"></i><b>{{count}}</b></div>
      <div class="sub">{{sub}}</div>
      <div class="tally" data-if="phase != 'standoff'">
        <span data-each="tally" class="t {{cls}}">{{name}} <i data-each="wins" class="w"></i></span>
      </div>
    </div>`,
  css: `
    :scope { margin-top: -120px; }
    .card { display: flex; flex-direction: column; align-items: center; gap: 6px; color: #f4e6c4; text-shadow: 3px 3px 0 var(--hud-ink, #2b1a0e); animation: slam 380ms cubic-bezier(0.3, 1.6, 0.5, 1); }
    .round { font: 700 14px var(--sans); text-transform: uppercase; letter-spacing: 0.3em; }
    .title { font: 72px/1 var(--pixel); letter-spacing: 0.04em; }
    .draw .title { color: #ffd27a; font-size: 110px; }
    .over .title { font-size: 54px; }
    .sub { font: 700 16px var(--sans); }
    .clock { position: relative; width: 92px; height: 92px; border-radius: 50%; background: radial-gradient(circle, #f1e2bd 0 60%, #b8955a 61% 66%, var(--hud-ink, #2b1a0e) 67%); box-shadow: 4px 5px 0 rgba(0, 0, 0, 0.4); text-shadow: none; }
    .clock b { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font: 40px var(--pixel); color: var(--hud-ink, #2b1a0e); }
    .clock i { position: absolute; left: 50%; bottom: 50%; width: 4px; margin-left: -2px; transform-origin: 50% 100%; background: var(--hud-danger, #8e1b12); border-radius: 2px; }
    .hand { height: 36px; transform: rotate(calc(var(--t) * -30deg)); transition: transform 300ms cubic-bezier(0.3, 1.8, 0.5, 1); }
    .noon { height: 26px; background: var(--hud-ink, #2b1a0e) !important; opacity: 0.6; }
    .tally { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 14px; max-width: 620px; margin-top: 6px; }
    .t { font: 700 14px var(--sans); display: flex; align-items: center; gap: 3px; }
    .t.lead { color: #ffd27a; }
    .t.me { text-decoration: underline; }
    .w { width: 10px; height: 10px; background: #ffd27a; clip-path: polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%); }
    @keyframes slam { from { transform: scale(1.8); opacity: 0; } }`,
};

export const ROUNDBAR: WidgetDefinition = {
  at: 'top',
  html: `
    <div class="bar" data-if="round > 0">
      <span class="r">Round {{round}}</span>
      <span class="alive"><i data-each="alive" class="p {{.}}"></i></span>
      <span class="clock {{hurry}}">{{time}}</span>
    </div>`,
  css: `
    :scope { margin-top: 10px; }
    .bar { display: flex; align-items: center; gap: 12px; padding: 4px 14px; background: var(--hud-paper, #eadab4); color: var(--hud-ink, #2b1a0e); border: 2px solid var(--hud-ink, #2b1a0e); border-radius: 2px; box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.35); }
    .r { font: 18px var(--pixel); }
    .alive { display: flex; gap: 4px; }
    .p { width: 12px; height: 16px; background: var(--hud-ink, #2b1a0e); clip-path: polygon(20% 0, 80% 0, 80% 30%, 100% 30%, 100% 42%, 70% 42%, 70% 100%, 30% 100%, 30% 42%, 0 42%, 0 30%, 20% 30%); }
    .p.me { background: #b07c26; }
    .p.dead { opacity: 0.2; }
    .clock { font: 700 16px var(--sans); font-variant-numeric: tabular-nums; min-width: 42px; text-align: right; }
    .clock.hurry { color: var(--hud-danger, #8e1b12); }`,
};

export const OUTFITS: WidgetDefinition = {
  at: 'center',
  modal: true,
  html: `
    <div class="picker">
      <div class="hd">Choose your gunslinger</div>
      <div class="row">
        <button data-each="outfits" data-action="pick" data-value="{{id}}" class="pick {{on}}" style="--hat: {{hat}}; --shirt: {{shirt}}; --pants: {{pants}}; --skin: {{skin}}">
          <span class="fig"><i class="crown"></i><i class="brim"></i><i class="head"></i><i class="torso"></i><i class="legs"></i></span>
          <b>{{name}}</b>
        </button>
      </div>
      <div class="foot">Your looks only: every gunslinger shoots the same. O to change again.</div>
    </div>`,
  css: `
    .picker { padding: 16px 20px; background: var(--hud-paper, #eadab4); color: var(--hud-ink, #2b1a0e); border: 3px solid var(--hud-ink, #2b1a0e); box-shadow: 6px 7px 0 rgba(0, 0, 0, 0.45); }
    .hd { font: 34px var(--pixel); text-align: center; margin-bottom: 12px; }
    .row { display: flex; gap: 10px; }
    .pick { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 104px; padding: 10px 6px; background: rgba(43, 26, 14, 0.07); border: 2px solid var(--hud-ink, #2b1a0e); color: inherit; font: 700 12px var(--sans); cursor: pointer; }
    .pick:hover, .pick:focus-visible, .pick.on { background: #d9b060; }
    .fig { position: relative; width: 60px; height: 96px; }
    .fig i { position: absolute; left: 50%; display: block; }
    .crown { width: 22px; height: 12px; top: 2px; margin-left: -11px; background: var(--hat); border-radius: 6px 6px 0 0; }
    .brim { width: 44px; height: 5px; top: 13px; margin-left: -22px; background: var(--hat); }
    .head { width: 18px; height: 18px; top: 18px; margin-left: -9px; background: var(--skin); }
    .torso { width: 30px; height: 30px; top: 36px; margin-left: -15px; background: var(--shirt); }
    .legs { width: 24px; height: 30px; top: 66px; margin-left: -12px; background: var(--pants); }
    .foot { font: italic 12px var(--sans); text-align: center; margin-top: 10px; opacity: 0.8; }`,
};
