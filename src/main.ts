import '@fontsource/silkscreen/400.css';
import './style.css';
import { sfx } from './audio/sfx';
import { GameClient } from './client/client';
import { loadPrefs } from './client/prefs';
import { Renderer } from './engine/renderer';
import { Input } from './game/input';
import { HostSession, type BotBrain } from './host/host';
import type { HostPlayer } from './host/hostPlayer';
import { localPair } from './net/link';
import type { C2H, H2C, MapId } from './net/protocol';
import { BuyMenu } from './ui/buyMenu';
import { Hud } from './ui/hud';
import { Scoreboard } from './ui/scoreboard';

// Part 3 harness: practice range against strafing dummies.
const app = document.getElementById('app')!;
const renderer = new Renderer(app);
const input = new Input(renderer.canvas);
const hud = new Hud(app);
const ui = { hud, buy: new BuyMenu(app), scores: new Scoreboard(app) };
const prefs = loadPrefs();

const params = new URLSearchParams(location.search);
const mapId = (params.get('map') ?? 'dunes') as MapId;
const host = new HostSession('TEST', { map: mapId, teamSize: 4, fillBots: false });
host.sandbox = true;
// Dummy bots strafe back and forth so there is something to shoot at.
host.botFactory = (_h, p: HostPlayer): BotBrain => {
  let t = Math.random() * 10;
  const base = { x: 0, z: 0 };
  return {
    onRoundStart() { base.x = p.p[0]; base.z = p.p[2]; },
    update(dt) {
      t += dt;
      const off = Math.sin(t * 0.9) * 1.5;
      p.p = [base.x, p.p[1], base.z + off];
      p.v = [0, 0, Math.cos(t * 0.9) * 1.35];
      p.yaw = Math.PI / 2;
    },
  };
};

const [hostEnd, clientEnd] = localPair<H2C, C2H>();
host.connect(hostEnd, true);
const client = new GameClient(renderer, input, ui, clientEnd, prefs.name || 'You', prefs);
client.sandbox = true;
client.onWantCursor = (free) => (free ? input.releaseLock() : input.requestLock());

setTimeout(() => {
  host.addBot(1); host.addBot(1); host.addBot(1);
  host.startMatch();
  for (const p of host.players.values()) { if (!p.bot) p.team = 0; host.spawnPlayer(p, true); }
}, 50);
const overlay = document.createElement('div');
overlay.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;background:rgba(0,0,0,.45);font-size:28px;cursor:pointer;z-index:10';
overlay.innerHTML = 'Click to play<small style="font-size:12px;opacity:.7">B buy · 1-4 weapons · R reload · right-click scope/heavy · G drop · Tab scores</small>';
app.appendChild(overlay);
overlay.onclick = () => { sfx.unlock(); input.requestLock(); };
document.addEventListener('pointerlockchange', () => (overlay.style.display = input.locked || ui.buy.isOpen || hud.chatOpen ? 'none' : 'flex'));

let last = performance.now();
function step(dt: number) {
  host.update(dt);
  client.update(dt);
  client.render(dt);
  input.endFrame();
}
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  step(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const run = async (seconds: number, dt = 1 / 60) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) { step(dt); if (i % 10 === 0) await Promise.resolve(); }
};
Object.assign(window, { __cf: { renderer, input, host, client, run } });
