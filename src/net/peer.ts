import { Peer, type DataConnection, type PeerOptions } from 'peerjs';
import { Ticker } from '../host/ticker';
import type { Link } from './link';
import type { C2H, H2C } from './protocol';

// Rooms over the internet. The host's browser registers a PeerJS id made
// from the room code; friends look it up on the PeerJS signalling server and
// then talk to the host directly over WebRTC data channels.

export const PEER_PREFIX = 'cubefire-v1-';
/** No 0/O or 1/I, so codes are easy to read out loud. */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;
/** A link with no traffic at all for this long is treated as dropped. */
const TIMEOUT_MS = 15000;
const KEEPALIVE_MS = 2000;
/** How long a closed room or link stays on the signalling server before leaving it. */
const LINGER_MS = 2500;
/** Frequent, replaceable messages go over the unordered channel. */
const FAST = new Set(['snap', 'state']);

export function newRoomCode(): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

/**
 * Signalling server settings. By default PeerJS's free public server; for
 * local testing `?peer=127.0.0.1:9000` points at a server you run yourself.
 */
export function peerOptions(): PeerOptions {
  const q = new URLSearchParams(location.search).get('peer');
  if (!q) return { debug: 0 };
  const [host, port] = q.split(':');
  return { host, port: Number(port) || 9000, path: '/', secure: false, debug: 0, config: { iceServers: [] } };
}

/** Same tab (even after a refresh) = same player, so a dropped friend can rejoin. */
export function playerToken(): string {
  const key = 'cubefire.token';
  try {
    let t = sessionStorage.getItem(key);
    if (!t) { t = Math.random().toString(36).slice(2, 12); sessionStorage.setItem(key, t); }
    return t;
  } catch {
    return Math.random().toString(36).slice(2, 12);
  }
}

type Envelope = { m: unknown; q?: number } | { k: 1 };

/**
 * A Link over two PeerJS data connections: a reliable ordered one for
 * everything that matters, and an unordered one for snapshots and player
 * state, where a late packet is simply dropped (a newer one is on its way).
 */
export class PeerLink<In, Out extends { t: string }> implements Link<In, Out> {
  onMessage: ((msg: In) => void) | null = null;
  onClose: (() => void) | null = null;
  private fast: DataConnection | null = null;
  private seqOut = 0;
  private seqIn = 0;
  private lastRecv = performance.now();
  private closed = false;
  private keepalive: Ticker;
  private closers: (() => void)[] = [];

  constructor(private rel: DataConnection) {
    rel.on('data', (d) => this.recv(d as Envelope));
    rel.on('close', () => this.close());
    rel.on('error', () => this.close());
    // Runs from a worker, so a background tab still keeps the link alive.
    this.keepalive = new Ticker(() => {
      if (performance.now() - this.lastRecv > TIMEOUT_MS) { this.close(); return; }
      this.raw(this.rel, { k: 1 });
    }, KEEPALIVE_MS);
  }

  get open(): boolean {
    return !this.closed && this.rel.open;
  }

  /** Add the unordered channel once it is connected. */
  attachFast(conn: DataConnection): void {
    this.fast = conn;
    conn.on('data', (d) => this.recv(d as Envelope));
    conn.on('close', () => { if (this.fast === conn) this.fast = null; });
    conn.on('error', () => { if (this.fast === conn) this.fast = null; });
  }

  /** Extra clean-up when the link closes (for whoever owns it). */
  whenClosed(fn: () => void): void {
    if (this.closed) fn(); else this.closers.push(fn);
  }

  send(msg: Out): void {
    if (!this.open) return;
    if (FAST.has(msg.t) && this.fast?.open) this.raw(this.fast, { q: ++this.seqOut, m: msg });
    else this.raw(this.rel, { m: msg });
  }

  private raw(conn: DataConnection, env: Envelope): void {
    try { void conn.send(env); } catch { /* channel closing; the close handler takes over */ }
  }

  private recv(env: Envelope): void {
    this.lastRecv = performance.now();
    if (this.closed || !env || typeof env !== 'object' || 'k' in env) return;
    if (env.q !== undefined) {
      if (env.q <= this.seqIn) return; // older than one we already used
      this.seqIn = env.q;
    }
    try {
      this.onMessage?.(env.m as In);
    } catch (e) {
      // A bad message from one player must not take the room down.
      console.warn('Ignored a message that failed to process', e);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.keepalive.stop();
    // Deliver anything still queued (a kick reason, the last messages) before closing,
    // but don't wait forever for a player who has already gone.
    try { this.rel.close({ flush: true }); } catch { /* already closed */ }
    setTimeout(() => { try { this.rel.close(); } catch { /* already closed */ } }, 1000);
    try { this.fast?.close(); } catch { /* already closed */ }
    for (const fn of this.closers) fn();
    this.closers = [];
    queueMicrotask(() => this.onClose?.());
  }
}

export type HostLink = PeerLink<C2H, H2C>;
export type ClientLink = PeerLink<H2C, C2H>;

/** Explain PeerJS errors in plain words. */
function explain(type: string): string {
  switch (type) {
    case 'peer-unavailable': return 'No room with that code is open. Check the code, or ask your friend to host again.';
    case 'network': case 'server-error': case 'socket-error': case 'socket-closed':
      return "Couldn't reach the online service. Check your internet connection and try again.";
    case 'browser-incompatible': return 'This browser cannot do online play. Try an up-to-date Chrome, Edge or Firefox.';
    case 'webrtc': return 'The connection to the other player failed (a strict firewall can cause this).';
    default: return `Online error (${type}). Try again in a moment.`;
  }
}

/**
 * The host's side: registers the room code and hands every friend that
 * connects to `onPlayer` as a Link.
 */
export class RoomServer {
  private peer: Peer | null = null;
  private links = new Map<string, HostLink>();
  private pendingFast = new Map<string, DataConnection>();
  private destroyed = false;
  code = '';

