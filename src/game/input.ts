export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'crouch' | 'walk'
  | 'fire' | 'alt' | 'reload' | 'use' | 'drop' | 'inspect'
  | 'slot1' | 'slot2' | 'slot3' | 'slot4' | 'slot5' | 'lastWeapon'
  | 'buy' | 'scores' | 'chat' | 'teamChat';

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space', 'WheelDown'],
  crouch: ['ControlLeft', 'KeyC'],
  walk: ['ShiftLeft'],
  fire: ['Mouse0'],
  alt: ['Mouse2'],
  reload: ['KeyR'],
  use: ['KeyE'],
  drop: ['KeyG'],
  inspect: ['KeyF'],
  slot1: ['Digit1'],
  slot2: ['Digit2'],
  slot3: ['Digit3'],
  slot4: ['Digit4'],
  slot5: ['Digit5'],
  lastWeapon: ['KeyQ'],
  buy: ['KeyB'],
  scores: ['Tab'],
  chat: ['KeyY', 'Enter'],
  teamChat: ['KeyU'],
};

/**
 * Collects keyboard and mouse state. "Codes" are KeyboardEvent.code values
 * plus Mouse0..4 and WheelUp/WheelDown, so everything can be bound the same way.
 */
export class Input {
  bindings: Record<Action, string[]> = structuredClone(DEFAULT_BINDINGS);
  /** When false (menus, chat), game actions read as released. */
  enabled = true;
  private held = new Set<string>();
  private pressedNow = new Set<string>();
  private mx = 0;
  private my = 0;
  private wheel = 0;

  constructor(private canvas: HTMLCanvasElement) {
    addEventListener('keydown', (e) => {
      if (isTyping(e.target)) return;
      if (e.code === 'Tab' || e.code === 'Space' || (e.ctrlKey && ['KeyW', 'KeyS', 'KeyD', 'KeyA'].includes(e.code))) e.preventDefault();
      if (!e.repeat) this.pressedNow.add(e.code);
      this.held.add(e.code);
    });
    addEventListener('keyup', (e) => this.held.delete(e.code));
    addEventListener('blur', () => this.held.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.held.add(`Mouse${e.button}`);
      this.pressedNow.add(`Mouse${e.button}`);
    });
    addEventListener('mouseup', (e) => this.held.delete(`Mouse${e.button}`));
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Browsers occasionally report a huge jump when pointer lock engages; drop it.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mx += e.movementX;
      this.my += e.movementY;
    });
    canvas.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      e.preventDefault();
      this.pressedNow.add(e.deltaY > 0 ? 'WheelDown' : 'WheelUp');
      this.wheel += Math.sign(e.deltaY);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked) this.held.clear();
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  requestLock(): void {
    if (this.locked) return;
    const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true } as never) as unknown as Promise<void> | undefined;
    // Some browsers reject unadjustedMovement; retry plainly.
    p?.catch?.(() => this.canvas.requestPointerLock());
  }

  releaseLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  down(a: Action): boolean {
    if (!this.enabled) return false;
    return this.bindings[a].some((c) => this.held.has(c));
  }

  pressed(a: Action): boolean {
    if (!this.enabled) return false;
    return this.bindings[a].some((c) => this.pressedNow.has(c));
  }

  /** Raw key test, ignoring bindings and the enabled flag (for UI shortcuts). */
  rawPressed(code: string): boolean {
    return this.pressedNow.has(code);
  }

  rawDown(code: string): boolean {
    return this.held.has(code);
  }

  takeMouse(): [number, number] {
    const r: [number, number] = [this.mx, this.my];
    this.mx = this.my = 0;
    return r;
  }

  takeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Call once at the end of every frame. */
  endFrame(): void {
    this.pressedNow.clear();
  }

  /** Forget held keys, e.g. when a menu opens. */
  clear(): void {
    this.held.clear();
    this.pressedNow.clear();
    this.mx = this.my = this.wheel = 0;
  }
}

export function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}
