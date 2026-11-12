import type { GameContext, Player } from '@platform';
import { ARMOUR, MAX_LEVEL, MEALS, nameOf, NOTES, weightOf, xpForLevel, xpToNext } from './data';
import { cancelJob, craft, knows, learn, QUEUE_MAX, recipeOf, recipes, sparksLeft, STATION_NAMES, whyNot, type BookRecipe } from './craft';
import { iconCell, glyphCell, ICON_COLUMNS } from './icons';
import { addItems, containerIfOpen, countItems, dropSlot, moveSlot, parseRef, protection, refsOf, slotAt, sortBag, stow, wear, type SlotRef } from './pack';
import { survivorOf, touch, type Slot, type Survivor } from './state';
import { canEat, eat } from './vitals';

/**
 * The survivor's journal: one screen (Tab) with three pages. The pack (belt, backpack, what's
 * worn, and an open container beside them), making things (by hand, or at the station that opened
 * it), and know-how (the recipes to learn with sparks). It's a widget, so the server builds it
 * from data and every click comes back as an action: pick a slot up with one click and put it
 * down with the next.
 */

export const JOURNAL = 'bt-journal';

const refText = (r: SlotRef) => `${r.kind}${r.index}`;

/** A slot as the screen shows it. */
function slotView(ref: SlotRef, stack: Slot, sel: string | null, empty = '') {
  const r = refText(ref);
  const cell = stack ? iconCell(stack.item) : { x: 0, y: 0 };
  return {
    r,
    x: cell.x,
    y: cell.y,
    n: stack && stack.count > 1 ? String(stack.count) : '',
    c: `${stack ? '' : `empty ${empty}`}${sel === r ? ' sel' : ''}`,
    t: stack ? nameOf(stack.item) : '',
  };
}

const TIERS: { from: number; title: string }[] = [
  { from: 1, title: 'Castaway' },
  { from: 5, title: 'Forager' },
  { from: 10, title: 'Homesteader' },
  { from: 18, title: 'Smith' },
  { from: 30, title: 'Warden' },
];

function recipeView(player: Player, s: Survivor, r: BookRecipe) {
  const cell = iconCell(r.item);
  const why = whyNot(player, r);
  const elsewhere = r.station !== null && s.ui.station !== r.station;
  return {
    k: r.key,
    x: cell.x,
    y: cell.y,
    name: r.count > 1 ? `${nameOf(r.item)} ×${r.count}` : nameOf(r.item),
    sub: elsewhere ? `at a ${STATION_NAMES[r.station!] ?? r.station}` : r.station ? (STATION_NAMES[r.station] ?? r.station) : 'by hand',
    c: elsewhere ? 'away' : why ? 'short' : 'ready',
    needs: r.needs.map(([item, n]) => {
      const c = iconCell(item);
      const have = countItems(player, item);
      return { x: c.x, y: c.y, t: `${have}/${n}`, c: have >= n ? 'ok' : 'lack', name: nameOf(item) };
    }),
    off: why !== null,
    off5: whyNot(player, r, 5) !== null,
  };
}

