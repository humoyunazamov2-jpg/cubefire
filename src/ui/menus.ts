import './menus.css';
import type { Prefs } from '../client/prefs';
import { MAPS, MAP_LIST } from '../maps';
import type { C2H, RoomInfo, RoomSettings, TeamSlot } from '../net/protocol';
import { esc } from './hud';

const h = (html: string): HTMLElement => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

class Screen {
  readonly root: HTMLDivElement;
  constructor(parent: HTMLElement, cls: string) {
    this.root = document.createElement('div');
    this.root.className = `screen ${cls}`;
    parent.appendChild(this.root);
  }
  show(): void { this.root.classList.add('on'); }
  hide(): void { this.root.classList.remove('on'); }
  get visible(): boolean { return this.root.classList.contains('on'); }
}

// ------------------------------------------------------------------ main menu

export interface MainMenuActions {
  vsBots(): void;
  practice(): void;
  host(): void;
  join(code: string): void;
  settings(): void;
  help(): void;
  rename(name: string): void;
}

export class MainMenu extends Screen {
  private nameInput: HTMLInputElement;
  private codeInput: HTMLInputElement;
  private joinRow: HTMLElement;

  constructor(parent: HTMLElement, prefs: Prefs, private act: MainMenuActions, online: boolean) {
    super(parent, 'menu-main');
    this.root.innerHTML = `
      <h1 class="logo">CUBEFIRE</h1>
      <div class="tagline">Blocky tactical shooter · rounds, money, and your friends</div>
      <div class="menu-col">
        <div class="name-row"><label>Your name</label><input class="txt" maxlength="16" placeholder="Player"></div>
        <button class="btn primary" data-a="bots">Play vs bots <small>offline</small></button>
        ${online ? `<button class="btn" data-a="host">Host a room <small>play with friends</small></button>
        <button class="btn" data-a="join">Join a room <small>with a code</small></button>
        <div class="row" data-join style="display:none"><input class="txt grow" maxlength="8" placeholder="Room code"><button class="btn small" data-a="go">Join</button></div>` : ''}
        <button class="btn" data-a="practice">Practice range <small>free weapons</small></button>
        <button class="btn" data-a="settings">Settings</button>
        <button class="btn" data-a="help">How to play</button>
      </div>
      <div class="menu-foot">Original game · art and sound generated in code</div>`;
    this.nameInput = this.root.querySelector('.name-row input')!;
    this.nameInput.value = prefs.name;
    this.nameInput.addEventListener('change', () => act.rename(this.nameInput.value.trim()));
    this.joinRow = this.root.querySelector('[data-join]') ?? document.createElement('div');
    this.codeInput = this.joinRow.querySelector('input') ?? document.createElement('input');
    this.codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.doJoin(); });
    this.root.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a');
      if (!a) return;
      act.rename(this.nameInput.value.trim());
      if (a === 'bots') act.vsBots();
      if (a === 'practice') act.practice();
      if (a === 'host') act.host();
      if (a === 'join') { this.joinRow.style.display = 'flex'; this.codeInput.focus(); }
      if (a === 'go') this.doJoin();
      if (a === 'settings') act.settings();
      if (a === 'help') act.help();
    });
  }

  private doJoin(): void {
    const code = this.codeInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length >= 4) this.act.join(code);
    else this.codeInput.focus();
  }

  prefillCode(code: string): void {
    this.joinRow.style.display = 'flex';
    this.codeInput.value = code;
  }
}

// ------------------------------------------------------------------ settings

const CROSSHAIR_COLORS = ['#7cff6b', '#ffffff', '#ffe14d', '#4df3ff', '#ff5ad1', '#ff4d4d'];

