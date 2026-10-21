import { opinionOf, stanceOf, type Stance } from './ai/opinion';
import { personalityOf } from './ai/personality';
import { atWar } from './core';
import type { Game, Player } from './state';
import { masterOf, teammates } from './teams';

/**
 * What the people in a game say to each other, and the faces their leaders make (`server.ts` passes
 * them on, `client/chat.ts` shows them): and what a bot's leader answers when spoken to, or made a face
 * at, as it feels about whoever it was (at war, it's bold or it isn't; a friend laughs along).
 */

/** The emotes: each one's words (its face is the screen's, `client/chat.ts`), and how it's meant. */
export const EMOTES = {
  wave: { name: 'Hello', tone: 'warm' },
  laugh: { name: 'Ha!', tone: 'warm' },
  gg: { name: 'Well played', tone: 'warm' },
  peace: { name: 'Peace?', tone: 'warm' },
  think: { name: 'Hmm…', tone: 'plain' },
  cry: { name: 'Oh no', tone: 'plain' },
  eyes: { name: 'Watching you', tone: 'cold' },
  angry: { name: 'Grr', tone: 'cold' },
  fire: { name: 'Burn!', tone: 'cold' },
  skull: { name: 'You’re finished', tone: 'cold' },
} as const satisfies Record<string, { name: string; tone: Tone }>;
export type EmoteId = keyof typeof EMOTES;
export const isEmote = (x: unknown): x is EmoteId => typeof x === 'string' && Object.hasOwn(EMOTES, x);

/** The ways to point at a tile for the others (a ping): what each says. */
export const PINGS = { look: 'Look here', attack: 'Attack here', defend: 'Defend here' } as const;
export type PingKind = keyof typeof PINGS;
export const isPing = (x: unknown): x is PingKind => typeof x === 'string' && Object.hasOwn(PINGS, x);

/** How long a line can be. */
export const CHAT_LENGTH = 200;

type Tone = 'warm' | 'plain' | 'cold';