/** What the journal shows for a survivor now. */
function view(player: Player, s: Survivor) {
  const ui = s.ui;
  const box = ui.container ? containerIfOpen(ui.container) : undefined;
  const selRef = ui.sel ? parseRef(ui.sel, s) : null;
  const selStack = selRef ? slotAt(player, s, selRef) : null;
  if (!selStack) ui.sel = null;
  const worn = protection(s);
  const armour = selStack ? ARMOUR[selStack.item] : undefined;
  const meal = selStack ? MEALS[selStack.item] : undefined;
  const selCell = selStack ? iconCell(selStack.item) : { x: 0, y: 0 };
  const known = recipes().filter((r) => knows(s, r));
  // What can be made here first (the open station's, then by hand), then what needs another station.
  const here = known.filter((r) => r.station === ui.station && r.station !== null);
  const hand = known.filter((r) => r.station === null);
  const away = known.filter((r) => r.station !== null && r.station !== ui.station);
  const sparks = sparksLeft(s);
  const meta: string[] = [];
  if (selStack) {
    meta.push(`${(weightOf(selStack.item) * selStack.count).toFixed(1)} weight`);
    if (armour) meta.push(`armour ${armour.armor}`, `cold ${armour.cold >= 0 ? '+' : ''}${armour.cold}`, `heat ${armour.heat >= 0 ? '+' : ''}${armour.heat}`);
    if (meal?.food) meta.push(`food +${meal.food}`);
    if (meal?.water) meta.push(`water +${meal.water}`);
    if (meal?.risk) meta.push('risky raw');
  }
  return {
    tab: ui.tab,
    tabPack: ui.tab === 'pack' ? 'on' : '',
    tabCraft: ui.tab === 'craft' ? 'on' : '',
    tabLore: ui.tab === 'lore' ? 'on' : '',
    craftName: ui.station ? (STATION_NAMES[ui.station] ?? ui.station) : 'Handcraft',
    lvl: s.level,
    xp: s.level >= MAX_LEVEL ? 1 : Math.min(1, (s.xp - xpForLevel(s.level)) / xpToNext(s.level)),
    sparks,
    // ---- Pack ----
    bag: refsOf(s, 'b').map((r) => slotView(r, slotAt(player, s, r), ui.sel)),
    belt: refsOf(s, 'h').map((r) => slotView(r, slotAt(player, s, r), ui.sel)),
    worn: refsOf(s, 'w').map((r) => slotView(r, slotAt(player, s, r), ui.sel, `w${r.index}`)),
    boxOpen: !!box,
    boxTitle: box?.title ?? '',
    box: box ? refsOf(s, 'c').map((r) => slotView(r, slotAt(player, s, r), ui.sel)) : [],
    weight: s.weight.toFixed(1),
    limit: s.limit,
    heavy: s.weight > s.limit ? 'heavy' : '',
    armor: player.armor,
    cold: worn.cold,
    heat: worn.heat,
    sel: !!selStack,
    selX: selCell.x,
    selY: selCell.y,
    selName: selStack ? (selStack.count > 1 ? `${nameOf(selStack.item)} ×${selStack.count}` : nameOf(selStack.item)) : '',
    selNote: selStack ? (NOTES[selStack.item] ?? '') : '',
    selMeta: meta.join(' · '),
    canUse: !!selStack && (!!armour || !!meal) && selRef?.kind !== 'c',
    useLabel: armour ? (selRef?.kind === 'w' ? 'Take off' : 'Wear') : meal?.drink ? 'Drink' : 'Eat',
    canSplit: !!selStack && selStack.count > 1,
    sendLabel: selRef?.kind === 'c' ? 'To pack' : `To ${box?.title.toLowerCase() ?? 'box'}`,
    // ---- Making ----
    queue: s.queue.map((j) => {
      const r = recipeOf(j.key);
      const c = iconCell(r?.item ?? '');
      return { x: c.x, y: c.y, n: j.left > 1 ? String(j.left) : '', name: nameOf(r?.item ?? j.key) };
    }),
    busy: s.queue.length > 0,
    p: jobProgress(s),
    queueFull: s.queue.length >= QUEUE_MAX,
    recipes: [...here, ...hand, ...away].map((r) => recipeView(player, s, r)),
    none: known.length === 0,
    // ---- Know-how ----
    tiers: TIERS.map((tier, i) => {
      const to = TIERS[i + 1]?.from ?? MAX_LEVEL + 1;
      return {
        title: tier.title,
        range: `Level ${tier.from}${to > MAX_LEVEL ? '+' : `–${to - 1}`}`,
        c: s.level >= tier.from ? 'open' : 'shut',
        cards: recipes()
          .filter((r) => r.level >= tier.from && r.level < to)
          .map((r) => {
            const cell = iconCell(r.item);
            const has = knows(s, r);
            const state = has ? 'known' : s.level < r.level ? 'locked' : sparks < r.cost ? 'poor' : 'ready';
            return {
              k: r.key,
              x: cell.x,
              y: cell.y,
              name: nameOf(r.item),
              tag: has ? 'known' : s.level < r.level ? `level ${r.level}` : r.cost === 0 ? 'free' : `${r.cost} spark${r.cost > 1 ? 's' : ''}`,
              c: state,
              t: `${nameOf(r.item)}${r.station ? ` (${STATION_NAMES[r.station] ?? r.station})` : ''}: ${r.needs.map(([item, n]) => `${n} ${nameOf(item)}`).join(', ')}`,
            };
          }),
      };
    }).filter((t) => t.cards.length > 0),
  };
}

