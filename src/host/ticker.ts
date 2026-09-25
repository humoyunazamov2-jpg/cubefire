/**
 * Calls `fn(dt)` about 60 times a second (or every `ms`), even when the tab
 * is in the background. Browsers pause requestAnimationFrame and throttle
 * timers in hidden tabs, which would freeze the match for everyone if the
 * host alt-tabbed; timers inside a Web Worker keep running, so the worker
 * just pings the page every tick.
 */
export class Ticker {
  private worker: Worker | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = performance.now();

  constructor(private fn: (dt: number) => void, ms = 1000 / 60) {
    try {
      const src = `setInterval(function () { postMessage(0); }, ${ms});`;
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      this.worker = new Worker(url);
      URL.revokeObjectURL(url);
      this.worker.onmessage = () => this.tick();
    } catch {
      this.timer = setInterval(() => this.tick(), ms);
    }
  }

  private tick(): void {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.fn(dt);
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
