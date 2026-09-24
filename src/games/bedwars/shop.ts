import type { IconRef, MenuEntry, MenuHandle, MenuOptions } from '@platform';
import { Sprite } from './art';
import { ARMOR, CURRENCIES, CURRENCY_NAME, PICK_ITEMS, SWORD_ITEMS, type Currency, type Match } from './state';

interface Offer {
  icon: IconRef;
  label: string;
  price: [Currency, number];
  note?: string;
  /** Already have it (highlighted, can't buy again). */
  owned?: boolean;
  /** Hand it over; false if there was no room. */
  buy(): boolean;
}

const ROMAN = ['I', 'II', 'III', 'IV'];
const PICK_NAMES = ['Wooden', 'Iron', 'Diamond'];
const PICK_PRICES: [Currency, number][] = [
  ['iron', 10],
  ['gold', 3],
  ['gold', 6],
];

/** The shopkeeper's menu: blocks, weapons, armour, tools and team upgrades, paid for from the wallet. */
export class Shop {
  private handle: MenuHandle | null = null;
  private shown = '';

  constructor(
    private m: Match,
    /** Gear or a team upgrade changed (re-apply armour and sword damage). */
    private upgraded: () => void,
  ) {}

  get open(): boolean {
    return this.handle?.open ?? false;
  }

  show() {
    if (this.open) return;
    this.handle = this.m.game.hud.menu({ ...this.contents(), onClose: () => (this.handle = null) });
  }

  close() {
    this.handle?.close();
    this.handle = null;
  }

  /** Keep prices greyed out correctly as the wallet changes. */
  refresh() {
    if (this.open && this.walletKey() !== this.shown) this.handle!.update(this.contents());
  }

  private walletKey(): string {
    const w = this.m.player.wallet;
    return CURRENCIES.map((c) => w[c]).join(',');
  }

  private give(item: string, count = 1): boolean {
    const left = this.m.game.player.inventory.give(item, count);
    return left < count;
  }

