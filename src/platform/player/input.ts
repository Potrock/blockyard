import type { PadAction, PadButton } from '../api/types';
import type { PlayerInput } from '../net/protocol';
import { DEFAULT_PAD, PAD_BUTTONS, readPad } from './gamepad';

/** Directions a controller moves through menus with (the D-pad or the left stick). */
const NAV: PadButton[] = ['Up', 'Down', 'Left', 'Right'];

/**
 * Keyboard / mouse state with pointer lock and per-frame edge detection, and a controller's
 * buttons and sticks alongside: while it drives the game its buttons press the keys and mouse
 * buttons they're bound to (and its sticks walk and look); otherwise they work the menus.
 */
export class Input {
  private down = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private buttonsDown = 0;
  private buttonsPressed = 0;
  /** Buttons and keys claimed this frame (`consume`): they read as idle until the frame ends. */
  private consumedButtons = 0;
  private consumedKeys = new Set<string>();
  /** Buttons and keys that went down this frame (the page's own systems: a gun's trigger). */
  private frameButtons = 0;
  private frameKeys = new Set<string>();
  /** Mouse movement this frame (mouse look). */
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  /** Mouse movement from frames that sent no `snapshot` (the host was still busy), for the next. */
  private carryDX = 0;
  private carryDY = 0;
  private sent = false;
  /** The mouse is captured (pointer lock). */
  private pointer = false;
  /** A controller has the game (no pointer lock needed: it doesn't use the mouse). */
  private padHeld = false;
  onLockChange: ((locked: boolean) => void) | null = null;
  /** A key went down (a controller's button pressing one comes without an event). */
  onKey: ((code: string, e?: KeyboardEvent) => void) | null = null;
  /** What was used last: `lock` captures with it, and the page shows hints for it. */
  device: 'mouse' | 'pad' = 'mouse';
  onDevice: ((device: 'mouse' | 'pad') => void) | null = null;
  /**
   * A controller button went down while it isn't driving the game (menus; `Up`/`Down`/`Left`/
   * `Right` also come from the left stick, repeating while held), or its pause button at any time.
   */
  onPadButton: ((button: PadButton, action: PadAction) => void) | null = null;
  /** What each controller button does (the game's `gamepad` over the platform's layout). */
  padBindings: Record<PadButton, PadAction> = { ...DEFAULT_PAD };
  /** The movement keys the controller's `jump`, `crouch` and `sprint` press. */
  padKeysFor = { jump: 'Space', crouch: 'ShiftLeft', sprint: 'ControlLeft' };
  /** The right stick, shaped for aiming ([right, down], each -1..1), while it drives the game. */
  padLook: [number, number] = [0, 0];
  /** How far the right stick is pushed (0..1). */
  padTilt = 0;
  /** The left stick ([right, forward]), while it drives the game and is pushed. */
  private padMove: [number, number] | null = null;
  private padPrev = new Set<PadButton>();
  private padKeys = new Set<string>();
  private padMouse = 0;
  private padWheel = 0;
  private padSprint = false;
  /** Menu directions held (D-pad or stick), and when each repeats next. */
  private navHeld = new Map<PadButton, number>();
  /**
   * Whether the controller drove the game last frame. Buttons held when that changes do nothing
   * until let go (A pressing Play doesn't jump; D-pad up opening a menu doesn't move in it).
   */
  private padDrove = false;
  private padIgnore = new Set<PadButton>();
  private stickIgnore = false;

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
      this.use('mouse');
      this.down.add(e.code);
      this.pressedThisFrame.add(e.code);
      this.frameKeys.add(e.code);
      if (this.locked && isGameKey(e.code)) e.preventDefault();
      this.onKey?.(e.code, e);
    }, opts);
    window.addEventListener('keyup', (e) => this.down.delete(e.code), opts);
    window.addEventListener('blur', () => {
      this.down.clear();
      this.buttonsDown = 0;
    }, opts);
    target.addEventListener('mousedown', (e) => {
      this.use('mouse');
      if (!this.pointer) return;
      this.buttonsDown |= 1 << e.button;
      this.buttonsPressed |= 1 << e.button;
      this.frameButtons |= 1 << e.button;
      e.preventDefault();
    }, opts);
    window.addEventListener('mouseup', (e) => {
      this.buttonsDown &= ~(1 << e.button);
    }, opts);
    target.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
    window.addEventListener('mousemove', (e) => {
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) this.use('mouse');
      if (!this.pointer) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    }, opts);
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.pointer) return;
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: true, signal },
    );
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.pointer = document.pointerLockElement === this.target;
      // The mouse took over from a controller (it lets go of the game when the pointer does).
      if (this.pointer) this.padHeld = false;
      if (!this.pointer) {
        this.down.clear();
        this.buttonsDown = 0;
      }
      if (this.locked !== was) this.onLockChange?.(this.locked);
    }, opts);
  }

  /** The game has the controls: the mouse is captured, or a controller has them. */
  get locked(): boolean {
    return this.pointer || this.padHeld;
  }

  /** The mouse is captured (pointer lock). */
  get pointerLocked(): boolean {
    return this.pointer;
  }

  /** A controller has the game (without the mouse). */
  get padCaptured(): boolean {
    return this.padHeld && !this.pointer;
  }

  private use(device: 'mouse' | 'pad') {
    if (this.device === device) return;
    this.device = device;
    this.onDevice?.(device);
  }

  /** Give the game the controls: with the controller if that's what was used last, else the mouse. */
  lock() {
    if (this.device === 'pad') {
      if (this.padHeld) return;
      const was = this.locked;
      this.padHeld = true;
      if (!was) this.onLockChange?.(true);
      return;
    }
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
    if (this.padHeld) {
      this.padHeld = false;
      if (!this.pointer) this.onLockChange?.(false);
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /**
   * Read the controller for this frame. While it `drives` the game its buttons press their keys
   * and mouse buttons and its sticks walk and look; otherwise it works the menus (`onPadButton`).
   */
  pollPad(drives: boolean) {
    const pad = readPad();
    const now = performance.now();
    const all = pad?.down ?? new Set<PadButton>();
    const pressed = PAD_BUTTONS.filter((b) => all.has(b) && !this.padPrev.has(b));
    this.padPrev = all;
    if (drives !== this.padDrove) {
      this.padDrove = drives;
      this.padIgnore = new Set(all);
      this.stickIgnore = true;
    }
    for (const b of this.padIgnore) if (!all.has(b)) this.padIgnore.delete(b);
    const held = new Set([...all].filter((b) => !this.padIgnore.has(b)));
    if (pad && (pressed.length || Math.hypot(...pad.move) > 0.5 || pad.lookTilt > 0.5)) this.use('pad');
    const b = this.padBindings;
    for (const btn of pressed) if (b[btn] === 'pause') this.onPadButton?.(btn, 'pause');
    if (!pad || Math.hypot(...pad.move) < 0.3) this.stickIgnore = false;

    if (!pad || !drives) {
      this.releasePad();
      if (!pad) return;
      // Menus: the D-pad and the left stick move (repeating while held), the rest press.
      const dirs = new Set<PadButton>(NAV.filter((d) => held.has(d)));
      const [mx, my] = this.stickIgnore ? [0, 0] : pad.move;
      if (Math.abs(mx) > 0.6 && Math.abs(mx) > Math.abs(my)) dirs.add(mx > 0 ? 'Right' : 'Left');
      if (Math.abs(my) > 0.6 && Math.abs(my) >= Math.abs(mx)) dirs.add(my > 0 ? 'Up' : 'Down');
      for (const d of NAV) {
        if (!dirs.has(d)) {
          this.navHeld.delete(d);
          continue;
        }
        const next = this.navHeld.get(d);
        if (next === undefined || now >= next) {
          this.navHeld.set(d, now + (next === undefined ? 380 : 110));
          this.onPadButton?.(d, b[d]);
        }
      }
      for (const btn of pressed) if (held.has(btn) && !NAV.includes(btn) && b[btn] !== 'pause') this.onPadButton?.(btn, b[btn]);
      return;
    }
    this.navHeld.clear();

    // The game: each button presses what it's bound to, for as long as it's held.
    const keys = new Set<string>();
    const pressedKeys: string[] = [];
    let mouse = 0;
    const act = (a: PadAction, edge: boolean) => {
      if (!a || a === 'pause') return;
      if (a === 'next' || a === 'prev') {
        if (edge) this.padWheel += a === 'next' ? 1 : -1;
        return;
      }
      if (a === 'sprint') {
        if (edge) this.padSprint = true;
        return;
      }
      const m = a === 'LMB' ? 0 : a === 'MMB' ? 1 : a === 'RMB' ? 2 : -1;
      if (m >= 0) {
        mouse |= 1 << m;
        if (edge) {
          this.buttonsPressed |= 1 << m;
          this.frameButtons |= 1 << m;
        }
        return;
      }
      const code = a === 'jump' ? this.padKeysFor.jump : a === 'crouch' ? this.padKeysFor.crouch : a;
      keys.add(code);
      if (edge && !this.padKeys.has(code)) {
        this.pressedThisFrame.add(code);
        this.frameKeys.add(code);
        pressedKeys.push(code);
      }
    };
    for (const btn of PAD_BUTTONS) if (held.has(btn)) act(b[btn], pressed.includes(btn));

    // The left stick walks (and holds WASD for games that read the keys); sprint stays on while it points ahead.
    const [mx, my] = pad.move;
    this.padMove = mx !== 0 || my !== 0 ? [mx, my] : null;
    if (my < 0.3) this.padSprint = false;
    const stickKeys: [boolean, string][] = [[my > 0.5, 'KeyW'], [my < -0.5, 'KeyS'], [mx > 0.5, 'KeyD'], [mx < -0.5, 'KeyA']];
    for (const [on, code] of stickKeys) {
      if (!on) continue;
      keys.add(code);
      if (!this.padKeys.has(code)) this.pressedThisFrame.add(code);
    }
    if (this.padSprint) {
      const code = this.padKeysFor.sprint;
      if (!this.padKeys.has(code)) this.pressedThisFrame.add(code);
      keys.add(code);
    }
    this.padKeys = keys;
    this.padMouse = mouse;
    this.padLook = pad.look;
    this.padTilt = pad.lookTilt;
    // The page's own keys too (E opens the block picker).
    for (const code of pressedKeys) this.onKey?.(code);
  }

  /** The left stick is pushed (walking), with a controller driving the game. */
  get padMoving(): boolean {
    return this.padMove !== null;
  }

  /** The controller lets go of everything it held in the game. */
  private releasePad() {
    this.padKeys.clear();
    this.padMouse = 0;
    this.padMove = null;
    this.padSprint = false;
    this.padLook = [0, 0];
    this.padTilt = 0;
  }

  isDown(code: string): boolean {
    return (this.down.has(code) || this.padKeys.has(code)) && !this.consumedKeys.has(code);
  }

  pressed(code: string): boolean {
    return this.pressedThisFrame.has(code) && !this.consumedKeys.has(code);
  }

  button(b: number): boolean {
    return ((this.buttonsDown | this.padMouse) & ~this.consumedButtons & (1 << b)) !== 0;
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
      down: this.padKeys.size ? [...new Set([...this.down, ...this.padKeys])] : [...this.down],
      pressed: [...this.pressedThisFrame],
      buttons: this.buttonsDown | this.padMouse,
      clicked: this.buttonsPressed,
      mouseX: this.carryDX + this.mouseDX,
      mouseY: this.carryDY + this.mouseDY,
      wheel: this.wheel + this.padWheel,
      yaw,
      pitch,
      viewSeq,
    };
    if (this.padMove) s.move = [...this.padMove];
    this.pressedThisFrame.clear();
    this.buttonsPressed = 0;
    this.carryDX = 0;
    this.carryDY = 0;
    this.wheel = 0;
    this.padWheel = 0;
    this.sent = true;
    return s;
  }

  /** A button went down this frame (whether or not a snapshot has gone since). */
  clickedThisFrame(b: number): boolean {
    return (this.frameButtons & (1 << b)) !== 0;
  }

  /** A key went down this frame. */
  keyThisFrame(code: string): boolean {
    return this.frameKeys.has(code);
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
    this.frameButtons = 0;
    this.frameKeys.clear();
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
