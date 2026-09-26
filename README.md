# Cubefire

A blocky tactical shooter that runs in your web browser. Two teams, **Blaze**
and **Frost**, fight in rounds: wipe out the other team to win the round, earn
money, and buy better weapons for the next one. First team to the target number
of rounds wins. Play against bots, or open a private room and play with friends.

Everything you see and hear (blocks, weapons, players, sounds) is made by the
game's own code, so there are no image or sound files to download.

**Play now: <https://humoyunazamov2-jpg.github.io/cubefire/>** (works in
Chrome, Edge or Firefox; send friends the same link to play together).

## Play on this computer (Windows)

1. Double-click **`start.cmd`** in this folder.
2. The first time, it downloads the parts the game is built from (about a
   minute). Then your web browser opens the game by itself.
3. Keep the black window open while you play. Close it to stop the game.

If the window says **Node.js was not found**: install the "LTS" version from
<https://nodejs.org> (click the big green button, then Next, Next, Install),
and double-click `start.cmd` again.

## Play with friends

Friends play in their own browsers, so the game has to be online first (see
[Putting the game online](#putting-the-game-online)). Then:

1. One of you clicks **Host a room**. You get a five-letter room code.
2. Click **Copy invite** and send the link (or just read the code out).
3. Friends open the link, or click **Join a room** and type the code.
4. The host picks the map, team size (1v1, 2v2 or 4v4), rounds to win, bot
   skill and friendly fire, then clicks **Start match**. Bots fill empty places.

The host's computer runs the match, so the host should keep the game open until
the end (switching to another tab or window is fine). If someone's internet
drops, they can join again with the same code and get their team, money and
score back. Up to 8 people can be in one room.

If a friend can't connect at all, a very strict firewall (some offices, schools
or mobile networks) may be blocking direct connections: try another network.

## Controls

| Action | Key |
|---|---|
| Move | W A S D |
| Jump | Space (or mouse wheel down) |
| Crouch | Ctrl or C |
| Walk quietly | Shift |
| Shoot | Left click |
| Scope / heavy knife stab / gentle throw | Right click |
| Reload | R |
| Weapons | 1 2 3 4, Q for the last one |
| Buy menu (in your spawn, at the start of a round) | B |
| Scoreboard | hold Tab |
| Drop weapon | G |
| Chat / team chat | Y / U |
| Pause, settings, leave | Esc |

More in the game under **How to play**.

## If the game feels slow

Open **Settings** and set **Graphics** to **Low**. The default, **Auto**,
lowers the resolution by itself when the frame rate drops, and starts a little
lower on laptops with built-in graphics. **Show FPS** puts a frame counter in
the corner. If the game says it **can't start**, follow the steps it shows
(usually: switch on "graphics acceleration" in the browser's settings).

## Putting the game online

This repository uses option A: it is public and GitHub Pages publishes the game
at the link above every time `main` changes. The other options are kept here in
case that ever needs to change.

**A. Free, with GitHub Pages (the repository becomes public, so anyone can see
the code).**
1. On GitHub, open this repository, click **Settings**.
2. Scroll to the bottom (**Danger Zone**), click **Change visibility**, choose
   **Public**, and confirm.
3. In the left menu click **Pages**. Under **Build and deployment**, set
   **Source** to **GitHub Actions**.
4. Click the **Actions** tab at the top, click **Build and deploy** on the left,
   then **Run workflow** and the green **Run workflow** button.
5. After about two minutes the game is at
   **<https://humoyunazamov2-jpg.github.io/cubefire/>**, and it updates by itself
   whenever the code on `main` changes.

**B. Keep the code private, pay for GitHub Pro (about $4 a month).** Buy GitHub
Pro in your GitHub account settings under **Billing and plans**, then do steps
3 to 5 of option A (skip the visibility change).

**C. Keep the code private and free, with another website host.** Double-click
`start.cmd` once: it creates a folder called **`dist`**. Upload everything inside
`dist` to a free static host, for example **Netlify** (make an account, then drag
the `dist` folder onto <https://app.netlify.com/drop>) or **Cloudflare Pages**.
The game works at whatever address they give you. Repeat the upload after
changes.

Online rooms find each other through PeerJS's free public matchmaking service,
which needs no account.

## For developers

- `npm install` once, then `npm run dev` for a live-reloading dev server at
  <http://127.0.0.1:5174/>.
- `npm run typecheck`, `npm run build` (output in `dist/`).
- `npm run smoke` plays through the whole game in a headless browser (menus,
  a full match, bots on every map, practice range, an online room between two
  browsers, the release build) and reports anything broken. It needs Playwright
  (`npm i -g playwright`).
- [`PLAN.md`](PLAN.md) has the design, the file map and notes for each part.

Built with [three.js](https://threejs.org) (MIT licence) and
[PeerJS](https://peerjs.com) (MIT licence). Font: Silkscreen by Jason Kottke
(SIL Open Font Licence).
