import { defineGame } from '@platform';
import crate from './blocks/crate.png?url';

/** Marble's texture: one for the block and its slab. */
const MARBLE = { color: '#d9dcdf', noise: 0.22, scale: 3 };

/** Creative building in an endless procedural world: the platform with no rules on top. */
export default defineGame({
  id: 'sandbox',
  title: 'Sandbox',
  tagline: 'Build anything in an endless world',
  accent: '#7fd46b',
  controls: [
    ['Space ×2', 'fly'],
    ['LMB', 'break'],
    ['RMB', 'place'],
    ['E', 'blocks'],
  ],
  world: { spawn: 'auto', persist: true },
  player: { build: true, fly: true, health: false, hotbar: 'blocks' },
  // A few blocks of its own, in the block picker with the built-in ones: a crate painted as a
  // PNG, marble mottled from a colour (and its slab), and a paper lantern that lights the dark.
  blocks: {
    crate: { texture: crate, hardness: 1.2 },
    marble: { texture: MARBLE },
    marble_slab: { label: 'Marble Slab', texture: MARBLE, shape: 'slab', full: 'marble' },
    paper_lantern: { texture: { top: { color: '#7a4a24' }, bottom: { color: '#7a4a24' }, side: { color: ['#ffb347', '#ffc061', '#ffa630'], scale: 4 } }, light: 13, glow: 0.8 },
  },
});
