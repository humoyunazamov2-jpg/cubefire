import '@fontsource/silkscreen/400.css';
import './style.css';
import { Renderer } from './engine/renderer';
import { buildTestMap } from './maps/testMap';

// Part 1 harness: render the test map with a free-fly camera.
const app = document.getElementById('app')!;
const renderer = new Renderer(app);
const t0 = performance.now();
const { world, env } = buildTestMap();
renderer.setWorld(world, env);
console.log(`world meshed in ${(performance.now() - t0).toFixed(0)} ms`);

const cam = renderer.camera;
cam.position.set(4, 14, 4);
cam.rotation.set(-0.35, -2.4, 0);
const keys = new Set<string>();
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));
let dragging = false;
renderer.canvas.addEventListener('mousedown', () => (dragging = true));
addEventListener('mouseup', () => (dragging = false));
addEventListener('mousemove', (e) => {
  if (!dragging) return;
  cam.rotation.y -= e.movementX * 0.004;
  cam.rotation.x = Math.max(-1.5, Math.min(1.5, cam.rotation.x - e.movementY * 0.004));
});

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const sp = (keys.has('ShiftLeft') ? 30 : 10) * dt;
  const fx = -Math.sin(cam.rotation.y), fz = -Math.cos(cam.rotation.y);
  if (keys.has('KeyW')) { cam.position.x += fx * sp; cam.position.z += fz * sp; }
  if (keys.has('KeyS')) { cam.position.x -= fx * sp; cam.position.z -= fz * sp; }
  if (keys.has('KeyA')) { cam.position.x += fz * sp; cam.position.z -= fx * sp; }
  if (keys.has('KeyD')) { cam.position.x -= fz * sp; cam.position.z += fx * sp; }
  if (keys.has('Space')) cam.position.y += sp;
  if (keys.has('KeyC')) cam.position.y -= sp;
  renderer.render(dt, false);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

Object.assign(window, { __cf: { renderer, world, cam } });
