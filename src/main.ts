import '@fontsource/silkscreen/400.css';
import './style.css';
import './ui/hud.css';
import { App } from './app';

const root = document.getElementById('app')!;

/** Plain explanation instead of a blank page when the browser can't do 3D. */
function showFatal(err: unknown): void {
  root.innerHTML = `<div class="fatal"><h1>Cubefire can't start</h1>
    <p>This browser couldn't turn on 3D graphics (WebGL), which the game needs.</p>
    <ul>
      <li>Use an up-to-date Chrome, Edge or Firefox.</li>
      <li>In the browser's settings, search for <b>graphics acceleration</b> (or <b>hardware acceleration</b>), switch it on and restart the browser.</li>
      <li>Update your computer's graphics drivers (Windows Update usually does this).</li>
    </ul>
    <small>${String((err as Error)?.message ?? err).replace(/[<>&]/g, '')}</small></div>`;
}

let app: App | null = null;
try {
  app = new App(root, true);
} catch (e) {
  showFatal(e);
}

if (app) {
  const game = app;
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    game.frame(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  /** Test hook: step the game by hand (the browser pauses frames in hidden tabs). */
  const run = async (seconds: number, dt = 1 / 60) => {
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      game.frame(dt);
      if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  };
  Object.assign(window, { __cf: { app: game, run } });
}
