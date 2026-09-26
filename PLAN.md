# Cubefire — project plan and handover notes

Cubefire is a browser first-person shooter with a Minecraft-style blocky look
and Counter-Strike-2-style round structure, for playing with friends in
private rooms (1v1, 2v2, 4v4). No matchmaking, no Web3.

This file is written so a new session with no chat history can pick up the
work. Read it top to bottom before changing anything.

## Who it is for

- The owner is learning the absolute basics of coding and **does not want to
  do any step themselves**, not even small ones. Do installs, git, testing and
  deploys yourself. Only hand them things that truly need them (e.g. an
  interactive browser sign-in), with exact click-by-click steps.
- Their laptop: Intel i5 with **integrated graphics**. Keep rendering cheap.

## Status

| # | Part | Status |
|---|------|--------|
| 1 | Voxel engine | **Done** |
| 2 | Player movement and physics | **Done** |
| 3 | Weapons and combat | **Done** |
| 4 | Maps | **Done** |
| 5 | CS2 match rules and game UI | **Done** (tested end to end in headless Chromium; `npm run smoke`) |
| 6 | Bots | **Done** (bot-only matches simulated on all maps; `npm run smoke`) |
| 7 | Friends multiplayer (rooms over the internet) | **Done** (two browsers over real WebRTC in `npm run smoke`; needs one real test with a friend, see Part 7) |
| 8 | Polish and release | **Done** except the deploy click, which is the owner's choice (see Part 8) |

Git history has one commit per finished part (`git log --oneline`); Part 5
has two (the in-progress commit and the finishing one).

## Design decisions (made by the owner — don't change without asking)

- **Mode: elimination rounds only.** No bomb. A round ends when a team is
  wiped out. If the round timer runs out, the team with more players alive
  wins; if equal, more total HP wins; if still equal, the round is a draw.
- **Fixed maps.** No breaking or placing blocks.
- **No Web3.** Money and stats are per-match only.
- **Team sizes 1v1 / 2v2 / 4v4, custom rooms only**, joined with a room code.
- **Repository is PUBLIC, game on GitHub Pages** (owner's decision after Part
  8): permanent link <https://humoyunazamov2-jpg.github.io/cubefire/>.
  `.github/workflows/deploy.yml` republishes on every push to `main`. Claude's
  tools can't change repository settings, so the owner flipped visibility and
  set Settings → Pages → Source to "GitHub Actions" themselves.
- All art, sounds and names are **original** (generated in code). Never copy
  Minecraft textures/sounds or CS weapon/map names.

## How to run it (Windows, this machine)

- **For the owner: double-click `start.cmd`.** It uses `.tools\node` if present
  (otherwise an installed Node.js), runs `npm install` the first time, builds
  the game and opens it at <http://127.0.0.1:5174/> with `vite preview`.