/** How far along the job in hand is, 0..1 (in tenths: it's sent as it changes). */
function jobProgress(s: Survivor): number {
  const job = s.queue[0];
  const r = job && recipeOf(job.key);
  return r && r.time > 0 ? Math.round(Math.min(1, job.t / r.time) * 10) / 10 : 0;
}

// -----------------------------------------------------------------------------------------------
// Opening, closing, keeping it current
// -----------------------------------------------------------------------------------------------

/** Open the journal on a page (or bring it to that page if it's open). */
export function openJournal(player: Player, tab: Survivor['ui']['tab'], opts: { station?: string | null; container?: string | null } = {}): void {
  const s = survivorOf(player);
  s.ui.open = true;
  s.ui.tab = tab;
  s.ui.sel = null;
  s.ui.station = opts.station ?? null;
  s.ui.container = opts.container ?? null;
  s.ui.stale = false;
  s.ui.belt = beltKey(player);
  player.hud.widget(JOURNAL, view(player, s));
}

export function closeJournal(player: Player): void {
  const s = survivorOf(player);
  if (!s.ui.open) return;
  closed(s);
  player.hud.widget(JOURNAL).remove();
}

function closed(s: Survivor): void {
  s.ui.open = false;
  s.ui.sel = null;
  s.ui.station = null;
  s.ui.container = null;
}

const beltKey = (player: Player): string => player.inventory.slots.map((x) => (x ? `${x.item}${x.count}` : '')).join(',');

/** Every step: Tab opens it, and an open one follows what changed. */
export function stepJournal(player: Player, s: Survivor): void {
  if (!s.ui.open) {
    if (player.alive && player.input.pressed('Tab')) openJournal(player, 'pack');
    return;
  }
  if (!player.alive) return closeJournal(player);
  // The belt is the platform's: it changes without a word (a pickup, an arrow shot).
  const belt = beltKey(player);
  if (belt !== s.ui.belt) {
    s.ui.belt = belt;
    s.ui.stale = true;
  }
  if (s.ui.stale) {
    s.ui.stale = false;
    player.hud.widget(JOURNAL, view(player, s));
  } else if (s.queue.length > 0 && s.ui.tab === 'craft') {
    player.hud.widget(JOURNAL).set({ p: jobProgress(s) });
  }
}

// -----------------------------------------------------------------------------------------------
// Clicks
// -----------------------------------------------------------------------------------------------

/** The slot they've picked up, if it still holds something. */
function selected(player: Player, s: Survivor): SlotRef | null {
  const ref = s.ui.sel ? parseRef(s.ui.sel, s) : null;
  return ref && slotAt(player, s, ref) ? ref : null;
}

