import * as THREE from 'three';
import { sfx } from './audio/sfx';
import { GameClient } from './client/client';
import { loadPrefs, savePrefs, type Prefs } from './client/prefs';
import { Renderer } from './engine/renderer';
import { Input } from './game/input';
import { createBot } from './bots/bot';
import { HostSession } from './host/host';
import { Ticker } from './host/ticker';
import { MAPS } from './maps';
import { localPair } from './net/link';
import type { C2H, H2C, MapId, RoomSettings } from './net/protocol';
import { BuyMenu } from './ui/buyMenu';
import { Hud } from './ui/hud';
import { HelpScreen, Loading, Lobby, MainMenu, Notice, PauseMenu, Prompt, SettingsScreen } from './ui/menus';
import { Scoreboard } from './ui/scoreboard';

type State = 'menu' | 'lobby' | 'match';

interface Session {
  host: HostSession | null;
  ticker: Ticker | null;
  client: GameClient;
  offline: boolean;
  practice: boolean;
  code: string;
}

/**
 * The whole game: menus, lobby and the match, and the switching between them.
 */
export class App {
  readonly renderer: Renderer;
  readonly input: Input;
  readonly hud: Hud;
  readonly buy: BuyMenu;
  readonly scores: Scoreboard;
  prefs: Prefs;
  state: State = 'menu';
  session: Session | null = null;
  /** Tests step the host by hand instead of using the background ticker. */
  manualTick = false;
  private main: MainMenu;
  private settings: SettingsScreen;
  private help: HelpScreen;
  private pause: PauseMenu;
  private lobby: Lobby;
  private prompt: Prompt;
  private loading: Loading;
  private notice: Notice;
  private backdropMap: MapId = 'dunes';
  private backdropReady = false;
  private orbit = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 60;
  private scale = 1;
  private slowTime = 0;

