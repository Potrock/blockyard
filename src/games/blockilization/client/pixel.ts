import { glyphPaths, restyleGlyphs } from './icons';

/**
 * The interface's pixel look, laid over `style.ts` and the panels' own sheets (it comes last, so its
 * rules win): panels framed in 9-sliced pixel borders (stepped corners, a bevel), pressable block
 * buttons, inventory-slot wells, bars made of blocks, pixel type (Jersey 10 for names, numbers and
 * buttons; Tiny5 for short text; Chakra Petch for reading at length), and every glyph redrawn as
 * pixels (`usePixelGlyphs`).
 */

// -------------------------------------------------------------------------------------------------
// Pixel frames: an SVG of square pixels for `border-image`, its bands from the outside in

/**
 * A frame `k` pixels deep (each `p` screen pixels), its corners stepped `s` pixels in. A band named
 * `bev` is `H` where it faces up or left and `L` where it faces down or right (`bev2`: `H2`/`L2`).
 */
function frame(k: number, bands: string[], pal: Record<string, string>, p = 2, s = 1): { url: string; w: number } {
  const N = 2 * k + 2;
  let rects = '';
  for (let y = 0; y < N; y++) {
    let run = '';
    let start = 0;
    const flush = (x: number) => {
      if (run) rects += `<rect x="${start * p}" y="${y * p}" width="${(x - start) * p}" height="${p}" fill="${run}"/>`;
    };
    for (let x = 0; x <= N; x++) {
      let c = '';
      if (x < N) {
        const dt = y, db = N - 1 - y, dl = x, dr = N - 1 - x;
        const tl = dl + dt - s, tr = dr + dt - s, bl = dl + db - s, br = dr + db - s;
        const d = Math.min(dt, db, dl, dr, tl, tr, bl, br);
        if (d >= 0 && d < bands.length) {
          let key = bands[d];
          if (key === 'bev' || key === 'bev2') {
            const [hi, lo] = key === 'bev' ? ['H', 'L'] : ['H2', 'L2'];
            key = d === dt || d === dl || d === tl ? hi : d === db || d === dr || d === br ? lo : d === tr ? (dt <= dr ? hi : lo) : dl <= db ? hi : lo;
          }
          c = pal[key] ?? '';
        }
      }
      if (c !== run) {
        flush(x);
        run = c;
        start = x;
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${N * p}" height="${N * p}" shape-rendering="crispEdges">${rects}</svg>`;
  return { url: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, w: k * p };
}
const border = (f: { url: string; w: number }) => `border: ${f.w}px solid transparent !important; border-image: ${f.url} ${f.w} / ${f.w}px stretch !important; background-clip: padding-box !important;`;

const PANEL = frame(3, ['O', 'bev', 'bev2'], { O: '#07090c', H: '#4d5770', L: '#11141a', H2: '#343c4d', L2: '#1a1e27' });
const PANEL_HI = frame(3, ['O', 'bev', 'bev2'], { O: '#07090c', H: '#66728f', L: '#11141a', H2: '#3f4859', L2: '#1c2029' });
const SLOT = frame(2, ['bev', 'bev2'], { H: '#0b0d12', L: '#465066', H2: '#151921', L2: '#2c3342' }, 2, 0);
const SLOT_SM = frame(1, ['bev'], { H: '#0b0d12', L: '#465066' }, 2, 0);
const button = (hi: string, lo: string) => frame(2, ['O', 'bev'], { O: '#07090c', H: hi, L: lo });
const BTN = button('#6a7590', '#232833');
const BTN_GREEN = button('#a6ec7c', '#2c6420');
const BTN_RED = button('#ee7c64', '#5e1c12');
const BTN_GOLD = button('#ffe48a', '#7a5a12');
const BTN_BLUE = button('#a8dcff', '#1e4a80');
const CHIP = frame(1, ['O'], { O: '#07090c' }, 2, 0);
const CHIP_ON = frame(1, ['O'], { O: '#f2c14e' }, 2, 0);
const TIP = frame(2, ['O', 'bev'], { O: '#07090c', H: '#5d6884', L: '#0d1015' });

// Faces: the top half a touch lighter (a block lit from above).
const face = (a: string, b: string) => `background: linear-gradient(180deg, ${a} 0 50%, ${b} 50%) !important;`;
const FACE = face('#4a5368', '#434b5e');
const FACE_HOVER = face('#56607a', '#4e576d');
const FACE_GREEN = face('#6cc04c', '#5fb042');
const FACE_RED = face('#c04a34', '#b0412d');
const FACE_GOLD = face('#e8bc48', '#dcae3a');
const FACE_BLUE = face('#4a8ed8', '#3f80c8');
// Bars: blocks of 8 with a 2-pixel gap, each lit on top.
const blocks = (bc: string, bh: string, bl: string) => `background: repeating-linear-gradient(90deg, transparent 0 8px, #0f1218 8px 10px), linear-gradient(180deg, ${bh} 0 2px, ${bc} 2px calc(100% - 2px), ${bl} calc(100% - 2px)) !important;`;

const D = `'Jersey 10', 'Tiny5', monospace`;
const T = `'Tiny5', 'Jersey 10', monospace`;
/** For reading at length (articles, cards, tips, descriptions): a plain face with square shoulders, kin to the pixel ones. */
const R = `'Chakra Petch', system-ui, sans-serif`;
const SH = 'text-shadow: 2px 2px 0 #0b0d12;';

export const PIXEL_CSS = `
.cv-root { --bg: #222731; --bg2: #262c37; --line: rgba(255,255,255,.07); --line2: rgba(255,255,255,.14); --text: #eef1f5; --muted: #9aa4b5; --dim: #6c7688;
  --gold: #f2c14e; --gold2: #d39a2a; --good: #7fd46b; --bad: #ff6b5e; --blue: #5ab4ff; --r: 0px; --r2: 0px; --shadow: 4px 4px 0 rgba(4,6,10,.5);
  font: 400 15px/1.35 ${T}; letter-spacing: 0; font-synthesis: none; }
.cv-root *, .cv-root *::before, .cv-root *::after { border-radius: 0 !important; }
.cv-root b, .cv-root strong { font-weight: 400; color: #fff; }
.cv-root small { font-size: 13px; }
.cv-root kbd { font: 400 18px/1 ${D} !important; ${border(CHIP)} background: #3a4252 !important; box-shadow: inset 0 -2px 0 #232833 !important; padding: 0 5px !important; height: 22px !important; }
.cv-ico.px { overflow: visible; }

/* Panels: a pixel frame, solid (no frosted glass), a hard shadow. */
.cv-panel, .cv-note, .cv-tip, .pd-card, .nt-decide, .nt-more, .cv-taphint, .cv-toast { ${border(PANEL)} background: linear-gradient(180deg, #262c37, #222731) !important; background-clip: padding-box !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; box-shadow: 4px 4px 0 rgba(4,6,10,.5) !important; }
.cv-big, .cv-diplo, .cv-lobby, .cv-over, .cv-splash, .cv-city, .nt-panel { ${border(PANEL_HI)} background: linear-gradient(180deg, #2a303c, #252a35) !important; background-clip: padding-box !important; }
.cv-confirm { background: rgba(5,8,12,.55); }
.cv-in, .cv-confirm .box { animation-timing-function: steps(4, end); }

/* Type: names, numbers and buttons in Jersey 10; the rest in Tiny5. */
.cv-h, .cv-stat, .cv-research .name, .cv-endturn .t, .cv-next b, .cv-count, .cv-opt .n, .cv-tabs button, .ov-tabs button, .cv-btn, .cv-chip, .mn-item, .cv-lobby .chip, .cv-promo b, .cv-pol b, .lb-win b, .gd-way b, .cv-spec b, .cv-bld b,
.civrow .who b, .cv-dip-civ b, .pd-head h2, .pd-card .pd-head b, .pd-brand, .cv-splash h2, .cv-over h2, .cv-lobby h1, .tt-card .n, .cv-civ .txt b, .cv-yields > div, .cv-ustats b, .cv-city .pop, .cv-preview .str b, .cv-preview .verdict,
.cv-prog .l > span, .cv-ptree .hd b, .ov-ghead b, .ov-civ .top b, .nt-turn b, .cv-advisor b, .cv-label, .pd-group, .cv-preview .vs, .tt-era span, .cv-splash .kick, .cv-dip-head b, .cv-trade-verdict, .cv-defence b, .hk-row b {
  font-family: ${D} !important; font-weight: 400 !important; letter-spacing: .03em; }
.cv-h { font-size: 22px !important; line-height: 1 !important; ${SH} }
.cv-h.big { font-size: 30px !important; }
.cv-label { font-size: 17px !important; line-height: 1 !important; letter-spacing: .08em !important; color: var(--muted); }
.cv-root .cv-muted { color: var(--muted); }

/* Reading at length: articles, hover cards, tips, hints and descriptions. */
.pd-text, .pd-card .pd-text, .pd-ability p, .cv-unit .hint, .cv-advisor .cv-grow > .cv-muted, .cv-splash p, .cv-pol small, .cv-promo small, .cv-civ .txt small, .lb-win small, .lb-desc, .lb-how,
.gd-way small, .cv-bld small, .cv-spec small, .cv-ptree .hd small, .cv-ideo .tenet small, .cv-dip-reason span, .cv-trade-opt small, .cv-over .hero .cv-muted, .cv-lobby .tag, .cv-card small, .cv-alert.rev small {
  font-family: ${R} !important; font-weight: 400; letter-spacing: 0 !important; }
.pd-text { font-size: 15px !important; line-height: 1.6 !important; }
.pd-card .pd-text, .cv-advisor .cv-grow > .cv-muted, .cv-unit .hint, .cv-splash p { font-size: 14.5px !important; line-height: 1.45 !important; }
.cv-pol small, .cv-promo small, .cv-civ .txt small, .lb-win small, .gd-way small, .cv-bld small, .cv-spec small, .cv-ideo .tenet small, .cv-trade-opt small, .cv-alert.rev small { font-size: 13.5px !important; line-height: 1.35 !important; }

/* Buttons: blocks that press in. */
.cv-btn { ${border(BTN)} ${FACE} color: #fff !important; font-size: 20px !important; line-height: 1 !important; padding: 3px 10px 4px !important; ${SH} box-shadow: 0 2px 0 #07090c !important; transition: none !important; }
.cv-btn:hover:not(:disabled, .off) { ${FACE_HOVER} }
.cv-btn:active:not(:disabled, .off) { transform: translateY(2px) !important; box-shadow: none !important; }
/* Not to be pressed now (.off: one whose hover card says why, which some browsers withhold from a disabled one): faded, flat, greyed, not lit by the mouse. */
.cv-btn:disabled, .cv-btn.off { opacity: .45 !important; box-shadow: none !important; filter: grayscale(.7); cursor: default !important; }
.cv-btn.gold, .cv-endturn.gold, .mn-item.gold { ${border(BTN_GREEN)} ${FACE_GREEN} color: #fff !important; text-shadow: 2px 2px 0 #1f4a16 !important; }
.cv-btn.gold:hover:not(.off), .cv-endturn.gold:hover, .mn-item.gold:hover { ${face('#78cc58', '#6abc4c')} }
.cv-btn.danger { ${border(BTN)} color: #ffb4a6 !important; }
.cv-confirm .cv-btn.danger, .cv-btn.danger.strong { ${border(BTN_RED)} ${FACE_RED} color: #fff !important; text-shadow: 2px 2px 0 #4a120a !important; }
.cv-btn.small { font-size: 18px !important; padding: 2px 8px 3px !important; }
.cv-btn.icon { padding: 3px 5px !important; }
.cv-btn .cv-i { filter: drop-shadow(2px 2px 0 #0b0d12); }
.cv-opt .cv-btn.small:not(.icon) { ${border(BTN_GOLD)} ${FACE_GOLD} color: #2a1d04 !important; text-shadow: 1px 1px 0 rgba(255,240,190,.6) !important; }
.cv-opt .cv-btn.small:not(.icon) .cv-i { filter: none; } .cv-opt .cv-btn.small:not(.icon) .cv-ico { color: #5a3e04 !important; }
.cv-x { ${border(BTN)} ${FACE} width: 28px !important; height: 28px !important; color: #fff !important; box-shadow: 0 2px 0 #07090c !important; }
.cv-x:hover { ${FACE_HOVER} }

/* Chips: small blocks; the chosen one ringed in gold. */
.cv-chip, .cv-lobby .chip, .tt-queue .cv-chip { ${border(CHIP)} background: #343b4a !important; font-size: 18px !important; line-height: 1 !important; padding: 2px 8px 3px !important; color: var(--text); }
.cv-chip.on, .cv-lobby .chip.on { ${border(CHIP_ON)} background: #4a4430 !important; color: #ffe3a1 !important; }
.cv-chip.good { background: #24402a !important; color: #b8f09c !important; } .cv-chip.bad { background: #4a2420 !important; color: #ffb4a6 !important; }

/* Wells: inventory slots for pictures, tiles and fields. */
.cv-pic, .cv-portrait, .cv-input { ${border(SLOT)} background: #181c24 !important; background-clip: padding-box !important; }
.cv-pic.sm { ${border(SLOT_SM)} }
.cv-tile { box-shadow: inset 0 0 0 2px #07090c, inset 4px 4px 0 rgba(255,255,255,.22), inset -4px -4px 0 rgba(0,0,0,.3) !important; }
.cv-input { color: var(--text); font: 400 15px ${T} !important; padding: 4px 8px !important; }
.cv-input:focus { border-image: ${SLOT.url} ${SLOT.w} / ${SLOT.w}px stretch !important; box-shadow: 0 0 0 2px var(--gold) !important; }

/* Bars: a slot of blocks. */
.cv-bar, .cv-progress, .tt-bar, .cv-preview .hpbar { ${border(SLOT_SM)} height: 12px !important; background: #0f1218 !important; background-clip: padding-box !important; overflow: hidden; }
.cv-bar i, .cv-progress i, .tt-bar i { ${blocks('#4a9ef0', '#a8dcff', '#2a62a8')} transition: none !important; }
.cv-bar.gold i, .cv-progress i { ${blocks('#e8b43a', '#ffe48a', '#9a6a10')} }
.cv-bar.green i, .cv-bar.food i { ${blocks('#5cc040', '#b4f08c', '#2e7a20')} }
.cv-bar.orange i { ${blocks('#ec8a2e', '#ffcc88', '#9a4e10')} }
.cv-bar.red i { ${blocks('#e04a34', '#ff9a8a', '#8a2014')} }
.cv-bar.purple i { ${blocks('#b46ad8', '#ecb8ff', '#6a2e8a')} }
.cv-preview .hpbar .keep { ${blocks('#5cc040', '#b4f08c', '#2e7a20')} }
.cv-preview .hpbar .maybe { ${blocks('#ec8a2e', '#ffcc88', '#9a4e10')} }
.cv-preview .hpbar .lose { ${blocks('#c8432f', '#ff8a7a', '#7a1e12')} }

/* Top bar */
.cv-top { height: 50px !important; top: 6px !important; padding: 0 6px !important; }
.cv-top .civ { border-right: 0 !important; box-shadow: 2px 0 0 #11141a, 4px 0 0 #3a4254; padding-right: 12px !important; }
.cv-top .civ b { font: 400 24px/1 ${D}; ${SH} }
.cv-stat { font-size: 24px !important; line-height: 1 !important; padding: 3px 6px !important; ${SH} gap: 6px !important; }
.cv-stat small { font: 400 18px/1 ${D} !important; opacity: 1 !important; color: var(--muted); }
.cv-stat:hover { background: rgba(255,255,255,.07) !important; }
.cv-top .when { border-right: 0 !important; box-shadow: -2px 0 0 #3a4254, -4px 0 0 #11141a, 2px 0 0 #11141a, 4px 0 0 #3a4254; }
.cv-top .when b { font: 400 20px/1 ${D}; color: var(--gold); ${SH} }
.cv-top .when small { font: 400 15px/1.1 ${D}; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.cv-top .menu button { width: 34px !important; height: 34px !important; color: #c9d1de !important; }
.cv-top .menu button:hover { background: rgba(255,255,255,.1) !important; color: #fff !important; }
.cv-top .menu button.on { ${border(BTN_GREEN)} background: #5fb042 !important; background-clip: padding-box !important; color: #fff !important; }
.cv-top .menu button .dot { width: 8px !important; height: 8px !important; top: 2px !important; right: 2px !important; box-shadow: 0 0 0 2px #07090c !important; }
.cv-top .menu button .count { font: 400 16px/16px ${D} !important; background: #d8402e !important; color: #fff !important; box-shadow: 0 0 0 2px #07090c !important; top: -2px !important; right: -2px !important; }
.cv-top .menu .sep { width: 4px !important; height: 26px !important; background: none !important; box-shadow: inset 2px 0 0 #11141a, inset -2px 0 0 #3a4254; }

/* Below the bar: everything starts a little lower. */
.cv-research, .cv-notes, .cv-city, .nt-panel, .nt-digest { top: 64px !important; }
.cv-big { top: 64px !important; }

/* Research */
.cv-research .name { font-size: 24px !important; line-height: 1 !important; ${SH} }
.cv-research .cv-bar { margin: 6px 0 3px !important; }

/* Notes: toasts */
.cv-note { padding: 4px 8px 4px 4px !important; font-size: 14px !important; line-height: 1.25 !important; }
.cv-note .ico, .nt-row .ico, .nt-decide .ico { box-shadow: inset 0 0 0 2px #07090c, inset 3px 3px 0 rgba(255,255,255,.22), inset -3px -3px 0 rgba(0,0,0,.3); }
.nt-decide { font-size: 14px !important; }
.nt-decide small { font: 400 16px/1 ${D}; letter-spacing: .04em; }
.nt-more { font-size: 13px !important; padding: 2px 8px !important; }

/* End turn, minimap */
.cv-endturn { padding: 8px 12px !important; }
.cv-endturn .t { font-size: 30px !important; line-height: .9 !important; letter-spacing: .03em !important; }
.cv-endturn small { font-size: 13px !important; font-weight: 400 !important; }
.cv-endturn.need { ${border(BTN_BLUE)} ${FACE_BLUE} text-shadow: 2px 2px 0 #102a50 !important; }
.cv-endturn.wait { ${border(BTN)} ${FACE} }
.cv-next b { font-size: 22px !important; color: var(--gold) !important; ${SH} }
.cv-minimap { padding: 0 !important; }
.cv-minimap canvas { image-rendering: pixelated; }
.cv-roster i { box-shadow: 0 0 0 2px #07090c !important; }
.cv-roster .who b { font: 400 17px/1 ${D} !important; letter-spacing: .03em; }
.cv-taphint { color: #ffe3a1 !important; }

/* Unit */
.cv-unit { width: 436px !important; }
.cv-unit .cv-h { font-size: 30px !important; }
.cv-unit .acts { gap: 4px !important; flex-wrap: wrap !important; }
.cv-unit .acts .cv-btn.small { padding: 2px 5px 3px !important; gap: 4px !important; font-size: 17px !important; }
.cv-unit .cv-ustats { font-size: 13px !important; }
.cv-unit .cv-ustats b { font-size: 22px !important; line-height: 1; ${SH} }
.cv-mod { font: 400 16px/1.1 ${D} !important; letter-spacing: .04em; padding: 1px 6px !important; }
.cv-mod.up { background: #24402a !important; box-shadow: inset 0 0 0 2px #3c6a3c; } .cv-mod.down { background: #4a2420 !important; box-shadow: inset 0 0 0 2px #7a3a30; }
.cv-defence { font-size: 14px !important; } .cv-defence b { font-size: 20px; ${SH} }
.cv-promos { background: #3a3424 !important; border: 0 !important; box-shadow: inset 0 0 0 2px #6a5a2a; }
.cv-promo { ${border(CHIP)} background: #4a4430 !important; }
.cv-promo b { font-size: 20px !important; color: #ffe3a1; }

/* City */
.cv-city .head { border-bottom: 0 !important; box-shadow: inset 0 -2px 0 #3a4254, inset 0 -4px 0 #11141a; }
.cv-city .pop { ${border(BTN)} width: 50px !important; height: 50px !important; font-size: 34px !important; line-height: 1; ${SH} background: rgba(0,0,0,.25) !important; background-clip: padding-box !important; }
.cv-city .cv-h.big { font-size: 40px !important; line-height: .9 !important; }
.cv-yields > div { ${border(SLOT_SM)} background: #181c24 !important; background-clip: padding-box !important; font-size: 24px !important; line-height: 1; ${SH} padding: 4px 8px !important; }
.cv-yields > div:hover { background: #222834 !important; }
.cv-yields small { font: 400 17px/1 ${D} !important; color: var(--muted) !important; text-shadow: none; }
.cv-yields .bd { ${border(TIP)} background: #11141a !important; background-clip: padding-box !important; font: 400 14px/1.3 ${T} !important; text-shadow: none; }
.cv-yields .bd .ln b { font: 400 18px/1 ${D}; }
.cv-prog .l { font-size: 13px !important; } .cv-prog .l > span { font-size: 20px !important; line-height: 1; } .cv-prog .l small { font-size: 13px !important; }
.cv-tabs { border-bottom: 0 !important; box-shadow: inset 0 -2px 0 #11141a, inset 0 -4px 0 #3a4254; padding-bottom: 0 !important; }
.cv-tabs button { font-size: 21px !important; padding: 6px 10px 7px !important; border-bottom: 0 !important; }
.cv-tabs button.on { background: #343c4c !important; color: #fff !important; box-shadow: inset 2px 2px 0 #4d5770, inset -2px 0 0 #11141a, inset 0 -4px 0 var(--gold); }
.cv-now { ${border(SLOT)} background: #1c2029 !important; background-clip: padding-box !important; }
.cv-now .cv-grow > div:nth-child(2) { font: 400 26px/1 ${D} !important; letter-spacing: .03em; ${SH} }
.cv-now > div:nth-child(3) > div:first-child { font: 400 36px/.9 ${D} !important; ${SH} }
.cv-opt { padding: 4px 6px !important; }
.cv-opt:hover { background: rgba(255,255,255,.06) !important; }
.cv-opt .n { font-size: 21px !important; line-height: 1; ${SH} }
.cv-opt .meta { font-size: 13px !important; }
.cv-opt.wonder .n { color: var(--gold) !important; }
.cv-opt.on { background: rgba(236,138,46,.14) !important; box-shadow: inset 2px 0 0 #ec8a2e; }
.cv-queue .q { background: #1c2029 !important; font-size: 14px !important; }
.cv-spec, .cv-bld, .cv-card, .cv-alert { background: #1c2029 !important; border: 0 !important; box-shadow: inset 2px 2px 0 #11141a, inset -2px -2px 0 #2e3544 !important; }
.cv-spec b, .cv-bld b { font-size: 20px !important; line-height: 1; }
.cv-spec .slots button { ${border(SLOT_SM)} background: #181c24 !important; background-clip: padding-box !important; }
.cv-spec .slots button.full { background: #1e4a80 !important; } .cv-spec .slots button.locked { box-shadow: 0 0 0 2px var(--gold) !important; }
.cv-alert { box-shadow: inset 0 0 0 2px #8a5a20 !important; background: #3a2a18 !important; }
.cv-buildings span { background: #1c2029 !important; box-shadow: inset 0 0 0 2px #2e3544; font-size: 13px !important; }

/* Big panels: policies, ideologies, tech tree, overview, pedia, diplomacy, menus */
.cv-ptree, .civrow, .cv-dip-civ, .lb-win, .gd-way, .ov-group, .ov-civ, .ov-rank, .ov-state, .pd-facts > div, .cv-trade-opt, .cv-trade-amt, .cv-trade-deal, .cv-dip-reason, .cv-civ, .cv-seat, .mn-item, .pd-ability, .pd-note, .pd-cs, .pd-link, .cv-ideo, .cv-graph {
  border: 0 !important; background: #1c2029 !important; box-shadow: inset 2px 2px 0 #11141a, inset -2px -2px 0 #2e3544 !important; }
.mn-item { ${border(BTN)} ${FACE} box-shadow: 0 2px 0 #07090c !important; font-size: 20px !important; color: #fff !important; ${SH} }
.mn-item:hover { ${FACE_HOVER} }
.cv-pol { ${border(CHIP)} background: #2c323f !important; }
.cv-pol:hover:not(:disabled) { background: #363d4c !important; }
.cv-pol.have { ${border(CHIP_ON)} background: #4a4430 !important; }
.cv-pol.can { border-image: ${frame(1, ['O'], { O: '#5ab4ff' }, 2, 0).url} 2 / 2px stretch !important; }
.cv-pol b { font-size: 19px !important; line-height: 1; }
.cv-ptree.locked { opacity: .5; }
.cv-trade-opt.on, .cv-trade-amt.on, .cv-civ.on, .cv-dip-civ.on, .lb-win.on, .ov-rank.me { box-shadow: inset 0 0 0 2px var(--gold), inset 4px 4px 0 rgba(242,193,78,.12) !important; background: #2e2a1e !important; }
.cv-civ:hover, .cv-dip-civ:hover, .lb-win:hover:not(:disabled), .mn-item:hover { transform: none !important; }
.cv-civ .txt b, .civrow .who b, .cv-dip-civ b, .lb-win b, .gd-way b { font-size: 20px !important; line-height: 1; }
.cv-lobby h1 { font-size: 60px !important; letter-spacing: .04em !important; background: none !important; -webkit-background-clip: border-box !important; background-clip: border-box !important; color: var(--gold) !important; text-shadow: 4px 4px 0 #0b0d12; }
.cv-lobby .row > label { font: 400 18px/1 ${D}; letter-spacing: .04em; }
/* A moment's card and a deal put to you over the panels they hold back (a panel's close button stood over
   them where they met: drawn larger, a phone's moment card covers the unit card's corner). */
.cv-root :is(.cv-splash, .cv-offer) { z-index: 12; }
/* An ending framed as a film (ending.ts): the interface out of the shot (its bars covered the top bar
   and the corner as designed; drawn larger, they'd show past them). */
.cv-root:has(.en-scene) > :not(:has(.en-scene)) { visibility: hidden !important; }
/* The lobby's Hall of Fame (fame.ts): its games wells, as the civilizations' are; its title, names, places and scores in the display face. */
.hf-row { background: #1c2029 !important; box-shadow: inset 2px 2px 0 #11141a, inset -2px -2px 0 #2e3544; padding: 5px 8px !important; }
.hf-head b { font: 400 22px/1 ${D}; letter-spacing: .04em; color: #fff; ${SH} }
.hf-who b { font: 400 20px/1 ${D}; color: #fff; }
.hf-rank, .hf-score { font: 400 24px/1 ${D} !important; ${SH} }
.hf-game { font-size: 13px !important; }
.cv-splash h2, .cv-over h2 { font-size: 40px !important; line-height: 1; ${SH} }
.cv-splash .kick { font-size: 18px !important; letter-spacing: .1em !important; }
.cv-splash .art { background: #181c24 !important; box-shadow: inset 4px 4px 0 #0b0d12, inset -4px -4px 0 #343c4d; }
.ov-tabs { background: #181c24 !important; border: 0 !important; box-shadow: inset 2px 2px 0 #0b0d12, inset -2px -2px 0 #343c4d; }
.ov-tabs button { font-size: 20px !important; }
.ov-tabs button.on { ${border(CHIP_ON)} background: #4a4430 !important; }
.ov-table th { font: 400 17px/1 ${D} !important; letter-spacing: .06em !important; background: #1c2029 !important; border-bottom: 2px solid #11141a !important; }
.ov-table td { border-bottom: 2px solid #1c2029 !important; font-size: 14px; }
.ov-table td.n { font: 400 20px/1 ${D}; }
.pd-head h2 { font-size: 40px !important; line-height: 1; ${SH} }
.pd-brand { font-size: 24px !important; }
.pd-cat, .pd-entry { font-size: 14px !important; }
.pd-cat.on, .pd-entry.on { box-shadow: inset 2px 0 0 var(--gold); }
.pd-text { color: #d8dee8 !important; }
.pd-text h4 { font: 400 20px/1 ${D} !important; letter-spacing: .08em !important; }
.pd-facts > div b { font: 400 20px/1 ${D}; }
.pd-side, .pd-mid { border-right: 2px solid #11141a !important; box-shadow: 2px 0 0 #343c4d; }
.tt-card { ${border(PANEL)} background: #232833 !important; background-clip: padding-box !important; box-shadow: 4px 4px 0 rgba(4,6,10,.45) !important; transition: none !important; }
.tt-card:hover { transform: translateY(-2px); }
.tt-card .n { font-size: 20px !important; line-height: 1; ${SH} }
.tt-card .meta { font-size: 13px !important; }
.tt-card.known { background: #1e2e24 !important; }
.tt-card.can { border-image: ${frame(3, ['O', 'bev', 'bev2'], { O: '#07090c', H: '#7fc4ff', L: '#1e4a80', H2: '#3a6a9a', L2: '#1a3050' }).url} 6 / 6px stretch !important; }
.tt-card.now, .tt-card.queued { border-image: ${frame(3, ['O', 'bev', 'bev2'], { O: '#07090c', H: '#ffe48a', L: '#7a5a12', H2: '#c49a3a', L2: '#4a3a10' }).url} 6 / 6px stretch !important; background: #2e2a1e !important; }
.tt-badge { font: 400 18px/20px ${D} !important; background: var(--gold) !important; box-shadow: 0 0 0 2px #07090c !important; }
.tt-lines path { stroke-linecap: square; stroke-linejoin: miter; }
.tt-eras { background: #1c2029 !important; backdrop-filter: none !important; border-bottom: 2px solid #11141a !important; }
.tt-era span { font-size: 20px !important; letter-spacing: .1em !important; }
.tt-era small { font: 400 16px/1 ${D} !important; }
.cv-tip { font-size: 14px !important; padding: 6px 9px !important; }
.pd-card { font-size: 14px !important; } .pd-card .pd-head b { font-size: 22px !important; line-height: 1; ${SH} }
.cv-dip-reason, .nt-row, .nt-digest .nt-row, .cv-dip-line, .cv-deal-item, .ov-unit, .hk-row { font-size: 14px !important; }
.cv-dip-reason b { font: 400 20px/1 ${D}; }
.cv-tip b { font: 400 20px/1 ${D}; letter-spacing: .03em; ${SH} }
.cv-tip .ln.yl { font: 400 19px/1 ${D}; }
.cv-preview .str b { font-size: 34px !important; ${SH} }
.cv-preview .verdict { font-size: 22px !important; }
.cv-preview .vs { font-size: 20px !important; }
.cv-advisor .face { box-shadow: inset 0 0 0 2px #07090c, inset 3px 3px 0 rgba(255,255,255,.22), inset -3px -3px 0 rgba(0,0,0,.3); }
.cv-advisor b { font-size: 22px !important; line-height: 1; ${SH} }
.cv-lenses button { ${border(CHIP)} background: #222731 !important; font: 400 17px/1 ${D} !important; letter-spacing: .03em; height: 26px !important; }
.cv-lenses button.on { ${border(CHIP_ON)} background: #4a4430 !important; }
.cv-confirm .box .cv-h { font-size: 30px !important; }
/* Deals: their lines a size up; the lens's key, the turn's summary, the how-to-win note in the pixel type. */
.cv-deal-item { font-size: 14px !important; }
.cv-lenskey { font-size: 14px !important; }
.lk-head b { font: 400 20px/1 ${D}; letter-spacing: .03em; ${SH} }
.lk-scale i { height: 10px !important; box-shadow: 0 0 0 2px #07090c; }
.lk-ends { font: 400 15px/1 ${D} !important; letter-spacing: .06em; text-transform: uppercase; margin-top: 2px !important; }
.lk-item i { width: 12px !important; height: 12px !important; box-shadow: 0 0 0 2px #07090c, inset 0 2px 0 rgba(255,255,255,.3); }
.nt-dhead b { font: 400 20px/1 ${D}; letter-spacing: .03em; ${SH} }
.gd-win > small, .cv-lenskey > small { font-family: ${R} !important; font-size: 13.5px !important; line-height: 1.4; }

/* The panels' running text (religion, victory, spies, great people): sentences in the reading face, a size up from the inline 12px; their headings in the pixel display type. */
:is(.cv-big, .cv-diplo) :is(.cv-card, .civrow, .gd-way) :is(.cv-muted, small), :is(.cv-big, .cv-diplo) [style*="font-size:12px"], .cv-big > .cv-scroll > :is(.cv-muted, small), .cv-diplo > :is(.cv-muted, small), .cv-diplo .list > :is(.cv-muted, small) {
  font-family: ${R} !important; font-size: 14px !important; line-height: 1.4; }
:is(.cv-big, .cv-diplo) .cv-card b, .cv-diplo .cv-card > .cv-row b, .cv-diplo > .cv-row > div > b { font: 400 20px/1.1 ${D} !important; letter-spacing: .03em; ${SH} }
.cv-big > .cv-scroll > .cv-h { font-size: 26px !important; margin-top: 6px; }

/* What's newer on the unit card and in the overview: where it's going, why a worker can't build, the city picked to build. */
.cv-unit .going { font-size: 14px !important; font-weight: 400 !important; color: #ffe3a1; }
.cv-blocked { font-size: 13.5px !important; opacity: 1 !important; color: var(--muted); }
.cv-blocked b { font: 400 18px/1 ${D}; letter-spacing: .03em; }
.ov-pick > td { background: #181c24 !important; box-shadow: inset 2px 0 0 #f2c14e; }
.cv-repeat { font-size: 17px !important; }
/* The end-turn button naming what's needed first (a longer label): a size down, so it reads whole. */
.cv-endturn.need .t { font-size: 22px !important; line-height: .95 !important; white-space: normal !important; display: -webkit-box !important; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

/* Good and bad numbers, one green and one red wherever they're shown (breakdowns, modifiers, a fight's
   odds, opinions, deals, chips, standings, a way that can't be gone). */
.cv-yields .bd .ln b, .cv-mod.up, .cv-preview .mods b.up, .cv-dip-reason.good b, .cv-trade-verdict.good, .cv-chip.good, .ov-demo .place.first, .cv-preview .verdict.good { color: #9be7a4 !important; }
.cv-yields .bd .ln b.neg, .cv-mod.down, .cv-preview .mods b.down, .cv-dip-reason.bad b, .cv-trade-verdict.bad, .cv-chip.bad, .ov-table .bad, .ov-demo .place.last, .cv-unit .arrive.no, .cv-tip .ln.way.no, .cv-preview .verdict.bad { color: #ff9a8e !important; }
/* The colour-blind palette (the menu's Colours, ui.ts applyLook): good blue and bad orange, not green
   and red (each still has its sign, arrow or tick besides). */
.cv-root.cb { --good: #5aaeff; --bad: #ff9a3c; }
.cv-root.cb :is(.cv-yields .bd .ln b, .cv-mod.up, .cv-preview .mods b.up, .cv-dip-reason.good b, .cv-trade-verdict.good, .cv-chip.good, .ov-demo .place.first, .cv-preview .verdict.good) { color: #9fd3ff !important; }
.cv-root.cb :is(.cv-yields .bd .ln b.neg, .cv-mod.down, .cv-preview .mods b.down, .cv-dip-reason.bad b, .cv-trade-verdict.bad, .cv-chip.bad, .ov-table .bad, .ov-demo .place.last, .cv-unit .arrive.no, .cv-tip .ln.way.no, .cv-preview .verdict.bad) { color: #ffb870 !important; }
.cv-root.cb :is(.cv-chip.good, .cv-mod.up) { background: #1e3450 !important; } .cv-root.cb .cv-mod.up { box-shadow: inset 0 0 0 2px #3a628f; }
.cv-root.cb :is(.cv-chip.bad, .cv-mod.down) { background: #4a3014 !important; } .cv-root.cb .cv-mod.down { box-shadow: inset 0 0 0 2px #8a5a24; }
.cv-root.cb .cv-preview .verdict.good, .cv-root.cb .ov-demo .place.first { background: rgba(90,174,255,.16) !important; }
.cv-root.cb .cv-preview .verdict.bad, .cv-root.cb .ov-demo .place.last { background: rgba(255,154,60,.16) !important; }
.cv-root.cb .cv-preview .hpbar .keep { ${blocks('#3d8fd8', '#9fd3ff', '#1d4f80')} }
.cv-root.cb .cv-preview .hpbar .maybe { ${blocks('#bdb59a', '#ece5cc', '#6e6852')} }
.cv-root.cb .cv-preview .hpbar .lose { ${blocks('#e0761c', '#ffb870', '#8a4208')} }
.cv-root.cb .cv-bar.green i { ${blocks('#3d8fd8', '#9fd3ff', '#1d4f80')} } .cv-root.cb .cv-bar.red i { ${blocks('#e0761c', '#ffb870', '#8a4208')} }
.cv-root.cb .cg-tally .yes { ${blocks('#3d8fd8', '#9fd3ff', '#1d4f80')} }
.cv-root.cb .cg-tally .no { ${blocks('#e0761c', '#ffb870', '#8a4208')} }
.cv-root.cb .cg-way.yes { background: #1e3450; color: #9fd3ff; } .cv-root.cb .cg-way.no { background: #4a3014; color: #ffb870; }
.cv-root.cb :is(.y-sad, .y-anarchy) { color: #ffb870; } .cv-root.cb .y-anarchy { background: rgba(160,96,30,.3); }
.cv-root.cb :is(.cs-quest .reward, .cs-acts .gain, .cs-give.now b) { color: #9fd3ff; } .cv-root.cb .cs-give.now { color: #dcecff; } .cv-root.cb .cs-tribute .loss { color: #ffb870; }
.cv-root.cb .cs-card.friend { box-shadow: inset 0 0 0 2px #11141a, inset 4px 0 0 #5aaeff; } .cv-root.cb .cs-card.war { box-shadow: inset 0 0 0 2px #11141a, inset 4px 0 0 #ff9a3c; }
.cv-preview .dmg, .cv-preview .mods { font-size: 13px !important; }
.cv-tip .ln.f1 { font-size: 13px !important; }

/* Map pins (pins.ts) as the rest: its menu's items blocks, its icons slots (the chosen ringed in gold),
   the list's rows slots, the toggle a chip. */
.pn-item { ${border(BTN)} ${FACE} color: #fff !important; font: 400 19px/1 ${D} !important; letter-spacing: .03em; ${SH} box-shadow: 0 2px 0 #07090c !important; }
.pn-item:hover:not(:disabled) { ${FACE_HOVER} }
.pn-icon { ${border(SLOT_SM)} background: #181c24 !important; background-clip: padding-box !important; }
.pn-icon:hover { background: #222834 !important; }
.pn-icon.on { ${border(CHIP_ON)} background: #4a4430 !important; background-clip: padding-box !important; }
.pn-go { ${border(SLOT_SM)} background: #181c24 !important; background-clip: padding-box !important; }
.pn-go:hover { background: #222834 !important; }
.pn-go b { font: 400 19px/1 ${D}; letter-spacing: .03em; ${SH} }
.pn-head b { font: 400 20px/1 ${D}; letter-spacing: .03em; ${SH} }
.pn-toggle { ${border(CHIP)} background: #222731 !important; background-clip: padding-box !important; font: 400 16px/1 ${D} !important; }
.pn-toggle.on { ${border(CHIP_ON)} background: #4a4430 !important; background-clip: padding-box !important; }

/* Small print brought up to each face's readable size (Tiny5 13, Jersey 10 16): the end-turn line, the
   tech queue's turns and the advisor's tag, the overview's facts and groups, the log's turns, the game's facts. */
.cv-endturn small { font: 400 13px/1.15 ${T} !important; letter-spacing: 0 !important; }
.tt-queue .cv-chip .cv-muted, .tt-queue .cv-chip small { font: 400 16px/1 ${D} !important; }
.adv-tag, .tt-card .meta .adv-tag { font-size: 13px !important; }
.ov-civ .facts span, .ov-ghead .stat, .mn-facts span, .cv-graph .tabs .cv-muted:not(.peak) { font-size: 13px !important; }
.ov-ghead b, .ov-civ .top b { font: 400 20px/1 ${D} !important; letter-spacing: .03em; ${SH} }
.nt-turn b { font: 400 20px/1 ${D}; letter-spacing: .03em; ${SH} }
.nt-turn .cv-muted { font-size: 13px !important; }
.pd-facts.small > div, .pd-card .cv-muted, .pd-unlocks { font-size: 13px !important; }
.pd-facts.small > div b { font: 400 18px/1 ${D}; }

/* The world being made: the cover in a slot, the title over it, a bar of blocks, the tip in a well. */
.cv-building .bd-art { ${border(SLOT)} background: #0b0d12 !important; background-clip: padding-box !important; }
.cv-building .bd-art img { image-rendering: auto; }
.cv-building .bd-art h1 { font-size: 46px !important; text-shadow: 3px 3px 0 #0b0d12, -1px -1px 0 #0b0d12, 1px -1px 0 #0b0d12, -1px 1px 0 #0b0d12 !important; }
.cv-building .bd-what b { font: 400 26px/1 ${D}; letter-spacing: .03em; ${SH} }
.cv-building .bd-what span { font: 400 24px/1 ${D}; color: var(--gold); ${SH} }
.cv-building .cv-progress { height: 18px !important; }
.cv-building .bd-world { font: 400 17px/1 ${D}; letter-spacing: .06em; text-transform: uppercase; }
.cv-building .bd-tip { ${border(SLOT_SM)} background: #1c2029 !important; background-clip: padding-box !important; font-family: ${R}; font-size: 14px; line-height: 1.4; color: #d8dee8; }
@media (max-width: 760px), (max-height: 520px) { .cv-building .bd-art h1 { font-size: 32px !important; } .cv-building .bd-what b { font-size: 21px; } }

/* The game's end: a result card. The way it was won on a glyph block beside the winner, the viewer's
   numbers in slots, the graph's lines stepping turn by turn, the standings with score bars of blocks. */
.cv-over { width: min(820px, 96vw) !important; gap: 10px !important; padding: 16px 20px !important; }
.cv-over .cv-graph svg { height: 140px !important; }
.cv-over .cv-graph .tabs { margin-bottom: 4px !important; }
.cv-over .ov-standings .who { flex-basis: 250px !important; }
.cv-over.won { box-shadow: 4px 4px 0 rgba(4,6,10,.5), 0 0 0 4px rgba(242,193,78,.35) !important; }
.cv-over .ov-kick { font-size: 20px !important; color: var(--gold); }
.cv-over.lost .ov-kick { color: #ff8a7a; }
.cv-over h2 { font-size: 40px !important; margin: 2px 0 4px !important; }
.cv-over .hero .cv-muted { font-size: 15px !important; }
.cv-over .ov-facts > div { ${border(SLOT_SM)} background: #181c24 !important; background-clip: padding-box !important; }
.cv-over .ov-facts small { font: 400 15px/1 ${D}; letter-spacing: .08em; text-transform: uppercase; }
.cv-over .ov-facts b { font: 400 24px/1 ${D}; letter-spacing: .03em; ${SH} }
.cv-graph { ${border(SLOT)} background: #13161d !important; background-clip: padding-box !important; box-shadow: none !important; }
.cv-graph .peak { font: 400 17px/1 ${D} !important; letter-spacing: .04em; }
.cv-legend { font-size: 13px !important; gap: 6px 14px !important; }
.cv-legend i { width: 12px !important; height: 12px !important; box-shadow: 0 0 0 2px #07090c, inset 0 2px 0 rgba(255,255,255,.3); }
.cv-legend .me { color: #fff; }
.cv-over .ov-standings .civrow { gap: 10px !important; }
.cv-over .ov-standings .civrow.first { box-shadow: inset 0 0 0 2px var(--gold), inset 4px 4px 0 rgba(242,193,78,.12) !important; background: #2e2a1e !important; }
.cv-over .ov-standings .civrow.me:not(.first) { box-shadow: inset 0 0 0 2px #5ab4ff, inset 2px 2px 0 #11141a !important; }
.cv-over .ov-standings .place { font: 400 24px/1 ${D}; ${SH} }
.cv-over .ov-standings .civrow.first .place { color: var(--gold); }
.cv-over .ov-standings .civrow { padding: 4px 10px !important; min-height: 38px; }
.cv-over .ov-standings .who { display: flex; align-items: baseline; gap: 8px; }
.cv-over .ov-standings .who b { font-size: 20px !important; line-height: 1; flex: none; }
.cv-over .ov-standings .who small { font-size: 13px; color: var(--muted); }
.cv-over .ov-standings .score { font: 400 24px/1 ${D}; color: #fff; ${SH} }
.ov-scorebar { ${border(SLOT_SM)} height: 14px !important; background: #0f1218 !important; background-clip: padding-box !important; }
.ov-scorebar i { background: repeating-linear-gradient(90deg, transparent 0 8px, #0f1218 8px 10px), linear-gradient(180deg, rgba(255,255,255,.35) 0 2px, transparent 2px), var(--civ) !important; }
.cv-over .ov-acts .cv-btn { font-size: 22px !important; padding: 6px 18px 7px !important; }
@media (max-width: 760px), (max-height: 520px) {
  .cv-over h2 { font-size: 26px !important; }
  .cv-over .ov-kick { font-size: 16px !important; }
  .cv-over .ov-facts small { font-size: 12px; } .cv-over .ov-facts b { font-size: 18px; }
  .cv-over .ov-standings .who b { font-size: 17px !important; } .cv-over .ov-standings .score, .cv-over .ov-standings .place { font-size: 19px; }
}
/* A short screen (a phone on its side): diplomacy's leaders a column of portraits, the room left to the leader or the deal. */
@media (max-height: 520px) {
  .cv-dip-body { grid-template-columns: 58px minmax(0, 1fr) !important; grid-template-rows: none !important; gap: 8px !important; }
  .cv-dip-list { flex-direction: column !important; overflow-x: hidden !important; overflow-y: auto !important; }
  .cv-dip-civ { min-width: 0 !important; padding: 4px !important; justify-content: center; }
  .cv-dip-civ > .cv-grow, .cv-dip-civ > .cv-chip { display: none !important; }
  .cv-dip-civ .cv-portrait, .cv-dip-civ .cv-tile { width: 40px !important; height: 40px !important; }
  .cv-dip > .title small { display: none; }
  .cv-trade { gap: 8px !important; } .cv-trade-deal { gap: 8px !important; padding: 6px !important; }
}

/* A full top bar on a wide screen (ui.ts fitTop): the numbers a little smaller, the resources closer. */
@media (min-width: 761px) and (min-height: 521px) {
  .cv-root.top-tight .cv-stat { font-size: 21px !important; padding: 3px 4px !important; gap: 4px !important; }
  .cv-root.top-tight .cv-stat small { font-size: 16px !important; }
  .cv-root.top-tight .cv-top .cv-stat[data-pedia^="resource:"] { font-size: 18px !important; gap: 1px !important; padding: 3px 2px !important; }
}

/* A phone held upright: the prompt to turn it, as the rest is drawn. */
.cv-rotate { background: #1c2029 !important; }
.cv-rotate .cv-h.big { font-size: 34px !important; }
.cv-rotate-phone { border: 0 !important; background: #343c4d; box-shadow: inset 0 0 0 4px #eef1f5, inset 0 0 0 6px #07090c, 4px 4px 0 rgba(4,6,10,.5); }
.cv-root.top-scroll .cv-top .menu { background: #262c37 !important; box-shadow: -10px 0 8px -4px #262c37; }
@media (orientation: portrait) and (max-width: 600px) { .cv-top .menu { background: #262c37 !important; box-shadow: -10px 0 8px -4px #262c37; } }

/* Small screens (a phone on its side, a small window): the type and the bar smaller, as style.ts has them. */
@media (max-width: 760px), (max-height: 520px) {
  :where(.cv-root > *) { font-size: 13px; }
  .cv-top { height: 40px !important; top: 4px !important; }
  .cv-stat { font-size: 18px !important; padding: 2px 3px !important; gap: 4px !important; }
  .cv-top .civ { padding-right: 8px !important; margin-right: 4px !important; }
  /* Strategic resources: each a glyph and its count, close. */
  .cv-top .cv-stat[data-pedia^="resource:"] { font-size: 16px !important; gap: 1px !important; padding: 2px 2px !important; }
  .cv-top .menu button { width: 28px !important; height: 28px !important; }
  .cv-research, .cv-notes, .cv-city, .nt-panel, .nt-digest, .cv-big { top: 48px !important; }
  .cv-h { font-size: 20px !important; } .cv-h.big { font-size: 24px !important; }
  .cv-btn { font-size: 17px !important; padding: 2px 7px 3px !important; } .cv-btn.small { font-size: 16px !important; }
  .cv-endturn .t { font-size: 20px !important; }
  .cv-endturn > .cv-i { display: none !important; }
  .cv-endturn small { font-size: 11px !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cv-research small { white-space: nowrap; }
  .cv-research .name { font-size: 17px !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cv-unit { width: min(330px, calc(100vw - 176px)) !important; }
  .cv-unit .cv-h { font-size: 22px !important; }
  .cv-city .cv-h.big { font-size: 28px !important; }
  .cv-city .pop { width: 40px !important; height: 40px !important; font-size: 26px !important; }
  .cv-yields > div { font-size: 18px !important; padding: 2px 4px !important; }
  .cv-tabs button { font-size: 17px !important; padding: 4px 6px 5px !important; }
  .cv-opt .n { font-size: 18px !important; }
  .cv-now .cv-grow > div:nth-child(2) { font-size: 20px !important; }
  .cv-lobby h1 { font-size: 40px !important; }
  .pd-head h2 { font-size: 28px !important; }
}
.cv-scroll { scrollbar-color: #4d5770 #11141a; }
.cv-scroll::-webkit-scrollbar { width: 10px; } .cv-scroll::-webkit-scrollbar-track { background: #11141a; } .cv-scroll::-webkit-scrollbar-thumb { background: #4d5770; border-radius: 0; box-shadow: inset 2px 2px 0 #66728f, inset -2px -2px 0 #343c4d; }
`;

// -------------------------------------------------------------------------------------------------
// Pixel glyphs: each line icon drawn small and kept to its solid pixels (once for each glyph and
// size), then drawn as squares in the text's colour, a dark pixel's shadow under it.

const ready = new Map<string, string>();
const waiting = new Set<string>();
let onReady: (() => void) | null = null;
let settle = 0;

/** The pixels for a glyph `size` screen pixels across: each 2 pixels square from 22 up (a grid of 11 or more), else 1. */
const gridOf = (size: number) => (size >= 22 ? Math.round(size / 2) : Math.round(size));

async function rasterize(name: string, grid: number): Promise<string> {
  // Small ones (14 pixels or fewer) drawn with lines of a pixel, kept a little more readily, so they stay open; bigger ones bolder.
  const small = grid <= 14;
  const sw = Math.max(small ? 0 : 1.9, ((small ? 0.95 : 1.15) * 24) / grid).toFixed(2);
  const keep = small ? 110 : 100;
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${grid}" height="${grid}" fill="none" stroke="#000" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${glyphPaths(name).replace(/currentColor|#fff\b/g, '#000')}</svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = grid;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, grid, grid);
  const a = ctx.getImageData(0, 0, grid, grid).data;
  let d = '';
  for (let y = 0; y < grid; y++)
    for (let x = 0; x < grid; ) {
      if (a[(y * grid + x) * 4 + 3] < keep) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < grid && a[(y * grid + x + w) * 4 + 3] >= keep) w++;
      d += `M${x} ${y}h${w}v1h-${w}z`;
      x += w;
    }
  return d;
}

/** The pixel glyph's markup for a path that's ready. */
const glyphMarkup = (d: string, grid: number, size: number, color?: string) =>
  `<svg class="cv-ico px" viewBox="0 0 ${grid} ${grid}" width="${size}" height="${size}" shape-rendering="crispEdges"${color ? ` style="color:${color}"` : ''} aria-hidden="true"><path d="${d}" fill="rgba(7,9,12,.6)" transform="translate(1 1)"/><path d="${d}" fill="currentColor"/></svg>`;

/**
 * Pictures made since the last swap: once a batch is in (nothing asked for in the last 30 ms), the
 * stand-ins drawn while they were being made (marked `data-px`, `data-pxe`) are swapped for them where
 * they stand, without redrawing the interface (a big panel, the tech tree's, would be built again for each).
 */
function swapStandIns() {
  for (const el of document.querySelectorAll<SVGElement>('svg[data-px]')) {
    const [name, size, ...colour] = el.dataset.px!.split('|');
    const grid = gridOf(+size);
    const d = ready.get(`${name}|${grid}`);
    if (d === undefined) continue;
    if (!d) el.removeAttribute('data-px');
    else el.outerHTML = glyphMarkup(d, grid, +size, colour.join('|') || undefined);
  }
  for (const el of document.querySelectorAll<SVGElement>('svg[data-pxe]')) {
    const url = ready.get(standInKeys.get(el.dataset.pxe!) ?? '');
    if (url === undefined) continue;
    const size = el.getAttribute('width') ?? '40';
    if (!url) el.removeAttribute('data-pxe');
    else el.outerHTML = `<img class="cv-emblem px" src="${url}" width="${size}" height="${size}" alt="" draggable="false" style="image-rendering:pixelated">`;
  }
  onReady?.();
}
const madeOne = () => {
  clearTimeout(settle);
  settle = window.setTimeout(swapStandIns, 30);
};

function pixelGlyph(name: string, size: number, color?: string): string | null {
  const grid = gridOf(size);
  const key = `${name}|${grid}`;
  const d = ready.get(key);
  if (d === undefined) {
    if (!waiting.has(key)) {
      waiting.add(key);
      rasterize(name, grid)
        .then((path) => ready.set(key, path))
        .catch(() => ready.set(key, ''))
        .finally(() => {
          waiting.delete(key);
          madeOne();
        });
    }
    // The line glyph meanwhile, marked to be swapped.
    return `<svg class="cv-ico" data-px="${name}|${size}${color ? `|${color}` : ''}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"${color ? ` style="color:${color}"` : ''} aria-hidden="true">${glyphPaths(name)}</svg>`;
  }
  if (!d) return null;
  return glyphMarkup(d, grid, size, color);
}

/** A picture of an SVG drawn at `grid` pixels (its edges hard: each pixel there or not, in its own colour), as a PNG's blob address. */
async function rasterizeColour(markup: string, grid: number): Promise<string> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replace(/width="[^"]*" height="[^"]*"/, `width="${grid}" height="${grid}"`))}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = grid;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, grid, grid);
  const px = ctx.getImageData(0, 0, grid, grid);
  for (let i = 0; i < px.data.length; i += 4) {
    px.data[i + 3] = px.data[i + 3] < 110 ? 0 : 255;
  }
  ctx.putImageData(px, 0, 0);
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done));
  return blob ? URL.createObjectURL(blob) : '';
}

