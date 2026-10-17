import { BUILDINGS } from '../rules/buildings';
import { CIVS } from '../rules/civs';
import { TECHS } from '../rules/techs';
import { UNITS } from '../rules/units';

/**
 * The interface's pictures that aren't models: line icons (24-unit squares, drawn in the current
 * colour) for the yields, resources, techs, buildings, policies and great people, and an emblem for
 * every civilization and city-state. All drawn here, in code: `svg` makes markup for the panels,
 * `iconImage` a picture for the map's canvas.
 */

// -------------------------------------------------------------------------------------------------
// The glyphs (SVG inside a 24 x 24 box; `F` marks a filled shape)

const F = 'fill="currentColor" stroke="none"';
/** Shapes turned about the box's middle (a weapon drawn upright, laid on the diagonal). */
const turn = (deg: number, shapes: string) => `<g transform="rotate(${deg} 12 12)">${shapes}</g>`;
/** A pike drawn upright: a long shaft, a small head. */
const PIKE = `<path d="M12 25V5"/><path ${F} d="M12-1.5l1.8 4.5L12 6l-1.8-3z"/>`;

const G: Record<string, string> = {
  // Yields and the empire.
  food: '<path d="M12 21V8"/><path d="M12 9c-3-1-4-4-4-6 3 0 4 3 4 6zM12 9c3-1 4-4 4-6-3 0-4 3-4 6zM12 14c-3-1-5-3-5-6 3 0 5 3 5 6zM12 14c3-1 5-3 5-6-3 0-5 3-5 6zM12 19c-3-1-5-3-5-6 3 0 5 3 5 6zM12 19c3-1 5-3 5-6-3 0-5 3-5 6z"/>',
  prod: '<path d="M14 4l6 6-3 3-6-6z"/><path d="M11 7l-8 8 3 3 8-8"/><path d="M15 15l5 5"/>',
  gold: '<circle cx="12" cy="12" r="8"/><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.6 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.2 0-2.2-.6-2.6-1.6M12 6.5V8M12 16v1.5"/>',
  science: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M7.5 15h9"/>',
  culture: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  faith: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/><circle cx="12" cy="12" r="3"/>',
  happy: '<circle cx="12" cy="12" r="9"/><path d="M8 14c1 2 2.5 3 4 3s3-1 4-3"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.6"/>',
  unhappy: '<circle cx="12" cy="12" r="9"/><path d="M8 17c1-2 2.5-3 4-3s3 1 4 3"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.6"/>',
  golden: '<path d="M12 2l2.6 6.4L21 9l-5 4.4L17.5 20 12 16.6 6.5 20 8 13.4 3 9l6.4-.6z"/>',
  tourism: '<path d="M2.5 13.5l19-8-5.5 15-4-5.5z"/><path d="M12 15l9.5-9.5"/>',
  turn: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pop: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5"/>',
  strength: '<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/>',
  ranged: '<path d="M4 20L20 4M20 4h-5M20 4v5M4 20l3-1M4 20l1-3"/><path d="M8 14l-2-2M11 11L9 9"/>',
  moves: '<path d="M5 12h12M13 6l6 6-6 6"/>',
  hp: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  xp: '<path d="M12 3l2.4 5 5.6.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.6-.8z"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  crown: '<path d="M3 8l4 4 5-7 5 7 4-4-2 10H5z"/><path d="M5 21h14"/>',
  city: '<path d="M3 21h18M5 21V10l4-3v14M9 21V5l6-2v18M15 21V11l4 2v8"/>',
  trade: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  spy: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>',
  vote: '<path d="M5 11l3 3 7-7"/><path d="M3 15v5h18v-5"/>',
  war: '<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 17.5L21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2"/>',
  peace: '<path d="M12 21c-4-3-8-6-8-11a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 5-4 8-8 11z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01" stroke-width="2.4"/>',
  lightbulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9l5 6M21 9l-5 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 6-7"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 14h.01M18 14h.01M9 14h6" stroke-width="2.2"/>',
  // Resources.
  wheat: '<path d="M12 21V8"/><path d="M12 9c-3-1-4-4-4-6 3 0 4 3 4 6zM12 9c3-1 4-4 4-6-3 0-4 3-4 6zM12 14c-3-1-5-3-5-6 3 0 5 3 5 6zM12 14c3-1 5-3 5-6-3 0-5 3-5 6z"/>',
  cattle: '<path d="M5 6c0 2 1 3 3 3M19 6c0 2-1 3-3 3"/><path d="M8 9h8l1 6c0 3-2 5-5 5s-5-2-5-5z"/><path d="M10 15h.01M14 15h.01" stroke-width="2.4"/><path d="M10 18h4"/>',
  sheep: '<circle cx="12" cy="12" r="6"/><circle cx="7" cy="9" r="2.5"/><circle cx="17" cy="9" r="2.5"/><circle cx="12" cy="7" r="2.5"/><path d="M9 18v3M15 18v3"/>',
  deer: '<path d="M8 3v4l-3 1M8 7l3 2M16 3v4l3 1M16 7l-3 2"/><path d="M9 10h6l-1 8-2 3-2-3z"/>',
  bananas: '<path d="M5 9c1 7 6 11 13 10M7 7c2 6 6 9 12 9M9 5c2 5 5 7 10 7"/><path d="M4 9l2-3"/>',
  fish: '<path d="M3 12c3-4 7-5 10-5s6 2 7 5c-1 3-4 5-7 5s-7-1-10-5z"/><path d="M20 12l2-3v6z"/><path d="M8 11h.01" stroke-width="2.4"/>',
  stone: '<path d="M4 17l3-8 6-3 6 4 1 7-8 3z"/><path d="M7 9l5 3 8-2M12 12l-1 8"/>',
  horses: '<path d="M7 21v-7c-2-1-3-3-2-6l4-4 2 2 4-1 4 4-1 3-3-1-2 3v7"/><path d="M11 7.5h.01" stroke-width="2.4"/>',
  iron: '<path d="M3 15h18l-2 5H5z"/><path d="M6 15l2-6h8l2 6"/><path d="M10 9V6h4v3"/>',
  coal: '<path d="M4 18l3-6 5 2 3-5 5 4-1 5z"/><path d="M8 13l-1-4 4 2"/>',
  oil: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
  aluminum: '<path d="M3 16l5-6h13l-5 6z"/><path d="M3 16v3h13v-3M16 19l5-6v-3"/>',
  uranium: '<circle cx="12" cy="12" r="2"/><path d="M12 10L8 3a9 9 0 0 1 8 0zM13.7 13L21 13a9 9 0 0 1-4 7zM10.3 13L7 20a9 9 0 0 1-4-7z"/>',
  gold_ore: '<path d="M6 14l3-5h6l3 5-6 6z"/><path d="M9 9l3 11 3-11M6 14h12"/>',
  silver: '<path d="M3 15l4-4h10l4 4zM5 20l4-4h10l4 4z"/>',
  gems: '<path d="M6 4h12l4 5-10 12L2 9z"/><path d="M2 9h20M9 4l3 17 3-17"/>',
  marble: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M8 5c1 4 5 5 4 9M14 11c2 2 3 5 6 6"/>',
  copper: '<ellipse cx="12" cy="9" rx="7" ry="3"/><path d="M5 9v6c0 1.7 3 3 7 3s7-1.3 7-3V9"/>',
  salt: '<path d="M5 18l3-8 3 8zM11 18l3-11 3 11z"/><path d="M3 18h18"/>',
  ivory: '<path d="M5 20c0-8 4-14 13-16-3 5-6 10-6 16"/>',
  furs: '<path d="M6 4l3 3h6l3-3 1 7-3 2 1 8H8l1-8-3-2z"/>',
  truffles: '<path d="M4 12a8 6 0 0 1 16 0z"/><path d="M9 12v6a3 3 0 0 0 6 0v-6"/>',
  dyes: '<path d="M12 3s5 6 5 10a5 5 0 0 1-10 0c0-4 5-10 5-10z"/><path d="M9 14a3 3 0 0 0 3 3"/>',
  spices: '<path d="M8 3c2 1 3 2 3 4"/><path d="M11 7c5 0 8 3 8 7s-4 7-9 7c-3 0-5-2-5-5 0-5 2-9 6-9z"/>',
  silk: '<path d="M4 6c3-2 6 2 9 0s5-2 7 0v12c-2-2-4-2-7 0s-6-2-9 0z"/>',
  sugar: '<path d="M8 21L10 3M14 21l2-18"/><path d="M9.4 9h2M8.7 15h2M15.3 9h2M14.6 15h2"/>',
  cotton: '<circle cx="12" cy="9" r="3"/><circle cx="8" cy="12" r="3"/><circle cx="16" cy="12" r="3"/><path d="M12 15v6M9 18l3 3 3-3"/>',
  wine: '<circle cx="12" cy="9" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="12" cy="15" r="2"/><circle cx="12" cy="19" r="2"/><path d="M12 7V3l3-1"/>',
  incense: '<path d="M5 14h14l-2 6H7z"/><path d="M10 11c-1-2 1-3 0-5M14 11c-1-2 1-3 0-5"/>',
  citrus: '<circle cx="12" cy="13" r="7"/><path d="M12 6v14M5 13h14M7 8l10 10M17 8L7 18"/><path d="M12 6c0-2 1-3 3-3"/>',
  cocoa: '<path d="M12 3c4 2 6 5 6 9s-2 7-6 9c-4-2-6-5-6-9s2-7 6-9z"/><path d="M12 3v18M8 7c2 2 2 8 0 10M16 7c-2 2-2 8 0 10"/>',
  whales: '<path d="M2 14c4 0 6-4 11-4 4 0 7 2 8 4-3 4-7 5-11 5-4 0-6-2-8-5z"/><path d="M2 14l-1-4 4 2"/><path d="M15 12h.01" stroke-width="2.4"/>',
  pearls: '<path d="M3 15c0-5 4-9 9-9s9 4 9 9z"/><path d="M7 15c0-3 2-6 5-6s5 3 5 6"/><circle cx="12" cy="18" r="2.5"/>',
  crab: '<ellipse cx="12" cy="13" rx="6" ry="4"/><path d="M6 12l-3-3 1-3 3 2M18 12l3-3-1-3-3 2M7 15l-3 3M17 15l3 3M8 17l-2 3M16 17l2 3"/>',
  // Techs and buildings.
  plough: '<path d="M3 17h10l6-10"/><path d="M7 17l-2 4M13 17l2 4M19 7l2-2"/>',
  pot: '<path d="M8 3h8M9 3v3c-3 1-5 4-5 8 0 4 3 7 8 7s8-3 8-7c0-4-2-7-5-8V3"/>',
  bow: '<path d="M5 3c8 4 8 14 0 18"/><path d="M5 3v18M5 12h15M17 9l3 3-3 3"/>',
  pick: '<path d="M4 9c4-5 12-5 16 0"/><path d="M12 6L5 21"/>',
  sail: '<path d="M12 3v14M12 4c4 3 6 7 6 11h-6M12 6c-3 3-5 6-5 9h5"/><path d="M3 18h18l-3 3H6z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M7 14h2M11 14h2M15 14h2M7 17h2M11 17h2"/>',
  quill: '<path d="M20 3C11 4 6 9 5 19l3-1c1-6 5-10 12-15z"/><path d="M4 21l4-3"/>',
  trap: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3L6.3 17.7"/>',
  wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 3v7M12 14v7M3 12h7M14 12h7"/>',
  bricks: '<path d="M3 5h18v14H3zM3 9.7h18M3 14.3h18M8 5v4.7M16 5v4.7M12 9.7v4.6M8 14.3V19M16 14.3V19"/>',
  axe: '<path d="M14 3l7 7-4 4c-2-3-4-5-7-7z"/><path d="M12 9L3 18l3 3 9-9"/>',
  lens: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L21 21"/>',
  compass_tool: '<circle cx="12" cy="5" r="2"/><path d="M11 7L5 21M13 7l6 14M7.5 15h9"/>',
  columns: '<path d="M3 21h18M4 18h16M5 8h14M3 8l9-5 9 5M6 8v10M10 8v10M14 8v10M18 8v10"/>',
  owl: '<circle cx="9" cy="10" r="2.5"/><circle cx="15" cy="10" r="2.5"/><path d="M5 5l2 3M19 5l-2 3M12 12v2M6 10c-1 6 2 10 6 11 4-1 7-5 6-11"/>',
  mask: '<path d="M4 4h16v6c0 6-4 10-8 10S4 16 4 10z"/><path d="M8 9h2M14 9h2M9 14c1.5 1.5 4.5 1.5 6 0"/>',
  coins: '<ellipse cx="9" cy="7" rx="6" ry="2.5"/><path d="M3 7v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V7"/><path d="M9 13.5v3.5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4c0-1.4-2.7-2.5-6-2.5"/>',
  sword: '<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/>',
  temple: '<path d="M3 21h18M5 21V11M9 21V11M15 21V11M19 21V11M3 11h18M12 3l9 8H3z"/>',
  scroll: '<path d="M6 4h12v14a3 3 0 0 1-3 3H6"/><path d="M6 4a2 2 0 0 0-2 2v2h2M15 21a3 3 0 0 0 3-3v-1H9v1a3 3 0 0 1-3 3"/><path d="M9 8h6M9 12h6"/>',
  guild: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
  crucible: '<path d="M5 8h14l-2 10a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3z"/><path d="M8 5c1-2 2-2 4 0s3 2 4 0"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2l1.5 3 3-1 .5 3.3 3.2.8-1.3 3L21 13l-3 1.5.6 3.3-3.3-.2L14 20.5 12 18l-2 2.5-1.3-2.9-3.3.2.6-3.3L3 13l2.1-2.1-1.3-3 3.2-.8.5-3.3 3 1z"/>',
  book: '<path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z"/>',
  lance: '<path d="M3 21L17 7M17 7l4-4-1 5-3-1"/><path d="M8 13l-3-3M11 16l-3-3"/>',
  gears: '<circle cx="8" cy="9" r="4"/><circle cx="16.5" cy="15.5" r="3.5"/><path d="M8 3v2M8 13v2M2 9h2M12 9h2M16.5 10v2M16.5 19v2M11 15.5h2M20 15.5h2"/>',
  pendulum: '<path d="M4 3h16M12 3l5 14"/><circle cx="17.5" cy="18.5" r="2.5"/><path d="M12 3L8 15" stroke-dasharray="2 2"/>',
  anvil: '<path d="M3 7h13c0 3 2 4 5 4-2 2-5 2-7 2l-1 3h3v4H7v-4h3l-1-3c-3 0-6-2-6-6z"/>',
  telescope: '<path d="M4 13l12-7 2 4-12 7z"/><path d="M10 15l-3 6M12 14l3 7M18 10l3-1-1-3-3 1"/>',
  lute: '<ellipse cx="9" cy="15" rx="5" ry="6"/><path d="M12 10l8-8M17 3l3 3"/><circle cx="9" cy="15" r="1.5"/>',
  bank: '<path d="M3 21h18M3 10h18M12 3l9 7H3zM6 10v8M10 10v8M14 10v8M18 10v8"/>',
  press: '<path d="M4 3h16v4H4zM12 7v5M6 12h12v4H6zM4 21h16"/><path d="M9 16v5M15 16v5"/>',
  cannon: '<path d="M3 13l14-6 2 4-14 6z"/><circle cx="8" cy="17" r="3.5"/><path d="M19 9h2"/>',
  ship_wheel: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19"/>',
  dome: '<path d="M3 21h18M5 21v-8h14v8M5 13a7 7 0 0 1 14 0M12 3v3M9 21v-4h6v4"/>',
  chart_up: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 6-7M16 6h4v4"/>',
  urn: '<path d="M8 3h8M9 3c0 3-4 4-4 9 0 5 3 9 7 9s7-4 7-9c0-5-4-6-4-9"/><path d="M6 12h12"/>',
  atom: '<circle cx="12" cy="12" r="1.8"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/>',
  factory: '<path d="M3 21V11l6 3V11l6 3V6h4v15z"/><path d="M15 3h4v3"/><path d="M7 18h2M12 18h2M17 18h1"/>',
  rifle: '<path d="M2 15l14-7h6v2l-6 2-3 2v4h-3l-1-3-5 3z"/>',
  medal: '<circle cx="12" cy="15" r="5"/><path d="M8 3l4 7 4-7M12 12.5v5M9.5 15h5"/>',
  sprout: '<path d="M12 21v-9M12 12c0-4 3-7 8-7 0 5-3 7-8 7zM12 15c0-3-2-6-7-6 0 4 2 6 7 6z"/>',
  dna: '<path d="M7 3c0 6 10 6 10 12s-10 3-10 6M17 3c0 6-10 6-10 12s10 3 10 6"/><path d="M8 7h8M8 17h8M10 10h4M10 14h4"/>',
  bolt: '<path d="M13 2L4 14h7l-2 8 9-12h-7z"/>',
  train: '<rect x="5" y="3" width="14" height="13" rx="3"/><path d="M5 10h14M9 16l-3 5M15 16l3 5M8 13h.01M16 13h.01" /><path d="M9 6h6"/>',
  dynamite: '<path d="M6 9h4v12H6zM10 9h4v12h-4zM14 9h4v12h-4z"/><path d="M12 9c0-3 2-4 4-5M17 3l1 2M19 5l-2 0"/>',
  snowflake: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 2 3-2M9 20l3-2 3 2"/>',
  radio: '<path d="M12 10v11M8 21h8M9 15l3-5 3 5"/><path d="M8 6a6 6 0 0 1 8 0M5 3a10 10 0 0 1 14 0"/>',
  bolt_gear: '<circle cx="12" cy="12" r="7"/><path d="M12 5v3M12 16v3M5 12h3M16 12h3"/><path d="M13 9l-3 3h4l-3 3"/>',
  plane: '<path d="M2 13l8-1 4-8h2l-1 8 6 1v2l-6 1 1 5h-2l-4-5-8-1z"/>',
  rail: '<path d="M7 2L4 22M17 2l3 20M5.5 7h13M5 12h14M4.5 17h15"/>',
  bottle: '<path d="M10 2h4v4l2 3v11a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V9l2-3z"/><path d="M8 12h8"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  piston: '<rect x="7" y="3" width="10" height="9" rx="1"/><path d="M12 12v5M9 17h6l-1 4h-4z"/><path d="M7 7h10"/>',
  pill: '<rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(-35 12 12)"/><path d="M9.7 8.7l4.6 6.6"/>',
  radar: '<path d="M5 17a9 9 0 0 1 4-13l6 9z"/><path d="M15 13l4-4M12 21v-4M8 21h8"/>',
  tank: '<rect x="3" y="13" width="18" height="6" rx="3"/><path d="M6 13l2-4h7l2 4M11 9V7h10"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 4 6 4 9s-1 6-4 9c-3-3-4-6-4-9s1-6 4-9z"/>',
  play: `<path ${F} d="M7 4.5v15l12.5-7.5z"/>`,
  pause: `<path ${F} d="M6 4.5h4.5v15H6zM13.5 4.5H18v15h-4.5z"/>`,
  leaf: '<path d="M5 19C5 10 11 4 20 4c0 9-6 15-15 15z"/><path d="M5 19L14 10"/>',
  rocket: '<path d="M12 2c4 3 5 8 4 13H8C7 10 8 5 12 2z"/><path d="M8 15l-3 4h4M16 15l3 4h-4M10 19l2 3 2-3"/><circle cx="12" cy="9" r="1.5"/>',
  computer: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 21h8M12 16v5"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  truck: '<path d="M2 6h12v10H2zM14 9h4l4 4v3h-8z"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/>',
  missile: '<path d="M4 20L18 6l2-4-4 2L2 18"/><path d="M7 13l-3 1 2 2M11 17l-1 3-2-2"/>',
  satellite: '<path d="M9 9l6 6M7 11l4-4 6 6-4 4z"/><path d="M3 7l4-4 3 3-4 4zM14 18l4-4 3 3-4 4z"/><path d="M17 4a6 6 0 0 1 3 3"/>',
  robot: '<rect x="5" y="7" width="14" height="11" rx="2"/><path d="M12 7V3M9 12h.01M15 12h.01M9 15h6M3 11v4M21 11v4" /><circle cx="12" cy="3" r="1"/>',
  laser: '<path d="M2 12h6M16 12h6"/><rect x="8" y="9" width="8" height="6" rx="1"/><path d="M19 7l2-2M19 17l2 2"/>',
  network: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M12 7.5v4M12 11.5l-5.5 4.5M12 11.5l5.5 4.5"/>',
  particles: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="9" cy="18" r="2"/><path d="M8 7l8 0.5M7 8l1.5 8M10.5 16.5l6-7"/>',
  fusion: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
  hexes: '<path d="M7 3l4 2.3v4.6L7 12.2 3 9.9V5.3zM17 3l4 2.3v4.6l-4 2.3-4-2.3V5.3zM12 11.8l4 2.3v4.6L12 21l-4-2.3v-4.6z"/>',
  // A natural wonder: a peak under a star.
  peak: `<path d="M2.5 20.5l7-12 3.6 6 2.4-3.4 6 9.4z"/><path d="M8 13.5l1.5-1.3 1.6 1.4"/><path ${F} d="M18 2.5l.9 2 2.1.3-1.5 1.5.4 2.1-1.9-1-1.9 1 .4-2.1L15 4.8l2.1-.3z"/>`,
  jet: '<path d="M12 2l2 8 8 4v2l-8-1-1 5 3 2v1h-8v-1l3-2-1-5-8 1v-2l8-4z"/>',
  infinity: '<path d="M6 8c-3 0-4 2-4 4s1 4 4 4c4 0 8-8 12-8 3 0 4 2 4 4s-1 4-4 4c-4 0-8-8-12-8z"/>',
  anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M5 13c0 4 3 8 7 8s7-4 7-8M3 13h4M17 13h4M9 10h6"/>',
  tower: '<path d="M6 21V8h12v13M4 21h16M6 8V4h2v2h2V4h4v2h2V4h2v4"/><path d="M10 21v-5h4v5"/>',
  scales: '<path d="M12 3v18M7 21h10M4 7h16"/><path d="M4 7l-3 7a3 3 0 0 0 6 0zM20 7l-3 7a3 3 0 0 0 6 0z"/>',
  bed: '<path d="M2 18V6M22 18v-6a3 3 0 0 0-3-3H10v6M2 15h20"/><circle cx="6" cy="11" r="2"/>',
  badge: '<path d="M12 2l8 4v6c0 5-4 9-8 10-4-1-8-5-8-10V6z"/><path d="M12 8l1.2 2.5 2.8.4-2 2 .5 2.8L12 14.3l-2.5 1.4.5-2.8-2-2 2.8-.4z"/>',
  frame: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/>',
  arena: '<ellipse cx="12" cy="10" rx="9" ry="4"/><path d="M3 10v6c0 2.2 4 4 9 4s9-1.8 9-4v-6M7 13v5M12 14v6M17 13v5"/>',
  cross: '<path d="M12 3v18M7 8h10"/>',
  drop: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
  health: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/>',
  horse_head: '<path d="M7 21v-7c-2-1-3-3-2-6l4-4 2 2 4-1 4 4-1 3-3-1-2 3v7"/>',
  hammer: '<path d="M14 4l6 6-3 3-6-6z"/><path d="M11 7l-8 8 3 3 8-8"/>',
  bag: '<path d="M8 7h8l3 4v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8z"/><path d="M9 7l-1-4h8l-1 4"/><path d="M12 11v6M10 13h4"/>',
  people: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-4 3-6 6-6s6 2 6 6M15 14c3 0 6 2 6 5"/>',
  // Units: each its own, on its flag (`unitGlyph`): drawn to still read once a flag's glyph is pixels (a grid of 11 or 12).
  footprints: `<path ${F} d="M4 11c0-2 1-3 2.5-3S9 9 9 11v3c0 1.5-1 2-2.5 2S4 15.5 4 14zM4.5 18h4v1.5c0 1.2-.9 2-2 2s-2-.8-2-2zM14 5c0-2 1-3 2.5-3S19 3 19 5v3c0 1.5-1 2-2.5 2S14 9.5 14 8zM14.5 12h4v1.5c0 1.2-.9 2-2 2s-2-.8-2-2z"/>`,
  club: turn(45, `<path d="M12 25v-9"/><path ${F} d="M12 0c2.6 0 3.6 2 3.6 4.5 0 3.5-1.6 7-2 11.5h-3.2c-.4-4.5-2-8-2-11.5C8.4 2 9.4 0 12 0z"/><path d="M8.2 5.5H6.5M15.8 5.5h1.7M8.8 10H7.3M15.2 10h1.5"/>`),
  spear: turn(45, `<path d="M12 26V7"/><path ${F} d="M12-1.5l2.6 5.5L12 8.5 9.4 4z"/>`),
  pikes: turn(45, PIKE) + turn(-45, PIKE),
  spear_shield: `<path d="M13 11l3.5-3.5M2.5 21.5l2-2"/><path ${F} d="M21.5 2.5l-.7 4.3-4.3.7.7-4.3z"/><path d="M8 8.5l5 2v4c0 3.5-2.3 5.5-5 6.5-2.7-1-5-3-5-6.5v-4z"/><path d="M8 11v7.5"/>`,
  gladius: turn(-45, `<path ${F} d="M12 1l2.2 3.5V15H9.8V4.5z"/><path d="M8 15.5h8M12 16v4.5"/><path ${F} d="M10.3 20h3.4v3h-3.4z"/>`),
  longsword: turn(-45, `<path ${F} d="M12-3l1.2 2.5V15h-2.4V-.5z"/><path d="M7.5 15.5h9M12 16v6"/><circle ${F} cx="12" cy="23.5" r="1.8"/>`),
  zweihander: `<path ${F} d="M12 1l1.4 2.5V15h-2.8V3.5z"/><path d="M10.5 11H8.5M13.5 11h2M4.5 17.5v-2h15v2M12 16v5"/><path ${F} d="M10.5 21h3v2.5h-3z"/>`,
  tomahawk: turn(45, `<path d="M10 24V4M9 5H6.5V3"/><path ${F} d="M11 4l5-1.5v8L11 8.5z"/>`),
  jaguar: `<path ${F} fill-rule="evenodd" d="M4 12V3l5 4h6l5-4v9c0 5-3.5 9-8 9s-8-4-8-9zM7 11h3.5v2.5H7zM13.5 11H17v2.5h-3.5zM10.5 16h3L12 18z"/>`,
  recurve: '<path d="M1.5 9.5Q15 9 14.5 22.5" stroke-width="2.4"/><path d="M1.5 9.5l13 13M5 19L21 3M21 3h-5M21 3v5"/>',
  crossbow: `<path ${F} d="M2 13C3.5 6 20.5 6 22 13c-3-3.5-17-3.5-20 0zM10.5 3.5h3V17l1.5 5h-6l1.5-5zM12 0l2.5 4h-5z"/><path d="M3 12.5l9 3.5 9-3.5"/>`,
  gatling: `<path d="M9 7h12M9 11h12M21 5v8M3 9H1"/><path ${F} d="M3 4h6v10H3z"/><circle cx="7" cy="18" r="3.5"/>`,
  machine_gun: `<path ${F} d="M4 6.5h11V11H4z"/><path d="M15 8.7h6.5M4 8H2M9.5 11l-5 10M9.5 11v10M9.5 11l5 10"/>`,
  chariot: `<circle cx="7" cy="15" r="5.5"/><circle ${F} cx="7" cy="15" r="1.6"/><path d="M13 9l9 3.5"/><path ${F} d="M2 7h8V2h3v7H2z"/>`,
  elephant: `<path ${F} fill-rule="evenodd" d="M2.5 12c0-4.5 2-8 5.5-8 3 0 4.5.5 6 .5 4.5 0 8 .5 8 4.5v12h-3.5v-5h-6v5H9v-5.5c-1.5 0-2.5-1-3-2v7.5H2.5zM7 6h3.5v5.5H7z"/>`,
  helm: `<path ${F} fill-rule="evenodd" d="M4 21V5l2-3h12l2 3v16zM6 9h12v2.5H6zM11 11.5h2V19h-2z"/>`,
  camel: `<path ${F} d="M2 7l2.5-1.5L6 6.5 7.5 11 9 11.5c1-4.5 2.5-6.5 4-6.5 2 0 3 2.5 4 5 1.5.5 2.5 1.5 2.5 3.5V15L18 16H8l-1-1z"/><path d="M8.5 15.5V21M10.5 15.5V21M16 15.5V21M18 15.5V21M19.5 12l1.5 3"/>`,
  lance_flag: `<path d="M2.5 21.5L19 5" stroke-width="2.4"/><path ${F} d="M22 2l-5 1.5 3.5 3.5zM16.5 7.5L12 12l10 1z"/>`,
  horseshoe: `<path ${F} d="M5.5 21C3.5 18.5 2.5 15 2.5 12 2.5 6.5 6.5 2.5 12 2.5s9.5 4 9.5 9.5c0 3-1 6.5-3 9h-3.5c2-2.5 3-6 3-9 0-3.8-2.5-6-6-6s-6 2.2-6 6c0 3 1 6.5 3 9z"/>`,
  catapult: `<path d="M2 17h18M17 17L6.5 6.5"/><circle ${F} cx="5.5" cy="19.5" r="2.5"/><circle ${F} cx="16.5" cy="19.5" r="2.5"/><path ${F} d="M1.5 3h8v2C9.5 7.5 8 9 5.5 9S1.5 7.5 1.5 5z"/>`,
  trebuchet: `<path d="M5 21l6-13 6 13M3 21h16M3 1.5l11 9M3 1.5v6"/><path ${F} d="M12 11h5.5v5H12z"/><circle ${F} cx="3" cy="9.5" r="2"/>`,
  artillery: `<path d="M7 13L21 3.5" stroke-width="2.8"/><path ${F} d="M10 5.5h3V14h-3z"/><circle cx="8" cy="15.5" r="5"/><circle ${F} cx="8" cy="15.5" r="1.5"/><path d="M8 15.5L1.5 21"/>`,
  rocket_truck: `<path ${F} d="M2 15h13v-5h4l2.5 3v4H2zM2 11.5l7-7 1.5 1.5-7 7zM7 12l7-7 1.5 1.5-7 7z"/><circle ${F} cx="5" cy="19" r="2"/><circle ${F} cx="11" cy="19" r="2"/><circle ${F} cx="18" cy="19" r="2"/>`,
  musket: turn(45, `<path d="M12-2v14"/><path ${F} d="M10.8 11h2.4l1.3 10 .5 4.5h-5l.6-4.5z"/><path d="M13.5 12.5l1.5-1.5"/>`),
  brodie: `<path ${F} d="M6.5 11C6.5 7 9 4.5 12 4.5s5.5 2.5 5.5 6.5zM1.5 11h21l-2.5 3H4z"/><path d="M6.5 14c1 4.5 10 4.5 11 0"/>`,
  helmet: '<path d="M4 15c0-7 3.5-11 8-11s8 4 8 11z"/><path d="M2.5 15.5h19M6 15.5c1 4.5 11 4.5 12 0"/>',
  parachute: `<path d="M2 11c0-5.5 4.5-9 10-9s10 3.5 10 9z"/><path d="M2 11l10 7M7 11l5 7M12 11v7M17 11l-5 7M22 11l-10 7"/><path ${F} d="M10.5 18h3v4h-3z"/>`,
  at_gun: `<path d="M8 12.5h14M21.5 11v3M6 18l-4 3"/><path ${F} d="M5 8h4.5v8H5z"/><circle cx="8" cy="17.5" r="3.5"/>`,
  aa_gun: `<path d="M10 15l6-13M13 16l6-13M4 21h16M6 21l2-4M18 21l-2-4"/><path ${F} d="M8 13h7v5H8z"/>`,
  sam: `<rect x="3" y="16" width="18" height="5" rx="2.5"/><path d="M5 16v-3h14v3"/><path ${F} d="M7 13L19 3l1.5 1.5L9 14.5z"/>`,
  bazooka: turn(45, `<path ${F} d="M10.5 3h3v19h-3zM12-1.5l2.3 3v1.5H9.7V1.5zM9.5 22h5l-1 2h-3z"/><path d="M13.5 13h2.5v3"/>`),
  apc: `<path ${F} d="M2 14.5V10l3-3h12l5 4v3.5zM9 3h5v4H9z"/><circle ${F} cx="5" cy="19" r="2.5"/><circle ${F} cx="12" cy="19" r="2.5"/><circle ${F} cx="19" cy="19" r="2.5"/><path d="M14 5h7"/>`,
  visor: `<path ${F} fill-rule="evenodd" d="M4 12l2-8 6-2 6 2 2 8-2 9H6zM7 9h10l-1 4.5H8z"/><path d="M18 4l3-3"/>`,
  landship: `<path d="M2 15l4-8h11l5 7-2 5H5z"/><path ${F} d="M9 11h5v5H9z"/><path d="M14 13h4"/>`,
  modern_tank: `<path d="M2.5 16.5l2-3h15l2 3-2 3h-15z"/><path ${F} d="M7 13.5L8.5 10H16l2 3.5z"/><path d="M16 11h7"/>`,
  mech: `<path ${F} d="M8 4h8v7H8z"/><path d="M9.5 11L7 15l2 6M14.5 11l2.5 4-2 6M7 21h4M13 21h4M8 7H4v3M16 7h4v3"/>`,
  helicopter: `<path d="M1 3h20M11 3v4M14 11h7M21 8v6M3 19h12M6 15v4M12 15v4"/><path ${F} d="M3 11c0-2.5 2-4 5-4h3c2.5 0 4 1.5 4 4s-1.5 4-4 4H8c-3 0-5-1.5-5-4z"/>`,
  triplane: `<path d="M2 5h20M3 11h18M4 17h16M8 17l-1 4M16 17l1 4"/><circle ${F} cx="12" cy="11" r="3"/>`,
  biplane: `<path d="M1 5h22M2 13h20M12 13v5M8 21l4-3 4 3"/><circle ${F} cx="7.5" cy="9" r="2.5"/><circle ${F} cx="16.5" cy="9" r="2.5"/>`,
  prop_plane: `<path ${F} d="M11 3c0-1 2-1 2 0v17h-2zM3 11c0-1.5 8-2.5 9-2.5s9 1 9 2.5-8 1.5-9 1.5-9 0-9-1.5zM8 19h8v2H8z"/><path d="M8.5 2h7"/>`,
  heavy_bomber: `<path ${F} d="M11 3c0-1 2-1 2 0v16h-2zM2 10.5L11 9v3.5L2 12zM22 10.5L13 9v3.5l9-.5zM8 19h8v2H8z"/><path d="M5 8v2.5M8.5 7.5v2.5M15.5 7.5v2.5M19 8v2.5"/>`,
  flying_wing: `<path ${F} d="M12 5l10.5 10.5-2.5 1-2-1.5-3 2-3-2-3 2-3-2-2 1.5-2.5-1z"/>`,
  bomb: turn(45, `<path ${F} d="M12 0c3.5 0 6 3 6 7.5S15.5 15 12 15s-6-3-6-7.5S8.5 0 12 0z"/><path d="M8 15.5v6h8v-6M12 15v6.5"/>`),
  mushroom: `<path ${F} d="M4 9c0-4.5 4-6.5 8-6.5s8 2 8 6.5c0 2-2 2.5-4 2.5H8c-2 0-4-.5-4-2.5z"/><path d="M10 11.5V18M14 11.5V18M4.5 21c2-3 13-3 15 0z"/>`,
  trireme: `<path ${F} d="M1 11.5h18l4 2.5-4 2.5H4c-2 0-3-2-3-5zM7 3h9v6H7z"/><path d="M11.5 11.5V2M5 16.5l-1.5 3M9 16.5l-1.5 3M13 16.5l-1.5 3M17 16.5l-1.5 3"/>`,
  galleass: `<path ${F} d="M2 11h17l4 2.5-4 2.5H5c-2 0-3-2-3-5zM10 2L4 9.5h6zM17 3.5l-4.5 6H17z"/><path d="M10 11V1.5M17 11V3M7 16l-1 3M11 16l-1 3M15 16l-1 3"/>`,
  caravel: `<path ${F} d="M2 13h20l-2.5 4.5h-15zM2 13V9.5h4V13z"/><path d="M9 13V2.5M16 13V5"/><path ${F} d="M9 3.5l-5 7.5h5zM16 5.5L12 11h4z"/>`,
  turtle_ship: `<path ${F} d="M2 14h20l-2.5 4h-15z"/><path d="M4.5 14c0-5 3.5-7.5 7.5-7.5s7.5 2.5 7.5 7.5M8 8l-1-2M12 6.5V4M16 8l1-2M20 12l2.5-2v3"/>`,
  frigate: `<path ${F} d="M1.5 14h21l-2.5 4.5H4z"/><path d="M6 14V4M12 14V2M18 14V4"/><path ${F} d="M4 5h4v3.5H4zM10 3h4v3.5h-4zM16 5h4v3.5h-4zM4 9.5h4V13H4zM10 7.5h4V11h-4zM16 9.5h4V13h-4z"/>`,
  privateer: `<path ${F} d="M2 14h20l-2.5 4.5h-15zM6 6h10v3H6zM6 10h10v3H6zM11 1h6v3h-6z"/><path d="M11 14V1"/>`,
  ironclad: `<path ${F} d="M2 15h20l-2 3.5H4z"/><path d="M6 15l2-4h8l2 4M11 11V6h2v5"/><circle cx="15.5" cy="3.5" r="1.5"/>`,
  destroyer: `<path ${F} d="M1.5 14h21l-2 3.5h-17z"/><path d="M8 14v-3h3V8h3v6M12.5 8V3M16 14v-2h3v2M19 12.5h2.5"/>`,
  battleship: `<path ${F} d="M1.5 13.5h21l-2 4h-17z"/><path d="M9 13.5V9h1.5V5h3v4H15v4.5M12 5V2M3.5 13.5V12h3v1.5M17.5 13.5V12h3v1.5M6.5 12.5H9M17.5 12.5H15"/>`,
  missile_ship: `<path ${F} d="M1.5 14h21l-2 3.5h-17z"/><path d="M5 14v-3h6v3M8 11V4M6 6h4"/><path ${F} d="M14 13l5.5-7 1.5 1-5.5 7z"/>`,
  sub: `<path ${F} d="M3 14c0-1.5 1.5-2.5 4-2.5h12c2 0 3.5 1 3.5 2.5s-1.5 2.5-3.5 2.5H7c-2.5 0-4-1-4-2.5zM9 8h5l1 3.5H9z"/><path d="M12 8V4.5h1.5M5 11.5V10h2"/>`,
  nuclear_sub: `<path ${F} d="M2 16c0-1.5 1.5-2.5 4-2.5h14c1.5 0 2.5 1 2.5 2.5s-1 2.5-2.5 2.5H6c-2.5 0-4-1-4-2.5zM6 13.5V10h4l1 3.5zM15.5 12V5L17 2.5 18.5 5v7z"/>`,
  carrier: `<path ${F} d="M1.5 13h21v1.5l-2 3.5H4l-2.5-3.5z"/><path d="M16 13V8h3v5M17.5 8V4"/><path ${F} d="M4 10.5h7l1.5-1v3l-1.5-1H4z"/>`,
  // Emblem symbols (drawn filled, white, on a civ's shield).
  ankh: `<path ${F} d="M12 2c-3 0-5 2.5-5 5.5 0 2 1 3.5 2.5 4.5H4v3h6.5v7h3v-7H20v-3h-5.5c1.5-1 2.5-2.5 2.5-4.5C17 4.5 15 2 12 2zm0 3c1.2 0 2 1.2 2 2.5S13.2 10 12 10s-2-1.2-2-2.5S10.8 5 12 5z"/>`,
  ziggurat: `<path ${F} d="M10 3h4v3h3v4h2v4h2v5H3v-5h2v-4h2V6h3z"/>`,
  pagoda: `<path ${F} d="M12 2l1 2h-2zM6 6h12l-2 2H8zM9 8h6v3H9zM4 11h16l-2.5 2.5h-11zM8 13.5h8V17H8zM2 17h20l-3 3H5z"/>`,
  chakra: `<circle cx="12" cy="12" r="9" fill="none" stroke="#fff" stroke-width="2"/><circle ${F} cx="12" cy="12" r="2.5"/><path stroke="#fff" stroke-width="1.6" d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/>`,
  wingsun: `<circle ${F} cx="12" cy="11" r="3.5"/><path ${F} d="M1 9c3 0 6 1 7.5 2.5C7 13 4 14 1.5 13.5c2-1 2-3-.5-4.5zM23 9c-3 0-6 1-7.5 2.5C17 13 20 14 22.5 13.5c-2-1-2-3 .5-4.5zM10 15h4l-2 6z"/>`,
  taeguk: `<circle cx="12" cy="12" r="9" fill="none" stroke="#fff" stroke-width="2"/><path ${F} d="M3 12a9 9 0 0 1 18 0 4.5 4.5 0 0 1-9 0 4.5 4.5 0 0 0-9 0z"/>`,
  crescent: `<path ${F} d="M14 3a9 9 0 1 0 6.5 15.3A7.5 7.5 0 1 1 14 3z"/><path ${F} d="M18 7l.9 2.2 2.3.2-1.8 1.5.6 2.3-2-1.3-2 1.3.6-2.3-1.8-1.5 2.3-.2z"/>`,
  eagle: `<path ${F} d="M12 3c1.5 0 2.5 1 2.5 2.5 0 .8-.4 1.3-.9 1.7l5.4-2.2-1 3.4 3-.6-2.3 3 2.3.7-4.5 2.4 1.5 3.3-3.5-1.3L12 21l-2.5-5.1-3.5 1.3 1.5-3.3L3 11.5l2.3-.7L3 7.8l3 .6-1-3.4 5.4 2.2c-.5-.4-.9-.9-.9-1.7C9.5 4 10.5 3 12 3z"/>`,
  pine: `<path ${F} d="M12 2l4 6h-2l4 6h-3l4 5h-6v3h-2v-3H5l4-5H6l4-6H8z"/>`,
  sunstone: `<circle cx="12" cy="12" r="5" fill="none" stroke="#fff" stroke-width="2"/><circle ${F} cx="12" cy="12" r="2"/><path ${F} d="M12 1l1.5 4h-3zM12 23l-1.5-4h3zM1 12l4-1.5v3zM23 12l-4 1.5v-3zM4.2 4.2l3.9 1.8-2.1 2.1zM19.8 19.8l-3.9-1.8 2.1-2.1zM4.2 19.8l1.8-3.9 2.1 2.1zM19.8 4.2l-1.8 3.9-2.1-2.1z"/>`,
  onion: `<path ${F} d="M12 1l1 2.5c3 2 6 5 6 8.5 0 2-1 3-2 3.5V21H7v-5.5c-1-.5-2-1.5-2-3.5 0-3.5 3-6.5 6-8.5z"/><path stroke="#000" stroke-opacity=".35" stroke-width="1.4" d="M5 21h14M10 21v-4h4v4"/>`,
  fleur: `<path ${F} d="M12 2c2 2.5 3 5 3 8 0 2-1 3.5-3 5-2-1.5-3-3-3-5 0-3 1-5.5 3-8zM3 9c3 0 6 2 7 5-2 1.5-4 1.5-6 .5C3 13.5 2.5 11 3 9zM21 9c-3 0-6 2-7 5 2 1.5 4 1.5 6 .5 1-1 1.5-3.5 1-5.5zM6 15h12v2H6zM11 17h2v5h-2z"/>`,
  skull: `<path ${F} d="M12 2c-5 0-8 3.5-8 8 0 3 1.5 5 3 6v3h2v-2h2v2h2v-2h2v2h2v-3c1.5-1 3-3 3-6 0-4.5-3-8-8-8zm-3.5 7a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/>`,
  anchor_f: `<path stroke="#fff" stroke-width="2.4" fill="none" d="M12 7v14M5 13c0 4 3 8 7 8s7-4 7-8M3 13h4M17 13h4M8.5 10h7"/><circle cx="12" cy="5" r="2.2" fill="none" stroke="#fff" stroke-width="2.2"/>`,
  lyre_f: `<path stroke="#fff" stroke-width="2.2" fill="none" d="M7 4c-2 5-2 10 2 14h6c4-4 4-9 2-14M9 8h6M10 8v10M14 8v10"/>`,
  swords_f: `<path stroke="#fff" stroke-width="2.4" fill="none" d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M9.5 17.5L21 6V3h-3L6.5 14.5M11 19l-6-6"/>`,
  coin_f: `<circle cx="12" cy="12" r="8" fill="none" stroke="#fff" stroke-width="2.4"/><path ${F} d="M11 7h2v10h-2z"/>`,
  temple_f: `<path ${F} d="M12 2l10 7H2zM4 10h3v9H4zM10.5 10h3v9h-3zM17 10h3v9h-3zM2 20h20v2H2z"/>`,
};

