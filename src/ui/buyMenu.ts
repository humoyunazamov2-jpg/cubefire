import { isTyping } from '../game/input';
import { ARMOR, GRENADE_LIMIT, WEAPONS, type GrenadeId, type ItemId } from '../game/weapons';
import type { Inventory } from '../net/protocol';
import { esc } from './hud';

export interface BuyContext {
  money: number;
  inv: Inventory;
  canBuy: boolean;
  buyLeft: number;
  sandbox: boolean;
}

const COLUMNS: { title: string; items: [ItemId, string][] }[] = [
  { title: 'Pistols', items: [['pistol', '1'], ['deagle', '2']] },
  { title: 'SMG & Shotgun', items: [['smg', '3'], ['shotgun', '4']] },
  { title: 'Rifles', items: [['rifle', '5'], ['carbine', '6']] },
  { title: 'Snipers', items: [['marksman', '7'], ['sniper', '8']] },
  { title: 'Grenades', items: [['he', 'Z'], ['flash', 'X'], ['smoke', 'C']] },
  { title: 'Gear', items: [['kevlar', 'V'], ['helmet', 'H']] },
];

const KEY_OF: Record<string, ItemId> = {};
for (const c of COLUMNS) for (const [id, k] of c.items) KEY_OF[k.length === 1 && k >= '0' && k <= '9' ? `Digit${k}` : `Key${k}`] = id;

export function itemPrice(item: ItemId, inv: Inventory): number {
  if (item === 'kevlar') return ARMOR.kevlar.price;
  if (item === 'helmet') return inv.armor >= 100 ? 350 : ARMOR.helmet.price;
  return WEAPONS[item].price;
}

export function itemName(item: ItemId): string {
  if (item === 'kevlar') return ARMOR.kevlar.name;
  if (item === 'helmet') return ARMOR.helmet.name;
  return WEAPONS[item].name;
}

/** Why an item can't be bought right now, or null if it can. */
export function buyBlock(item: ItemId, ctx: BuyContext): string | null {
  const { inv } = ctx;
  if (item === 'kevlar' && inv.armor >= 100) return 'owned';
  if (item === 'helmet' && inv.armor >= 100 && inv.helmet) return 'owned';
  if (item !== 'kevlar' && item !== 'helmet') {
    const d = WEAPONS[item];
    if (d.slot === 'primary' && inv.primary === item) return 'owned';
    if (d.slot === 'secondary' && inv.secondary === item) return 'owned';
    if (d.slot === 'grenade') {
      const g = item as GrenadeId;
      if (inv.grenades.filter((x) => x === g).length >= GRENADE_LIMIT[g]) return 'owned';
      if (inv.grenades.length >= 4) return 'full';
    }
  }
  if (!ctx.sandbox && itemPrice(item, inv) > ctx.money) return 'money';
  return null;
}

/** CS-style buy menu. Click an item or press its key. */
export class BuyMenu {
  readonly root: HTMLDivElement;
  private box: HTMLDivElement;
  onBuy: ((item: ItemId) => void) | null = null;
  onClose: (() => void) | null = null;
  private ctx: BuyContext | null = null;
  private sig = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'overlay';
    this.box = document.createElement('div');
    this.box.className = 'buy';
    this.root.appendChild(this.box);
    parent.appendChild(this.root);
    this.root.addEventListener('mousedown', (e) => { if (e.target === this.root) this.close(); });
    this.box.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button[data-item]') as HTMLButtonElement | null;
      if (b && !b.disabled) this.onBuy?.(b.dataset.item as ItemId);
    });
    // Capture phase, so the game's own key handling never sees these keys
    // (otherwise the B that closes the menu would open it again).
    addEventListener('keydown', (e) => {
      if (!this.isOpen || isTyping(e.target)) return;
      if (e.code === 'Escape' || e.code === 'KeyB') { e.preventDefault(); e.stopImmediatePropagation(); this.close(); return; }
      const item = KEY_OF[e.code];
      if (!item) return;
      e.stopImmediatePropagation();
      if (!e.repeat && this.ctx && !buyBlock(item, this.ctx) && this.ctx.canBuy) this.onBuy?.(item);
    }, true);
  }

  get isOpen(): boolean {
    return this.root.classList.contains('on');
  }

  open(ctx: BuyContext): void {
    this.root.classList.add('on');
    this.sig = '';
    this.update(ctx);
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.classList.remove('on');
    this.onClose?.();
  }

  update(ctx: BuyContext): void {
    this.ctx = ctx;
    if (!this.isOpen) return;
    const sig = JSON.stringify([ctx.money, ctx.inv, ctx.canBuy, Math.ceil(ctx.buyLeft)]);
    if (sig === this.sig) return;
    this.sig = sig;
    const cols = COLUMNS.map((c) => {
      const items = c.items.map(([id, key]) => {
        const block = buyBlock(id, ctx);
        const price = itemPrice(id, ctx.inv);
        const blurb = id === 'kevlar' ? 'Body armour. Cuts damage to the chest and arms.'
          : id === 'helmet' ? 'Body armour plus a helmet that protects against headshots.'
          : WEAPONS[id].blurb;
        return `<button class="buy-item${block === 'owned' ? ' owned' : ''}" data-item="${id}" ${block || !ctx.canBuy ? 'disabled' : ''}>` +
          `<div class="row"><span><kbd>${key}</kbd>${esc(itemName(id))}</span><span class="price">${ctx.sandbox ? 'free' : `$${price}`}</span></div>` +
          `<div class="blurb">${esc(blurb)}${block === 'owned' ? ' (owned)' : ''}</div></button>`;
      }).join('');
      return `<div class="buy-col"><h3>${c.title}</h3>${items}</div>`;
    }).join('');
    const timer = ctx.sandbox ? 'Practice: everything is free' : ctx.canBuy ? `Buy time left: ${Math.ceil(ctx.buyLeft)}s` : 'You can only buy in your spawn area during buy time';
    this.box.innerHTML = `<header><h2>Buy</h2><span class="timer">${timer}</span><span class="money">$${ctx.money}</span></header>` +
      `<div class="buy-cols">${cols}</div><footer>B or Esc closes. Buying a gun drops the one in the same slot.</footer>`;
  }
}