/** What the journal's buttons do, by action name: each takes the player who pressed it and the button's value. */
export const journalActions: Record<string, (player: Player, value: string) => void> = {
  tab(player, value) {
    const s = survivorOf(player);
    if (value !== 'pack' && value !== 'craft' && value !== 'lore') return;
    s.ui.tab = value;
    s.ui.sel = null;
    touch(s);
  },
  close(player) {
    closeJournal(player);
  },
  /** A slot clicked: pick it up, or put down what's picked up (onto it, or swapped with it). */
  slot(player, value) {
    const s = survivorOf(player);
    const ref = parseRef(value, s);
    if (!ref) return;
    const from = selected(player, s);
    if (!from) {
      s.ui.sel = slotAt(player, s, ref) ? value : null;
    } else if (from.kind === ref.kind && from.index === ref.index) {
      s.ui.sel = null;
    } else {
      moveSlot(player, s, from, ref);
      s.ui.sel = null;
    }
    touch(s);
  },
  /** Half the picked-up stack goes to an empty slot beside it. */
  split(player) {
    const s = survivorOf(player);
    const from = selected(player, s);
    const stack = from && slotAt(player, s, from);
    if (!from || !stack || stack.count < 2) return;
    const empty = refsOf(s, from.kind === 'w' ? 'b' : from.kind).find((r) => !slotAt(player, s, r)) ?? refsOf(s, 'b').find((r) => !slotAt(player, s, r));
    if (empty) moveSlot(player, s, from, empty, Math.floor(stack.count / 2));
    touch(s);
  },
  drop1(player) {
    const s = survivorOf(player);
    const from = selected(player, s);
    if (from) dropSlot(player, s, from, 1);
    touch(s);
  },
  dropall(player) {
    const s = survivorOf(player);
    const from = selected(player, s);
    if (from) dropSlot(player, s, from);
    s.ui.sel = null;
    touch(s);
  },
  /** Eat or drink the picked-up thing, or put it on (or take it off). */
  use(player) {
    const s = survivorOf(player);
    const from = selected(player, s);
    const stack = from && slotAt(player, s, from);
    if (!from || !stack || from.kind === 'c') return;
    if (ARMOUR[stack.item]) {
      if (from.kind === 'w') stow(player, s, from, ['b', 'h']);
      else wear(player, s, from);
      s.ui.sel = null;
      player.audio.play('bt_equip');
    } else {
      const meal = MEALS[stack.item];
      if (!meal || !canEat(player, meal)) return;
      // The meal first, then one fewer in the slot (what it leaves, a waterskin, goes where there's room).
      const left = stack.count - 1;
      moveOne(player, s, from, left, stack.item);
      eat(player, stack.item, { ...meal, leaves: undefined });
      if (meal.leaves) addItems(player, meal.leaves, 1, true);
    }
    touch(s);
  },
  /** The picked-up stack goes across: into the open container, or out of it. */
  send(player) {
    const s = survivorOf(player);
    const from = selected(player, s);
    if (!from || !s.ui.container) return;
    stow(player, s, from, from.kind === 'c' ? ['b', 'h'] : ['c']);
    s.ui.sel = null;
    touch(s);
  },
  takeall(player) {
    const s = survivorOf(player);
    for (const r of refsOf(s, 'c')) stow(player, s, r, ['b', 'h']);
    s.ui.sel = null;
    touch(s);
  },
  stowall(player) {
    const s = survivorOf(player);
    if (!s.ui.container) return;
    for (const r of refsOf(s, 'b')) stow(player, s, r, ['c']);
    s.ui.sel = null;
    touch(s);
  },
  sort(player) {
    const s = survivorOf(player);
    sortBag(player, s);
    s.ui.sel = null;
  },
  make(player, value) {
    if (!craft(player, value, 1)) player.audio.play('bt_deny');
  },
  make5(player, value) {
    if (!craft(player, value, 5)) player.audio.play('bt_deny');
  },
  cancel(player, value) {
    cancelJob(player, Number(value));
  },
  learn(player, value) {
    if (!learn(player, value)) player.audio.play('bt_deny');
  },
};

/** Leave `left` of an item in a slot (after one was eaten out of it). */
function moveOne(player: Player, s: Survivor, ref: SlotRef, left: number, item: string): void {
  if (ref.kind === 'h') player.inventory.set(ref.index, left > 0 ? { item, count: left } : null);
  else if (ref.kind === 'b') s.bag[ref.index] = left > 0 ? { item, count: left } : null;
  if (left <= 0) s.ui.sel = null;
}

// -----------------------------------------------------------------------------------------------
// The widget
// -----------------------------------------------------------------------------------------------

const SLOT = `<i class="ic r{{y}}" style="--x: {{x}}"></i><b>{{n}}</b>`;

