import type { GameContext, MenuEntry, MenuHandle, Player, StoreApi } from '@platform';

/**
 * Tribes: survivors who build as one. A tribe's members may take down, open and build beside
 * each other's pieces, and use each other's stations, boxes and beds.
 *
 * A tribe is its name, its leader and its members, kept in `game.store` under `bt.tribes` so a
 * tribe outlasts a restart. Members are owner keys (the same ones the ownership map uses), so a
 * signed-in survivor is in their tribe wherever they play from; a guest's key lasts one visit,
 * and they leave their tribe when they leave the island. Invitations are not kept: they last a
 * few minutes and only while the server runs.
 */

/** A tribe as it's saved. */
export interface Tribe {
  name: string;
  /** The owner key of whoever leads it (they founded it, or were next in line when the leader left). */
  leader: string;
  /** Owner key to the name they were last seen under. */
  members: Record<string, string>;
}

const KEY = 'bt.tribes';
/** The most survivors in one tribe, and the most tribes kept. */
export const TRIBE_SIZE = 12;
const MAX_TRIBES = 400;
/** How long an invitation stands, in seconds. */
const INVITE_LASTS = 300;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 '\-]{1,18}[A-Za-z0-9]$/;

export class Tribes {
  private tribes = new Map<string, Tribe>();
  /** Owner key to the id of their tribe. */
  private of = new Map<string, string>();
  /** Who has been asked in: owner key to the tribe and when the asking lapses (the game's clock). */
  private invites = new Map<string, { tribe: string; from: string; until: number }>();
  private dirty = false;
  private menus = new Map<string, MenuHandle>();

  constructor(
    private store: StoreApi,
    private keyOf: (player: Player) => string,
  ) {}

  /** Read the tribes back. `present` are the owner keys of whoever is on the island now (guests among them keep their place). */
  load(present: ReadonlySet<string> = new Set()): void {
    this.tribes.clear();
    this.of.clear();
    this.invites.clear();
    this.menus.clear();
    const saved = this.store.get<Record<string, Tribe>>(KEY) ?? {};
    for (const [id, tribe] of Object.entries(saved)) {
      if (!tribe || typeof tribe.name !== 'string' || !tribe.members) continue;
      // A guest's key means nothing after the visit it was made on: one who has gone isn't carried over.
      const members = Object.fromEntries(Object.entries(tribe.members).filter(([key]) => !key.startsWith('g:') || present.has(key)));
      const keys = Object.keys(members);
      if (!keys.length) continue;
      this.tribes.set(id, { name: tribe.name, leader: tribe.leader in members ? tribe.leader : keys[0], members });
      for (const key of keys) this.of.set(key, id);
    }
    this.dirty = false;
  }

  save(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.store.set(KEY, Object.fromEntries(this.tribes));
  }

  /** The tribe an owner key belongs to, or null. */
  tribeOfKey(key: string): Tribe | null {
    const id = this.of.get(key);
    return (id && this.tribes.get(id)) || null;
  }

  /** Whether two owner keys are in the same tribe. */
  same(a: string, b: string): boolean {
    const id = this.of.get(a);
    return id !== undefined && id === this.of.get(b);
  }

  /** The tribe a survivor has been asked to join (and not yet answered), or null. */
  invitedTo(player: Player, now: number): { tribe: Tribe; from: string } | null {
    const invite = this.invites.get(this.keyOf(player));
    if (!invite) return null;
    const tribe = this.tribes.get(invite.tribe);
    if (!tribe || invite.until <= now) {
      this.invites.delete(this.keyOf(player));
      return null;
    }
    return { tribe, from: invite.from };
  }

  // Each of these does one thing a survivor asked for and returns what to tell them; it throws
  // (an Error with words for them) when it can't be done.

