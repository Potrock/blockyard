import { CHAT_LENGTH, EMOTES, PINGS, type EmoteId, type PingKind } from '../rules/chat';
import { CIVS } from '../rules/civs';
import type { ChatLine, ChatTo } from '../rules/state';
import { centreHere, landY, lookAt, toScreen } from './camera';
import { emblemEl, icon } from './icons';
import type { Pen } from './lenses';
import { mapFont } from './pixel';
import { play } from './sound';
import { cityAt, me, store, teammate } from './store';
import { h, tell, type El } from './ui';

/**
 * Talking across the table: a chat for everyone in the game, your team or one civ you've met (M opens
 * it, Enter sends); a face your leader makes (the others see it by your portrait); and a ping, a tile
 * pointed at for a few seconds (Alt+click it, or the tile's menu), rings on the map and the minimap,
 * an arrow at the screen's edge where it's off it. A bot's leader spoken to answers as it feels about
 * you (`rules/chat.ts`). In the lobby, the same chat, to everyone there.
 */

/** Each emote's face. */
export const FACES: Record<EmoteId, string> = { wave: '👋', laugh: '😂', gg: '🤝', peace: '🕊️', think: '🤔', cry: '😢', eyes: '👀', angry: '😠', fire: '🔥', skull: '💀' };

/** Each ping's glyph and colour. */
const PING_LOOK: Record<PingKind, { glyph: string; color: string }> = {
  look: { glyph: 'spy', color: '#ffd23a' },
  attack: { glyph: 'war', color: '#ff6b5e' },
  defend: { glyph: 'shield', color: '#5ab4ff' },
};

/** How many lines are kept; how long one stays on the map's corner with the chat shut; a ping's seconds; a face's by its leader. */
const KEPT = 80;
const SHOWN = 14;
const PING_SECONDS = 6;
const FACE_SECONDS = 5;

/** The lines (oldest first), and when each came (the page's clock, seconds). */
let lines: { line: ChatLine; at: number }[] = [];
let open = false;
/** Who what's typed goes to. */
let to: ChatTo = 'all';
/** Lines come in with the chat shut. */
let unread = 0;
/** What's being typed in each field (kept while the chat's shut). */
const drafts = new Map<string, string>();
/** The pings on show. */
let pings: { tile: number; kind: PingKind; color: string; name: string; at: number }[] = [];
/** The last face each player's leader made. */
const faces = new Map<number, { emote: EmoteId; at: number }>();

const now = () => performance.now() / 1000;
const colorOf = (l: ChatLine) => CIVS[l.civ ?? '']?.color ?? '#9aa4b5';

/** A line, come in. */
export function takeChat(line: ChatLine) {
  const t = now();
  lines.push({ line, at: t });
  if (lines.length > KEPT) lines.splice(0, lines.length - KEPT);
  const mine = line.from >= 0 && line.from === me() && !line.bot;
  if (!open && !mine) unread++;
  if (line.ping) {
    pings = pings.filter((p) => t - p.at < PING_SECONDS && p.tile !== line.ping!.tile);
    pings.push({ tile: line.ping.tile, kind: line.ping.kind as PingKind, color: colorOf(line), name: line.name, at: t });
    play('ping');
  } else if (!mine) play('chat');
  if (line.emote && line.from >= 0) faces.set(line.from, { emote: line.emote as EmoteId, at: t });
  store.changed++;
}

/** The lines kept with the game (or the lobby's), as a screen comes in. */
export function takeChatLog(log: ChatLine[]) {
  // (Long said: none of them on the map's corner, nor pings.)
  lines = log.slice(-KEPT).map((line) => ({ line, at: -Infinity }));
  unread = 0;
  pings = [];
  faces.clear();
  store.changed++;
}

/** Say something (words, a face, a tile pointed at) to whoever the chat's set to, or `target`. */
function say(d: { text?: string; emote?: EmoteId; ping?: { tile: number; kind: PingKind } }, target: ChatTo = to) {
  tell('chat', { ...d, to: target });
}

/** Point at a tile for the others (the chat's choice of who). */
export function pingTile(tile: number, kind: PingKind = 'look') {
  if (tile < 0 || !store.known[tile]) return;
  say({ ping: { tile, kind } });
}