const HTML = `
<div class="jr">
  <div class="tabs">
    <button data-action="tab" data-value="pack" class="tab {{tabPack}}">Pack</button>
    <button data-action="tab" data-value="craft" class="tab {{tabCraft}}">{{craftName}}</button>
    <button data-action="tab" data-value="lore" class="tab {{tabLore}}">Know-how<b class="pip" data-if="sparks > 0">{{sparks}}</b></button>
    <span class="who">Level {{lvl}}<i class="xp"><i style="--p: {{xp}}"></i></i></span>
    <button data-action="close" class="x" title="Close (Esc)">Esc</button>
  </div>

  <div class="pane pack" data-if="tab == 'pack'">
    <div class="col side" data-if="boxOpen">
      <h3>{{boxTitle}}</h3>
      <div class="grid box"><button data-each="box" data-action="slot" data-value="{{r}}" class="slot {{c}}" title="{{t}}">${SLOT}</button></div>
      <div class="row"><button data-action="takeall" class="btn">Take all</button><button data-action="stowall" class="btn">Stow pack</button></div>
    </div>
    <div class="col main">
      <div class="hd"><h3>Backpack</h3><span class="wt {{heavy}}"><i class="ic sm r0" style="--x: ${glyphCell('load').x}"></i>{{weight}} / {{limit}}</span><button data-action="sort" class="btn small">Tidy</button></div>
      <div class="grid bag"><button data-each="bag" data-action="slot" data-value="{{r}}" class="slot {{c}}" title="{{t}}">${SLOT}</button></div>
      <h3>Belt</h3>
      <div class="grid belt"><button data-each="belt" data-action="slot" data-value="{{r}}" class="slot {{c}}" title="{{t}}">${SLOT}<small>{{$n}}</small></button></div>
    </div>
    <div class="col info">
      <h3>Worn</h3>
      <div class="grid worn"><button data-each="worn" data-action="slot" data-value="{{r}}" class="slot {{c}}" title="{{t}}">${SLOT}</button></div>
      <p class="prot">Armour <b>{{armor}}</b> · Cold <b>{{cold}}</b> · Heat <b>{{heat}}</b></p>
      <div class="detail" data-if="sel">
        <div class="dh"><i class="ic big r{{selY}}" style="--x: {{selX}}"></i><h4>{{selName}}</h4></div>
        <p>{{selNote}}</p>
        <p class="meta">{{selMeta}}</p>
        <div class="acts">
          <button data-if="canUse" data-action="use" class="btn go">{{useLabel}}</button>
          <button data-if="boxOpen" data-action="send" class="btn go">{{sendLabel}}</button>
          <button data-if="canSplit" data-action="split" class="btn">Split</button>
          <button data-action="drop1" class="btn">Drop 1</button>
          <button data-if="canSplit" data-action="dropall" class="btn">Drop all</button>
        </div>
      </div>
      <p class="hint" data-if="!sel">Click a slot to pick it up, then click where it should go.</p>
    </div>
  </div>

  <div class="pane craft" data-if="tab == 'craft'">
    <div class="queue">
      <span class="lbl">Making</span>
      <button data-each="queue" data-action="cancel" data-value="{{$i}}" class="job" title="Cancel {{name}}">${SLOT}</button>
      <i class="bar" data-if="busy"><i style="--p: {{p}}"></i></i>
      <span class="idle" data-if="!busy">Nothing. Pick something below.</span>
    </div>
    <div class="list">
      <div data-each="recipes" class="rc {{c}}">
        <i class="ic r{{y}}" style="--x: {{x}}"></i>
        <div class="nm"><b>{{name}}</b><small>{{sub}}</small></div>
        <div class="needs"><span data-each="needs" class="need {{c}}" title="{{name}}"><i class="ic sm r{{y}}" style="--x: {{x}}"></i>{{t}}</span></div>
        <button data-action="make" data-value="{{k}}" class="btn go" disabled="{{off}}">Make</button>
        <button data-action="make5" data-value="{{k}}" class="btn" disabled="{{off5}}">×5</button>
      </div>
      <p class="hint" data-if="none">You know nothing yet. Learn something under Know-how.</p>
    </div>
  </div>

  <div class="pane lore" data-if="tab == 'lore'">
    <p class="sparks"><i class="ic sm r0" style="--x: ${glyphCell('spark').x}"></i><b>{{sparks}}</b> sparks to spend. Every level brings more.</p>
    <div class="tiers">
      <div data-each="tiers" class="tier {{c}}">
        <h4>{{title}} <small>{{range}}</small></h4>
        <div class="cards"><button data-each="cards" data-action="learn" data-value="{{k}}" class="card {{c}}" title="{{t}}"><i class="ic r{{y}}" style="--x: {{x}}"></i><span>{{name}}</span><small>{{tag}}</small></button></div>
      </div>
    </div>
  </div>
</div>`;