  constructor(
    private onPlayer: (link: HostLink) => void,
    private onReady: (code: string) => void,
    private onFail: (reason: string) => void,
  ) {}

  open(tries = 3): void {
    if (this.destroyed) return;
    this.code = newRoomCode();
    const peer = new Peer(PEER_PREFIX + this.code, peerOptions());
    this.peer = peer;
    let ready = false;
    peer.on('open', () => { ready = true; this.onReady(this.code); });
    peer.on('connection', (conn) => this.accept(conn));
    // Lost the signalling server (not the players): reconnect so others can still join.
    peer.on('disconnected', () => { if (!this.destroyed && !peer.destroyed) setTimeout(() => { if (!this.destroyed && !peer.destroyed) peer.reconnect(); }, 1500); });
    peer.on('error', (err) => {
      const type = (err as { type?: string }).type ?? 'unknown';
      if (type === 'unavailable-id' && !ready && tries > 1) { peer.destroy(); this.open(tries - 1); return; }
      if (!ready) { this.destroy(); this.onFail(explain(type)); }
      // After the room is up, errors about single connections are handled per link.
    });
  }

  private accept(conn: DataConnection): void {
    const cid = String((conn.metadata as { cid?: string } | undefined)?.cid ?? '');
    conn.on('open', () => {
      if (conn.label === 'fast') {
        const link = this.links.get(cid);
        if (link) link.attachFast(conn); else this.pendingFast.set(cid, conn);
        // A second channel whose main one never shows up (or already left) is dropped.
        setTimeout(() => { if (this.pendingFast.get(cid) === conn) { this.pendingFast.delete(cid); conn.close(); } }, 15000);
        return;
      }
      const link: HostLink = new PeerLink(conn);
      this.links.set(cid, link);
      link.whenClosed(() => { if (this.links.get(cid) === link) this.links.delete(cid); });
      const fast = this.pendingFast.get(cid);
      if (fast) { this.pendingFast.delete(cid); link.attachFast(fast); }
      this.onPlayer(link);
    });
  }

  get playerCount(): number {
    return this.links.size;
  }

  destroy(): void {
    this.destroyed = true;
    for (const l of this.links.values()) l.close();
    this.links.clear();
    for (const c of this.pendingFast.values()) { try { c.close(); } catch { /* already closed */ } }
    this.pendingFast.clear();
    // Same as for friends: let closing channels finish before leaving the signalling server.
    const peer = this.peer;
    this.peer = null;
    if (peer) setTimeout(() => peer.destroy(), LINGER_MS);
  }
}

/**
 * A friend's side: find the room by code and connect. Calls `onOpen` with
 * the link, or `onFail` with a reason. Returns a cancel function.
 */
export function joinRoom(code: string, onOpen: (link: ClientLink) => void, onFail: (reason: string) => void): () => void {
  const peer = new Peer(peerOptions());
  const cid = Math.random().toString(36).slice(2, 10);
  let settled = false;
  const fail = (reason: string) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    peer.destroy();
    onFail(reason);
  };
  const timer = setTimeout(() => fail("Couldn't connect to the room in time. Check the code and your internet connection."), 20000);
  peer.on('open', () => {
    const target = PEER_PREFIX + cleanCode(code);
    const rel = peer.connect(target, { label: 'rel', reliable: true, serialization: 'json', metadata: { cid } });
    rel.on('open', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const link: ClientLink = new PeerLink(rel);
      const fast = peer.connect(target, { label: 'fast', reliable: false, serialization: 'json', metadata: { cid } });
      fast.on('open', () => link.attachFast(fast));
      // Close the second channel even if it is still connecting, and only drop the
      // signalling connection a little later: dropping it at once makes PeerJS on
      // the host trip over a channel that is still arriving.
      link.whenClosed(() => {
        try { fast.close(); } catch { /* already closed */ }
        setTimeout(() => peer.destroy(), LINGER_MS);
      });
      onOpen(link);
    });
    rel.on('error', () => fail(explain('webrtc')));
  });
  peer.on('error', (err) => fail(explain((err as { type?: string }).type ?? 'unknown')));
  return () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    peer.destroy();
  };
}