/** Emblems as pixels: each one's picture, made once for each emblem and size. */
/** Emblems being made: each stand-in's mark, and the key of what it's waiting for. */
const standInKeys = new Map<string, string>();
const markOf = new Map<string, string>();

function pixelEmblem(markup: string, size: number): string | null {
  const grid = gridOf(size);
  const key = `${markup}|${grid}`;
  const url = ready.get(key);
  if (url === undefined) {
    if (!waiting.has(key)) {
      waiting.add(key);
      rasterizeColour(markup, grid)
        .then((u) => ready.set(key, u))
        .catch(() => ready.set(key, ''))
        .finally(() => {
          waiting.delete(key);
          madeOne();
        });
    }
    // The drawn emblem meanwhile, marked to be swapped (a mark for each emblem and size).
    let mark = markOf.get(key);
    if (!mark) {
      mark = String(markOf.size);
      markOf.set(key, mark);
      standInKeys.set(mark, key);
    }
    return markup.replace('<svg ', `<svg data-pxe="${mark}" `);
  }
  if (!url) return null;
  return `<img class="cv-emblem px" src="${url}" width="${size}" height="${size}" alt="" draggable="false" style="image-rendering:pixelated">`;
}

/** Draw every glyph and emblem as pixels from now on (`made`: told when more have been made, after they're swapped in). */
export function usePixelGlyphs(made: () => void) {
  onReady = made;
  restyleGlyphs(pixelGlyph, pixelEmblem);
}

/** The map's type (its banners, tags and numbers): Jersey 10, a little larger than the sizes Inter was drawn at. */
export const mapFont = (px: number) => `400 ${Math.round(px * 1.45)}px 'Jersey 10', 'Tiny5', sans-serif`;