  create(player: Player, name: string): string {
    const key = this.keyOf(player);
    if (this.of.has(key)) throw new Error(`You're already in ${this.tribeOfKey(key)!.name}: leave it first (/tribe leave)`);
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!NAME.test(clean)) throw new Error('A tribe name is 3 to 20 letters, numbers and spaces');
    const id = clean.toLowerCase();
    if (this.tribes.has(id)) throw new Error(`There's already a tribe called ${this.tribes.get(id)!.name}`);
    if (this.tribes.size >= MAX_TRIBES) throw new Error('The island has all the tribes it can hold');
    this.tribes.set(id, { name: clean, leader: key, members: { [key]: player.name } });
    this.of.set(key, id);
    this.invites.delete(key);
    this.dirty = true;
    return `You founded ${clean}. Ask others in with /tribe invite <name>`;
  }

  invite(player: Player, other: Player, now: number): string {
    const key = this.keyOf(player);
    const id = this.of.get(key);
    const tribe = id && this.tribes.get(id);
    if (!id || !tribe) throw new Error('Found a tribe first: /tribe create <name>');
    const theirs = this.keyOf(other);
    if (theirs === key) throw new Error("You're already in your own tribe");
    if (this.of.get(theirs) === id) throw new Error(`${other.name} is already in ${tribe.name}`);
    if (this.of.has(theirs)) throw new Error(`${other.name} is in another tribe (${this.tribeOfKey(theirs)!.name})`);
    if (Object.keys(tribe.members).length >= TRIBE_SIZE) throw new Error(`${tribe.name} is full (${TRIBE_SIZE} survivors)`);
    this.invites.set(theirs, { tribe: id, from: player.name, until: now + INVITE_LASTS });
    other.hud.toast(`${player.name} asks you to join ${tribe.name}: /tribe accept (or G)`);
    return `Asked ${other.name} to join ${tribe.name}`;
  }

  accept(player: Player, now: number, tell: (to: string, text: string) => void): string {
    const key = this.keyOf(player);
    const invite = this.invitedTo(player, now);
    if (!invite) throw new Error('Nobody has asked you to join a tribe');
    if (this.of.has(key)) throw new Error(`Leave ${this.tribeOfKey(key)!.name} first (/tribe leave)`);
    const { tribe } = invite;
    if (Object.keys(tribe.members).length >= TRIBE_SIZE) throw new Error(`${tribe.name} is full`);
    for (const member of Object.keys(tribe.members)) tell(member, `${player.name} joined ${tribe.name}`);
    tribe.members[key] = player.name;
    this.of.set(key, this.invites.get(key)!.tribe);
    this.invites.delete(key);
    this.dirty = true;
    return `You joined ${tribe.name}`;
  }

  leave(key: string, tell: (to: string, text: string) => void): string {
    const id = this.of.get(key);
    const tribe = id && this.tribes.get(id);
    if (!id || !tribe) throw new Error("You're not in a tribe");
    const name = tribe.members[key];
    delete tribe.members[key];
    this.of.delete(key);
    this.dirty = true;
    const left = Object.keys(tribe.members);
    if (!left.length) {
      this.tribes.delete(id);
      return `You left ${tribe.name}, and with nobody in it the tribe is no more`;
    }
    if (tribe.leader === key) tribe.leader = left[0];
    for (const member of left) tell(member, `${name} left ${tribe.name}`);
    return `You left ${tribe.name}`;
  }

  /** A survivor is seen (joining, or doing something): their tribe remembers the name they go by now. */
  seen(player: Player): void {
    const tribe = this.tribeOfKey(this.keyOf(player));
    if (tribe && tribe.members[this.keyOf(player)] !== player.name) {
      tribe.members[this.keyOf(player)] = player.name;
      this.dirty = true;
    }
  }

  /** The words `/tribe` (or `/tribe info`) answers with. */
  describe(player: Player, now: number): string {
    const tribe = this.tribeOfKey(this.keyOf(player));
    const invite = this.invitedTo(player, now);
    if (!tribe) return invite ? `${invite.from} asks you to join ${invite.tribe.name}: /tribe accept` : "You're not in a tribe. /tribe create <name> founds one";
    const names = Object.entries(tribe.members).map(([key, name]) => (key === tribe.leader ? `${name} (leader)` : name));
    return `${tribe.name}: ${names.join(', ')}`;
  }

  /** The tribe menu: who's in it, who could be asked, and the way out. */
  menu(game: GameContext, player: Player): void {
    const tell = (to: string, text: string) => game.players.find((p) => this.keyOf(p) === to)?.hud.toast(text);
    const act = (what: () => string) => {
      try {
        player.hud.toast(what());
      } catch (problem) {
        player.hud.toast(problem instanceof Error ? problem.message : String(problem));
      }
      handle.update(build());
    };
    // A name to found one under at a click: theirs, as far as a tribe's name may be spelled.
    const ownName = `${player.name.replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 12) || 'Survivor'}'s Tribe`;
    const build = () => {
      const now = game.clock.total;
      const key = this.keyOf(player);
      const tribe = this.tribeOfKey(key);
      const sections: { title?: string; entries: MenuEntry[] }[] = [];
      if (tribe) {
        const online = new Set(game.players.map((p) => this.keyOf(p)));
        sections.push({
          title: `Members (${Object.keys(tribe.members).length} of ${TRIBE_SIZE})`,
          entries: Object.entries(tribe.members).map(([member, name]) => ({
            label: name,
            detail: member === tribe.leader ? 'Leader' : '',
            note: member === key ? 'You' : online.has(member) ? 'On the island' : 'Away',
            active: member === key,
          })),
        });
        const others = game.players.filter((p) => !this.of.has(this.keyOf(p)));
        sections.push({
          title: 'Ask someone in',
          entries: others.length
            ? others.map((other) => ({
                label: other.name,
                note: this.invites.get(this.keyOf(other))?.tribe === this.of.get(key) ? 'Asked: waiting for their answer' : 'Shares your structures, stations and boxes',
                onSelect: () => act(() => this.invite(player, other, game.clock.total)),
              }))
            : [{ label: 'Nobody without a tribe is on the island', disabled: true }],
        });
        sections.push({ entries: [{ label: `Leave ${tribe.name}`, note: 'Your own structures stay yours', onSelect: () => act(() => this.leave(key, tell)) }] });
      } else {
        const invite = this.invitedTo(player, now);
        if (invite) {
          sections.push({
            title: 'You have been asked in',
            entries: [{ label: `Join ${invite.tribe.name}`, note: `${invite.from} asked you`, active: true, onSelect: () => act(() => this.accept(player, game.clock.total, tell)) }],
          });
        }
        sections.push({
          title: 'Found a tribe',
          entries: [
            {
              label: `Found "${ownName}"`,
              note: 'Or name it yourself: /tribe create <name>',
              onSelect: () => act(() => this.create(player, ownName)),
            },
          ],
        });
      }
      return {
        title: tribe ? tribe.name : 'Tribe',
        subtitle: tribe ? 'Tribemates share structures, doors, stations, boxes and beds.' : 'Survivors in a tribe build as one: they share structures, doors, stations and boxes.',
        sections,
      };
    };
    this.menus.get(player.id)?.close();
    const handle = player.hud.menu({ ...build(), onClose: () => this.menus.delete(player.id) });
    this.menus.set(player.id, handle);
  }

  /** Whether a survivor has the tribe menu up (the key that opens it shuts it too). */
  closeMenu(player: Player): boolean {
    const menu = this.menus.get(player.id);
    if (!menu) return false;
    menu.close();
    this.menus.delete(player.id);
    return true;
  }

  /** A survivor goes: their menu with them, and (a guest, whose key ends here) their place in a tribe. */
  left(player: Player, tell: (to: string, text: string) => void): void {
    this.menus.delete(player.id);
    const key = this.keyOf(player);
    this.invites.delete(key);
    if (key.startsWith('g:') && this.of.has(key)) this.leave(key, tell);
  }

  /** The `/tribe` command. */
  command(args: string[], game: GameContext, player: Player): string | void {
    const now = game.clock.total;
    const tell = (to: string, text: string) => game.players.find((p) => this.keyOf(p) === to)?.hud.toast(text);
    const [verb, ...rest] = args;
    switch ((verb ?? '').toLowerCase()) {
      case '':
      case 'menu':
        this.menu(game, player);
        return;
      case 'info':
        return this.describe(player, now);
      case 'create':
      case 'found':
        if (!rest.length) throw new Error('Name it: /tribe create <name>');
        return this.create(player, rest.join(' '));
      case 'invite': {
        const name = rest.join(' ').toLowerCase();
        if (!name) throw new Error('Whom? /tribe invite <player>');
        const other = game.players.find((p) => p.name.toLowerCase() === name) ?? game.players.find((p) => p.name.toLowerCase().startsWith(name));
        if (!other) throw new Error(`Nobody called ${rest.join(' ')} is on the island`);
        return this.invite(player, other, now);
      }
      case 'accept':
      case 'join':
        return this.accept(player, now, tell);
      case 'leave':
        return this.leave(this.keyOf(player), tell);
      default:
        throw new Error('Try /tribe create <name>, invite <player>, accept, leave or info');
    }
  }
}
