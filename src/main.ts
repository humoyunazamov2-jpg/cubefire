import '@fontsource/silkscreen/400.css';
import './style.css';
import './ui/hud.css';
import { App } from './app';

const app = new App(document.getElementById('app')!);

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  app.frame(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/** Test hook: step the game by hand (the browser pauses frames in hidden tabs). */
const run = async (seconds: number, dt = 1 / 60) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    app.frame(dt);
    if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0));
  }
};
Object.assign(window, { __cf: { app, run } });
