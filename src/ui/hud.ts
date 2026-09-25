import './hud.css';
import { WEAPONS, type WeaponId } from '../game/weapons';
import type { Inventory } from '../net/protocol';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement, html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
};

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface HudTop {
  score: [number, number];
  alive: [boolean[], boolean[]];
  clock: string;
  label: string;
  urgent: boolean;
}

export interface KillEntry {
  killer: string | null;
  killerTeam: number;
  victim: string;
  victimTeam: number;
  weapon: string;
  hs: boolean;
  wb: boolean;
  mine: boolean;
}

/** DOM overlay: vitals, ammo, round clock, kill feed, crosshair and screen effects. */
export class Hud {
  readonly root: HTMLDivElement;
  private topBlaze: HTMLDivElement;
  private topFrost: HTMLDivElement;
  private clock: HTMLDivElement;
  private money: HTMLDivElement;
  private hp: HTMLDivElement;
  private ar: HTMLDivElement;
  private ammo: HTMLDivElement;
  private weaponName: HTMLDivElement;
  private slots: HTMLDivElement;
  private xhair: HTMLDivElement;
  private xLines: HTMLElement[] = [];
  private hitmark: HTMLDivElement;
  private dmgInd: HTMLDivElement;
  private killfeed: HTMLDivElement;
  private center: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private scopeEl: HTMLDivElement;
  private flashEl: HTMLDivElement;
  private smokeEl: HTMLDivElement;
  private vignette: HTMLDivElement;
  private chatEl: HTMLDivElement;
  private chatLog: HTMLDivElement;
  private chatInput: HTMLInputElement;
  private chatPrefix: HTMLSpanElement;
  private spec: HTMLDivElement;
  private buyHint: HTMLDivElement;
  private netWarn: HTMLDivElement;
  private fpsEl: HTMLDivElement;
  private cache = new Map<string, string>();
  private hitTimer = 0;
  private centerTimer = 0;
  private toastTimer = 0;
  private lastMoney = -1;
  crosshairColor = '#7cff6b';
  crosshairSize = 7;
  crosshairGap = 4;
  showFps = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', '', parent);
    this.root.id = 'hud';
    const top = el('div', 'hud-top', this.root);
    this.topBlaze = el('div', 'team blaze hud-panel', top);
    this.clock = el('div', 'clock hud-panel', top);
    this.topFrost = el('div', 'team frost hud-panel', top);

    const bl = el('div', 'hud-bl', this.root);
    this.money = el('div', 'hud-money hud-panel', bl);
    const vit = el('div', 'hud-vitals', bl);
    this.hp = el('div', 'hud-vital hp hud-panel', vit);
    this.ar = el('div', 'hud-vital ar hud-panel', vit);

    const br = el('div', 'hud-br', this.root);
    this.weaponName = el('div', 'hud-weapon hud-panel', br);
    this.ammo = el('div', 'hud-ammo hud-panel', br);
    this.slots = el('div', 'hud-slots', this.root);

    this.xhair = el('div', 'xhair', this.root);
    for (let i = 0; i < 4; i++) this.xLines.push(el('i', '', this.xhair));
    el('i', 'dot', this.xhair);
    this.hitmark = el('div', 'hitmark', this.root);
    this.dmgInd = el('div', 'dmg-ind', this.root);
    this.killfeed = el('div', 'killfeed', this.root);
    this.center = el('div', 'center-msg', this.root);
    this.toastEl = el('div', 'toast hud-panel', this.root);
    this.scopeEl = el('div', 'scope', this.root);
    this.smokeEl = el('div', 'smoke-screen', this.root);
    this.vignette = el('div', 'vignette', this.root);
    this.flashEl = el('div', 'flashbang', this.root);

    this.chatEl = el('div', 'chat', this.root);
    this.chatLog = el('div', 'chat-log', this.chatEl);
    const ci = el('div', 'chat-input', this.chatEl);
    this.chatPrefix = el('span', '', ci, 'ALL:');
    this.chatInput = el('input', '', ci);
    this.chatInput.maxLength = 160;