export class SettingsScreen extends Screen {
  private onClose: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    super(parent, 'center dim');
  }

  open(prefs: Prefs, onChange: (p: Prefs) => void, onClose: () => void): void {
    this.onClose = onClose;
    const p = { ...prefs };
    const seg = (key: keyof Prefs, opts: [string, string][]) =>
      `<div class="seg" data-seg="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(p[key]) === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const range = (key: keyof Prefs, min: number, max: number, step: number, fmt: (v: number) => string) =>
      `<input type="range" data-r="${key}" min="${min}" max="${max}" step="${step}" value="${p[key]}"><span class="val" data-v="${key}">${fmt(p[key] as number)}</span>`;
    const fmts: Record<string, (v: number) => string> = {
      sensitivity: (v) => v.toFixed(2), fov: (v) => `${v}°`, volume: (v) => `${Math.round(v * 100)}%`,
      crosshairSize: (v) => `${v}`, crosshairGap: (v) => `${v}`,
    };
    this.root.innerHTML = `<div class="panel">
      <h2>Settings <button class="btn small" data-a="close">Done</button></h2>
      <div class="set-grid">
        <span>Mouse sensitivity</span>${range('sensitivity', 0.1, 4, 0.05, fmts.sensitivity)}
        <span>Field of view</span>${range('fov', 60, 100, 1, fmts.fov)}
        <span>Volume</span>${range('volume', 0, 1, 0.05, fmts.volume)}
        <span>Crosshair size</span>${range('crosshairSize', 2, 14, 1, fmts.crosshairSize)}
        <span>Crosshair gap</span>${range('crosshairGap', 0, 12, 1, fmts.crosshairGap)}
        <span>Crosshair colour</span><div class="row">${CROSSHAIR_COLORS.map((c) => `<span class="swatch${p.crosshairColor === c ? ' on' : ''}" data-c="${c}" style="background:${c}"></span>`).join('')}</div><span></span>
        <span>Graphics</span>${seg('quality', [['auto', 'Auto'], ['high', 'High'], ['low', 'Low']])}<span></span>
        <span>Show FPS</span>${seg('showFps', [['true', 'On'], ['false', 'Off']])}<span></span>
        <span>Weapon bob</span>${seg('viewBob', [['true', 'On'], ['false', 'Off']])}<span></span>
      </div>
      <h3>Graphics: Auto lowers the resolution when your frame rate drops. Low is for weak laptops.</h3>
    </div>`;
    const emit = () => onChange({ ...p });
    this.root.querySelectorAll<HTMLInputElement>('input[data-r]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const k = inp.dataset.r as keyof Prefs;
        (p as unknown as Record<string, number>)[k] = Number(inp.value);
        this.root.querySelector(`[data-v="${k}"]`)!.textContent = fmts[k](Number(inp.value));
        emit();
      });
    });
    this.root.querySelectorAll<HTMLElement>('[data-seg]').forEach((s) => {
      s.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('button');
        if (!b) return;
        const k = s.dataset.seg as keyof Prefs;
        const v = b.dataset.v!;
        (p as unknown as Record<string, unknown>)[k] = v === 'true' ? true : v === 'false' ? false : v;
        s.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        emit();
      });
    });
    this.root.querySelectorAll<HTMLElement>('[data-c]').forEach((sw) => {
      sw.addEventListener('click', () => {
        p.crosshairColor = sw.dataset.c!;
        this.root.querySelectorAll('[data-c]').forEach((x) => x.classList.toggle('on', x === sw));
        emit();
      });
    });
    this.root.querySelector('[data-a="close"]')!.addEventListener('click', () => this.close());
    this.show();
  }

  close(): void {
    if (!this.visible) return;
    this.hide();
    this.onClose?.();
  }
}

// ------------------------------------------------------------------ how to play

export class HelpScreen extends Screen {
  constructor(parent: HTMLElement, onClose: () => void) {
    super(parent, 'center dim');
    const keys: [string, string][] = [
      ['Move', 'W A S D'], ['Jump', 'Space · wheel down'], ['Crouch', 'Ctrl or C'], ['Walk quietly', 'Shift'],
      ['Shoot', 'Left click'], ['Scope / heavy stab / lob', 'Right click'], ['Reload', 'R'], ['Weapons', '1 2 3 4 · Q'],
      ['Buy menu', 'B'], ['Scoreboard', 'Tab (hold)'], ['Drop weapon', 'G'], ['Inspect', 'F'],
      ['Chat / team chat', 'Y / U'], ['Pause', 'Esc'],
    ];
    this.root.innerHTML = `<div class="panel help">
      <h2>How to play <button class="btn small" data-a="close">Close</button></h2>
      <p><b>Goal.</b> Two teams, Blaze and Frost. A round ends when one team is wiped out. If the clock runs out, the team with more players alive wins (then more health). First team to the target number of rounds wins the match. Sides swap at halftime.</p>
      <p><b>Money.</b> Everyone starts with $800 and a pistol. At the start of each round you have a few seconds to buy in your spawn area (press B). Winning a round pays $3250; losing pays $1400 and more for each loss in a row. Kills pay too: SMGs and shotguns pay the most. If you survive a round you keep your weapons.</p>
      <p><b>Shooting.</b> Stand still, walk or crouch to be accurate. Running and jumping make bullets spray. Headshots do four times the damage. Pull the mouse down while spraying to fight the recoil. Bullets go through thin wood, glass and leaves.</p>
      <p><b>Grenades.</b> Frag explodes after a short fuse. Blinder flashes anyone looking at it (turn away!). Fog makes a wall of smoke for 15 seconds.</p>
      <h3>Controls</h3>
      <div class="keys">${keys.map(([a, k]) => `<div><span>${a}</span><kbd>${k}</kbd></div>`).join('')}</div>
    </div>`;
    this.root.querySelector('[data-a="close"]')!.addEventListener('click', () => { this.hide(); onClose(); });
  }
}

// ------------------------------------------------------------------ pause

export interface PauseActions {
  resume(): void;
  settings(): void;
  team(t: TeamSlot): void;
  leave(): void;
  endMatch(): void;
}

export class PauseMenu extends Screen {
  constructor(parent: HTMLElement, private act: PauseActions) {
    super(parent, 'center dim');
  }

  open(opts: { canPickTeam: boolean; isHost: boolean; code: string | null; online: boolean }): void {
    this.root.innerHTML = `<div class="panel" style="width:min(380px,92vw)">
      <h2>Paused</h2>
      ${opts.online && opts.code ? `<div class="hint" style="margin-bottom:10px">Room code: <b style="color:var(--gold)">${esc(opts.code)}</b> · the match keeps running</div>` : ''}
      <div class="menu-col" style="width:100%">
        <button class="btn primary" data-a="resume">Resume</button>
        ${opts.canPickTeam ? `<div class="row"><button class="btn grow center" data-t="0">Join Blaze</button><button class="btn grow center" data-t="1">Join Frost</button></div>` : ''}
        <button class="btn" data-a="settings">Settings</button>
        ${opts.isHost ? '<button class="btn" data-a="end">End match for everyone</button>' : ''}
        <button class="btn" data-a="leave">${opts.isHost && opts.online ? 'Close room and leave' : 'Leave match'}</button>
      </div></div>`;
    this.root.onclick = (e) => {
      const el = e.target as HTMLElement;
      const a = el.closest('[data-a]')?.getAttribute('data-a');
      const t = el.closest('[data-t]')?.getAttribute('data-t');
      if (t !== null && t !== undefined) { this.act.team(Number(t) as TeamSlot); this.act.resume(); return; }
      if (a === 'resume') this.act.resume();
      if (a === 'settings') this.act.settings();
      if (a === 'leave') this.act.leave();
      if (a === 'end') this.act.endMatch();
    };
    this.show();
  }
}

// ------------------------------------------------------------------ lobby

export interface LobbyActions {
  send(m: C2H): void;
  leave(): void;
  copyCode(code: string): void;
}

export class Lobby extends Screen {
  private box: HTMLDivElement;
  private chatLog: HTMLDivElement;
  private chatInput: HTMLInputElement;
  private body: HTMLDivElement;
  private sig = '';

  constructor(parent: HTMLElement, private act: LobbyActions) {
    super(parent, 'center dim');
    this.box = document.createElement('div');
    this.box.className = 'panel lobby';
    this.root.appendChild(this.box);
    this.body = document.createElement('div');
    this.box.appendChild(this.body);
    const chat = h(`<div class="lobby-chat"><div class="log"></div><input class="txt" maxlength="160" placeholder="Say something and press Enter"></div>`);
    this.box.appendChild(chat);
    this.chatLog = chat.querySelector('.log')!;
    this.chatInput = chat.querySelector('input')!;
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && this.chatInput.value.trim()) {
        act.send({ t: 'chat', text: this.chatInput.value.trim(), team: false });
        this.chatInput.value = '';
      }
    });
    this.body.addEventListener('click', (e) => this.onClick(e));
  }

  chat(name: string | null, text: string): void {
    const line = document.createElement('div');
    line.innerHTML = name === null ? `<span class="note">${esc(text)}</span>` : `<span class="n">${esc(name)}:</span> ${esc(text)}`;
    this.chatLog.appendChild(line);
    while (this.chatLog.children.length > 60) this.chatLog.firstElementChild!.remove();
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  private onClick(e: MouseEvent): void {
    const el = e.target as HTMLElement;
    const d = (k: string) => el.closest(`[data-${k}]`)?.getAttribute(`data-${k}`);
    const join = d('join'), addBot = d('addbot'), kick = d('kick'), set = d('set'), a = d('a');
    if (join !== undefined && join !== null) this.act.send({ t: 'team', team: Number(join) as TeamSlot });
    if (addBot !== undefined && addBot !== null) this.act.send({ t: 'addBot', team: Number(addBot) as 0 | 1 });
    if (kick) this.act.send({ t: 'kickBot', id: Number(kick) });
    if (set) {
      const [key, raw] = set.split('=');
      const v: unknown = raw === 'true' ? true : raw === 'false' ? false : /^\d+$/.test(raw) ? Number(raw) : raw;
      this.act.send({ t: 'settings', settings: { [key]: v } as Partial<RoomSettings> });
    }
    if (a === 'start') this.act.send({ t: 'startMatch' });
    if (a === 'leave') this.act.leave();
    if (a === 'copy') this.act.copyCode(el.closest('[data-code]')!.getAttribute('data-code')!);
  }

  /** Fresh room: forget the old chat. */
  reset(): void {
    this.chatLog.innerHTML = '';
    this.sig = '';
  }

  /** Shown for the moment between connecting and the host's first reply. */
  connecting(): void {
    this.sig = '';
    this.body.innerHTML = '<h2><span>Room</span></h2><div class="hint" style="padding:40px 0;text-align:center">Connecting to the room...</div>';
  }

  render(room: RoomInfo, myId: number, offline: boolean): void {
    const sig = JSON.stringify([room, myId]);
    if (sig === this.sig) return;
    this.sig = sig;
    const me = room.roster.find((r) => r.id === myId);
    const isHost = !!me?.host;
    const s = room.settings;
    const size = s.teamSize;
    const team = (t: 0 | 1) => {
      const list = room.roster.filter((r) => r.team === t);
      const rows = list.map((r) => `<li><span class="${r.id === myId ? 'you' : ''}">${r.host ? '♛ ' : ''}${esc(r.name)}${r.bot ? '<span class="tag">BOT</span>' : ''}</span>` +
        `<span>${r.bot && isHost ? `<button data-kick="${r.id}">remove</button>` : r.bot ? '' : `<span class="tag">${r.ping} ms</span>`}</span></li>`);
      for (let i = list.length; i < size; i++) rows.push(`<li class="empty">${s.fillBots ? 'empty · a bot will fill this' : 'empty slot'}</li>`);
      const full = list.length >= size && !list.some((r) => r.bot);
      return `<div class="team-box ${t === 0 ? 'blaze' : 'frost'}"><h4><span>${t === 0 ? 'Blaze' : 'Frost'}</span><span>${list.length}/${size}</span></h4><ul>${rows.join('')}</ul>
        <div class="foot">${me?.team !== t ? `<button class="btn small grow center" data-join="${t}" ${full ? 'disabled' : ''}>Join ${t === 0 ? 'Blaze' : 'Frost'}</button>` : ''}
        ${isHost && list.length < size ? `<button class="btn small" data-addbot="${t}">+ bot</button>` : ''}</div></div>`;
    };
    const segBtns = (key: keyof RoomSettings, opts: [string | number | boolean, string][]) =>
      `<div class="seg">${opts.map(([v, l]) => `<button ${isHost ? '' : 'disabled'} data-set="${key}=${v}" class="${s[key] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const specs = room.roster.filter((r) => r.team === -1);
    this.body.innerHTML = `
      <h2><span>${offline ? 'Match vs bots' : 'Room'}</span>
        ${offline ? '' : `<span class="lobby-code" data-code="${esc(room.code)}">Code <b>${esc(room.code)}</b><button class="btn small" data-a="copy">Copy invite</button></span>`}</h2>
      <div class="lobby-grid">
        ${team(0)}${team(1)}
        <div class="lobby-set">
          <div class="set-row"><label>Mode</label>${segBtns('teamSize', [[1, '1v1'], [2, '2v2'], [4, '4v4']])}</div>
          <div><label>Map</label><div class="map-cards">${MAP_LIST.map((id) => `<button class="map-card${s.map === id ? ' on' : ''}" ${isHost ? '' : 'disabled'} data-set="map=${id}">${MAPS[id].name}<small>${MAPS[id].sizes}</small></button>`).join('')}</div></div>
          <div class="set-row"><label>Rounds to win</label>${segBtns('winRounds', [[3, '3'], [5, '5'], [7, '7'], [9, '9'], [13, '13']])}</div>
          <div class="set-row"><label>Fill empty slots with bots</label>${segBtns('fillBots', [[true, 'Yes'], [false, 'No']])}</div>
          <div class="set-row"><label>Bot skill</label>${segBtns('botSkill', [[0, 'Easy'], [1, 'Normal'], [2, 'Hard']])}</div>
          <div class="set-row"><label>Friendly fire</label>${segBtns('friendlyFire', [[false, 'Off'], [true, 'On']])}</div>
        </div>
      </div>
      <div class="lobby-foot">
        <div class="row">
          <button class="btn" data-a="leave">${offline ? 'Back' : isHost ? 'Close room' : 'Leave room'}</button>
          ${me?.team === -1 ? '<button class="btn small" data-join="0">Join a team</button>' : '<button class="btn small" data-join="-1">Spectate</button>'}
        </div>
        <span class="hint grow">${specs.length ? `Spectating: ${specs.map((r) => esc(r.name)).join(', ')}. ` : ''}${isHost ? (offline ? '' : 'Send your friends the code. They pick "Join a room" and type it.') : 'Waiting for the host to start...'}</span>
        ${isHost ? '<button class="btn primary" data-a="start">Start match</button>' : ''}
      </div>`;
  }
}

// ------------------------------------------------------------------ small screens

export class Prompt extends Screen {
  constructor(parent: HTMLElement, onClick: () => void) {
    super(parent, 'prompt');
    this.root.innerHTML = '<div class="big">Click to play</div><small>Esc pauses · B buys · Tab shows scores</small>';
    this.root.addEventListener('click', onClick);
  }
}

export class Loading extends Screen {
  constructor(parent: HTMLElement) {
    super(parent, 'loading');
  }
  showText(text: string): void {
    this.root.textContent = text;
    this.show();
  }
}

export class Notice extends Screen {
  constructor(parent: HTMLElement) {
    super(parent, 'center dim');
  }
  open(title: string, text: string, onOk: () => void): void {
    this.root.innerHTML = `<div class="panel error-box"><h2>${esc(title)}</h2><p>${esc(text)}</p><button class="btn primary center" data-a="ok">OK</button></div>`;
    this.root.querySelector('[data-a="ok"]')!.addEventListener('click', () => { this.hide(); onOk(); });
    this.show();
  }
}