- Node is a portable copy in `.tools/node` (gitignored, copied from the
  owner's other project `C:\Users\user\Projects\open-road\.tools`). Nothing is
  on the system PATH. In PowerShell:
  ```powershell
  $env:PATH = "C:\Users\user\Projects\cubefire\.tools\node;$env:PATH"
  npm install                 # first time only
  npx tsc --noEmit            # typecheck
  node node_modules/vite/bin/vite.js --port 5174 --strictPort --host 127.0.0.1   # dev server
  ```
- **git and gh are installed but not on the PATH of Claude's shells.** Use
  `C:\Program Files\Git\cmd\git.exe` and `C:\Program Files\GitHub CLI\gh.exe`,
  or prepend `C:\Program Files\Git\cmd;C:\Program Files\GitHub CLI` to PATH.
  gh is logged in as `humoyunazamov2-jpg` (keyring, scopes repo/workflow).
- Dev URL: `http://127.0.0.1:5174/`. `src/main.ts` now boots the real `App`
  (main menu → lobby → match). The old `?map=` practice harness is gone; the
  menu's "Practice range" button replaces it (`app.practice(mapId)`).

## How to run it (Claude Code cloud sessions, Linux)

Some sessions run in a cloud Linux container instead of the owner's laptop.
There, Node 22, git and a global Playwright with Chromium are already on the
PATH; GitHub access is through the session's own tools (no `gh`).
```bash
npm install
npx tsc --noEmit                      # typecheck
npm run smoke                         # end-to-end test, ~1 min (see below)
node node_modules/vite/bin/vite.js --port 5174 --strictPort --host 127.0.0.1   # dev server
```

### Automated smoke test (`npm run smoke`)

`scripts/smoke.mjs` starts its own Vite server, opens the game in headless
Chromium (SwiftShader WebGL) and checks: main menu → lobby (settings change) →
match start → buy phase → round win and payout → halftime swap and $800 reset
→ match end 3:1 with scoreboard → back to lobby → main menu → a bot-only 2v2
on each map (you spectate; bots must leave spawn, shoot, and finish a round by
elimination) → practice range (free buys, armour, bots wander and hold fire)
→ menu → an online room between two browser profiles over real WebRTC with a
local PeerJS server (wrong code, old version, invite link, chat/settings sync,
movement and damage both ways, host frames paused, rejoin, room closed), plus
"no console errors". Exit code 0 = all passed.
Run it after every change. It needs Playwright (global in cloud sessions; on
the Windows laptop it is not installed — `npm i -g playwright` there first).
Extend it when Part 8 adds features.

### Simulating bots without rendering

For bot work, create a `HostSession` directly in the page and step it with no
client at all (thousands of times faster than real time):
```js
const { HostSession } = await import('/src/host/host.ts');
const { createBot } = await import('/src/bots/bot.ts');
const h = new HostSession('SIM', { map: 'dunes', teamSize: 4, botSkill: 1, winRounds: 7 });
h.botFactory = createBot;
h.startMatch();                       // fills both teams with bots
while (h.inMatch) h.update(1 / 60);   // a whole match takes well under a second
```
Wrap `h.botFire` / `h.botThrow` / `h.broadcast` to count shots, grenades and
round results. A full bot's state is reachable as `h.bots.get(id)` (TS-private
fields are plain properties at runtime).

### Testing in Claude's browser pane / headless Chromium

