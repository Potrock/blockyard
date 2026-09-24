import type { PlayerInput } from '../net/protocol';

/** Keyboard / mouse state with pointer lock and per-frame edge detection. */
export class Input {
  private down = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private buttonsDown = 0;
  private buttonsPressed = 0;
  /** Buttons and keys claimed this frame (`consume`): they read as idle until the frame ends. */
  private consumedButtons = 0;
  private consumedKeys = new Set<string>();
  /** Mouse movement this frame (mouse look). */
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  /** Mouse movement from frames that sent no `snapshot` (the host was still busy), for the next. */
  private carryDX = 0;
  private carryDY = 0;
  private sent = false;
  locked = false;
  onLockChange: ((locked: boolean) => void) | null = null;
  onKey: ((code: string, e: KeyboardEvent) => void) | null = null;

  constructor(
    private target: HTMLElement,
    /** Aborting it removes every listener (the game is over). */
    signal?: AbortSignal,
  ) {
    const opts = { signal };
    window.addEventListener('keydown', (e) => {
      if (e.repeat) {
        if (this.locked && isGameKey(e.code)) e.preventDefault();
        return;
      }
      this.down.add(e.code);
      this.pressedThisFrame.add(e.code);
      if (this.locked && isGameKey(e.code)) e.preventDefault();
      this.onKey?.(e.code, e);
    }, opts);
    window.addEventListener('keyup', (e) => this.down.delete(e.code), opts);
    window.addEventListener('blur', () => {
      this.down.clear();
      this.buttonsDown = 0;
    }, opts);
    target.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.buttonsDown |= 1 << e.button;
      this.buttonsPressed |= 1 << e.button;
      e.preventDefault();
    }, opts);
    window.addEventListener('mouseup', (e) => {
      this.buttonsDown &= ~(1 << e.button);
    }, opts);
    target.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    }, opts);
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: true, signal },
    );
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.target;
      if (!this.locked) {
        this.down.clear();
        this.buttonsDown = 0;
      }
      this.onLockChange?.(this.locked);
    }, opts);
  }

  lock() {
    const el = this.target as HTMLElement & { requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | void };
    try {
      const r = el.requestPointerLock({ unadjustedMovement: true });
      // Retry without raw input (unsupported on some platforms); give up quietly if locking isn't allowed now.
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => Promise.resolve(el.requestPointerLock()).catch(() => {}));
    } catch {
      el.requestPointerLock();
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code: string): boolean {
    return this.down.has(code) && !this.consumedKeys.has(code);
  }

  pressed(code: string): boolean {
    return this.pressedThisFrame.has(code) && !this.consumedKeys.has(code);
  }

  button(b: number): boolean {
    return (this.buttonsDown & ~this.consumedButtons & (1 << b)) !== 0;
  }

  buttonPressed(b: number): boolean {
    return (this.buttonsPressed & ~this.consumedButtons & (1 << b)) !== 0;
  }

  /**
   * The controls for the simulation's next tick, as plain data: what's held now, and the presses,
   * clicks, wheel and mouse movement since the last snapshot (which this starts over).
   */
  snapshot(active: boolean, yaw: number, pitch: number, viewSeq: number): PlayerInput {
    const s: PlayerInput = {
      active,
      down: [...this.down],
      pressed: [...this.pressedThisFrame],
      buttons: this.buttonsDown,
      clicked: this.buttonsPressed,
      mouseX: this.carryDX + this.mouseDX,
      mouseY: this.carryDY + this.mouseDY,
      wheel: this.wheel,
      yaw,
      pitch,
      viewSeq,
    };
    this.pressedThisFrame.clear();
    this.buttonsPressed = 0;
    this.carryDX = 0;
    this.carryDY = 0;
    this.wheel = 0;
    this.sent = true;
    return s;
  }

  /** Claim a mouse button or key for the rest of this frame. */
  consume(what: number | string) {
    if (typeof what === 'number') this.consumedButtons |= 1 << what;
    else this.consumedKeys.add(what);
  }

  /** The frame is drawn: mouse look starts over (presses and clicks wait for the next snapshot). */
  endFrame() {
    this.consumedButtons = 0;
    this.consumedKeys.clear();
    if (!this.sent) {
      this.carryDX += this.mouseDX;
      this.carryDY += this.mouseDY;
    }
    this.sent = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
}

function isGameKey(code: string): boolean {
  return code === 'Space' || code === 'Tab' || code.startsWith('Arrow') || code === 'F3' || code === 'F1' || code === 'KeyE';
}