/** A tile's buttons to ping it (its menu's, its card's on a touch screen): look, attack, defend. `then`: after one's pressed. */
export function pingButtons(tile: number, then?: () => void): El {
  return h(
    'div.ch-pings',
    {},
    ...(Object.keys(PINGS) as PingKind[]).map((k) =>
      h('button.ch-pingbtn', { onclick: () => (pingTile(tile, k), then?.()), title: `${PINGS[k]}: point at it for ${to === 'team' ? 'your team' : typeof to === 'number' ? (store.view?.players[to]?.name ?? 'them') : 'everyone'} (Alt+click a tile for a quick one)` }, icon(PING_LOOK[k].glyph, 14, PING_LOOK[k].color), h('span', {}, PINGS[k].replace(' here', ''))),
    ),
  );
}

/** Whether the game has teams, and you're on one with someone. */
const onTeam = () => !!store.view?.players.some((p) => p.index !== me() && teammate(p.index));

/** Who the chat can go to: everyone, your team, each civ you've met (not a city-state). */
function targets(): [ChatTo, string][] {
  const v = store.view;
  const out: [ChatTo, string][] = [['all', 'Everyone']];
  if (!v || v.spectator) return out;
  if (onTeam()) out.push(['team', 'Your team']);
  for (const p of v.players) if (p.index !== me() && p.met && p.alive && !p.cityState && p.civ !== 'barbarian') out.push([p.index, `${p.name}${p.bot ? '' : ' (person)'}`]);
  return out;
}

/** The chat opened (with its field ready), or shut. */
export function toggleChat(show = !open, target?: ChatTo) {
  open = show;
  if (target !== undefined) to = target;
  if (open) {
    unread = 0;
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.ch-dock .ch-field')?.focus());
  }
  store.changed++;
}
export const chatOpen = () => open;
/** Whether anything's been said. */
export const chatSaid = () => lines.length > 0;

/**
 * Now and then the chat's corner needs drawing again though nothing else has changed (a line gone
 * stale, a ping or a face over): every frame, cheaply.
 */
let due = Infinity;
export function frameChat() {
  const t = now();
  if (t < due) return;
  due = Infinity;
  store.changed++;
}
const dueAt = (t: number) => (due = Math.min(due, t));

/** Who a line is for, said after the name (none when it's everyone's). */
function toWords(l: ChatLine): string {
  if (l.to === 'all') return '';
  if (l.to === 'team') return 'to the team';
  if (l.to === me()) return 'to you';
  return `to ${store.view?.players[l.to]?.name ?? 'them'}`;
}

/** Where a tile is, in a word or two (the city on it, or near it). */
function near(t: number): string {
  const c = cityAt(t);
  if (c) return c.name;
  const g = store.grid;
  if (!g || !store.view) return '';
  const close = store.view.cities
    .map((x) => ({ x, d: Math.hypot(centreHere(g, x.tile).x - centreHere(g, t).x, centreHere(g, x.tile).z - centreHere(g, t).z) }))
    .sort((a, b) => a.d - b.d)[0];
  return close && close.d < 40 ? `near ${close.x.name}` : '';
}

/** The map on a tile pointed at. */
function goTo(t: number) {
  const g = store.grid;
  if (!g) return;
  const c = centreHere(g, t);
  lookAt(c.x, c.z);
}

/** A line, as the chat shows it: whose (in their colours), who it's for, the words, the face, the tile. */
function lineEl(l: ChatLine): El {
  const where = l.ping ? near(l.ping.tile) : '';
  const tile = l.ping?.tile;
  return h(
    `div.ch-line${l.ping ? '.ping' : ''}`,
    tile !== undefined ? { onclick: () => goTo(tile), title: 'Go there' } : {},
    l.civ && CIVS[l.civ] ? h('span.ch-em', {}, emblemEl(l.civ, 14)) : null,
    // (The civ's colour, lightened: a dark one, England's red, would be lost on the dark panel.)
    h('b', { style: `color:color-mix(in srgb, ${colorOf(l)} 62%, #fff)` }, l.name),
    toWords(l) && h('small.ch-to', {}, toWords(l)),
    l.emote && h('span.ch-face', { title: EMOTES[l.emote as EmoteId]?.name ?? '' }, FACES[l.emote as EmoteId] ?? ''),
    l.ping && h('span.ch-ping', { style: `color:${PING_LOOK[l.ping.kind as PingKind]?.color ?? '#ffd23a'}` }, icon(PING_LOOK[l.ping.kind as PingKind]?.glyph ?? 'pin', 13), `${PINGS[l.ping.kind as PingKind] ?? 'Look here'}${where ? ` (${where})` : ''}`),
    l.text && h('span.ch-text', {}, l.text),
  );
}