    this.spec = el('div', 'spectating hud-panel', this.root);
    this.buyHint = el('div', 'buy-hint', this.root, 'Press B to buy');
    this.netWarn = el('div', 'net-warn', this.root, 'Connection to host is lagging...');
    this.fpsEl = el('div', 'fps', this.root);
    this.setCrosshair(0);
  }

  set visible(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  /** Only touch the DOM when a value actually changes. */
  private put(key: string, node: HTMLElement, html: string): void {
    if (this.cache.get(key) === html) return;
    this.cache.set(key, html);
    node.innerHTML = html;
  }

  top(t: HudTop): void {
    const pips = (list: boolean[]) => list.map((a) => `<span class="pip${a ? '' : ' dead'}"></span>`).join('');
    this.put('tb', this.topBlaze, `<div class="pips">${pips(t.alive[0])}</div><div class="score">${t.score[0]}</div>`);
    this.put('tf', this.topFrost, `<div class="score">${t.score[1]}</div><div class="pips">${pips(t.alive[1])}</div>`);
    this.put('clock', this.clock, `${t.clock}<small>${t.label}</small>`);
    this.clock.classList.toggle('urgent', t.urgent);
  }

  vitals(alive: boolean, hp: number, armor: number, helmet: boolean, money: number): void {
    this.put('money', this.money, `$${money}`);
    if (this.lastMoney >= 0 && money !== this.lastMoney) {
      this.money.classList.remove('flash-up', 'flash-down');
      void this.money.offsetWidth;
      this.money.classList.add(money > this.lastMoney ? 'flash-up' : 'flash-down');
    }
    this.lastMoney = money;
    this.hp.style.visibility = this.ar.style.visibility = alive ? 'visible' : 'hidden';
    this.put('hp', this.hp, `<span class="icon"></span>${hp}`);
    this.put('ar', this.ar, `<span class="icon"></span>${armor}${helmet ? '<small style="font-size:12px">+H</small>' : ''}`);
    this.hp.classList.toggle('low', alive && hp <= 25);
    this.vignette.style.opacity = alive && hp <= 35 ? String(0.3 + (35 - hp) / 50) : '0';
  }

  weapon(alive: boolean, w: WeaponId, mag: number, reserve: number, reloading: boolean, inv: Inventory): void {
    const def = WEAPONS[w];
    const br = this.ammo.parentElement!;
    br.style.visibility = alive ? 'visible' : 'hidden';
    this.slots.style.visibility = alive ? 'visible' : 'hidden';
    this.put('wn', this.weaponName, reloading ? 'Reloading...' : def.name);
    if (def.magSize > 0) this.put('ammo', this.ammo, `${mag}<small>/ ${reserve}</small>`);
    else if (def.slot === 'grenade') this.put('ammo', this.ammo, `${inv.grenades.filter((g) => g === w).length}<small>left</small>`);
    else this.put('ammo', this.ammo, '<small>melee</small>');
    this.ammo.classList.toggle('empty', def.magSize > 0 && mag === 0);
    const rows: string[] = [];
    const slot = (key: string, id: WeaponId | null, label?: string) => {
      if (!id) return;
      rows.push(`<div class="hud-slot${w === id ? ' active' : ''}"><b>${key}</b>${label ?? WEAPONS[id].name}</div>`);
    };
    slot('1', inv.primary);
    slot('2', inv.secondary);
    slot('3', 'knife');
    const counts = new Map<string, number>();
    for (const g of inv.grenades) counts.set(g, (counts.get(g) ?? 0) + 1);
    for (const [g, n] of counts) slot('4', g as WeaponId, `${WEAPONS[g as WeaponId].name}${n > 1 ? ` x${n}` : ''}`);
    this.put('slots', this.slots, rows.join(''));
  }

  /** Crosshair lines spread apart with inaccuracy (in pixels). */
  setCrosshair(gapPx: number, hidden = false): void {
    this.xhair.classList.toggle('hidden', hidden);
    this.xhair.style.setProperty('--xc', this.crosshairColor);
    const g = Math.round(this.crosshairGap + gapPx), s = this.crosshairSize;
    const key = `${g}/${s}`;
    if (this.cache.get('xh') === key) return;
    this.cache.set('xh', key);
    const [t, r, b, l] = this.xLines;
    Object.assign(t.style, { width: '2px', height: `${s}px`, left: '-1px', top: `${-g - s}px` });
    Object.assign(b.style, { width: '2px', height: `${s}px`, left: '-1px', top: `${g}px` });
    Object.assign(l.style, { width: `${s}px`, height: '2px', left: `${-g - s}px`, top: '-1px' });
    Object.assign(r.style, { width: `${s}px`, height: '2px', left: `${g}px`, top: '-1px' });
  }

  hit(head: boolean, kill: boolean): void {
    this.hitmark.className = `hitmark on${head ? ' head' : ''}${kill ? ' kill' : ''}`;
    this.hitTimer = kill ? 0.35 : 0.12;
  }

  /** Red arc pointing towards where damage came from; angle in radians (0 = ahead). */
  damageFrom(angle: number): void {
    const a = el('div', 'dmg-arc', this.dmgInd);
    a.style.transform = `rotate(${angle}rad)`;
    requestAnimationFrame(() => { a.style.opacity = '0'; });
    setTimeout(() => a.remove(), 1000);
  }

  kill(k: KillEntry): void {
    const t = (n: number) => (n === 0 ? 'b' : 'f');
    const row = el('div', `kf${k.mine ? ' mine' : ''}`, this.killfeed);
    row.innerHTML = `${k.killer ? `<span class="${t(k.killerTeam)}">${esc(k.killer)}</span>` : ''}` +
      `<span class="w">[${esc(k.weapon)}]</span>${k.wb ? '<span class="tag">WALL</span>' : ''}${k.hs ? '<span class="tag">HEAD</span>' : ''}` +
      `<span class="${t(k.victimTeam)}">${esc(k.victim)}</span>`;
    while (this.killfeed.children.length > 6) this.killfeed.firstElementChild!.remove();
    setTimeout(() => row.remove(), 7000);
  }

  message(big: string, small = '', cls = '', seconds = 3): void {
    this.center.className = 'center-msg fade';
    void this.center.offsetWidth;
    this.center.innerHTML = `<div class="big ${cls}">${esc(big)}</div>${small ? `<div class="small">${esc(small)}</div>` : ''}`;
    this.centerTimer = seconds;
  }

  toast(text: string, seconds = 2): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('on');
    this.toastTimer = seconds;
  }

  scope(on: boolean): void {
    this.scopeEl.classList.toggle('on', on);
  }

  flash(amount: number): void {
    this.flashEl.style.opacity = String(Math.max(0, Math.min(1, amount)));
  }

  smoke(amount: number): void {
    this.smokeEl.style.opacity = String(Math.max(0, Math.min(0.97, amount)));
  }

  spectating(text: string | null, sub = ''): void {
    this.spec.classList.toggle('on', !!text);
    if (text) this.put('spec', this.spec, `${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}`);
  }

  buyAvailable(on: boolean): void {
    this.buyHint.classList.toggle('on', on);
  }

  lagging(on: boolean): void {
    this.netWarn.classList.toggle('on', on);
  }

  fps(n: number, ping: number): void {
    this.fpsEl.style.display = this.showFps ? 'block' : 'none';
    if (this.showFps) this.put('fps', this.fpsEl, `${n} fps${ping >= 0 ? ` · ${ping} ms` : ''}`);
  }

  chatLine(name: string | null, team: number, text: string, teamOnly = false): void {
    const line = el('div', `chat-line${name === null ? ' note' : ''}`, this.chatLog);
    const cls = team === 0 ? 'b' : team === 1 ? 'f' : 's';
    line.innerHTML = name === null ? esc(text) : `<span class="n ${cls}">${teamOnly ? '(team) ' : ''}${esc(name)}:</span> ${esc(text)}`;
    while (this.chatLog.children.length > 8) this.chatLog.firstElementChild!.remove();
  }

  get chatOpen(): boolean {
    return this.chatEl.classList.contains('open');
  }

  /** Show the chat box; resolves with the text (or null if cancelled). */
  openChat(team: boolean): Promise<string | null> {
    this.chatEl.classList.add('open');
    this.chatPrefix.textContent = team ? 'TEAM:' : 'ALL:';
    this.chatInput.value = '';
    setTimeout(() => this.chatInput.focus(), 0);
    return new Promise((resolve) => {
      const done = (v: string | null) => {
        this.chatInput.removeEventListener('keydown', onKey);
        this.chatInput.removeEventListener('blur', onBlur);
        this.chatEl.classList.remove('open');
        this.chatInput.blur();
        resolve(v);
      };
      const onKey = (e: KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === 'Enter') done(this.chatInput.value.trim() || null);
        if (e.key === 'Escape') done(null);
      };
      const onBlur = () => done(null);
      this.chatInput.addEventListener('keydown', onKey);
      this.chatInput.addEventListener('blur', onBlur);
    });
  }

  tick(dt: number): void {
    if (this.hitTimer > 0) { this.hitTimer -= dt; if (this.hitTimer <= 0) this.hitmark.classList.remove('on'); }
    if (this.centerTimer > 0) { this.centerTimer -= dt; if (this.centerTimer <= 0) this.center.innerHTML = ''; }
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) this.toastEl.classList.remove('on'); }
  }

  clearFeed(): void {
    this.killfeed.innerHTML = '';
  }
}
