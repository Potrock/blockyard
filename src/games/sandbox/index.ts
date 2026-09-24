import { defineGame } from '@platform';

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
});