/**
 * The lines, in a box that scrolls (`key` names it): kept at the newest as they come in, unless it's
 * been scrolled up to read what came before.
 */
function logEl(key: string, empty: string, cls = ''): El {
  const was = document.querySelector<HTMLElement>(`.ch-log[data-key="${key}"]`);
  const newest = !was || was.scrollTop + was.clientHeight >= was.scrollHeight - 8;
  const log = h(`div.ch-log${cls}.cv-scroll`, { 'data-key': key }, ...(lines.length ? lines.map((x) => lineEl(x.line)) : [h('small.cv-muted', {}, empty)]));
  if (newest) requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
  return log;
}

/** The faces, as buttons that make them (at `target`, or whoever the chat's set to). */
function faceBar(target?: ChatTo): El {
  return h('div.ch-faces', {}, ...Object.entries(FACES).map(([id, face]) => h('button.ch-facebtn', { onclick: () => say({ emote: id as EmoteId }, target ?? to), title: EMOTES[id as EmoteId].name }, face)));
}

/**
 * A field to type in (Enter sends it to `target`), and Send. `key` names it: a field being typed in
 * goes on in the chat drawn again (`ui.ts`, `fill`), so lines can come in while you type.
 */
function field(key: string, target: () => ChatTo, placeholder: string): El {
  const input = h('input.cv-input.ch-field', { value: drafts.get(key) ?? '', placeholder, maxlength: String(CHAT_LENGTH), spellcheck: 'false', autocomplete: 'off', 'data-key': key }) as HTMLInputElement;
  const send = () => {
    const text = input.value.trim();
    if (!text) return;
    say({ text }, target());
    input.value = '';
    drafts.delete(key);
  };
  input.addEventListener('input', () => drafts.set(key, input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape' && open) toggleChat(false);
  });
  return h('div.ch-row', {}, input, h('button.cv-btn.small', { onclick: send }, 'Send'));
}

/**
 * The chat over the map: shut, the last few lines a moment (and a button, with how many came in);
 * open, the lines kept, who it's for, the faces and the field.
 */
export function renderChat(): El | null {
  const v = store.view;
  if (!v) return null;
  const t = now();
  const button = h(
    `button.ch-toggle.cv-btn.small${open ? '.on' : ''}`,
    { onclick: () => toggleChat(), title: open ? 'Shut the chat (Esc)' : 'Chat, faces and pings (M). Alt+click a tile to point at it' },
    icon('chat', 15),
    unread > 0 && !open && h('span.ch-unread', {}, String(Math.min(99, unread))),
  );
  if (!open) {
    const fresh = lines.filter((x) => t - x.at < SHOWN).slice(-5);
    for (const x of fresh) dueAt(x.at + SHOWN);
    return h('div.ch-dock', {}, fresh.length ? h('div.ch-recent', {}, ...fresh.map((x) => lineEl(x.line))) : null, button);
  }
  const choices = targets();
  if (!choices.some(([k]) => k === to)) to = 'all';
  const pick = h('select.cv-input.ch-pick', { title: 'Who it goes to' }, ...choices.map(([k, name]) => h('option', { value: String(k), selected: k === to }, name))) as HTMLSelectElement;
  pick.addEventListener('change', () => {
    const k = pick.value;
    to = k === 'all' || k === 'team' ? k : Number(k);
    store.changed++;
  });
  const log = logEl('dock', 'Nothing said yet. Say hello, make a face, or Alt+click a tile to point at it.');
  return h(
    'div.ch-dock.open',
    {},
    h(
      'div.ch-panel.cv-panel',
      {},
      h('div.ch-head', {}, icon('chat', 15, '#f2c14e'), h('b.cv-grow', {}, 'Chat'), pick),
      log,
      faceBar(),
      field('dock', () => to, typeof to === 'number' ? `Say something to ${v.players[to]?.name ?? 'them'}…` : to === 'team' ? 'Say something to your team…' : 'Say something to everyone…'),
    ),
    button,
  );
}

/** The chat in the lobby: what's been said there, and a field (to everyone in it). */
export function lobbyChat(): El {
  const log = logEl('lobby', 'Say hello while the game is set up.', '.lobby');
  unread = 0;
  return h('div.ch-lobby', {}, log, field('lobby', () => 'all', 'Say something to everyone here…'));
}

/**
 * The face a player's leader made a moment ago, over their portrait (`ribbon.ts`): it pops up and
 * fades (drawn again meanwhile, it goes on from where it was).
 */