The pane's tab is usually hidden, so `requestAnimationFrame` is paused.
`main.ts` exposes `window.__cf = { app, run }`:
- `await __cf.run(seconds)` steps the whole app (host + client + render) at 60 fps.
- Set `__cf.app.manualTick = true` **before** starting a session, so the host is
  stepped by `run()` instead of the background Web Worker ticker (otherwise
  the host advances in real time on its own and tests aren't repeatable).
- Then e.g. `__cf.app.playVsBots()` or `__cf.app.practice('arena')`.
- `__cf.app.session.client` is the `GameClient`; `.host` is the `HostSession`.
  Set `client.testMode = true` so the client takes input without pointer lock.
- Keys: `dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }))`.
- Mouse buttons: `app.input.held.add('Mouse0'); app.input.pressedNow.add('Mouse0')`
  (TS-private fields, reachable from page JS).
- Screenshots work after `run()` has rendered a frame.
- Fast-forwarding without rendering (much quicker in SwiftShader): call
  `host.update(1/60)`, `client.update(1/60)`, `app.input.endFrame()` in a loop,
  yielding with `await new Promise(r => setTimeout(r, 0))` every ~20 steps so
  the in-memory link's messages get delivered (see `T.fast` in the smoke test).
- Headless Chromium grants pointer lock on a real `page.mouse.click`, but
  pressing Escape does **not** release it there; call `document.exitPointerLock()`.
- In SwiftShader the real frame rate is low, so Auto graphics shrinks the
  canvas; a screenshot taken right after a resize can be black. Not a bug.

## Architecture

Vite + TypeScript (strict) + Three.js 0.186 + PeerJS 1.5 (for Part 7).
1 block = 1 metre. Model forward is −Z; yaw 0 looks along −Z.

**Host-authoritative, host runs in a browser.** Every player (including the
host) runs a `GameClient`. The host additionally runs a `HostSession`. They
talk through a `Link` (`src/net/link.ts`): an in-memory pair for the host's
own client (messages are `structuredClone`d — sharing objects caused a real
bug), and WebRTC data channels for friends (Part 7).

Authority split (friends-only, so trust is fine):
- **Client owns** its own position/look, ammo, reload and fire timing, and does
  its own hit detection against what it sees (interpolated remote players),
  then reports `fire` with hits.
- **Host owns** HP, armour, deaths, money, inventories, round state, grenade
  detonations, dropped weapons, bots.
- Snapshots at 20 Hz; clients send state at 30 Hz; remote players are rendered
  100 ms in the past and interpolated.
- Grenades are simulated identically on every machine (fixed step, plain
  arithmetic); the host announces the detonation point.

### File map

| Path | What it does |
|------|--------------|
| `src/engine/blocks.ts` | Block registry (id → textures, shape full/slab, solid, transparency, bullet penetration, footstep sound) |
| `src/engine/textures.ts` | Procedural 16×16 pixel textures packed into one atlas; seeded RNG `mulberry32` |
| `src/engine/world.ts` | `VoxelWorld` grid, voxel ray traversal, raycast, line of sight |
| `src/engine/mesher.ts` | Chunk meshes with Minecraft-style AO and baked sun shadows (vertex colours) |
| `src/engine/sky.ts`, `renderer.ts` | Sky dome, clouds, fog; renderer with a second scene for the first-person gun |
| `src/game/physics.ts` | Source-style movement, AABB-vs-voxel collision, step-up onto slabs |
| `src/game/localPlayer.ts` | Your own player: input → physics at 120 Hz, camera, recoil punch |
| `src/game/input.ts` | Keyboard/mouse with bindable actions and pointer lock |
| `src/game/weapons.ts` | Weapon data (damage, spread, recoil, prices, voxel models), economy constants |
| `src/game/arsenal.ts` | Per-player weapon runtime state: ammo, reload, spray, zoom, switching |
| `src/game/combat.ts` | Hitboxes (head/body/legs), bullet trace with wall penetration, damage + armour |
| `src/game/grenades.ts` | Grenade physics, flash blindness, HE damage |
| `src/net/protocol.ts` | All message types (`C2H`, `H2C`), room settings, defaults |
| `src/net/link.ts` | `Link` interface and in-memory pair |
| `src/net/peer.ts` | Online rooms: `PeerLink` (a `Link` over two WebRTC data channels, keepalive, timeout), `RoomServer` (host side), `joinRoom` (friend side), room codes, `?peer=` test server option, per-tab rejoin token |
| `src/host/host.ts` | `HostSession`: roster, bots hook, round state machine, economy, buying, damage, items, grenades |
| `src/host/hostPlayer.ts` | Host-side player record and snapshot encoding |
| `src/client/client.ts` | `GameClient`: map loading, local weapons, remote players, effects, HUD, spectating |
| `src/client/remotes.ts` | Interpolated remote players |
| `src/client/prefs.ts` | Player settings in localStorage |
| `src/render/*` | Player models + skins, first-person view model, voxel gun models, effects (tracers, particles, bullet holes, smoke, explosions) |
| `src/audio/sfx.ts` | Procedural WebAudio sounds (gunshots, footsteps per surface, explosions…) |
| `src/ui/hud.ts`, `buyMenu.ts`, `scoreboard.ts` | HUD, buy menu, scoreboard (DOM overlays) |
| `src/ui/menus.ts`, `menus.css` | Main menu, settings, how-to-play, pause menu, lobby, click-to-play prompt, loading and notice screens |
| `src/app.ts` | `App`: owns renderer/input/UI, switches menu ↔ lobby ↔ match, starts sessions (`playVsBots`, `practice`), pointer-lock/pause handling, menu backdrop, auto graphics quality. Sets `host.botFactory = createBot` |
| `src/bots/nav.ts` | `NavGrid`: walkable nodes (one per column and floor height) linked by walk / jump / drop edges, reachability from spawns, A*, straight-walk test. Built once per map and cached |
| `src/bots/bot.ts` | `Bot` (a `BotBrain`): per-round plan, pathing, perception, aiming and shooting, buying, grenades, reactions. Skill table `SKILLS` at the top |
| `src/host/ticker.ts` | Web Worker-driven timer (60 Hz by default) so the host keeps simulating, and links keep their keepalives, in a background tab |
| `src/maps/*` | `builder.ts` toolkit; maps `dunes`, `frostbite`, `arena` |
| `src/main.ts` | Boots `App`, runs the frame loop, exposes the `__cf` test hook |
| `scripts/smoke.mjs` | End-to-end smoke test in headless Chromium (`npm run smoke`) |
| `start.cmd` | Windows launcher: install once, build, open the game (`vite preview`) |
| `README.md` | Plain-English guide: play, friends, controls, putting the game online |
| `.github/workflows/deploy.yml` | CI build on every push/PR; GitHub Pages publish once Pages is on |

### Gameplay numbers worth knowing

- Run 5.2 m/s, walk ×0.52, crouch ×0.36; jump peaks ~1.27 blocks; step-up 0.55.
- Economy: start $800, max $16000, win $3250, loss bonus 1400 + 500/streak (max 3400),
  kill rewards per weapon, halftime resets to $800. First to `winRounds`
  (default 7); sides swap after `winRounds − 1` rounds.
- Headshot ×4, legs ×0.75. Armour reduces damage by the weapon's `armorPen`.

## What each remaining part must do

### Part 5 — CS2 match rules and game UI (DONE)
Round state machine in `host.ts` (warmup → freeze → live → roundEnd →
halftime → matchEnd, economy, MVP, buy zones) plus the app shell and all
menus. Everything in the old "next steps" list was run in headless Chromium
and works: main menu with Dunes backdrop, Play vs bots → lobby → loading →
"Click to play" → HUD; a whole match (round wins, time-up draw and
"more health" wins, loss bonus, kill rewards, halftime swap, match end
scoreboard, back to lobby); Esc → pause, Resume re-locks, B buy menu without
the pause menu, chat keeps the lock; settings apply live from the menu and
the pause menu; practice range; joining Frost, spectating and picking a team
mid-match from the pause menu; "End match for everyone".

Bugs found and fixed on the first run:
- B closed the buy menu and the same key press reopened it (buy menu now
  handles its keys in the capture phase and stops them).
- Armour was never sent in the inventory (host keeps it on the player), so the
  HUD blinked to 0 after buying and the buy menu never showed kevlar as owned
  or the $350 helmet upgrade. Buy menu now uses live armour from snapshots.
- Scoreboard columns didn't line up between the teams (enemy money is blank);
  ADR divided by one round too few at round/match end.
- Kill feed carried over between rounds; now cleared each round.
- The client remembered the last phase across matches, so a new match could
  skip its "Round 1" banner.
- Removing a bot mid-round (a spectator taking its seat) never re-checked
  elimination or dropped its gun.
- Shrinking the team size in the lobby left "2/1" teams; extra bots are removed
  (and extra humans moved) right away.
- Lobby didn't fit a 720p screen (chat box cut off); settings are now compact rows.
- The "Click to play" prompt could cover the pause menu.
- Own tracers started ~90 px away from the gun on screen (view model uses its
  own camera/FOV); now mapped through screen space and start at the muzzle.
- How-to-play said the wheel switches weapons; by default it jumps.

### Part 6 — Bots (DONE)
`src/bots/bot.ts` + `src/bots/nav.ts`; the host calls them through `BotBrain`
(`update`, `onRoundStart`, `onInventory`, `onDamaged`, `onSound`).
- **Movement**: same `stepMove` physics as people (2 × 1/120 s per host tick).
  A* over `NavGrid`; waypoints are skipped when a straight walk is safe; jumps
  on jump edges; stuck detection hops, then re-paths, then picks a new goal.
  At most 2 path searches per host tick across all bots (no stutter).
- **Plan per round**: 40% hold a spot on their own half (for 12–30 s after
  the round goes live), the rest push to an enemy-side point. Teammates claim
  different points. After that they hunt through unvisited enemy-side points
  and the enemy spawn; 50 s into a round they head for a rough guess of where
  the nearest enemy is, so rounds don't stall.
- **Senses**: field of view by skill, `world.lineOfSight` to head or chest,
  `host.smokeBlocks`, blind while `blindUntil`. They hear gunshots and grenades
  (`onSound`) and running footsteps within 14 m, turn towards damage
  (`onDamaged`), and chase the last-seen position when they lose sight.
- **Shooting**: reaction delay, aim error that shrinks while tracking, turn
  speed, head-or-chest choice, recoil control, bursts by range, counter-strafe
  before shooting, strafing between bursts, crouching at range, scoping snipers,
  switching to the pistol when the rifle runs dry up close, no shooting through
  teammates. Everything goes through their own `Arsenal` and `host.botFire`.
- **Skill** (`settings.botSkill`), measured on a standing target with a rifle:
  Easy ≈ 0.9 s to kill at 8 m / 2 s at 30 m; Normal ≈ 0.5 / 1.05 s; Hard ≈
  0.3 / 0.9 s. Tune the `SKILLS` table in `bot.ts`.
- **Buying** (during freeze, with a random delay): pistol round kevlar / Thumper
  / grenades; rifle + armour when they can afford both; force-buy an SMG or
  shotgun sometimes; otherwise save. Grenades from spare money.
- **Grenades**: HE at a spot an enemy was just seen, flash before chasing into
  one (then look away), smoke early in a push. Throw angles are found by
  simulating the real grenade physics (lands within ~0.1–0.7 m).
- **Practice range**: bots wander their half at walking speed and never shoot.
- Map fix found by bots: Arena's two spawns could see each other past the
  central pillar; the pillar is now one block wider on each side.
- Simulated results (8 bots): about 0.03 ms per host tick; no timeouts in
  ~100 simulated rounds; rounds last ~8 s (Arena) to ~18 s (Dunes/Frostbite).
  Matches can be one-sided because the economy snowballs, as in CS.

### Part 7 — Friends multiplayer (DONE)
How it works:
- The host's browser registers the PeerJS id `cubefire-v1-<CODE>` on PeerJS's
  free public signalling server (`0.peerjs.com`, no account needed). Friends
  look that id up and then talk to the host directly over WebRTC. PeerJS's
  default ICE config includes Google STUN and PeerJS's public TURN relay.
- Each friend opens two data channels, paired on the host by a random `cid`:
  `rel` (reliable, ordered: everything important) and `fast` (unordered:
  `snap` and `state`). Fast messages carry a sequence number and anything
  older than the last one used is dropped. Messages are wrapped as `{ m }`,
  keepalives are `{ k: 1 }`.
- Keepalive every 2 s from a Web Worker timer (works in background tabs); a
  link with no traffic for 15 s closes. A message that throws while being
  handled is logged and ignored (one bad packet can't take the room down).
- `App.hostOnline()` / `App.joinOnline(code)`; `new App(root, true)` shows
  the Host/Join buttons. `?join=CODE` pre-fills the code; "Copy invite" builds
  that link (and keeps a `?peer=` setting if one is in use).
- Rejoin: every tab has a token in `sessionStorage` (survives a refresh) sent
  in `hello`. If a player drops out mid-match and comes back with the same
  token, they get their team (if there is still room), money and score back
  and play from the next round.
- `PROTOCOL_VERSION` is now 2; a mismatched player is told to refresh.
- Clear messages for: service unreachable, room code not found, connection
  timeout, room closed / host gone.

Decisions made while the owner was away (sensible defaults):
- **Public PeerJS server** for signalling: free and needs no account. If it
  is ever down or rate-limited, run our own (`npx peerjs --port 9000`) and
  open the game with `?peer=your-host:9000`.
- **Room codes** are 5 characters without look-alikes (no 0/O, 1/I).
- **Rejoining keeps money and score**, but you sit out the rest of the round.
- **`peer`** (the PeerJS server) is a dev dependency, used only by the smoke
  test, because the sandbox that runs the tests can't reach `0.peerjs.com`.

Tested (headless Chromium, two separate browser profiles, real WebRTC, local
signalling server): hosting, wrong code, old version, invite link, lobby chat
and settings, starting a match, movement and damage both ways, fast channel
in use, host's frame loop stopped (as in a background tab) with the match still
running, dropping out and rejoining, host closing the room. Also: with the
public server blocked, Host/Join show "Couldn't reach the online service"
within a second.

**Still needs one real test with a friend** (can't be done from the sandbox):
1. Two different homes/networks: does WebRTC connect through both routers
   (STUN), and through strict ones (PeerJS TURN relay)? If some friends can't
   connect, a TURN server of our own may be needed.
2. The public PeerJS server itself (blocked here).
3. Feel over real latency (ping 30–120 ms): movement smoothness, hits.
4. Host alt-tabs for a minute in a real (visible) browser: match keeps going.
5. "Copy invite" to the clipboard (needs https, i.e. the deployed site).
6. Firefox and Edge as well as Chrome.

### Part 8 — Polish and release (DONE, deploy step left to the owner)
- **Settings** (from Part 5) plus **Reset to defaults** (keeps your name) and
  a line naming the graphics chip. Graphics **Auto** now also picks a starting
  resolution from the GPU name (`Renderer.suggestedScale`): built-in Intel-class
  graphics start at 80%, software rendering at 60%, then Auto adjusts.
- **How to play** has a "Playing with friends" section.
- **Performance pass**: a 4v4 match is ~80–110 draw calls and 20–48k
  triangles per frame, ~0.3 ms game update and ~1 ms render submission on the
  CPU, so the integrated-GPU budget goes to pixels (hence Auto/Low scaling).
  Found and fixed a leak: each match left ~120 scene objects, 11 geometries and
  3 textures behind (effects pool, first-person gun, sky). `Effects.dispose`,
  `ViewModel.dispose` and `Sky.dispose` now free them; repeated matches stay flat.
- **Online fixes**: closing a link now flushes queued messages first, so a
  "different game version" kick reason (and any last message) always arrives.
  Peers now stay on the signalling server for 2.5 s after their links close
  (`LINGER_MS`): leaving at once made PeerJS on the other side hit a null
  connection (`_initializeDataChannel`) for a channel that was still arriving.
- **No WebGL**: `main.ts` shows a plain explanation instead of a blank page.
- **Closing the tab during an online game** asks first (`beforeunload`);
  offline games don't.
- `start.cmd` launcher (CRLF), plain-English `README.md`, version 1.0.0,
  page description, `src/maps/testMap.ts` deleted.
- **Deploy prepared**: `vite.config.ts` uses `base: './'`, so one build works
  at any address (GitHub Pages' `/cubefire/`, a host's root, `vite preview`).
  `.github/workflows/deploy.yml` typechecks and builds on every push and pull
  request, and on `main` publishes to GitHub Pages only if Pages is switched on
  (checked with the API; otherwise it adds a notice and succeeds).
- The smoke test covers all of the above (32 checks), including the release
  build served from `/cubefire/`.

Decisions made while the owner was away:
- **Hosting is left to the owner** (as asked): see README.md, "Putting the
  game online". Nothing was made public and no accounts were created.
- **`start.cmd` serves the release build** (`vite build` + `vite preview`)
  rather than the dev server: it's what friends will get, and it loads faster.
- **CI runs typecheck + build only**, not the smoke test: the smoke test needs
  a browser download and ~3 minutes per run, which would eat into a private
  repo's free Actions minutes. Run `npm run smoke` before merging instead.

What the owner still needs to do: pick a hosting option and follow its steps
in README.md; then do the real-friend test listed under Part 7.

## Known problems / notes

- Browser pane tab is hidden during automated tests → use `__cf.run()`.
- The lobby chat is also shown in "Play vs bots", where only join notes appear.
- A spectator who picks a team mid-match gets that round's win/loss money.
- A few `map.points` sit inside blocks (e.g. Dunes (38, 5, 21.5)); bots snap
  them to the nearest reachable floor, so it is harmless.
- Bots are short-sighted beyond 110 m and don't hear footsteps beyond 14 m.
- Online tests use `?peer=127.0.0.1:<port>` with a local `peer` server and
  Chromium flags `--disable-features=WebRtcHideLocalIpsWithMdns
  --allow-loopback-in-peer-connection` (see `scripts/smoke.mjs`).
- Headless Chromium never hides a tab, so "background tab" is tested by
  stopping the page's `requestAnimationFrame` loop instead.
- `tsc` here is TypeScript 7 (native). `noUnusedLocals` is on: unused
  variables fail the typecheck.
- Line endings: `.gitattributes` forces LF (except `*.cmd` = CRLF).
- Cloud sessions can't force-push. After a PR is squash-merged, bring `main`
  back into the working branch with a normal merge (the content is identical),
  then continue; squash-merge the next PR so `main` keeps one commit per part.