/** How something typed is meant, from its words (anything else is plain). */
export function toneOf(text: string): Tone {
  if (/\b(die|dead|kill|crush|destroy|weak|loser|noob|burn|surrender|kneel|mine now|coming for|you'?re next)\b/i.test(text)) return 'cold';
  if (/\b(hi|hello|hey|friends?|peace|thanks?|thank you|gg|ally|allies|well played|nice|lol|haha)\b/i.test(text)) return 'warm';
  return 'plain';
}

/** A leader's answer: its words, and the face it makes. */
export interface Answer {
  text: string;
  emote: EmoteId;
}

/** What a leader says back, by how it feels and how it was spoken to (`{you}`: the one it's answering). */
/** How a leader feels toward whoever spoke to it: at war, bold or meek; their master, or their vassal (`vassals.ts`); else its stance. */
export type Mood = 'bold' | 'meek' | 'master' | 'vassal' | Stance;

const LINES: Record<Mood, Partial<Record<Tone, [EmoteId, string][]>> & { plain: [EmoteId, string][] }> = {
  bold: {
    warm: [
      ['laugh', 'Peace? Not while you still have cities.'],
      ['skull', 'Your kind words come too late, {you}.'],
    ],
    plain: [
      ['skull', 'Words won’t save your cities.'],
      ['fire', 'We’ll talk when your walls are rubble.'],
      ['skull', 'Kneel now, and we may let you keep your capital.'],
    ],
    cold: [
      ['laugh', 'Big words. Come and say them at our walls.'],
      ['fire', 'Is that a threat? It sounded like a plea.'],
    ],
  },
  meek: {
    warm: [
      ['peace', 'Send an envoy, and we will talk of peace.'],
      ['peace', 'Yes. Let this war end, {you}.'],
    ],
    plain: [
      ['cry', 'Must this war go on?'],
      ['peace', 'Enough blood has been spilt, {you}.'],
    ],
    cold: [
      ['cry', 'Have you no mercy?'],
      ['angry', 'We will defend our home to the last.'],
    ],
  },
  master: {
    warm: [
      ['laugh', 'Loyal as ever, {you}. Good.'],
      ['gg', 'Serve us well, and you will want for nothing.'],
    ],
    plain: [
      ['eyes', 'Your tribute had better not be late, {you}.'],
      ['think', 'You may speak, vassal.'],
    ],
    cold: [
      ['skull', 'Remember who spared your cities, {you}.'],
      ['angry', 'Mind your tongue, vassal.'],
    ],
  },
  vassal: {
    warm: [
      ['peace', 'We serve, {you}, as we swore to.'],
      ['wave', 'Your loyal vassal greets you.'],
    ],
    plain: [
      ['think', 'As you command, {you}.'],
      ['cry', 'Our tribute is on its way.'],
    ],
    cold: [
      ['angry', 'We kneel, {you}. We do not forget.'],
      ['eyes', 'One day we will stand on our own again.'],
    ],
  },
  hostile: {
    warm: [['eyes', 'Kind words, from you? We are not fooled.']],
    plain: [
      ['angry', 'Your days are numbered, {you}.'],
      ['angry', 'We have not forgotten what you did.'],
    ],
    cold: [
      ['angry', 'Say that again and it will be war.'],
      ['skull', 'Careful. Our armies are closer than you think.'],
    ],
  },
  guarded: {
    warm: [['think', 'Hmm. We shall see, {you}.']],
    plain: [
      ['eyes', 'We are watching you.'],
      ['think', 'Noted.'],
    ],
    cold: [['eyes', 'Mind your borders, {you}.']],
  },
  neutral: {
    warm: [
      ['wave', 'Greetings, {you}.'],
      ['wave', 'Well met.'],
    ],
    plain: [
      ['think', 'Our envoys will consider it.'],
      ['think', 'Hmm.'],
    ],
    cold: [['eyes', 'Careful, or you will make an enemy of us.']],
  },
  favorable: {
    warm: [
      ['laugh', 'Ha! Good to hear from you, {you}.'],
      ['wave', 'Our people speak well of yours.'],
    ],
    plain: [['wave', 'Always a pleasure, {you}.']],
    cold: [['think', 'That is no way to speak to a friend.']],
  },
  friendly: {
    warm: [
      ['laugh', 'Ha! We’ll drink to that, {you}.'],
      ['gg', 'Together, none can stand against us.'],
    ],
    plain: [['wave', 'Always good to hear from a friend.']],
    cold: [['laugh', 'Ha! Save it for our enemies, friend.']],
  },
};

/** How `bot` feels toward `p`: at war (and bold about it, or not), their master or vassal, or its stance. */
export function moodOf(game: Game, bot: Player, p: Player): Mood {
  if (teammates(game, bot.index, p.index)) return 'friendly';
  if (masterOf(game, p.index) === bot) return 'master';
  if (masterOf(game, bot.index) === p) return 'vassal';
  if (atWar(game, bot.index, p.index)) {
    // (Bold leaders, and any winning the war, swagger; the rest want it over.)
    const ours = game.cities.filter((c) => c.owner === bot.index).length;
    const theirs = game.cities.filter((c) => c.owner === p.index).length;
    return personalityOf(bot).boldness >= 6 || ours > theirs ? 'bold' : 'meek';
  }
  return stanceOf(opinionOf(game, bot, p).total);
}

/**
 * What `bot`'s leader answers `p`, who said `said` to it (words or a face): a line as it feels about
 * them, and the face it makes. `roll` (0 to 1) picks among the lines that fit.
 */
export function botAnswer(game: Game, bot: Player, p: Player, said: { text?: string; emote?: string }, roll: number): Answer | null {
  if (!bot.alive || bot.cityState || bot.civ === 'barbarian' || !bot.bot) return null;
  const tone: Tone = isEmote(said.emote) ? EMOTES[said.emote].tone : said.text ? toneOf(said.text) : 'plain';
  const lines = LINES[moodOf(game, bot, p)];
  const pool = lines[tone] ?? lines.plain;
  const [emote, text] = pool[Math.min(pool.length - 1, Math.floor(roll * pool.length))];
  return { emote, text: text.replace('{you}', p.name) };
}