export function faceEl(index: number): El | null {
  const f = faces.get(index);
  if (!f) return null;
  const age = now() - f.at;
  if (age >= FACE_SECONDS) return null;
  dueAt(f.at + FACE_SECONDS);
  return h('span.ch-over', { style: `animation-delay:-${age.toFixed(2)}s`, title: EMOTES[f.emote]?.name ?? '' }, FACES[f.emote] ?? '');
}

/** What a leader last said to you, or to everyone, in the last minute: for the diplomacy screen, as their words. */
export function lastWords(index: number): ChatLine | null {
  const t = now();
  for (let i = lines.length - 1; i >= 0; i--) {
    const x = lines[i];
    if (t - x.at > 60) break;
    if (x.line.from === index && x.line.text && (x.line.to === 'all' || x.line.to === me())) return x.line;
  }
  return null;
}

/** Speaking to one leader (the diplomacy screen's): a face to make at them, or words. */
export function talkTo(index: number): El {
  const p = store.view?.players[index];
  return h('div.ch-talk', {}, faceBar(index), field(`talk${index}`, () => index, `Say something to ${p?.name ?? 'them'}…`));
}

/** The pings on the minimap: a dot each, in the colours of whoever made it. */
export function minimapPings(dot: (tile: number, color: string) => void) {
  const t = now();
  for (const p of pings) if (t - p.at < PING_SECONDS) dot(p.tile, PING_LOOK[p.kind].color);
}

/**
 * The pings on the map: rings spreading from the tile in the ping's colour, its glyph and who made
 * it over it; off the screen, an arrow at its edge pointing the way.
 */