  constructor(root: HTMLElement, readonly online = false) {
    this.prefs = loadPrefs();
    this.renderer = new Renderer(root);
    this.input = new Input(this.renderer.canvas);
    this.hud = new Hud(root);
    this.buy = new BuyMenu(root);
    this.scores = new Scoreboard(root);
    this.hud.visible = false;

    this.main = new MainMenu(root, this.prefs, {
      vsBots: () => this.playVsBots(),
      practice: () => this.practice(),
      host: () => this.hostOnline(),
      join: (code) => this.joinOnline(code),
      settings: () => this.openSettings(),
      help: () => { this.main.hide(); this.help.show(); },
      rename: (name) => { this.prefs.name = name; savePrefs(this.prefs); },
    }, online);
    this.help = new HelpScreen(root, () => this.showMenuForState());
    this.settings = new SettingsScreen(root);
    this.pause = new PauseMenu(root, {
      resume: () => this.resume(),
      settings: () => { this.pause.hide(); this.openSettings(); },
      team: (t) => this.session?.client.send({ t: 'team', team: t }),
      leave: () => this.leave(),
      endMatch: () => { this.session?.host?.endMatch(); this.pause.hide(); },
    });
    this.lobby = new Lobby(root, {
      send: (m) => this.session?.client.send(m),
      leave: () => this.leave(),
      copyCode: (code) => this.copyInvite(code),
    });
    this.prompt = new Prompt(root, () => { sfx.unlock(); this.input.requestLock(); });
    this.loading = new Loading(root);
    this.notice = new Notice(root);

    document.addEventListener('pointerlockchange', () => this.onLockChange());
    document.addEventListener('pointerlockerror', () => { if (this.state === 'match' && !this.pause.visible) this.prompt.show(); });
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.settings.visible) this.settings.close();
    });
    this.applyPrefs();
    this.showMenu();
  }

  // ---------------------------------------------------------------- screens

  private hideAll(): void {
    for (const s of [this.main, this.settings, this.help, this.pause, this.lobby, this.prompt, this.loading]) s.hide();
  }

  private showMenu(): void {
    this.state = 'menu';
    this.hideAll();
    this.hud.visible = false;
    this.main.show();
    this.useBackdrop();
  }

  private showLobby(): void {
    this.state = 'lobby';
    this.hideAll();
    this.hud.visible = false;
    this.scores.visible = false;
    this.lobby.show();
    this.input.releaseLock();
    this.useBackdrop();
    const c = this.session?.client;
    if (c?.room) this.lobby.render(c.room, c.myId, !!this.session?.offline);
  }

  private showMenuForState(): void {
    if (this.state === 'menu') this.main.show();
    else if (this.state === 'lobby') this.lobby.show();
    else this.pauseMenu();
  }

  private openSettings(): void {
    this.main.hide();
    this.lobby.hide();
    this.settings.open(this.prefs, (p) => { this.prefs = p; savePrefs(p); this.applyPrefs(); }, () => this.showMenuForState());
  }

  private applyPrefs(): void {
    this.session?.client.applyPrefs(this.prefs);
    sfx.setVolume(this.prefs.volume);
    this.renderer.setFov(this.prefs.fov);
    if (this.prefs.quality === 'high') this.setScale(1);
    if (this.prefs.quality === 'low') this.setScale(0.6);
  }

  private setScale(s: number): void {
    if (Math.abs(s - this.scale) < 0.01) return;
    this.scale = s;
    this.renderer.setRenderScale(s);
  }

  private pauseMenu(): void {
    const s = this.session;
    if (!s) return;
    const me = s.client.room?.roster.find((r) => r.id === s.client.myId);
    this.prompt.hide();
    this.pause.open({ canPickTeam: me?.team === -1, isHost: !!s.host && !s.practice, code: s.code, online: !s.offline });
  }

  private onLockChange(): void {
    const locked = this.input.locked;
    if (locked) { this.prompt.hide(); this.pause.hide(); return; }
    if (this.state !== 'match') return;
    this.input.clear();
    if (this.buy.isOpen || this.hud.chatOpen || this.settings.visible) return;
    this.pauseMenu();
  }

  private resume(): void {
    this.pause.hide();
    sfx.unlock();
    this.input.requestLock();
  }

  // ---------------------------------------------------------------- menu backdrop

  /** Show a slowly orbiting view of a map behind the menus. */
  private useBackdrop(): void {
    if (this.session?.client.inMatch) return;
    if (this.backdropReady) return;
    const map = MAPS[this.backdropMap].build();
    this.renderer.setWorld(map.world, map.env);
    this.backdropReady = true;
  }

  // ---------------------------------------------------------------- sessions

  private newClient(link: ReturnType<typeof localPair<H2C, C2H>>[1], s: Omit<Session, 'client'>): GameClient {
    const client = new GameClient(this.renderer, this.input, { hud: this.hud, buy: this.buy, scores: this.scores }, link, this.prefs.name || 'Player', this.prefs);
    const session: Session = { ...s, client };
    this.session = session;
    client.sandbox = s.practice;
    client.onWantCursor = (free) => (free ? this.input.releaseLock() : this.input.requestLock());
    client.onRoom = (room) => {
      session.code = room.code;
      if (this.state === 'lobby') this.lobby.render(room, client.myId, s.offline);
    };
    client.onChat = (name, text) => this.lobby.chat(name, text);
    client.onLoading = (name) => { this.hideAll(); this.loading.showText(`Loading ${name}...`); };
    client.onStart = () => {
      this.state = 'match';
      this.backdropReady = false;
      this.hideAll();
      this.hud.visible = true;
      this.prompt.show();
    };
    client.onEnd = () => {
      this.hud.visible = false;
      this.scores.visible = false;
      if (session.practice) this.leave();
      else this.showLobby();
    };
    client.onKick = (reason) => { this.leave(); this.notice.open('Disconnected', reason, () => {}); };
    client.onClosed = () => {
      if (this.session !== session) return;
      this.leave();
      this.notice.open('Connection closed', 'The room was closed or the connection to the host was lost.', () => {});
    };
    return client;
  }

  private startHost(settings: Partial<RoomSettings>, practice: boolean, code: string): HostSession {
    const host = new HostSession(code, settings);
    host.sandbox = practice;
    host.botFactory = createBot;
    return host;
  }

  playVsBots(): void {
    this.leave(true);
    const host = this.startHost({ teamSize: 2, fillBots: true }, false, 'LOCAL');
    const [hostEnd, clientEnd] = localPair<H2C, C2H>();
    host.connect(hostEnd, true);
    const ticker = this.manualTick ? null : new Ticker((dt) => host.update(dt));
    this.newClient(clientEnd, { host, ticker, offline: true, practice: false, code: 'LOCAL' });
    this.showLobby();
  }

  practice(map: MapId = 'dunes'): void {
    this.leave(true);
    const host = this.startHost({ map, teamSize: 4, fillBots: false }, true, 'PRACTICE');
    const [hostEnd, clientEnd] = localPair<H2C, C2H>();
    host.connect(hostEnd, true);
    const ticker = this.manualTick ? null : new Ticker((dt) => host.update(dt));
    this.newClient(clientEnd, { host, ticker, offline: true, practice: true, code: 'PRACTICE' });
    // Practice targets: three bots on the other team, then straight into the map.
    setTimeout(() => {
      for (let i = 0; i < 3; i++) host.addBot(1);
      host.startMatch();
      for (const p of host.players.values()) { if (!p.bot) p.team = 0; host.spawnPlayer(p, true); }
    }, 30);
  }

  hostOnline(): void {
    this.notice.open('Coming soon', 'Online rooms arrive in the next update.', () => {});
  }

  joinOnline(_code: string): void {
    this.notice.open('Coming soon', 'Online rooms arrive in the next update.', () => {});
  }

  private copyInvite(code: string): void {
    const url = `${location.origin}${location.pathname}?join=${code}`;
    void navigator.clipboard?.writeText(`Join my Cubefire room: ${url} (code ${code})`).then(
      () => this.hud.toast('Invite copied', 2),
      () => this.hud.toast(`Code: ${code}`, 3),
    );
  }

  /** Leave the current session and go back to the main menu. */
  leave(silent = false): void {
    const s = this.session;
    this.session = null;
    if (s) {
      s.ticker?.stop();
      s.client.onClosed = null;
      s.client.dispose();
    }
    this.input.releaseLock();
    this.buy.close();
    this.scores.visible = false;
    this.backdropReady = false;
    if (!silent) this.showMenu();
  }

  // ---------------------------------------------------------------- loop

  frame(dt: number): void {
    const s = this.session;
    if (s?.host && !s.ticker) s.host.update(dt);
    if (s) s.client.update(dt);

    if (s?.client.inMatch) {
      this.input.enabled = !this.pause.visible && !this.settings.visible;
      s.client.render(dt);
    } else {
      // Menu backdrop camera orbit.
      this.orbit += dt * 0.05;
      const cam = this.renderer.camera;
      const cx = 52, cz = 36;
      cam.position.set(cx + Math.sin(this.orbit) * 58, 30, cz + Math.cos(this.orbit) * 58);
      cam.lookAt(new THREE.Vector3(cx, 6, cz));
      this.renderer.render(dt, false);
    }
    this.input.endFrame();
    this.autoQuality(dt);
  }

  /** In Auto mode, render fewer pixels while the frame rate is low. */
  private autoQuality(dt: number): void {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime < 1) return;
    this.fps = this.fpsFrames / this.fpsTime;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.hud.fps(Math.round(this.fps), this.session?.client.ping ?? -1);
    if (this.prefs.quality !== 'auto' || document.hidden) return;
    if (this.fps < 45) this.slowTime++; else this.slowTime = 0;
    if (this.slowTime >= 2 && this.scale > 0.55) { this.setScale(Math.max(0.55, this.scale - 0.15)); this.slowTime = 0; }
    else if (this.fps > 58 && this.scale < 1) this.setScale(Math.min(1, this.scale + 0.05));
  }
}
