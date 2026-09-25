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
| 5 | CS2 match rules and game UI | **In progress** — code written and typechecks, **never run in a browser yet** (see "Where Part 5 stopped") |
| 6 | Bots | Not started |
| 7 | Friends multiplayer (rooms over the internet) | Not started |
| 8 | Polish and release | Not started |

Git history has one commit per finished part (`git log --oneline`).

## Design decisions (made by the owner — don't change without asking)

- **Mode: elimination rounds only.** No bomb. A round ends when a team is
  wiped out. If the round timer runs out, the team with more players alive
  wins; if equal, more total HP wins; if still equal, the round is a draw.
- **Fixed maps.** No breaking or placing blocks.
- **No Web3.** Money and stats are per-match only.
- **Team sizes 1v1 / 2v2 / 4v4, custom rooms only**, joined with a room code.
- **Repository is PRIVATE** (owner's latest instruction). ⚠️ Conflict: earlier
  the owner chose "a permanent web link on GitHub Pages" for friends to join.
  Free GitHub Pages only works for **public** repos. Before Part 8's deploy,
  ask the owner to choose: make the repo public, pay for GitHub Pro, or use
  another free static host (e.g. a separate public repo containing only the
  built `dist/`, Cloudflare Pages, Netlify — the latter two need accounts the
  owner must create themselves).
- All art, sounds and names are **original** (generated in code). Never copy
  Minecraft textures/sounds or CS weapon/map names.

## How to run it (Windows, this machine)

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

### Testing in Claude's browser pane

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
| `src/host/host.ts` | `HostSession`: roster, bots hook, round state machine, economy, buying, damage, items, grenades |
| `src/host/hostPlayer.ts` | Host-side player record and snapshot encoding |
| `src/client/client.ts` | `GameClient`: map loading, local weapons, remote players, effects, HUD, spectating |
| `src/client/remotes.ts` | Interpolated remote players |
| `src/client/prefs.ts` | Player settings in localStorage |
| `src/render/*` | Player models + skins, first-person view model, voxel gun models, effects (tracers, particles, bullet holes, smoke, explosions) |
| `src/audio/sfx.ts` | Procedural WebAudio sounds (gunshots, footsteps per surface, explosions…) |
| `src/ui/hud.ts`, `buyMenu.ts`, `scoreboard.ts` | HUD, buy menu, scoreboard (DOM overlays) |
| `src/ui/menus.ts`, `menus.css` | Main menu, settings, how-to-play, pause menu, lobby, click-to-play prompt, loading and notice screens |
| `src/app.ts` | `App`: owns renderer/input/UI, switches menu ↔ lobby ↔ match, starts sessions (`playVsBots`, `practice`), pointer-lock/pause handling, menu backdrop, auto graphics quality. `makeBot` placeholder bot factory lives here until Part 6 |
| `src/host/ticker.ts` | Web Worker-driven 60 Hz tick so the host keeps simulating in a background tab |
| `src/maps/*` | `builder.ts` toolkit; maps `dunes`, `frostbite`, `arena`; `testMap.ts` is the old engine test scene and is no longer used (safe to delete) |
| `src/main.ts` | Boots `App`, runs the frame loop, exposes the `__cf` test hook |

### Gameplay numbers worth knowing

- Run 5.2 m/s, walk ×0.52, crouch ×0.36; jump peaks ~1.27 blocks; step-up 0.55.
- Economy: start $800, max $16000, win $3250, loss bonus 1400 + 500/streak (max 3400),
  kill rewards per weapon, halftime resets to $800. First to `winRounds`
  (default 7); sides swap after `winRounds − 1` rounds.
- Headshot ×4, legs ×0.75. Armour reduces damage by the weapon's `armorPen`.

## What each remaining part must do

### Part 5 — CS2 match rules and game UI (IN PROGRESS)
The host round state machine already exists in `host.ts` (warmup → freeze →
live → roundEnd → halftime → matchEnd, economy, MVP, buy zones).

#### Where Part 5 stopped (owner asked to stop here)
Written, typechecks (`npx tsc --noEmit` exit 0), committed — but **not yet run
in a browser even once**. Expect small bugs on first run.
- Done: `src/app.ts` app shell; `src/ui/menus.ts` + `menus.css` (main menu with
  name box, Play vs bots, Practice range, Settings, How to play; lobby with
  team lists, add/remove bots, mode 1v1/2v2/4v4, map cards, rounds to win,
  fill bots, bot skill, friendly fire, start button, lobby chat; pause menu;
  settings screen saved to localStorage; loading/notice screens);
  `src/host/ticker.ts` background ticker (used for every hosted session);
  `GameClient` got `onLoading` / `onChat` hooks and loads the map one tick
  after `start` so the loading screen can paint; `main.ts` now boots `App`.
- The main menu's online buttons are hidden (`new App(root)` → `online=false`);
  `hostOnline()` / `joinOnline()` just show "Coming soon" (Part 7).
- Bots use the idle placeholder `makeBot` in `app.ts` (they stand and look
  around) until Part 6.

#### Next steps for Part 5, in order
1. Start the dev server, open the page, check the console for errors, and
   screenshot the main menu (the backdrop is Dunes with an orbiting camera).
2. Play vs bots → lobby renders → Start match → loading screen → "Click to play"
   prompt → HUD. With `manualTick`, confirm freeze → live → kill all bots via
   `host.applyDamage` or shooting → roundEnd → money paid → next round.
3. Run a whole match (e.g. winRounds 3): halftime swaps spawns and resets money
   to $800, matchEnd shows the scoreboard, then the host sends `end` and the
   app returns to the lobby. Then Leave → main menu → backdrop comes back.
4. Pointer lock: Esc → pause menu; Resume re-locks; B opens the buy menu
   without triggering the pause menu; chat (Y) keeps the lock.
5. Settings apply live (FOV, sensitivity, volume, crosshair, graphics).
6. Practice range from the menu still works (sandbox, free buys, respawn).
7. Update this file, commit, push.
- Known rough edge: the first-person tracer start point uses the view-model
  camera (different FOV), so tracers start slightly off. Cosmetic.

### Part 6 — Bots
Implement `BotBrain` (`host.ts` exports the interface; `host.botFactory`).
Needed: nav grid over walkable cells + A*; route to `map.points` / enemy side;
vision (FOV, `world.lineOfSight`, `host.smokeBlocks`, `blindUntil`); reaction
time and aim error by `settings.botSkill` (0–2); counter-strafe then shoot
with `host.botFire`; buying with `host.botBuy` by money; occasional grenades
with `host.botThrow`; react to `onDamaged` / `onSound`.

### Part 7 — Friends multiplayer
- PeerJS: host opens `new Peer('cubefire-v1-<CODE>')`; clients connect to it.
  Wrap `DataConnection` as a `Link` (JSON). Consider a second unreliable
  channel for `state`/`snap`.
- Lobby UI: room code + copy button, team lists with join buttons, team size
  (1/2/4), map, rounds to win, fill with bots, bot skill, friendly fire,
  start button for the host, chat. The host messages for all of this exist.
- **Background-tab problem:** browsers pause `requestAnimationFrame` and
  throttle timers in hidden tabs, which would freeze the match if the host
  alt-tabs. Already handled by `src/host/ticker.ts` (Web Worker timer); just
  verify it keeps ticking with real remote players connected.
- Wire `App.hostOnline()` / `App.joinOnline(code)` and construct `App` with
  `online = true`. The lobby already has "Copy invite" (URL with `?join=CODE`);
  read `?join=` on startup and call `MainMenu.prefillCode`.
- Handle disconnects, rejoin, version mismatch (`PROTOCOL_VERSION`).

### Part 8 — Polish and release
Settings screen (sensitivity, FOV, volume, crosshair, graphics quality with
an automatic low mode for integrated GPUs), How-to-play, performance pass,
one-click `start.cmd` launcher, plain-English README, and deployment (see the
private-repo conflict above).

## Known problems / notes

- Browser pane tab is hidden during automated tests → use `__cf.run()`.
- `tsc` here is TypeScript 7 (native). `noUnusedLocals` is on: unused
  variables fail the typecheck.
- Line endings: `.gitattributes` forces LF (except `*.cmd` = CRLF).