export function drawPings(pen: Pen) {
  const g = store.grid;
  if (!g || !pings.length) return;
  const t = now();
  const before = pings.length;
  pings = pings.filter((p) => t - p.at < PING_SECONDS);
  // (One over: off the minimap too.)
  if (pings.length < before) store.changed++;
  if (!pings.length) return;
  const { ctx, zoomed, ui } = pen;
  const W = window.innerWidth;
  const H = window.innerHeight;
  for (const p of pings) {
    const age = t - p.at;
    const fade = Math.min(1, (PING_SECONDS - age) / 1.2);
    const look = PING_LOOK[p.kind];
    const c = centreHere(g, p.tile);
    const at = toScreen(c.x, landY(p.tile), c.z);
    const on = !!at && at.x > 0 && at.x < W && at.y > 0 && at.y < H;
    if (on) {
      for (let k = 0; k < 3; k++) {
        const r = ((age * 0.9 + k / 3) % 1) * 1.6 + 0.5;
        const ring = new Path2D();
        if (!pen.hex(ring, p.tile, landY(p.tile), r)) continue;
        ctx.lineWidth = Math.round(3 * ui);
        ctx.strokeStyle = look.color;
        ctx.globalAlpha = fade * (1 - ((age * 0.9 + k / 3) % 1));
        ctx.stroke(ring);
      }
      ctx.globalAlpha = fade;
      const size = Math.round(Math.max(18, Math.min(30, zoomed * 0.8)) * ui);
      const top = toScreen(c.x, landY(p.tile) + 2.2 + 0.3 * Math.sin(age * 6), c.z);
      if (top) {
        const x0 = Math.round(top.x - size / 2);
        const y0 = Math.round(top.y - size);
        ctx.fillStyle = '#07090c';
        ctx.fillRect(x0 - 2, y0 - 2, size + 4, size + 4);
        ctx.fillStyle = p.color;
        ctx.fillRect(x0, y0, size, size);
        ctx.fillStyle = '#151922';
        ctx.fillRect(x0 + 2, y0 + 2, size - 4, size - 4);
        pen.glyph(look.glyph, x0 + size / 2, y0 + size / 2, size * 0.7, look.color);
        const fs = Math.round(12 * ui);
        ctx.font = mapFont(fs);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const tw = ctx.measureText(p.name).width;
        ctx.fillStyle = 'rgba(13,19,27,0.86)';
        ctx.fillRect(Math.round(top.x - tw / 2 - 4), y0 - fs - 8, Math.round(tw + 8), fs + 5);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(p.name, Math.round(top.x), y0 - 4);
      }
      ctx.globalAlpha = 1;
      continue;
    }
    // Off the screen: an arrow at the edge, the way to it.
    const from = { x: W / 2, y: H / 2 };
    const to2 = at ?? toScreen(c.x, landY(p.tile), c.z);
    if (!to2) continue;
    const ang = Math.atan2(to2.y - from.y, to2.x - from.x);
    const m = 34 * ui;
    const ex = Math.max(m, Math.min(W - m, from.x + Math.cos(ang) * W));
    const ey = Math.max(m, Math.min(H - m, from.y + Math.sin(ang) * H));
    ctx.save();
    ctx.globalAlpha = fade * (0.75 + 0.25 * Math.sin(age * 8));
    ctx.translate(ex, ey);
    ctx.rotate(ang);
    ctx.fillStyle = '#07090c';
    ctx.beginPath();
    ctx.moveTo(18 * ui, 0);
    ctx.lineTo(-10 * ui, -13 * ui);
    ctx.lineTo(-10 * ui, 13 * ui);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = look.color;
    ctx.beginPath();
    ctx.moveTo(14 * ui, 0);
    ctx.lineTo(-7 * ui, -9 * ui);
    ctx.lineTo(-7 * ui, 9 * ui);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

export const CHAT_CSS = `
.ch-dock { position: absolute; left: 8px; top: calc(var(--research-bottom, 124px) + 8px); width: 320px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; pointer-events: none; z-index: 3; }
.ch-dock > * { pointer-events: auto; }
.ch-recent { display: flex; flex-direction: column; gap: 3px; pointer-events: none !important; }
.ch-recent .ch-line { background: rgba(13,19,27,0.82); border: 2px solid #07090c; padding: 3px 7px; animation: cvIn .25s; }
.ch-recent .ch-line.ping { pointer-events: auto; cursor: pointer; }
.ch-line { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; font-size: 13px; line-height: 1.35; overflow-wrap: anywhere; }
.ch-line.ping { cursor: pointer; }
.ch-line b { font-weight: 800; }
.ch-em { display: inline-flex; }
.ch-to { color: var(--muted); font-style: italic; }
.ch-face { font-size: 20px; line-height: 1; }
.ch-ping { display: inline-flex; align-items: center; gap: 4px; font-weight: 700; }
.ch-text { color: var(--text); }
.ch-toggle { position: relative; display: inline-flex; align-items: center; gap: 4px; }
.ch-toggle.on { border-color: #f2c14e !important; }
.ch-unread { position: absolute; top: -7px; right: -7px; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 9px; background: #e05545; color: #fff; font-size: 11px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; border: 2px solid #07090c; }
.ch-panel { width: 100%; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.ch-head { display: flex; align-items: center; gap: 6px; }
.ch-pick { max-width: 150px; padding: 2px 4px; font-size: 12px; }
.ch-log { display: flex; flex-direction: column; gap: 4px; max-height: 210px; min-height: 60px; overflow-y: auto; padding: 4px; background: rgba(7,9,12,0.35); }
.ch-log.lobby { max-height: 150px; }
.ch-faces { display: flex; flex-wrap: wrap; gap: 3px; }
.ch-facebtn { width: 30px; height: 30px; font-size: 17px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; background: #1a1f28 !important; border: 2px solid #07090c !important; padding: 0; transition: transform .1s; }
.ch-facebtn:hover { background: #2e3542 !important; transform: scale(1.12); }
.ch-row { display: flex; gap: 6px; }
.ch-row .ch-field { flex: 1; min-width: 0; }
.ch-talk { display: flex; flex-direction: column; gap: 6px; }
.ch-over { position: absolute; left: 50%; top: 24px; z-index: 3; font-size: 30px; line-height: 1; pointer-events: none; filter: drop-shadow(0 2px 0 #07090c); animation: chFace ${FACE_SECONDS}s ease-out forwards; }
@keyframes chFace { 0% { transform: translate(-50%, -20%) scale(.2); opacity: 0; } 6% { transform: translate(-50%, -50%) scale(1.3); opacity: 1; } 12% { transform: translate(-50%, -50%) scale(1); } 80% { opacity: 1; } 100% { transform: translate(-50%, -70%); opacity: 0; } }
.ch-pings { display: flex; gap: 4px; }
.ch-pingbtn { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 5px 4px; font-size: 12px; background: #2e3542 !important; border: 2px solid #07090c !important; }
.ch-pingbtn:hover { background: #3a4252 !important; }
.pn-card .ch-pings { flex-basis: 100%; }
.ch-lobby { display: flex; flex-direction: column; gap: 6px; }
@media (max-width: 760px), (max-height: 560px) {
  .ch-dock { width: min(280px, calc(100vw - 16px)); top: calc(var(--research-bottom, 104px) + 6px); }
  .ch-log { max-height: 140px; }
}
`;