  private offers(): { title: string; offers: Offer[] }[] {
    const t = this.m.player;
    const inv = this.m.game.player.inventory;
    const sword = (tier: number, label: string, price: [Currency, number]): Offer => ({
      // Sword item ids are the built-in sprite names.
      icon: SWORD_ITEMS[tier] as IconRef,
      label,
      price,
      note: `${[4, 5, 6, 7][tier] + (t.sharp ? 1 : 0)} damage · lost on death`,
      owned: t.sword >= tier,
      buy: () => {
        for (const s of SWORD_ITEMS) inv.take(s, inv.count(s));
        t.sword = tier;
        return this.give(SWORD_ITEMS[tier]);
      },
    });
    const armor = (tier: number, label: string, icon: IconRef, price: [Currency, number]): Offer => ({
      icon,
      label,
      price,
      note: `Permanent · blocks ${ARMOR[tier] * 4}% of damage`,
      owned: t.armor >= tier,
      buy: () => {
        t.armor = tier;
        this.upgraded();
        return true;
      },
    });
    const pick: Offer =
      t.pick < 3
        ? {
            icon: [Sprite.wooden_pickaxe, Sprite.iron_pickaxe, Sprite.diamond_pickaxe][t.pick],
            label: `${PICK_NAMES[t.pick]} Pickaxe`,
            price: PICK_PRICES[t.pick],
            note: t.pick ? 'Upgrade · drops a tier when you die' : 'Mines end stone and wood fast',
            buy: () => {
              if (t.pick) inv.take(PICK_ITEMS[t.pick], inv.count(PICK_ITEMS[t.pick]));
              t.pick++;
              return this.give(PICK_ITEMS[t.pick]);
            },
          }
        : { icon: Sprite.diamond_pickaxe, label: 'Diamond Pickaxe', price: ['gold', 6], note: 'Fully upgraded', owned: true, buy: () => false };
    return [
      {
        title: 'Blocks',
        offers: [
          { icon: { block: t.wool }, label: 'Wool ×16', price: ['iron', 4], note: 'Cheap and quick to place', buy: () => this.give('wool', 16) },
          { icon: { block: 'oak_planks' }, label: 'Oak Planks ×16', price: ['gold', 4], note: 'Sturdier than wool', buy: () => this.give('planks', 16) },
          { icon: { block: 'end_stone' }, label: 'End Stone ×12', price: ['iron', 24], note: 'Blast-proof; slow to mine by hand', buy: () => this.give('end_stone', 12) },
          { icon: { block: 'obsidian' }, label: 'Obsidian ×4', price: ['emerald', 4], note: 'Almost unbreakable', buy: () => this.give('obsidian', 4) },
        ],
      },
      {
        title: 'Weapons',
        offers: [
          sword(1, 'Stone Sword', ['iron', 10]),
          sword(2, 'Iron Sword', ['gold', 7]),
          sword(3, 'Diamond Sword', ['emerald', 4]),
          { icon: 'bow', label: 'Bow', price: ['gold', 12], note: 'Hold left-click to draw', buy: () => this.give('bow') },
          { icon: 'arrow', label: 'Arrows ×8', price: ['gold', 2], buy: () => this.give('arrow', 8) },
        ],
      },
      {
        title: 'Armor & tools',
        offers: [
          armor(1, 'Iron Armor', Sprite.iron_armor, ['gold', 12]),
          armor(2, 'Diamond Armor', Sprite.diamond_armor, ['emerald', 6]),
          pick,
          {
            icon: Sprite.shears,
            label: 'Shears',
            price: ['iron', 20],
            note: 'Permanent · cuts through wool',
            owned: t.shears,
            buy: () => {
              t.shears = true;
              return this.give('shears');
            },
          },
        ],
      },
      {
        title: 'Utility',
        offers: [
          { icon: Sprite.golden_apple, label: 'Golden Apple', price: ['gold', 3], note: 'Heals 4 hearts', buy: () => this.give('golden_apple') },
          { icon: Sprite.fire_charge, label: 'Fireball', price: ['iron', 40], note: 'Right-click to throw · blasts wool and wood', buy: () => this.give('fire_charge') },
        ],
      },
      {
        title: 'Team upgrades',
        offers: [
          {
            icon: 'diamond_sword',
            label: 'Sharpened Swords',
            price: ['diamond', 4],
            note: '+1 damage on every sword',
            owned: t.sharp,
            buy: () => {
              t.sharp = true;
              this.upgraded();
              return true;
            },
          },
          {
            icon: Sprite.diamond_armor,
            label: `Reinforced Armor ${ROMAN[Math.min(3, t.prot)]}`,
            price: ['diamond', 2 ** (Math.min(3, t.prot) + 1)],
            note: t.prot >= 4 ? 'Fully upgraded' : 'Tougher armour, for good',
            owned: t.prot >= 4,
            buy: () => {
              t.prot++;
              this.upgraded();
              return true;
            },
          },
          {
            icon: Sprite.golden_apple,
            label: 'Heal Pool',
            price: ['diamond', 1],
            note: 'Regenerate while on your island',
            owned: t.heal,
            buy: () => {
              t.heal = true;
              return true;
            },
          },
        ],
      },
    ];
  }

  private contents(): MenuOptions {
    const w = this.m.player.wallet;
    this.shown = this.walletKey();
    const sections = this.offers().map(({ title, offers }) => ({
      title,
      entries: offers.map((o): MenuEntry => {
        const [cur, n] = o.price;
        return {
          icon: o.icon,
          label: o.label,
          note: o.note,
          detail: o.owned ? 'Owned' : `${n} ${CURRENCY_NAME[cur][n === 1 ? 0 : 1]}`,
          active: o.owned,
          disabled: o.owned || w[cur] < n,
          onSelect: () => this.purchase(o),
        };
      }),
    }));
    return {
      title: 'Item Shop',
      subtitle: `You have ${w.iron} iron · ${w.gold} gold · ${w.diamond} ${CURRENCY_NAME.diamond[w.diamond === 1 ? 0 : 1].toLowerCase()} · ${w.emerald} ${CURRENCY_NAME.emerald[w.emerald === 1 ? 0 : 1].toLowerCase()}`,
      sections,
    };
  }

  private purchase(o: Offer) {
    const g = this.m.game;
    const w = this.m.player.wallet;
    const [cur, n] = o.price;
    if (o.owned || w[cur] < n) return;
    if (!o.buy()) {
      g.hud.toast('Your hotbar is full');
      return;
    }
    w[cur] -= n;
    g.audio.play('buy');
    g.hud.toast(`Bought ${o.label}`);
    this.handle?.update(this.contents());
  }
}
