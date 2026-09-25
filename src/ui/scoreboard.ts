import type { PlayerStats } from '../net/protocol';
import { esc } from './hud';

export interface ScoreRow {
  id: number;
  name: string;
  team: number;
  alive: boolean;
  money: number | null;
  ping: number;
  bot: boolean;
  stats: PlayerStats | undefined;
}

/** Same fixed column widths for both teams so their columns line up. */
const COLS = `<colgroup><col><col style="width:78px">${'<col style="width:44px">'.repeat(3)}<col style="width:52px"><col style="width:52px"><col style="width:64px"><col style="width:52px"></colgroup>`;

/** Hold Tab: both teams with kills, deaths, assists, damage per round and more. */
export class Scoreboard {
  readonly root: HTMLDivElement;
  private box: HTMLDivElement;
  private sig = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'overlay';
    this.root.style.pointerEvents = 'none';
    this.box = document.createElement('div');
    this.box.className = 'scoreboard';
    this.root.appendChild(this.box);
    parent.appendChild(this.root);
  }

  set visible(v: boolean) {
    this.root.classList.toggle('on', v);
  }

  /** `played` is the number of finished rounds, for damage per round. */
  render(rows: ScoreRow[], score: [number, number], round: number, played: number, mapName: string, myId: number): void {
    const sig = JSON.stringify([rows, score, round, played, myId]);
    if (sig === this.sig) return;
    this.sig = sig;
    const rounds = Math.max(1, played);
    const table = (team: number) => {
      const list = rows.filter((r) => r.team === team)
        .sort((a, b) => (b.stats?.kills ?? 0) - (a.stats?.kills ?? 0) || (b.stats?.damage ?? 0) - (a.stats?.damage ?? 0));
      const body = list.map((r) => {
        const s = r.stats ?? { kills: 0, deaths: 0, assists: 0, damage: 0, hs: 0, mvps: 0, id: r.id };
        const hsp = s.kills ? Math.round((s.hs / s.kills) * 100) : 0;
        return `<tr class="${r.id === myId ? 'me' : ''}${r.alive ? '' : ' dead'}">` +
          `<td>${esc(r.name)}${r.alive ? '' : ' ✝'}</td><td>${r.money !== null ? `$${r.money}` : ''}</td>` +
          `<td>${s.kills}</td><td>${s.deaths}</td><td>${s.assists}</td><td>${Math.round(s.damage / rounds)}</td>` +
          `<td>${hsp}%</td><td class="mvp">${s.mvps ? '★'.repeat(Math.min(s.mvps, 5)) + (s.mvps > 5 ? s.mvps : '') : ''}</td>` +
          `<td>${r.bot ? 'BOT' : r.ping}</td></tr>`;
      }).join('');
      const name = team === 0 ? 'Blaze' : 'Frost';
      return `<div class="sb-team ${team === 0 ? 'blaze' : 'frost'}"><h3><span>${name}</span><span>${score[team]}</span></h3>` +
        `<table>${COLS}<tr><th>Player</th><th>Money</th><th>K</th><th>D</th><th>A</th><th>ADR</th><th>HS</th><th>MVP</th><th>Ping</th></tr>${body}</table></div>`;
    };
    const specs = rows.filter((r) => r.team === -1).map((r) => esc(r.name)).join(', ');
    this.box.innerHTML = `<h2><span>${esc(mapName)}</span><span>Round ${Math.max(1, round)}</span></h2>${table(0)}${table(1)}` +
      (specs ? `<div style="font-size:11px;color:var(--muted)">Spectating: ${specs}</div>` : '');
  }
}
