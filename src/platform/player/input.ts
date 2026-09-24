/** Keyboard / mouse state with pointer lock and per-frame edge detection. */
export class Input {
  private down = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private buttonsDown = 0;
  private buttonsPressed = 0;
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  onLockChange: ((locked: boolean) => void) | null = null;
  onKey: ((code: string, e: KeyboardEvent) => void) | null = null;

  constructor(private target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) {
        if (this.locked && isGameKey(e.code)) e.preventDefault();
        return;
      }
      this.down.add(e.code);
      this.pressedThisFrame.add(e.code);
      if (this.locked && isGameKey(e.code)) e.preventDefault();
      this.onKey?.(e.code, e);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => {
      this.down.clear();
      this.buttonsDown = 0;
    });
    target.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.buttonsDown |= 1 << e.button;
      this.buttonsPressed |= 1 << e.button;
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      this.buttonsDown &= ~(1 << e.button);
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.target;
      if (!this.locked) {
        this.down.clear();
        this.buttonsDown = 0;
      }
      this.onLockChange?.(this.locked);
    });
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
    return this.down.has(code);
  }

  pressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  button(b: number): boolean {
    return (this.buttonsDown & (1 << b)) !== 0;
  }

  buttonPressed(b: number): boolean {
    return (this.buttonsPressed & (1 << b)) !== 0;
  }

  endFrame() {
    this.pressedThisFrame.clear();
    this.buttonsPressed = 0;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}

function isGameKey(code: string): boolean {
  return code === 'Space' || code === 'Tab' || code.startsWith('Arrow') || code === 'F3' || code === 'F1' || code === 'KeyE';
}
