// End-to-end smoke test: starts the dev server, opens the game in headless
// Chromium and plays through menu -> lobby -> a whole match -> bot-only
// rounds on every map -> practice range.
// Run with `npm run smoke`. Needs Playwright with Chromium (installed globally
// in Claude's cloud sessions; elsewhere run `npm i -g playwright` first).
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

function loadPlaywright() {
  const roots = [process.cwd() + '/'];
  try { roots.push(execSync('npm root -g').toString().trim() + '/'); } catch { /* no npm */ }
  for (const r of roots) {
    try { return createRequire(r)('playwright'); } catch { /* try next */ }
  }
  console.error('Playwright not found. Install it with: npm i -g playwright');
  process.exit(2);
}

const { chromium } = loadPlaywright();
const server = await createServer({ server: { port: 5199, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

try {
  await page.goto(url);
  await page.waitForFunction(() => window.__cf);
  // Helpers inside the page: step host + client quickly without rendering.
  await page.evaluate(() => {
    window.T = {
      async fast(sec) {
        const a = window.__cf.app, dt = 1 / 60;
        for (let i = 0; i < Math.round(sec / dt); i++) {
          const s = a.session; if (!s) return;
          if (s.host && !s.ticker) s.host.update(dt);
          s.client.update(dt);
          a.input.endFrame();
          if (i % 20 === 0) await new Promise((r) => setTimeout(r, 0));
        }
      },
      host: () => window.__cf.app.session.host,
      me: () => [...window.T.host().players.values()].find((p) => !p.bot),
      wipe(team) {
        const h = window.T.host();
        for (const p of h.players.values()) if (p.team === team && p.alive) {
          const att = [...h.players.values()].find((q) => q.team !== team && q.alive) ?? window.T.me();
          h.applyDamage(att, p, 'pistol', { id: p.id, zone: 'head', dist: 5, pen: 1 });
        }
      },
    };
  });
  check('main menu shows', await page.evaluate(() => window.__cf.app.state === 'menu'));

  // Lobby
  await page.evaluate(() => { window.__cf.app.manualTick = true; });
  await page.click('text=Play vs bots');
  await page.evaluate(() => window.T.fast(0.2));
  await page.click('.lobby [data-set="winRounds=3"]');
  await page.evaluate(() => window.T.fast(0.2));
  check('lobby shows and settings change', await page.evaluate(() => window.__cf.app.state === 'lobby' && window.T.host().settings.winRounds === 3));

  // Match start
  await page.click('text=Start match');
  await page.waitForFunction(() => window.__cf.app.state === 'match', null, { timeout: 5000 });
  await page.evaluate(() => window.T.fast(0.5));
  check('match starts in buy phase with bots filled', await page.evaluate(() => window.T.host().phase === 'freeze' && window.T.host().players.size === 4));

  // Round 1: Blaze wins
  await page.evaluate(() => window.T.fast(10.2));
  check('buy phase ends, round goes live', await page.evaluate(() => window.T.host().phase === 'live'));
  await page.evaluate(() => { window.T.wipe(1); return window.T.fast(0.3); });
  const r1 = await page.evaluate(() => ({ phase: window.T.host().phase, score: window.T.host().score, money: window.T.me().money }));
  check('eliminating a team ends the round and pays out', r1.phase === 'roundEnd' && r1.score[0] === 1 && r1.money === 800 + 2 * 300 + 3250, JSON.stringify(r1));

  // Round 2 then halftime
  await page.evaluate(() => window.T.fast(5.2 + 10.2));
  await page.evaluate(() => { window.T.wipe(1); return window.T.fast(5.5); });
  check('halftime after round 2', await page.evaluate(() => window.T.host().phase === 'halftime'));
  await page.evaluate(() => window.T.fast(6.2));
  const half = await page.evaluate(() => ({ swapped: window.T.host().swapped, money: window.T.me().money }));
  check('sides swap and money resets to $800', half.swapped && half.money === 800, JSON.stringify(half));

  // Round 3 lost, round 4 won -> match over
  await page.evaluate(() => window.T.fast(10.2));
  await page.evaluate(() => { window.T.wipe(0); return window.T.fast(5.5 + 10.2); });
  await page.evaluate(() => { window.T.wipe(1); return window.T.fast(5.5); });
  const end = await page.evaluate(() => ({ phase: window.T.host().phase, score: window.T.host().score, board: document.querySelector('.scoreboard')?.parentElement?.classList.contains('on') }));
  check('match ends 3:1 and shows the scoreboard', end.phase === 'matchEnd' && end.score[0] === 3 && end.score[1] === 1 && !!end.board, JSON.stringify(end));
  await page.evaluate(() => window.T.fast(12.5));
  check('back to the lobby after the match', await page.evaluate(() => window.__cf.app.state === 'lobby'));

  // Leave to the menu
  await page.click('.lobby [data-a="leave"]');
  check('Back returns to the main menu', await page.evaluate(() => window.__cf.app.state === 'menu' && !window.__cf.app.session));

  // Bots on their own: spectate a 2v2 on each map until a team is wiped out.
  for (const map of ['dunes', 'frostbite', 'arena']) {
    await page.click('text=Play vs bots');
    await page.evaluate(() => window.T.fast(0.2));
    await page.click(`.lobby [data-set="map=${map}"]`);
    await page.evaluate(() => window.T.fast(0.2));
    await page.click('.lobby [data-join="-1"]');
    await page.evaluate(() => window.T.fast(0.2));
    await page.click('text=Start match');
    await page.waitForFunction(() => window.__cf.app.state === 'match', null, { timeout: 5000 });
    const r = await page.evaluate(async () => {
      const h = window.T.host();
      let shots = 0;
      const fire = h.botFire.bind(h);
      h.botFire = (...args) => { shots++; fire(...args); };
      // How far each bot gets from where it stood when the round went live.
      const start = new Map(), far = new Map();
      const reasons = [];
      // Up to two rounds; one of them must end with a team wiped out.
      for (let i = 0; i < 1000 && reasons.length < 2 && h.inMatch; i++) {
        const before = h.phase;
        await window.T.fast(0.25);
        if (h.phase === 'live') for (const p of h.players.values()) {
          if (!p.bot) continue;
          if (before !== 'live' || !start.has(p.id)) start.set(p.id, [...p.p]);
          const s0 = start.get(p.id);
          far.set(p.id, Math.max(far.get(p.id) ?? 0, Math.hypot(p.p[0] - s0[0], p.p[2] - s0[2])));
        }
        if (before !== 'roundEnd' && h.phase === 'roundEnd') reasons.push(h.reason);
        if (reasons.some((x) => x.includes('eliminated'))) break;
      }
      const moved = [...far.values()].filter((d) => d > 5).length;
      return { reasons, shots, moved, bots: h.bots.size };
    });
    check(`bots fight and finish a round on ${map}`, r.bots === 4 && r.moved >= 2 && r.shots > 0 && r.reasons.some((x) => x.includes('eliminated')), JSON.stringify(r));
    await page.evaluate(() => window.__cf.app.leave());
  }

  // Practice range: free buying, armour shows up in the inventory
  await page.evaluate(() => window.__cf.app.practice('arena'));
  await page.waitForFunction(() => window.__cf.app.state === 'match' && window.T.host().players.size === 4, null, { timeout: 5000 });
  await page.evaluate(() => window.T.fast(0.3));
  await page.evaluate(() => { const c = window.__cf.app.session.client; c.send({ t: 'buy', item: 'rifle' }); c.send({ t: 'buy', item: 'kevlar' }); return window.T.fast(0.3); });
  const inv = await page.evaluate(() => window.__cf.app.session.client.arsenal.inv);
  check('practice range buys are free and armour is sent', inv.primary === 'rifle' && inv.armor === 100, JSON.stringify(inv));
  const practice = await page.evaluate(async () => {
    const h = window.T.host();
    const start = new Map([...h.players.values()].map((p) => [p.id, [...p.p]]));
    await window.T.fast(8);
    const moved = [...h.players.values()].filter((p) => p.bot && Math.hypot(p.p[0] - start.get(p.id)[0], p.p[2] - start.get(p.id)[2]) > 1).length;
    return { moved, hp: window.T.me().hp };
  });
  check('practice bots walk around and hold fire', practice.moved >= 1 && practice.hp === 100, JSON.stringify(practice));
  await page.evaluate(() => window.__cf.app.leave());
  check('leaving practice returns to the menu', await page.evaluate(() => window.__cf.app.state === 'menu'));
} catch (e) {
  check('no exception while testing', false, String(e));
}

check('no errors in the browser console', errors.length === 0, errors.join(' | '));
await browser.close();
await server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} check(s) failed` : `\nAll ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