/** Another way to draw the glyphs and emblems (the pixel look, `pixel.ts`): its markup, or null to draw one as here. */
let restyle: ((name: string, size: number, color?: string) => string | null) | null = null;
let restyleEmblem: ((markup: string, size: number) => string | null) | null = null;
export function restyleGlyphs(glyphs: typeof restyle, emblems: typeof restyleEmblem) {
  restyle = glyphs;
  restyleEmblem = emblems;
  images.clear();
}
/** A glyph's shapes (inside a 24 x 24 box). */
export const glyphPaths = (name: string) => G[name] ?? G.info;

/** A glyph as SVG markup (`size` pixels, in `color` or the text's colour). */
export function svg(name: string, size = 18, color?: string): string {
  const alt = restyle?.(name, size, color);
  if (alt) return alt;
  const g = G[name] ?? G.info;
  return `<svg class="cv-ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"${color ? ` style="color:${color}"` : ''} aria-hidden="true">${g}</svg>`;
}

/** A glyph as a DOM element. */
export function icon(name: string, size = 18, color?: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'cv-i';
  span.innerHTML = svg(name, size, color);
  return span;
}

/**
 * A glyph as a picture for the map's canvas (made once for each glyph, size and colour; one drawn the
 * plain way while its restyled look is still being made is made again, alone, once that's ready).
 */
