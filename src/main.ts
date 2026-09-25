import '@fontsource/silkscreen/400.css';
import './style.css';
import { Renderer } from './engine/renderer';
import { Input } from './game/input';
import { LocalPlayer } from './game/localPlayer';
import { settle } from './game/physics';
import { buildTestMap } from './maps/testMap';
import { PlayerModel } from './render/playerModel';
import type { WeaponId } from './game/weapons';

// Part 2 harness: walk the test map in first person among a few dummy characters.
const app = document.getElementById('app')!;
const renderer = new Renderer(app);
const { world, env } = buildTestMap();
renderer.setWorld(world, env);

const input = new Input(renderer.canvas);
const me = new LocalPlayer(world);
me.spawn(20.5, 5, 24.5, 0);
settle(world, me.body);

const overlay = document.createElement('div');
overlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);font-size:28px;cursor:pointer';
overlay.textContent = 'Click to play';
app.appendChild(overlay);
overlay.onclick = () => input.requestLock();
document.addEventListener('pointerlockchange', () => (overlay.style.display = input.locked ? 'none' : 'flex'));
const cross = document.createElement('div');
cross.style.cssText = 'position:fixed;left:50%;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;background:linear-gradient(#fff,#fff) center/2px 14px no-repeat,linear-gradient(#fff,#fff) center/14px 2px no-repeat;mix-blend-mode:difference;pointer-events:none';
app.appendChild(cross);

const dummies: { m: PlayerModel; x: number; z: number; weapon: WeaponId; mode: string }[] = [];
const spots: [number, number, number, WeaponId, string][] = [
  [0, 16, 20, 'rifle', 'walk'], [1, 24, 22, 'sniper', 'stand'], [1, 14, 16, 'smg', 'crouch'],
  [0, 26, 26, 'knife', 'stand'], [1, 22, 27, 'deagle', 'dead'],
];
spots.forEach(([team, x, z, weapon, mode], i) => {
  const m = new PlayerModel(team, i);
  m.setName(`Dummy ${i + 1}`);
  m.root.position.set(x + 0.5, 5, z + 0.5);
  renderer.scene.add(m.root);
  dummies.push({ m, x: x + 0.5, z: z + 0.5, weapon, mode });
});

let last = performance.now();
let t = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  step(dt);
  requestAnimationFrame(frame);
}
function step(dt: number) {
  t += dt;
  if (input.locked) me.look(input);
  me.update(dt, input.locked || (window as unknown as { __free?: boolean }).__free ? input : null, 1);
  me.applyCamera(renderer.camera, dt);
  for (const d of dummies) {
    let speed = 0, yaw = t * 0.3;
    if (d.mode === 'walk') {
      const a = t * 0.8;
      d.m.root.position.set(d.x + Math.cos(a) * 3, 5, d.z + Math.sin(a) * 3);
      yaw = -a; speed = 2.4;
    }
    d.m.update({ yaw, pitch: Math.sin(t) * 0.5, crouch: d.mode === 'crouch' ? 1 : 0, speed, onGround: true, alive: d.mode !== 'dead', weapon: d.weapon }, dt);
  }
  renderer.render(dt, false);
  input.endFrame();
}
requestAnimationFrame(frame);

/** Advance n frames of dt seconds without waiting for the browser (tests in a hidden tab). */
const run = (seconds: number, dt = 1 / 60) => { for (let i = 0; i < Math.round(seconds / dt); i++) step(dt); };
Object.assign(window, { __cf: { renderer, world, me, input, dummies, run } });
