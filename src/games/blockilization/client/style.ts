/**
 * The interface's look: frosted dark glass panels with soft edges and shadows, one clean typeface
 * (Inter) at a few weights, a warm gold accent, each yield its own colour, and small motions (cards
 * lift on hover, panels slide in). Every element is the client's own (`ui.ts`, `more.ts`).
 */
export const CSS = `
.cv-root {
  --bg: rgba(13, 19, 27, 0.84); --bg2: rgba(22, 31, 43, 0.92); --line: rgba(255, 255, 255, 0.08); --line2: rgba(255, 255, 255, 0.14);
  --text: #e9eef3; --muted: #8fa1b3; --dim: #5f7286; --gold: #f2c14e; --gold2: #d39a2a; --good: #6fd27a; --bad: #ff6b5e; --blue: #6ab8ff;
  --r: 12px; --r2: 8px; --shadow: 0 12px 32px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.3);
  position: fixed; inset: 0; pointer-events: none; color: var(--text);
  /* (Its own lengths and size are what its sheets ask about: it's drawn larger or smaller as a whole, ui.ts applyLook.) */
  container-type: size;
  font: 500 13px/1.4 'Inter', var(--sans, system-ui), sans-serif; letter-spacing: -0.005em; -webkit-font-smoothing: antialiased;
}
.cv-root * { box-sizing: border-box; }
.cv-root button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; }
.cv-root img { display: block; }
.cv-i { display: inline-flex; align-items: center; justify-content: center; flex: none; }
.cv-i svg, .cv-em svg { display: block; }
.cv-em { display: inline-flex; flex: none; filter: drop-shadow(0 2px 3px rgba(0,0,0,.4)); }

/* Panels and controls */
.cv-panel { pointer-events: auto; background: var(--bg); border: 1px solid var(--line); border-radius: var(--r); box-shadow: var(--shadow); backdrop-filter: blur(14px) saturate(1.2); -webkit-backdrop-filter: blur(14px) saturate(1.2); }
.cv-in { animation: cvIn 0.22s cubic-bezier(.2,.8,.2,1); }
@keyframes cvIn { from { opacity: 0; transform: translateY(8px) scale(.985); } }
@keyframes cvSlide { from { opacity: 0; transform: translateX(16px); } }
@keyframes cvPop { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.92); } 100% { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
.cv-h { font-weight: 700; font-size: 15px; letter-spacing: -0.01em; }
.cv-h.big { font-size: 20px; }
.cv-label { font-size: 10.5px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: var(--muted); }
.cv-muted { color: var(--muted); } .cv-dim { color: var(--dim); }
.cv-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 12px; border-radius: var(--r2); background: rgba(255,255,255,0.07); border: 1px solid var(--line) !important; font-weight: 600; transition: background .15s, border-color .15s, transform .1s; white-space: nowrap; }
.cv-btn:hover { background: rgba(255,255,255,0.13); }
.cv-btn:active { transform: translateY(1px); }
.cv-btn:disabled { opacity: 0.4; cursor: default; background: rgba(255,255,255,0.05); }
.cv-btn.gold { background: linear-gradient(180deg, #f6cf62, #dca23a); color: #1b1407; box-shadow: 0 4px 14px rgba(242,193,78,.25); }
.cv-btn.gold:hover { background: linear-gradient(180deg, #ffdb78, #e6ad44); }
.cv-btn.danger { background: rgba(255,107,94,.16); color: #ffc2bb; }
.cv-btn.small { padding: 4px 9px; font-size: 12px; border-radius: 7px; }
.cv-x { position: absolute; top: 12px; right: 12px; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.07) !important; color: var(--muted) !important; z-index: 2; }
.cv-x:hover { background: rgba(255,255,255,0.15) !important; color: var(--text) !important; }
.cv-bar { height: 6px; border-radius: 4px; background: rgba(255,255,255,0.08); overflow: hidden; }
.cv-bar i { display: block; height: 100%; border-radius: 4px; background: linear-gradient(90deg, #4a9ae8, #7fc4ff); transition: width .3s; }
.cv-bar.gold i { background: linear-gradient(90deg, #d39a2a, #f6cf62); }
.cv-bar.green i, .cv-bar.food i { background: linear-gradient(90deg, #3fa45a, #7bd16a); }
.cv-bar.orange i { background: linear-gradient(90deg, #d2782a, #f0a24a); }
.cv-bar.red i { background: linear-gradient(90deg, #c8432f, #ff7a5e); }
.cv-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 99px; background: rgba(255,255,255,0.07); border: 1px solid var(--line); font-size: 12px; font-weight: 600; }
.cv-chip.on { background: rgba(242,193,78,.16); border-color: rgba(242,193,78,.55); color: #ffe3a1; }
.cv-chip.good { background: rgba(111,210,122,.14); border-color: rgba(111,210,122,.4); color: #b9f0c0; }
.cv-chip.bad { background: rgba(255,107,94,.14); border-color: rgba(255,107,94,.4); color: #ffc2bb; }
.cv-tile { display: inline-flex; align-items: center; justify-content: center; flex: none; border-radius: 10px; box-shadow: inset 0 1px 0 rgba(255,255,255,.18), 0 2px 6px rgba(0,0,0,.3); }
.cv-pic { flex: none; border-radius: 10px; background: radial-gradient(circle at 50% 35%, rgba(255,255,255,.13), rgba(255,255,255,.02) 70%); display: flex; align-items: center; justify-content: center; overflow: hidden; }
.cv-pic img { width: 100%; height: 100%; object-fit: contain; }
.cv-scroll { overflow-y: auto; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.18) transparent; }
.cv-scroll::-webkit-scrollbar { width: 8px; height: 8px; } .cv-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,.16); border-radius: 8px; }
.cv-row { display: flex; align-items: center; gap: 8px; }
.cv-grow { flex: 1; min-width: 0; }
.cv-input { width: 100%; padding: 8px 10px; background: rgba(0,0,0,.25); color: var(--text); border: 1px solid var(--line2); border-radius: var(--r2); font: inherit; pointer-events: auto; }
.cv-input:focus { outline: none; border-color: rgba(242,193,78,.6); }
select.cv-input { width: auto; flex: 1; }

/* Yields */
.y-food { color: #7bd16a; } .y-prod { color: #f0a24a; } .y-gold { color: #f6cf4a; } .y-science { color: #6ab8ff; } .y-culture { color: #d68ae8; } .y-faith { color: #e8e2d0; } .y-happy { color: #a8e86a; } .y-sad { color: #ff7a6a; } .y-golden { color: #ffb84a; } .y-tourism { color: #c88aff; } .y-anarchy { color: #ff7a6a; background: rgba(160,58,42,.25); }

/* Top bar */
.cv-top { position: absolute; top: 8px; left: 8px; right: 8px; height: 46px; display: flex; align-items: center; gap: 2px; padding: 0 6px; }
.cv-top .civ { display: flex; align-items: center; gap: 8px; padding-right: 10px; margin-right: 4px; border-right: 1px solid var(--line); }
.cv-top .civ b { font-size: 13px; white-space: nowrap; }
.cv-stat { display: inline-flex; align-items: center; gap: 5px; padding: 5px 7px; border-radius: 8px; font-weight: 700; font-size: 13px; white-space: nowrap; font-variant-numeric: tabular-nums; cursor: default; }
.cv-stat:hover { background: rgba(255,255,255,.06); }
.cv-stat small { font-weight: 600; font-size: 11.5px; opacity: .72; }
.cv-top .spacer { flex: 1; }
.cv-top .when { display: flex; flex-direction: column; align-items: flex-end; padding: 0 10px; border-right: 1px solid var(--line); margin-right: 4px; line-height: 1.15; }
.cv-top .when b { font-size: 12.5px; white-space: nowrap; } .cv-top .when small { font-size: 11px; color: var(--muted); white-space: nowrap; }
.cv-top .menu { display: flex; gap: 2px; }
.cv-takeover { position: absolute; top: calc(100% + 6px); left: 120px; display: flex; flex-direction: column; gap: 4px; padding: 8px; min-width: 300px; z-index: 5; }
.cv-takeover .cv-btn { display: flex; align-items: center; gap: 8px; text-align: left; }
.cv-top .menu button { width: 34px; height: 34px; border-radius: 9px; display: flex; align-items: center; justify-content: center; color: var(--muted); position: relative; }
.cv-top .menu button:hover { background: rgba(255,255,255,.1); color: var(--text); }
.cv-top .menu button.on { background: rgba(242,193,78,.14); color: var(--gold); }
.cv-top .menu button .dot { position: absolute; top: 5px; right: 5px; width: 7px; height: 7px; border-radius: 50%; background: var(--gold); box-shadow: 0 0 0 2px #121a24; }
/* (What leaves the top bar for the menu on a small screen, or when the bar's too full: the menu's items for it, and its dot for them, only then.) */
.mn-item.fold, .cv-top .menu button.folds .dot { display: none; }
.cv-root.top-fold .cv-top .menu button.fold, .cv-root.top-fold .cv-top .menu .sep { display: none; }
.cv-root.top-fold .mn-item.fold { display: flex; } .cv-root.top-fold .cv-top .menu button.folds .dot { display: block; }
.cv-root.top-tight .cv-stat { padding: 5px 4px; gap: 4px; }
.cv-root.top-terse .cv-stat small { display: none; }

/* Research */
.cv-research { position: absolute; top: 62px; left: 8px; width: 276px; padding: 9px 10px; display: flex; align-items: center; gap: 10px; cursor: pointer; transition: transform .15s; }
.cv-research:hover { transform: translateY(-1px); }
.cv-research .name { font-weight: 700; }
.cv-research .cv-bar { margin: 5px 0 3px; }

/* Notifications */
.cv-notes { position: absolute; right: 8px; top: 62px; width: 290px; display: flex; flex-direction: column; gap: 6px; max-height: calc(100vh - 330px); overflow: hidden; }
.cv-note { pointer-events: auto; display: flex; align-items: center; gap: 9px; padding: 7px 10px 7px 7px; border-radius: 11px; background: var(--bg); border: 1px solid var(--line); box-shadow: 0 6px 16px rgba(0,0,0,.35); backdrop-filter: blur(12px); cursor: pointer; animation: cvSlide 0.25s ease-out; font-size: 12.5px; line-height: 1.3; }
.cv-note:hover { border-color: var(--line2); }
.cv-note .ico { width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex: none; }

/* End turn + minimap */
.cv-corner { position: absolute; right: 8px; bottom: 8px; width: 276px; display: flex; flex-direction: column; gap: 8px; align-items: stretch; }
.cv-minimap { height: 150px; padding: 5px; overflow: hidden; position: relative; }
.cv-minimap canvas { width: 100%; height: 100%; display: block; border-radius: 8px; cursor: pointer; }
.cv-endturn { pointer-events: auto; display: flex !important; align-items: center; gap: 10px; padding: 11px 14px !important; border-radius: var(--r) !important; text-align: left; box-shadow: var(--shadow); transition: transform .12s, filter .12s; }
.cv-endturn:hover { filter: brightness(1.07); }
.cv-endturn:active { transform: translateY(1px); }
.cv-endturn .t { font-weight: 800; font-size: 15px; letter-spacing: .01em; }
.cv-endturn small { display: block; font-size: 11.5px; font-weight: 600; opacity: .78; margin-top: 1px; }
.cv-endturn.gold { background: linear-gradient(180deg, #f6cf62, #dca23a) !important; color: #1b1407 !important; }
.cv-endturn.need { background: linear-gradient(180deg, #4a90e2, #2f6fc0) !important; color: #fff !important; }
.cv-endturn.hurry { animation: cvHurry 1s ease-in-out infinite; }
@keyframes cvHurry { 50% { box-shadow: var(--shadow), 0 0 0 3px rgba(255,107,94,.75); } }
.cv-roster { display: flex; flex-wrap: wrap; gap: 6px; padding: 7px 9px; }
.cv-roster span { position: relative; opacity: .45; transition: opacity .2s; }
.cv-roster span.done { opacity: 1; }
.cv-roster .who { display: flex; align-items: center; gap: 5px; min-width: 0; opacity: .6; }
.cv-roster .who.done { opacity: 1; } .cv-roster .who.away { opacity: .35; } .cv-roster .who span { opacity: 1; }
.cv-roster .who b { max-width: 84px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .cv-roster .who small { color: var(--muted); }
.cv-roster i { position: absolute; right: -4px; bottom: -3px; width: 13px; height: 13px; border-radius: 50%; background: #3f8f4f; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 0 2px rgba(13,19,27,.9); }
.cv-count { margin-left: auto; padding: 1px 6px; border-radius: 8px; background: rgba(255,255,255,.1); font-size: 11px; font-weight: 800; }
.cv-confirm { position: absolute; inset: 0; pointer-events: auto; background: rgba(5,8,12,.45); display: flex; align-items: center; justify-content: center; animation: cvFade .15s; z-index: 20; }
@keyframes cvFade { from { opacity: 0; } }
.cv-confirm .box { width: min(380px, 92vw); padding: 20px 20px 16px; display: flex; flex-direction: column; gap: 16px; animation: cvIn .2s cubic-bezier(.2,.8,.2,1); }
.cv-confirm .acts { display: flex; justify-content: flex-end; gap: 8px; }
.cv-endrow { display: flex; gap: 6px; align-items: stretch; } .cv-endrow .cv-endturn { flex: 1; min-width: 0; overflow: hidden; }
.cv-endrow .cv-endturn > div { min-width: 0; } .cv-endrow .cv-endturn .t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cv-next { pointer-events: auto; flex-direction: column; gap: 1px !important; padding: 6px 12px !important; border-radius: var(--r) !important; background: var(--bg2) !important; box-shadow: var(--shadow); }
.cv-next b { font-size: 12px; color: #ffe3a1; }
.cv-taphint { pointer-events: none; align-self: center; display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 99px; background: rgba(13,19,27,.9); border: 1px solid rgba(242,193,78,.5); color: #ffe3a1; font-weight: 650; font-size: 12px; animation: cvIn .2s; }
.cv-endturn.wait { background: var(--bg2) !important; color: var(--muted) !important; border: 1px solid var(--line) !important; }

/* Unit panel */
.cv-unit { position: absolute; left: 8px; bottom: 8px; width: 384px; padding: 12px; display: flex; flex-direction: column; gap: 9px; }
.cv-unit .top { display: flex; gap: 12px; align-items: center; padding-right: 30px; }
.cv-unit .cv-ustats { display: flex; flex-wrap: wrap; gap: 4px 12px; color: var(--muted); font-weight: 600; font-size: 12px; margin-top: 4px; }
.cv-unit .cv-ustats span { display: inline-flex; align-items: center; gap: 4px; } .cv-unit .cv-ustats b { color: var(--text); }
.cv-unit .acts { display: flex; flex-wrap: wrap; gap: 5px; }
.cv-unit .hint { color: var(--muted); font-size: 12px; }
.cv-repeat { align-self: flex-start; display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
.cv-blocked { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--muted); opacity: .8; }
.cv-blocked > div { display: flex; align-items: center; gap: 6px; } .cv-blocked b { font-weight: 700; color: var(--text); }
.cv-unit .going { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 700; color: #ffe3a1; }
.cv-unit .going.danger { color: #f0a090; }
.cv-unit .cv-work { display: flex; flex-direction: column; gap: 4px; padding: 7px 9px; border-radius: var(--r2); background: rgba(240,162,74,.1); box-shadow: inset 0 0 0 1px rgba(240,162,74,.3); }
.cv-unit .cv-work .going { color: #ffd9a8; } .cv-unit .cv-work .left { color: var(--text); white-space: nowrap; }
.cv-unit .cv-work small { font-size: 12px; } .cv-unit .cv-work .spent { color: #ffe3a1; }
.cv-btn.on { background: rgba(240,162,74,.18); box-shadow: inset 0 0 0 1px #f0a24a; color: #ffd9a8; cursor: default; }
.cv-unit .arrive { font-size: 12px; font-weight: 700; color: #cfe6ff; } .cv-unit .arrive:empty { display: none; } .cv-unit .arrive.no { color: #ff9a8e; }
.cv-promos { display: flex; flex-direction: column; gap: 5px; padding: 8px; border-radius: 10px; background: rgba(242,193,78,.1); border: 1px solid rgba(242,193,78,.3); }
.cv-promo { display: block; text-align: left; padding: 6px 9px; border-radius: 8px; background: rgba(242,193,78,.12); border: 1px solid rgba(242,193,78,.35) !important; transition: background .12s; }
.cv-promo:hover { background: rgba(242,193,78,.24); }
.cv-promo b { color: #ffe3a1; font-size: 12.5px; } .cv-promo small { display: block; color: var(--muted); font-size: 11.5px; }
.cv-proms { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
.cv-proms div { display: flex; align-items: center; gap: 6px; } .cv-proms b { white-space: nowrap; }
.cv-defence { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; font-size: 12px; color: var(--muted); }
.cv-defence b { color: var(--text); }
.cv-mod { padding: 1px 7px; border-radius: 99px; font-size: 11px; font-weight: 700; background: rgba(255,255,255,.06); }
.cv-mod.up { color: #9fe3a8; background: rgba(111,210,122,.12); } .cv-mod.down { color: #ffaaa0; background: rgba(255,107,94,.12); }
.cv-btn.icon { padding: 4px 6px; }

/* City screen */
.cv-city { position: absolute; right: 8px; top: 62px; bottom: 8px; width: 384px; display: flex; flex-direction: column; overflow: hidden; }
.cv-city .head { padding: 14px 14px 12px; display: flex; gap: 12px; align-items: center; border-bottom: 1px solid var(--line); }
.cv-city .pop { width: 42px; height: 42px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 17px; background: rgba(0,0,0,.3); border: 2px solid; flex: none; }
.cv-city .body { flex: 1; padding: 10px 14px 14px; display: flex; flex-direction: column; gap: 8px; }
.cv-city .summary { padding: 10px 14px 6px; display: flex; flex-direction: column; gap: 7px; }
.cv-yields { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.cv-yields > div { position: relative; display: flex; align-items: center; gap: 6px; padding: 6px 9px; border-radius: 9px; background: rgba(255,255,255,.05); font-weight: 700; font-variant-numeric: tabular-nums; cursor: default; }
.cv-yields > div:hover { background: rgba(255,255,255,.1); }
.cv-yields small { color: var(--muted); font-weight: 600; font-size: 11px; margin-left: auto; }
.cv-yields .bd { display: none; position: absolute; top: calc(100% + 6px); left: 0; z-index: 8; width: 236px; padding: 9px 11px; flex-direction: column; gap: 3px; background: rgba(10,15,22,.97); border: 1px solid var(--line2); border-radius: 10px; box-shadow: var(--shadow); font-weight: 600; font-size: 12px; }
.cv-yields > div:nth-child(3n) .bd { left: auto; right: 0; }
.cv-yields > div:hover .bd { display: flex; }
.cv-yields .bd .ln { display: flex; justify-content: space-between; gap: 10px; color: var(--muted); }
.cv-yields .bd .ln b { color: #b9f0c0; } .cv-yields .bd .ln b.neg { color: #ffaaa0; }
.cv-yields .bd .ln.total { border-top: 1px solid var(--line); padding-top: 4px; margin-top: 2px; color: var(--text); }
.cv-prog { display: flex; align-items: center; gap: 9px; }
.cv-prog .l { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; font-weight: 700; margin-bottom: 3px; }
.cv-prog .l small { color: var(--muted); font-weight: 600; font-size: 11.5px; text-align: right; }
.cv-bar.purple i { background: linear-gradient(90deg, #9a5ab8, #d68ae8); }
.cv-tabs { display: flex; gap: 4px; padding: 4px 14px 0; border-bottom: 1px solid var(--line); }
.cv-tabs button { display: inline-flex; align-items: center; gap: 6px; padding: 8px 11px; font-weight: 700; font-size: 12.5px; color: var(--muted); border-bottom: 2px solid transparent !important; margin-bottom: -1px; }
.cv-tabs button:hover { color: var(--text); }
.cv-tabs button.on { color: #ffe3a1; border-bottom-color: var(--gold) !important; }
.cv-queue { display: flex; flex-direction: column; gap: 3px; }
.cv-queue .q { display: flex; align-items: center; gap: 7px; padding: 3px 4px 3px 6px; border-radius: 8px; background: rgba(255,255,255,.04); font-weight: 600; font-size: 12.5px; }
.cv-queue .q .cv-pic, .cv-queue .q .cv-tile { border-radius: 7px; }
.cv-opt.on { background: rgba(240,162,74,.1); }
.cv-citizens { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; }
.cv-citizens span { display: inline-flex; align-items: center; gap: 4px; }
.cv-spec { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 10px; background: rgba(255,255,255,.04); }
/* What each focus would make: a row each (the one in place ringed in gold), the yields some focus changes as columns. */
.cv-focus { display: flex; flex-direction: column; gap: 2px; font-variant-numeric: tabular-nums; }
.cv-focus .hd, .cv-focus .row { display: grid; grid-template-columns: minmax(96px, 1.4fr) repeat(calc(var(--cols) + 1), minmax(30px, .5fr)) minmax(78px, 1fr); align-items: center; gap: 4px; padding: 3px 8px; text-align: left; }
.cv-focus .hd { color: var(--muted); font: 400 15px/1 'Jersey 10', monospace; letter-spacing: .06em; text-transform: uppercase; }
.cv-focus .hd > span:not(:first-child), .cv-focus .row > b { text-align: right; justify-self: end; }
.cv-focus .hd > span:last-child, .cv-focus .row > small { text-align: right; justify-self: end; }
.cv-focus .row { background: rgba(255,255,255,.035); box-shadow: inset 0 0 0 2px #11141a; min-height: 30px; }
.cv-focus .row:hover { background: rgba(255,255,255,.08); }
.cv-focus .row.on { background: rgba(242,193,78,.14); box-shadow: inset 0 0 0 2px #f2c14e; }
.cv-focus .nm { display: inline-flex; align-items: center; gap: 5px; font: 400 18px/1 'Jersey 10', monospace; color: #fff; }
.cv-focus .row b { font: 400 18px/1 'Jersey 10', monospace; color: var(--text); }
.cv-focus .row b.neg { color: #ff9a8e; }
.cv-focus .row small { color: var(--muted); font-size: 13px; white-space: nowrap; }
/* Great people a city brings on, and the empire's progress toward each. */
.cv-gp { display: flex; flex-direction: column; gap: 5px; margin-top: 4px; }
.cv-gp .row { display: flex; align-items: center; gap: 8px; }
.cv-gp .l { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 3px; }
.cv-gp .l b { font: 400 18px/1 'Jersey 10', monospace; } .cv-gp .l small { color: var(--muted); font-size: 13px; }
/* A building's great works: each slot a block, filled or waiting. */
.cv-works { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.cv-works .work { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px 2px 4px; background: #3a2c46; box-shadow: inset 0 0 0 2px #07090c; font-size: 13px; color: #f0dcff; }
.cv-works .work.empty { background: transparent; box-shadow: inset 0 0 0 2px #3a4254; color: var(--dim); }
/* A city's faith: its people's religions on a bar, the pressure of each. */
.cv-faith, .cv-croutes { display: flex; flex-direction: column; gap: 5px; margin-top: 6px; }
.cv-faith .l { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cv-faith .l b { font: 400 18px/1 'Jersey 10', monospace; }
.cv-faith .mix { display: flex; height: 12px; background: #0f1218; box-shadow: inset 0 0 0 2px #07090c; padding: 2px; }
.cv-faith .mix i { display: block; height: 100%; }
.cv-faith .press { display: flex; flex-direction: column; gap: 2px; font-size: 14px; }
.cv-faith .press .l { gap: 8px; }
.cv-faith .press .l b { font: 400 17px/1 'Jersey 10', monospace; color: var(--text); }
.cv-faith .press .dot { width: 10px; height: 10px; flex: none; box-shadow: 0 0 0 2px #07090c; }
.cv-faith .press .bar { height: 8px; background: #0f1218; box-shadow: inset 0 0 0 2px #07090c; padding: 2px; }
.cv-faith .press .bar i { display: block; height: 100%; }
.cv-faith .press small { font-size: 13px; }
/* A city's trade routes. */
.cv-croutes .row { display: flex; align-items: center; gap: 8px; padding: 3px 6px; background: rgba(255,255,255,.035); font-size: 14px; }
.cv-croutes .row > span:not(.cv-grow) { display: inline-flex; align-items: center; gap: 3px; font: 400 17px/1 'Jersey 10', monospace; }
.cv-root.cb .cv-focus .row b.neg { color: #ffb870; }
.cv-spec b { display: block; font-size: 12.5px; } .cv-spec small { font-size: 11.5px; }
.cv-spec .slots { display: flex; gap: 4px; }
.cv-spec .slots button { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 1.5px dashed var(--line2) !important; color: var(--dim); transition: background .12s; }
.cv-spec .slots button:hover { background: rgba(255,255,255,.1); color: var(--text); }
.cv-spec .slots button.full { border: 1.5px solid rgba(106,184,255,.7) !important; background: rgba(106,184,255,.18); color: #cfe6ff; }
.cv-spec .slots button.locked { border-color: var(--gold) !important; box-shadow: 0 0 0 2px rgba(242,193,78,.2); }
.cv-bld { display: flex; gap: 10px; align-items: flex-start; padding: 6px 8px; border-radius: 10px; background: rgba(255,255,255,.035); }
.cv-bld b { font-size: 12.5px; } .cv-bld small { display: block; font-size: 11.5px; line-height: 1.35; margin-top: 1px; }
.cv-now { display: flex; gap: 10px; align-items: center; padding: 10px; border-radius: 10px; background: rgba(240,162,74,.08); border: 1px solid rgba(240,162,74,.3); }
.cv-opt { display: flex; align-items: center; gap: 10px; width: 100%; padding: 6px 8px; border-radius: 10px; text-align: left; transition: background .12s; }
.cv-opt:hover { background: rgba(255,255,255,.07); }
.cv-opt .n { font-weight: 650; }
.cv-opt .meta { font-size: 11.5px; color: var(--muted); }
.cv-opt.held { opacity: .55; cursor: default; } .cv-opt.held:hover { background: none; } .cv-opt.held .meta { color: #ffb36b; }
.cv-opt.wonder .n { color: #ffe3a1; }
.cv-buildings { display: flex; flex-wrap: wrap; gap: 4px; }
.cv-buildings span { display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px 3px 4px; border-radius: 7px; background: rgba(255,255,255,.06); font-size: 11.5px; font-weight: 600; }
.cv-alert { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 9px 10px; border-radius: 10px; background: rgba(255,160,80,.1); border: 1px solid rgba(255,160,80,.35); font-size: 12.5px; }

/* Big panels */
.cv-big { position: absolute; inset: 62px 8px 8px 8px; padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; animation: cvIn .22s ease-out; }
.cv-big > .title { display: flex; align-items: center; gap: 12px; padding-right: 40px; }
.cv-policies { flex: 1; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; align-content: start; }
.cv-ptree { padding: 12px; border-radius: 12px; background: rgba(255,255,255,.04); border: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; }
.cv-ptree.locked { opacity: .5; }
.cv-ptree .hd { display: flex; align-items: center; gap: 10px; margin-bottom: 2px; }
.cv-pol { display: block; width: 100%; padding: 7px 9px; border-radius: 9px; background: rgba(255,255,255,.04); border: 1px solid var(--line) !important; text-align: left; transition: background .12s; }
.cv-pol:hover:not(:disabled) { background: rgba(255,255,255,.09); }
.cv-pol b { font-weight: 700; font-size: 12.5px; }
.cv-pol small { display: block; color: var(--muted); font-size: 11.5px; line-height: 1.35; margin-top: 1px; }
.cv-pol.have { background: rgba(242,193,78,.13); border-color: rgba(242,193,78,.45) !important; }
.cv-pol.can { border-color: rgba(106,184,255,.45) !important; }
.cv-pol:disabled { cursor: default; }
.cv-card { padding: 10px; border-radius: 11px; background: rgba(255,255,255,.04); border: 1px solid var(--line); }

/* Dialogs (diplomacy, trade, victory...) */
.cv-diplo { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(640px, 94vw); max-height: 84vh; padding: 18px; display: flex; flex-direction: column; gap: 10px; animation: cvPop .22s ease-out; }
.cv-diplo .list { overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 2px; }
.civrow { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 11px; background: rgba(255,255,255,.04); border: 1px solid var(--line); flex-wrap: wrap; }
.civrow .who { flex: 1; min-width: 140px; }
.civrow .who b { display: block; font-size: 13.5px; }
.civrow .who small { color: var(--muted); }
.civrow.diplomat { border-color: rgba(106,160,220,.45); background: rgba(58,106,154,.12); }
.cv-why { flex-basis: 100%; }
.cv-btn.off { opacity: .45 !important; cursor: default; }
.cv-portrait { width: 52px; height: 52px; border-radius: 12px; overflow: hidden; flex: none; background: linear-gradient(160deg, rgba(255,255,255,.16), rgba(255,255,255,.02)); border: 1px solid var(--line2); }
.cv-portrait img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 30%; transform: scale(1.12); }

/* Lobby */
.cv-lobby { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(940px, 96vw); max-height: 94vh; overflow-y: auto; padding: 22px 26px; animation: cvPop .25s ease-out; }
.cv-lobby .brand { text-align: center; margin-bottom: 14px; }
/* The world being made (ui.ts renderBuilding): the cover, the bar, the kind of world, a tip. */
.cv-building { width: min(560px, 94vw); padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.cv-building .bd-art { position: relative; height: 210px; overflow: hidden; }
.cv-building .bd-art img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 40%; }
.cv-building .bd-art h1 { position: absolute; left: 14px; bottom: 8px; }
.cv-building .bd-what { display: flex; justify-content: space-between; align-items: baseline; }
.cv-building .cv-progress { margin-top: 0; }
.cv-building .bd-world { color: var(--muted); font-size: 12.5px; }
.cv-building .bd-tip { display: flex; gap: 10px; align-items: center; padding: 8px 10px; background: rgba(255,255,255,.04); }
.cv-lobby h1 { margin: 0; font-weight: 800; font-size: 34px; letter-spacing: -0.02em; background: linear-gradient(180deg, #ffe7a3, #e2a840); -webkit-background-clip: text; background-clip: text; color: transparent; }
.cv-lobby .tag { color: var(--muted); margin-top: 2px; }
.cv-lobby .sect { margin: 16px 0 8px; }
.cv-lobby .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin: 7px 0; }
.cv-lobby .row > label { width: 108px; color: var(--muted); font-weight: 600; font-size: 12.5px; }
.cv-lobby .chip { padding: 5px 12px; border-radius: 99px; background: rgba(255,255,255,.06); border: 1px solid var(--line) !important; font-weight: 600; font-size: 12.5px; transition: background .12s; }
.cv-lobby .chip:hover:not(:disabled) { background: rgba(255,255,255,.12); }
.cv-lobby .chip.on { background: rgba(242,193,78,.16); border-color: rgba(242,193,78,.6) !important; color: #ffe3a1; }
.cv-lobby .chip:disabled { opacity: .45; cursor: default; }
.cv-civs { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; }
.cv-civ { display: flex; gap: 10px; align-items: center; padding: 8px; text-align: left; border-radius: 12px; background: rgba(255,255,255,.04); border: 1px solid var(--line) !important; transition: transform .12s, background .12s; position: relative; overflow: hidden; }
.cv-civ:hover { transform: translateY(-2px); background: rgba(255,255,255,.08); }
.cv-civ.on { border-color: var(--gold) !important; background: rgba(242,193,78,.12); box-shadow: 0 0 0 3px rgba(242,193,78,.14); }
.cv-civ.taken { opacity: .38; }
.cv-civ .txt { min-width: 0; } .cv-civ .txt b { display: block; font-size: 13.5px; } .cv-civ .txt small { display: block; color: var(--muted); font-size: 11.5px; line-height: 1.3; }
.cv-civ .em { position: absolute; right: 6px; top: 6px; }
.cv-seats { display: flex; flex-wrap: wrap; gap: 6px; }
.cv-seat { display: flex; align-items: center; gap: 7px; padding: 4px 10px 4px 4px; border-radius: 99px; background: rgba(255,255,255,.05); border: 1px solid var(--line); font-weight: 600; }
.cv-progress { height: 8px; border-radius: 6px; background: rgba(255,255,255,.08); overflow: hidden; margin-top: 14px; }
.cv-progress i { display: block; height: 100%; background: linear-gradient(90deg, #d39a2a, #f6cf62); transition: width .3s; }

/* Tooltip, toast, splash, advisor */
.cv-tip { position: absolute; padding: 8px 10px; background: rgba(10,15,22,.95); border: 1px solid var(--line2); border-radius: 10px; pointer-events: none; font-size: 12px; max-width: 280px; z-index: 5; box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 3px; }
.cv-tip b { font-size: 12.5px; }
.cv-tip .ln { display: flex; align-items: center; gap: 5px; color: var(--muted); }
.cv-tip .ln.yl { gap: 9px; font-weight: 800; color: var(--text); } .cv-tip .ln.yl span { display: inline-flex; align-items: center; gap: 3px; }
.cv-tip .ln.way { color: #cfe6ff; font-weight: 700; } .cv-tip .ln.way.no { color: #ff9a8e; }

/* Combat preview */
.cv-preview { position: absolute; left: 50%; bottom: 8px; transform: translateX(-50%); width: min(500px, calc(100vw - 700px)); min-width: 340px; padding: 11px 13px 12px; display: flex; flex-direction: column; gap: 8px; pointer-events: none; animation: cvIn .15s; border-color: rgba(255,90,74,.35); }
.cv-preview.slim { flex-direction: row; align-items: center; gap: 8px; width: auto; min-width: 0; font-size: 12.5px; }
.cv-preview .sides { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items: start; }
.cv-preview .vs { align-self: center; font-weight: 800; font-size: 12px; color: var(--dim); letter-spacing: .08em; text-transform: uppercase; padding-top: 12px; }
.cv-preview .side { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.cv-preview .who { display: flex; align-items: center; gap: 6px; font-size: 13px; } .cv-preview .who b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cv-preview .str { display: flex; align-items: center; gap: 6px; } .cv-preview .str b { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.cv-preview .hpbar { display: flex; height: 7px; border-radius: 4px; background: rgba(255,255,255,.08); overflow: hidden; }
.cv-preview .hpbar i { display: block; height: 100%; }
.cv-preview .hpbar .keep { background: linear-gradient(90deg, #3fa45a, #7bd16a); }
.cv-preview .hpbar .maybe { background: repeating-linear-gradient(135deg, #f0a24a 0 4px, #b8742a 4px 8px); }
.cv-preview .hpbar .lose { background: #c8432f; }
.cv-preview .dmg { font-size: 11.5px; color: var(--muted); font-weight: 600; }
.cv-preview .mods { display: flex; flex-direction: column; gap: 1px; font-size: 11.5px; color: var(--muted); margin-top: 2px; }
.cv-preview .mods div { display: flex; gap: 6px; } .cv-preview .mods b { min-width: 38px; text-align: right; font-variant-numeric: tabular-nums; }
.cv-preview .mods b.up { color: #9fe3a8; } .cv-preview .mods b.down { color: #ffaaa0; } .cv-preview .mods b.flat { color: var(--dim); }
.cv-preview .verdict { display: flex; align-items: center; justify-content: center; gap: 7px; padding: 7px 10px; border-radius: 9px; font-weight: 800; font-size: 13.5px; }
.cv-preview .verdict.good { background: rgba(111,210,122,.14); color: #b9f0c0; }
.cv-preview .verdict.bad { background: rgba(255,107,94,.15); color: #ffc2bb; }
.cv-preview .verdict.even { background: rgba(242,193,78,.13); color: #ffe3a1; }
.cv-preview .blocked { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #ffcf9a; justify-content: center; }

/* Ideologies */
.cv-ideo { grid-column: 1 / -1; padding: 12px; border-radius: 12px; background: linear-gradient(160deg, rgba(106,74,138,.18), rgba(255,255,255,.03)); border: 1px solid rgba(160,120,210,.35); display: flex; flex-direction: column; gap: 10px; }
.cv-ideo .hd { display: flex; align-items: center; gap: 10px; }
.cv-alert.rev { background: rgba(160,58,42,.14); border-color: rgba(255,122,106,.45); flex-wrap: nowrap; }
.cv-alert.rev .cv-grow { display: flex; flex-direction: column; gap: 3px; }
.cv-alert.rev small { font-size: 13px; line-height: 1.35; }
.cv-pol .free { margin-left: 6px; padding: 0 5px; font-size: 13px; }
.cv-ideo .choices { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.cv-ideo .choices .cv-ptree { gap: 3px; }
.cv-ideo .tenet { padding: 2px 8px; font-size: 11.5px; line-height: 1.35; }
.cv-ideo .tenet b { font-size: 12px; } .cv-ideo .tenet small { color: var(--muted); font-size: 11px; }
.cv-ideo .levels { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.cv-ideo .level { display: flex; flex-direction: column; gap: 6px; }
.cv-toast { position: absolute; left: 50%; top: 66px; transform: translateX(-50%); padding: 9px 14px; display: flex; align-items: center; gap: 8px; background: rgba(60,20,16,.94); border: 1px solid rgba(255,107,94,.5); border-radius: 10px; pointer-events: none; animation: cvIn .2s; box-shadow: var(--shadow); font-weight: 600; }
.cv-splash { position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%); width: min(440px, 92vw); padding: 22px 24px 18px; text-align: center; animation: cvPop .32s cubic-bezier(.2,.9,.3,1.2); background: linear-gradient(180deg, rgba(30,40,54,.96), rgba(14,20,28,.96)); border-color: rgba(242,193,78,.45); cursor: pointer; box-shadow: var(--shadow), 0 0 50px rgba(242,193,78,.18); }
.cv-splash .kick { font-size: 11px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--gold); }
.cv-splash .art { width: 132px; height: 132px; margin: 10px auto 8px; border-radius: 24px; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at 50% 42%, rgba(242,193,78,.28), rgba(242,193,78,0) 70%); }
.cv-splash .art img { width: 124px; height: 124px; }
.cv-splash h2 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.01em; }
.cv-splash p { margin: 6px 0 0; color: var(--muted); }
.cv-splash small { display: block; margin-top: 12px; color: var(--dim); font-size: 11px; }
.cv-advisor { position: absolute; left: 50%; bottom: 8px; transform: translateX(-50%); width: min(470px, calc(100vw - 690px)); min-width: 280px; padding: 11px 12px; display: flex; gap: 11px; align-items: flex-start; animation: cvIn .3s; border-color: rgba(106,184,255,.35); }
.cv-advisor .face { width: 38px; height: 38px; border-radius: 11px; background: linear-gradient(160deg, #4a90e2, #2f5fa0); display: flex; align-items: center; justify-content: center; flex: none; color: #fff; }
.cv-advisor b { display: block; margin-bottom: 2px; }
.cv-advisor .acts { display: flex; gap: 6px; margin-top: 8px; }

/* Game over */
.cv-over { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(780px, 96vw); max-height: 92vh; overflow-y: auto; padding: 22px 24px; animation: cvPop .3s ease-out; display: flex; flex-direction: column; gap: 14px; }
.cv-over .hero { display: flex; gap: 16px; align-items: center; }
.cv-over .ov-art { display: flex; gap: 8px; flex: none; }
.cv-over .ov-facts { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.cv-over .ov-facts > div { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 8px; align-items: center; padding: 7px 10px; }
.cv-over .ov-facts .cv-i { grid-row: span 2; }
.cv-over .ov-facts small { color: var(--muted); }
.cv-over .ov-standings { display: flex; flex-direction: column; gap: 4px; }
.cv-over .ov-standings .civrow { flex-wrap: nowrap; padding: 6px 10px; }
.cv-over .ov-standings .place { width: 22px; text-align: center; color: var(--muted); }
.cv-over .ov-standings .who { flex: 0 0 210px; min-width: 0; }
.cv-over .ov-standings .who b, .cv-over .ov-standings .who small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cv-over .ov-standings .score { width: 52px; text-align: right; font-variant-numeric: tabular-nums; }
.cv-over .ov-standings .gone { opacity: .5; }
.ov-scorebar { flex: 1; height: 10px; background: rgba(255,255,255,.06); overflow: hidden; }
.ov-scorebar i { display: block; height: 100%; background: var(--civ); }
.cv-over .ov-acts { justify-content: center; gap: 8px; }
.cv-graph .peak { margin-left: auto; font-size: 11.5px; }
.cv-over h2 { margin: 0; font-size: 30px; font-weight: 800; letter-spacing: -0.02em; }
.cv-graph { border-radius: 12px; background: rgba(0,0,0,.22); border: 1px solid var(--line); padding: 10px; }
.cv-graph .tabs { display: flex; gap: 4px; margin-bottom: 8px; flex-wrap: wrap; }
.cv-graph svg { width: 100%; height: 190px; display: block; }
.cv-legend { display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; margin-top: 6px; }
.cv-legend span { display: inline-flex; align-items: center; gap: 5px; }
.cv-legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }

/* Misc. pieces the panels share */
.cv-dests { display: flex; flex-direction: column; gap: 2px; max-height: 220px; overflow: auto; }
.cv-dests { overflow-x: hidden; }
.cv-dests .cv-opt { gap: 6px; }
.cv-dests .cv-opt > span { flex: none; }
.cv-dests .cv-grow .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cv-cargo { display: flex; gap: 0; flex: none; }
.cv-cargo button { display: inline-flex; align-items: center; gap: 3px; padding: 2px 7px; font: 400 17px/1 'Jersey 10', monospace; color: var(--muted); background: #343b4a !important; box-shadow: inset 0 0 0 2px #07090c; }
.cv-cargo button:hover { color: var(--text); }
.cv-cargo button.on { background: #4a4430 !important; box-shadow: inset 0 0 0 2px #f2c14e; color: #ffe3a1; }
.cv-beliefs { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 6px; }

/* Small screens (a phone on its side, a small window): tighter, the map left room. */
@media (max-width: 760px), (max-height: 520px) {
  .cv-focus .hd, .cv-focus .row { grid-template-columns: minmax(80px, 1.2fr) repeat(calc(var(--cols) + 1), minmax(24px, .5fr)) minmax(64px, 1fr); padding: 3px 5px; gap: 3px; }
  .cv-focus .nm { font-size: 16px; } .cv-focus .row b { font-size: 16px; } .cv-focus .row small { font-size: 12px; }
  :where(.cv-root > *) { font-size: 11.5px; }
  .cv-h { font-size: 13px; } .cv-h.big { font-size: 16px; }
  .cv-btn { padding: 5px 9px; } .cv-btn.small { padding: 3px 7px; font-size: 11px; }
  .cv-x { top: 6px; right: 6px; width: 26px; height: 26px; }
  .cv-top { top: 4px; left: 4px; right: 4px; height: 38px; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
  .cv-top .civ b, .cv-top .when, .cv-stat small { display: none; }
  .cv-stat { padding: 4px 5px; font-size: 12px; }
  .cv-top .menu button { width: 28px; height: 28px; }
  .cv-top .menu button.fold, .cv-top .menu .sep { display: none; }
  .mn-item.fold { display: flex; } .cv-top .menu button.folds .dot { display: block; }
  .cv-research { top: 48px; left: 4px; width: 200px; padding: 6px 8px; gap: 7px; }
  .cv-notes { top: 48px; right: 4px; width: 200px; max-height: 30vh; }
  .cv-note { padding: 5px 7px; font-size: 11px; } .cv-note .ico { width: 22px; height: 22px; }
  .cv-corner { right: 4px; bottom: 4px; width: 164px; gap: 5px; }
  .cv-minimap { height: 80px; padding: 3px; }
  .cv-endturn { padding: 7px 9px !important; } .cv-endturn .t { font-size: 12.5px; } .cv-endturn small { font-size: 10px; }
  .cv-next { padding: 4px 8px !important; }
  .cv-unit { left: 4px; bottom: 4px; width: min(330px, calc(100vw - 176px)); padding: 8px; gap: 6px; max-height: 64vh; overflow-y: auto; }
  .cv-unit .hint { display: none; }
  .cv-city { top: 48px; right: 4px; bottom: 4px; width: min(350px, calc(100vw - 8px)); }
  .cv-big { inset: 48px 4px 4px 4px; padding: 10px; gap: 8px; }
  .cv-diplo { width: calc(100vw - 8px); max-height: calc(100vh - 56px); top: calc(50% + 20px); padding: 12px; }
  .cv-lobby { width: calc(100vw - 8px); max-height: calc(100vh - 8px); padding: 14px; }
  .cv-lobby h1 { font-size: 24px; }
  .cv-building .bd-art { height: 120px; } .cv-building { gap: 6px; padding: 10px; }
  .cv-lobby .row > label { width: 84px; }
  .cv-civs { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
  /* The advisor: a line under the top bar, between the research and the notes, until it's tapped open. */
  .cv-advisor { top: 48px; bottom: auto; width: min(420px, calc(100vw - 430px)); min-width: 220px; padding: 5px 30px 5px 6px; gap: 8px; align-items: center; cursor: pointer; animation: none; }
  .cv-advisor .face { width: 28px; height: 28px; }
  .cv-advisor:not(.open) .cv-grow > b { margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cv-advisor:not(.open) .cv-grow > :not(b) { display: none; }
  .cv-advisor::after { content: ''; position: absolute; right: 11px; top: 50%; margin-top: -3px; border: 5px solid transparent; border-top-color: var(--muted); border-bottom: 0; }
  .cv-advisor.open { align-items: flex-start; max-height: calc(100vh - 56px); overflow-y: auto; }
  .cv-advisor.open::after { top: 16px; transform: rotate(180deg); }
  .cv-splash .art { width: 96px; height: 96px; } .cv-splash .art img { width: 90px; height: 90px; }
  .cv-tip { max-width: 210px; font-size: 11px; }
  .cv-city .summary { padding: 6px 10px 4px; gap: 4px; }
  .cv-yields { grid-template-columns: repeat(6, 1fr); gap: 3px; }
  .cv-yields > div { padding: 4px 5px; gap: 3px; font-size: 11px; }
  .cv-yields small { display: none; }
  .cv-prog .l { font-size: 11px; margin-bottom: 1px; }
  .cv-tabs { padding: 2px 10px 0; } .cv-tabs button { padding: 6px 8px; font-size: 11.5px; }
  .cv-city .body { padding: 8px 10px 10px; }
  .cv-preview { width: calc(100vw - 8px); min-width: 0; bottom: auto; top: 48px; }
  .cv-preview .mods { display: none; }
  .cv-ideo .levels, .cv-ideo .choices { grid-template-columns: 1fr; }
  .cv-over { width: calc(100vw - 8px); max-height: calc(100vh - 8px); padding: 12px; gap: 10px; }
  .cv-over .ov-art .cv-portrait { display: none !important; }
  .cv-over .ov-facts { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; }
  .cv-over .ov-facts > div { padding: 4px 6px; column-gap: 5px; }
  .cv-over .ov-standings .who { flex-basis: 140px; }
  .cv-graph svg { height: 120px; }
}
/* A phone held upright (ui.ts): the prompt to turn it, over everything, until waved off. */
.cv-rotate { display: none; position: absolute; inset: 0; z-index: 50; pointer-events: auto; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; text-align: center; background: rgba(10,13,18,.96); }
.cv-rotate-phone { width: 46px; height: 76px; border: 3px solid var(--text); border-radius: 8px; margin-bottom: 8px; animation: cvRotate 2.4s ease-in-out infinite; }
@keyframes cvRotate { 0%, 20% { transform: rotate(0deg); } 50%, 80% { transform: rotate(-90deg); } 100% { transform: rotate(0deg); } }
@media (orientation: portrait) and (max-width: 600px) and (pointer: coarse) { .cv-root:not(.upright-ok) .cv-rotate { display: flex; } }
/* A bar still too full, or played upright anyway: the menu kept at the bar's right (the numbers scroll under it); upright, the advisor under the research. */
.cv-root.top-scroll .cv-top { overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.cv-root.top-scroll .cv-top .menu { position: sticky; right: 0; z-index: 1; padding-left: 4px; background: var(--bg2); box-shadow: -10px 0 8px -4px var(--bg2); }
@media (orientation: portrait) and (max-width: 600px) {
  .cv-top .menu { position: sticky; right: 0; z-index: 1; padding-left: 4px; background: var(--bg2); box-shadow: -10px 0 8px -4px var(--bg2); }
  .cv-advisor { left: 4px; right: 4px; top: 102px; width: auto; min-width: 0; transform: none; }
}
/* A short screen (a phone on its side): the city's panel scrolls as one, its list no longer squeezed under its summary. */
@media (max-height: 520px) {
  .cv-city { overflow-y: auto; }
  .cv-city .body { flex: none; overflow: visible; }
}
@media (max-height: 420px) {
  .cv-minimap { display: none; }
  .cv-notes { max-height: 22vh; }
}
`;