const images = new Map<string, { img: HTMLImageElement; standIn: boolean }>();
export function iconImage(name: string, size: number, color: string): HTMLImageElement {
  const key = `${name}|${size}|${color}`;
  let had = images.get(key);
  if (!had || (had.standIn && restyle?.(name, size, color))) {
    const markup = svg(name, size, color);
    const img = new Image(size, size);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replace(/currentColor/g, color))}`;
    had = { img, standIn: !!restyle && !markup.includes('cv-ico px') };
    images.set(key, had);
  }
  return had.img;
}

/** Icons copied onto canvases (an SVG's picture is drawn afresh each time it's put on a canvas; a canvas is only copied), and whether from the icon's final picture (not a stand-in for one still being made). */
const bitmaps = new Map<string, { img: HTMLImageElement; canvas: HTMLCanvasElement; final: boolean }>();

/** An icon as a bitmap `scale` times its size, to draw on a canvas often (the overlay's, each frame), or null until its picture's ready. */
export function iconBitmap(name: string, size: number, color: string, scale = 1): HTMLCanvasElement | null {
  const key = `${name}|${size}|${color}|${scale}`;
  const had = bitmaps.get(key);
  // (Copied from its final picture: nothing more to look at. The overlay asks for one for each flag, each frame.)
  if (had?.final) return had.canvas;
  const img = iconImage(name, size, color);
  if (!img.complete || !img.naturalWidth) return null;
  // (A picture restyled since: copied again.)
  if (had?.img === img) return had.canvas;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.round(size * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  bitmaps.set(key, { img, canvas, final: !images.get(`${name}|${size}|${color}`)?.standIn });
  return canvas;
}

// -------------------------------------------------------------------------------------------------
// What each thing's glyph is, and its colour

export const YIELD_COLOR: Record<string, string> = { food: '#7bd16a', prod: '#f0a24a', gold: '#f6cf4a', science: '#6ab8ff', culture: '#d68ae8', faith: '#e8e2d0', happy: '#a8e86a', golden: '#ffb84a', tourism: '#c88aff' };

const RESOURCE_GLYPH: Record<string, string> = { gold_ore: 'gold_ore', iron: 'iron' };
export const resourceGlyph = (id: string) => RESOURCE_GLYPH[id] ?? (G[id] ? id : 'gems');

const TECH_GLYPH: Record<string, string> = {
  agriculture: 'plough', pottery: 'pot', animal_husbandry: 'cattle', archery: 'bow', mining: 'pick', sailing: 'sail', calendar: 'calendar', writing: 'quill',
  trapping: 'trap', the_wheel: 'wheel', masonry: 'bricks', bronze_working: 'axe', optics: 'lens', horseback_riding: 'horse_head', mathematics: 'compass_tool',
  construction: 'columns', philosophy: 'owl', drama: 'mask', currency: 'coins', iron_working: 'sword', theology: 'temple', civil_service: 'scroll',
  guilds: 'guild', metal_casting: 'crucible', compass: 'compass', engineering: 'gear', education: 'book', chivalry: 'lance', machinery: 'gears',
  physics: 'pendulum', steel: 'anvil', astronomy: 'telescope', acoustics: 'lute', banking: 'bank', printing_press: 'press', gunpowder: 'cannon',
  navigation: 'ship_wheel', architecture: 'dome', economics: 'chart_up', metallurgy: 'crucible', chemistry: 'science', archaeology: 'urn',
  scientific_theory: 'lightbulb', industrialization: 'factory', rifling: 'rifle', military_science: 'medal', fertilizer: 'sprout', biology: 'dna',
  electricity: 'bolt', steam_power: 'train', dynamite: 'dynamite', refrigeration: 'snowflake', radio: 'radio', replaceable_parts: 'bolt_gear',
  flight: 'plane', railroad: 'rail', plastics: 'bottle', electronics: 'chip', ballistics: 'target', combustion: 'piston', penicillin: 'pill',
  atomic_theory: 'atom', radar: 'radar', combined_arms: 'tank', ecology: 'leaf', nuclear_fission: 'uranium', rocketry: 'rocket', computers: 'computer',
  telecommunications: 'phone', mobile_tactics: 'truck', advanced_ballistics: 'missile', satellites: 'satellite', robotics: 'robot', lasers: 'laser',
  the_internet: 'network', globalization: 'globe', particle_physics: 'particles', nuclear_fusion: 'fusion', nanotechnology: 'hexes', stealth: 'jet',
  future_tech: 'infinity',
};
export const techGlyph = (id: string) => TECH_GLYPH[id] ?? 'lightbulb';

/** Each era's colour (the tech tree's cards, the era banner). */
export const ERA_COLOR = ['#8a6a3a', '#a85a3a', '#5a7a3a', '#3a6a8a', '#6a4a8a', '#3a5a9a', '#8a3a4a', '#2a8a8a'];

const BUILDING_GLYPH: Record<string, [string, string]> = {
  palace: ['crown', 'gold'], monument: ['culture', 'culture'], granary: ['wheat', 'food'], shrine: ['faith', 'faith'], library: ['book', 'science'],
  barracks: ['sword', 'war'], walls: ['tower', 'war'], water_mill: ['wheel', 'food'], stable: ['horse_head', 'prod'], circus: ['arena', 'happy'],
  lighthouse: ['anchor', 'food'], caravansary: ['trade', 'gold'], temple: ['temple', 'faith'], amphitheater: ['mask', 'culture'], market: ['bag', 'gold'],
  mint: ['coins', 'gold'], colosseum: ['arena', 'happy'], courthouse: ['scales', 'happy'], aqueduct: ['drop', 'food'], forge: ['anvil', 'prod'],
  harbor: ['anchor', 'gold'], university: ['science', 'science'], castle: ['tower', 'war'], workshop: ['hammer', 'prod'], garden: ['leaf', 'food'],
  armory: ['shield', 'war'], bank: ['bank', 'gold'], observatory: ['telescope', 'science'], opera_house: ['culture', 'culture'], zoo: ['deer', 'happy'],
  seaport: ['ship_wheel', 'prod'], museum: ['frame', 'culture'], public_school: ['book', 'science'], factory: ['factory', 'prod'],
  stock_exchange: ['chart_up', 'gold'], hospital: ['health', 'food'], military_academy: ['medal', 'war'], arsenal: ['cannon', 'war'], hotel: ['bed', 'culture'],
  broadcast_tower: ['radio', 'culture'], stadium: ['arena', 'happy'], airport: ['plane', 'prod'], medical_lab: ['health', 'food'], research_lab: ['atom', 'science'],
  hydro_plant: ['drop', 'prod'], nuclear_plant: ['uranium', 'prod'], solar_plant: ['faith', 'prod'], military_base: ['radar', 'war'],
  spaceship_factory: ['rocket', 'prod'], police_station: ['badge', 'happy'], constabulary: ['badge', 'happy'], mosque: ['dome', 'faith'],
  pagoda: ['temple', 'faith'], cathedral: ['cross', 'faith'], monastery: ['book', 'faith'],
};
const CATEGORY_COLOR: Record<string, string> = { ...YIELD_COLOR, war: '#e86a5a' };

/** A building's glyph and colour (a civ's own building as the one it replaces; a wonder as its kind). */
export function buildingGlyph(id: string): { glyph: string; color: string } {
  const b = BUILDINGS[id];
  const base = b?.replaces ?? id;
  const [glyph, cat] = BUILDING_GLYPH[base] ?? (b?.kind === 'national' ? ['crown', 'golden'] : ['columns', 'golden']);
  return { glyph, color: CATEGORY_COLOR[cat] ?? '#f6cf4a' };
}

/** The wonders' pictures: each drawn as one of a few kinds of great building (`tools/portraits.mjs`). */
const WONDER_PICTURE: Record<string, string> = {
  pyramids: 'w_pyramid', stonehenge: 'w_henge', temple_of_artemis: 'w_temple', great_library: 'w_palace', colossus: 'w_colossus',
  hanging_gardens: 'w_gardens', great_lighthouse: 'w_lighthouse', mausoleum: 'w_temple', statue_of_zeus: 'w_zeus', oracle: 'w_temple', petra: 'w_gate',
  terracotta_army: 'w_army', great_wall: 'w_wall', parthenon: 'w_temple', colosseum_flavian: 'w_arena', great_mosque: 'w_dome', hagia_sophia: 'w_dome',
  borobudur: 'w_steps', angkor_wat: 'w_steps', chichen_itza: 'w_steps', machu_picchu: 'w_steps', notre_dame: 'w_cathedral', alhambra: 'w_dome',
  himeji_castle: 'w_castle', forbidden_palace: 'w_palace', sistine_chapel: 'w_cathedral', leaning_tower: 'w_pagoda', porcelain_tower: 'w_pagoda',
  taj_mahal: 'w_dome', uffizi: 'w_palace', globe_theatre: 'w_theatre', kremlin: 'w_wall', big_ben: 'w_clock', louvre: 'w_palace',
  brandenburg_gate: 'w_gate', neuschwanstein: 'w_castle', statue_of_liberty: 'w_liberty', eiffel_tower: 'w_spire', broadway: 'w_theatre',
  cristo_redentor: 'w_cristo', pentagon: 'w_modern', sydney_opera_house: 'w_opera', cn_tower: 'w_spire', hubble: 'w_dish', great_firewall: 'w_modern',
  united_nations: 'w_modern', manhattan_project: 'w_atom', apollo_program: 'w_rocket',
};
export const wonderPicture = (id: string): string | null => WONDER_PICTURE[id] ?? (BUILDINGS[id]?.kind === 'national' ? 'w_palace' : null);

export const POLICY_GLYPH: Record<string, string> = {
  tradition: 'crown', liberty: 'people', honor: 'sword', piety: 'temple', patronage: 'peace', aesthetics: 'culture', commerce: 'gold',
  exploration: 'compass', rationalism: 'atom', freedom: 'vote', order: 'gear', autocracy: 'war',
};

export const GREAT_GLYPH: Record<string, string> = {
  scientist: 'science', engineer: 'gear', merchant: 'gold', artist: 'frame', writer: 'quill', musician: 'culture', general: 'medal', admiral: 'anchor', prophet: 'faith',
};

/** Each unit class's glyph, for a unit without one of its own. */
const CLASS_GLYPH: Record<string, string> = {
  melee: 'sword', gun: 'rifle', mounted: 'horse_head', ranged: 'bow', siege: 'cannon', armor: 'tank', recon: 'compass', fighter: 'jet', bomber: 'plane',
  helicopter: 'helicopter', missile: 'missile', naval_melee: 'anchor', naval_ranged: 'ship_wheel', submarine: 'sub', carrier: 'carrier', civilian: 'people',
  trade: 'trade', religious: 'faith', great: 'xp',
};

/** Each unit's own glyph (a civ's own unit without one has the glyph of the unit it replaces). */
const UNIT_GLYPH: Record<string, string> = {
  settler: 'city', worker: 'hammer', work_boat: 'hammer',
  scout: 'footprints', explorer: 'compass',
  warrior: 'club', jaguar: 'jaguar', spearman: 'spear', immortal: 'spear_shield', pikeman: 'pikes', landsknecht: 'zweihander',
  swordsman: 'gladius', mohawk_warrior: 'tomahawk', longswordsman: 'longsword',
  archer: 'bow', composite_bowman: 'recurve', crossbowman: 'crossbow', gatling_gun: 'gatling', machine_gun: 'machine_gun',
  chariot_archer: 'chariot', war_elephant: 'elephant', horseman: 'horse_head', knight: 'helm', camel_archer: 'camel', lancer: 'lance_flag', cavalry: 'horseshoe',
  catapult: 'catapult', trebuchet: 'trebuchet', cannon: 'cannon', artillery: 'artillery', rocket_artillery: 'rocket_truck',
  musketman: 'musket', rifleman: 'rifle', great_war_infantry: 'brodie', infantry: 'helmet', paratrooper: 'parachute', mechanized_infantry: 'apc', xcom_squad: 'visor',
  anti_tank_gun: 'at_gun', anti_aircraft_gun: 'aa_gun', mobile_sam: 'sam', bazooka: 'bazooka',
  landship: 'landship', tank: 'tank', modern_armor: 'modern_tank', giant_death_robot: 'mech', helicopter_gunship: 'helicopter',
  triplane: 'triplane', fighter: 'prop_plane', jet_fighter: 'jet', great_war_bomber: 'biplane', bomber: 'heavy_bomber', stealth_bomber: 'flying_wing',
  atomic_bomb: 'bomb', guided_missile: 'missile', nuclear_missile: 'mushroom',
  trireme: 'trireme', galleass: 'galleass', caravel: 'caravel', turtle_ship: 'turtle_ship', frigate: 'frigate', privateer: 'privateer', ironclad: 'ironclad',
  destroyer: 'destroyer', battleship: 'battleship', missile_cruiser: 'missile_ship', submarine: 'sub', nuclear_submarine: 'nuclear_sub', carrier: 'carrier',
};

/** A unit's glyph, for its flag on the map: its own, else the unit's it replaces, a great person's kind's, or its class's. */
export function unitGlyph(type: string): string {
  const u = UNITS[type];
  return UNIT_GLYPH[type] ?? UNIT_GLYPH[u?.replaces ?? ''] ?? (u?.class === 'great' ? GREAT_GLYPH[type.slice('great_'.length)] : undefined) ?? CLASS_GLYPH[u?.class ?? 'melee'] ?? 'sword';
}

// -------------------------------------------------------------------------------------------------
// Emblems

const CIV_SYMBOL: Record<string, string> = {
  egypt: 'ankh', babylon: 'ziggurat', china: 'pagoda', india: 'chakra', persia: 'wingsun', korea: 'taeguk', arabia: 'crescent', germany: 'eagle',
  iroquois: 'pine', aztec: 'sunstone', russia: 'onion', france: 'fleur', barbarian: 'skull',
};
const CS_SYMBOL: Record<string, string> = { maritime: 'anchor_f', cultured: 'lyre_f', militaristic: 'swords_f', mercantile: 'coin_f', religious: 'temple_f' };

/** A civ's emblem: its symbol in its accent colour on a shield of its colour (a city-state's by its kind). */
export function emblem(civ: string, size = 40, kind?: string): string {
  const c = CIVS[civ];
  const color = c?.color ?? '#555';
  const accent = c?.accent ?? '#fff';
  const sym = kind ? CS_SYMBOL[kind] : CIV_SYMBOL[civ];
  const glyph = (G[sym ?? ''] ?? G.crown).replace(/#fff/g, accent).replace(/fill="currentColor"/g, `fill="${accent}"`);
  const shape = kind
    ? `<circle cx="20" cy="20" r="18" fill="${color}" stroke="#0008" stroke-width="2"/><circle cx="20" cy="20" r="15" fill="none" stroke="${accent}" stroke-opacity=".5" stroke-width="1.2"/>`
    : `<path d="M20 2l16 5v12c0 10-7 16-16 19C11 35 4 29 4 19V7z" fill="${color}" stroke="#0008" stroke-width="2"/><path d="M20 5.5l13 4v9.5c0 8-5.5 13-13 15.5-7.5-2.5-13-7.5-13-15.5V9.5z" fill="none" stroke="${accent}" stroke-opacity=".45" stroke-width="1.2"/>`;
  const markup = `<svg class="cv-emblem" viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true">${shape}<g transform="translate(9 ${kind ? 9 : 8}) scale(${22 / 24})" fill="none" stroke="${accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:${accent}">${glyph}</g></svg>`;
  return restyleEmblem?.(markup, size) ?? markup;
}

/** An emblem as a DOM element. */
export function emblemEl(civ: string, size = 40, kind?: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'cv-em';
  span.innerHTML = emblem(civ, size, kind);
  return span;
}

/** A tech's era (its column's), for its colour. */
export const techEra = (id: string) => {
  const col = TECHS[id]?.col ?? 0;
  return col <= 2 ? 0 : col <= 4 ? 1 : col <= 6 ? 2 : col <= 8 ? 3 : col <= 10 ? 4 : col <= 12 ? 5 : col <= 14 ? 6 : 7;
};
