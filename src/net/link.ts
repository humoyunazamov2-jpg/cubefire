/**
 * A two-way message channel. The host talks to its own client through an
 * in-memory pair and to friends through WebRTC; game code can't tell apart.
 */
export interface Link<In, Out> {
  send(msg: Out): void;
  onMessage: ((msg: In) => void) | null;
  onClose: (() => void) | null;
  close(): void;
  readonly open: boolean;
}

/**
 * In-memory link pair. Messages are copied (like a real network would) and
 * delivered asynchronously (microtask) to avoid re-entrancy.
 */
export function localPair<A, B>(): [Link<B, A>, Link<A, B>] {
  let open = true;
  const make = <In, Out>(): Link<In, Out> & { peer?: Link<Out, In> } => ({
    onMessage: null,
    onClose: null,
    get open() { return open; },
    send(msg: Out) {
      if (!open) return;
      const peer = this.peer!;
      const copy = structuredClone(msg);
      queueMicrotask(() => { if (open) peer.onMessage?.(copy); });
    },
    close() {
      if (!open) return;
      open = false;
      queueMicrotask(() => { a.onClose?.(); b.onClose?.(); });
    },
  });
  const a = make<B, A>();
  const b = make<A, B>();
  a.peer = b;
  b.peer = a;
  return [a, b];
}
