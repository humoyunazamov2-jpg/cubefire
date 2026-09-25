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
import type { C2H, H2C } from './net/protocol';
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

const host = new HostSession('TEST', { map: 'dunes', teamSize: 4, fillBots: false });
host.sandbox = true;
// Dummy bots strafe back and forth so there is something to shoot at.
host.botFactory = (_h, p: HostPlayer): BotBrain => {
  let t = Math.random() * 10;
  const base = { x: 0, z: 0 };
  return {
    onRoundStart() { base.x = p.p[0]; base.z = p.p[2]; },
    update(dt) {
      t += dt;
      const off = Math.sin(t * 0.9) * 2.5;
      p.p = [base.x + off, p.p[1], base.z];
      p.v = [Math.cos(t * 0.9) * 2.25, 0, 0];
      p.yaw = Math.PI;
      p.crouch = Math.sin(t * 0.3) > 0.7 ? 1 : 0;
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
  // Put the dummies in a row across the courtyard.
  const spots: [number, number, number][] = [[14.5, 5, 14.5], [20.5, 5, 13.5], [26.5, 5, 15.5]];
  [...host.players.values()].filter((p) => p.bot).forEach((p, i) => {
    p.alive = true; p.hp = 100; p.p = [...spots[i]]; p.team = 1;
    host.bots.get(p.id)?.onRoundStart?.();
  });
  const me = [...host.players.values()].find((p) => !p.bot)!;
  me.team = 0;
  host.spawnPlayer(me, true);
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