/** The stylesheet, with the item sheet the sprites are cut from: a `data:` picture for each of its rows. */
const css = (rowUrls: readonly string[]) => `
.jr { --u: 32px; width: min(900px, 96vw); max-height: 88vh; display: flex; flex-direction: column; color: #efe9da; font: 14px/1.35 var(--sans);
  background: linear-gradient(180deg, #2c3328, #1c211b); border: 2px solid #55624a; border-radius: 10px; box-shadow: 0 10px 0 #0007, 0 0 0 4px #14180fcc }
.ic { --u: 32px; display: block; flex: none; width: var(--u); height: var(--u); background-repeat: no-repeat;
  background-size: calc(var(--u) * ${ICON_COLUMNS}) var(--u); background-position: calc(var(--x) * var(--u) * -1) 0; image-rendering: pixelated }
${rowUrls.map((url, r) => `.ic.r${r} { background-image: url(${url}) }`).join('\n')}
.ic.sm { --u: 16px } .ic.big { --u: 48px }
.tabs { display: flex; align-items: center; gap: 4px; padding: 8px 10px 0; border-bottom: 2px solid #55624a }
.tab { position: relative; padding: 7px 16px 8px; background: #20261d; color: #b9c2a6; border: 2px solid #3f4a37; border-bottom: none; border-radius: 8px 8px 0 0;
  font: 700 14px var(--sans); letter-spacing: 0.04em; cursor: pointer }
.tab:hover, .tab:focus-visible { color: #fff; outline: none }
.tab.on { background: #55624a; color: #fff; border-color: #55624a }
.pip { margin-left: 6px; padding: 0 6px; border-radius: 9px; background: #f2b84b; color: #2a1c05; font-size: 12px }
.who { margin-left: auto; display: flex; align-items: center; gap: 8px; font-weight: 700; color: #d8e3bd }
.xp { display: block; width: 110px; height: 8px; border-radius: 4px; background: #11150f; overflow: hidden }
.xp i { display: block; height: 100%; width: calc(var(--p) * 100%); background: #9bd45a }
.x { margin-left: 10px; padding: 3px 9px; background: transparent; color: #b9c2a6; border: 2px solid #3f4a37; border-radius: 6px; font: 700 12px var(--sans); cursor: pointer }
.x:hover { color: #fff; border-color: #8a9a77 }
.pane { display: flex; gap: 14px; padding: 12px 14px 14px; min-height: 0; overflow: auto }
h3 { margin: 0 0 6px; font: 700 12px var(--sans); letter-spacing: 0.12em; text-transform: uppercase; color: #a9b593 }
h4 { margin: 0; font: 700 15px var(--sans) }
.col { display: flex; flex-direction: column; min-width: 0 }
.col.main h3:not(:first-child) { margin-top: 12px }
.hd { display: flex; align-items: center; gap: 10px; margin-bottom: 6px }
.hd h3 { margin: 0 }
.wt { display: flex; align-items: center; gap: 4px; margin-left: auto; font-weight: 700; color: #d8e3bd }
.wt.heavy { color: #ff8a6b }
.grid { display: grid; gap: 4px }
.grid.bag { grid-template-columns: repeat(8, 44px) }
.grid.belt { grid-template-columns: repeat(9, 44px) }
.grid.box { grid-template-columns: repeat(6, 44px) }
.grid.worn { grid-template-columns: repeat(3, 44px) }
.slot { position: relative; width: 44px; height: 44px; padding: 0; display: grid; place-items: center; background: #141811; border: 2px solid #3a4433; border-radius: 6px; cursor: pointer }
.slot:hover, .slot:focus-visible { border-color: #9bd45a; outline: none }
.slot.sel { border-color: #f2b84b; background: #3a3320; box-shadow: 0 0 0 2px #f2b84b55 }
.slot.empty .ic { visibility: hidden }
.slot.empty.w0 .ic, .slot.empty.w1 .ic, .slot.empty.w2 .ic { visibility: visible; opacity: 0.28 }
.slot.empty.w0 .ic { --x: ${glyphCell('head').x} !important }
.slot.empty.w1 .ic { --x: ${glyphCell('body').x} !important }
.slot.empty.w2 .ic { --x: ${glyphCell('feet').x} !important }
.slot b { position: absolute; right: 2px; bottom: 0; font: 700 12px var(--sans); color: #fff; text-shadow: 0 1px 0 #000, 1px 0 0 #000, -1px 0 0 #000, 0 -1px 0 #000 }
.slot small { position: absolute; left: 3px; top: 0; font: 700 10px var(--sans); color: #7d8a6b }
.side { padding-right: 14px; border-right: 2px solid #3a4433 }
.row { display: flex; gap: 6px; margin-top: 8px }
.info { flex: 1; min-width: 190px }
.prot { margin: 8px 0 10px; color: #b9c2a6 } .prot b { color: #fff }
.detail { padding: 10px; background: #141811; border: 2px solid #3a4433; border-radius: 8px }
.dh { display: flex; align-items: center; gap: 10px; margin-bottom: 6px }
.detail p { margin: 0 0 6px; color: #cfd6c0 }
.detail .meta { color: #a9b593; font-size: 12px }
.acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px }
.btn { padding: 5px 11px; background: #2c3526; color: #efe9da; border: 2px solid #55624a; border-radius: 6px; font: 700 13px var(--sans); cursor: pointer }
.btn:hover, .btn:focus-visible { background: #3d4a34; outline: none }
.btn.go { background: #4f7a2a; border-color: #7fbf4d; color: #fff }
.btn.go:hover { background: #5f9233 }
.btn.small { padding: 2px 9px; font-size: 12px }
.btn[disabled] { opacity: 0.35; cursor: default; pointer-events: none }
.hint { margin: 8px 0 0; color: #8f9b7c; font-size: 13px }
.pane.craft, .pane.lore { flex-direction: column; gap: 10px }
.queue { display: flex; align-items: center; gap: 6px; min-height: 48px; padding: 6px 10px; background: #141811; border: 2px solid #3a4433; border-radius: 8px }
.lbl { font: 700 12px var(--sans); letter-spacing: 0.12em; text-transform: uppercase; color: #a9b593; margin-right: 4px }
.job { position: relative; width: 40px; height: 40px; padding: 0; display: grid; place-items: center; background: #20261d; border: 2px solid #3a4433; border-radius: 6px; cursor: pointer }
.job:hover { border-color: #ff8a6b }
.job b { position: absolute; right: 2px; bottom: 0; font: 700 12px var(--sans); color: #fff; text-shadow: 0 1px 0 #000, 1px 0 0 #000 }
.bar { display: block; flex: 1; max-width: 220px; height: 10px; margin-left: 8px; border-radius: 5px; background: #0c0f0a; overflow: hidden }
.bar i { display: block; height: 100%; width: calc(var(--p) * 100%); background: #f2b84b; transition: width 0.25s linear }
.idle { color: #8f9b7c }
.list { display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 6px; align-content: start }
.rc { display: flex; align-items: center; gap: 10px; padding: 6px 8px; background: #20261d; border: 2px solid #3a4433; border-radius: 8px }
.rc.short { opacity: 0.8 } .rc.away { opacity: 0.45 }
.nm { display: flex; flex-direction: column; width: 128px; flex: none } .nm small { color: #8f9b7c; font-size: 12px }
.needs { display: flex; flex-wrap: wrap; gap: 4px 8px; flex: 1; min-width: 0 }
.need { display: flex; align-items: center; gap: 3px; font: 700 12px var(--sans); color: #cfe6ae }
.need.lack { color: #ff8a6b }
.sparks { display: flex; align-items: center; gap: 6px; margin: 0; color: #cfd6c0 } .sparks b { color: #f2b84b; font-size: 16px }
.tiers { display: flex; flex-direction: column; gap: 10px }
.tier h4 { margin-bottom: 6px; color: #d8e3bd } .tier h4 small { margin-left: 6px; font-weight: 400; color: #8f9b7c }
.tier.shut { opacity: 0.55 }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px }
.card { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 4px 6px; background: #20261d; color: #efe9da; border: 2px solid #3a4433; border-radius: 8px;
  font: 700 12px var(--sans); text-align: center; cursor: pointer }
.card small { font-weight: 400; color: #8f9b7c }
.card.ready { border-color: #f2b84b } .card.ready small { color: #f2b84b }
.card.ready:hover, .card.ready:focus-visible { background: #3a3320; outline: none }
.card.known { border-color: #7fbf4d; background: #263320; cursor: default } .card.known small { color: #9bd45a }
.card.locked, .card.poor { cursor: default } .card.locked .ic { filter: grayscale(1) brightness(0.6) }
.card.poor small { color: #ff8a6b }
@media (max-width: 760px) { .pane.pack { flex-wrap: wrap } .side { border-right: none; padding-right: 0 } .list { grid-template-columns: 1fr } }
`;

/** Define the journal (once, in `setup`), cut from the item sheet given as a `data:` picture a row. */
export function defineJournal(game: GameContext, rowUrls: readonly string[]): void {
  game.hud.define(JOURNAL, {
    at: 'center',
    modal: true,
    html: HTML,
    css: css(rowUrls),
    actions: journalActions,
    onClose(player) {
      closed(survivorOf(player));
    },
  });
}
