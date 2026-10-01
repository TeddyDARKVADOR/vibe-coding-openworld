/**
 * Keyboard + mouse input. Keys use KeyboardEvent.code (physical position), so
 * W A S D on QWERTY is automatically Z Q S D on AZERTY. Arrow keys also work.
 */
export class Input {
  private keys = new Set<string>();
  /** Accumulated mouse movement since last read (pixels). */
  private mouseDX = 0;
  private mouseDY = 0;
  private wheel = 0;
  private dragging = false;
  jumpPressed = false;
  onToggleDebug: () => void = () => {};

  constructor(element: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.code === 'F3') { e.preventDefault(); this.onToggleDebug(); return; }
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) this.jumpPressed = true; }
      if (e.code.startsWith('Arrow')) e.preventDefault();
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    element.addEventListener('click', () => {
      if (document.pointerLockElement !== element) element.requestPointerLock?.()?.catch?.(() => {});
    });
    element.addEventListener('mousedown', () => { this.dragging = true; });
    addEventListener('mouseup', () => { this.dragging = false; });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === element || this.dragging) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    element.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    element.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** Movement intent relative to the camera: x = right, y = forward, each in [-1, 1]. */
  move(): { x: number; y: number; run: boolean } {
    const f = (this.down('KeyW', 'ArrowUp') ? 1 : 0) - (this.down('KeyS', 'ArrowDown') ? 1 : 0);
    const r = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
    return { x: r, y: f, run: this.down('ShiftLeft', 'ShiftRight') };
  }

  consumeMouse(): { dx: number; dy: number; wheel: number } {
    const r = { dx: this.mouseDX, dy: this.mouseDY, wheel: this.wheel };
    this.mouseDX = this.mouseDY = this.wheel = 0;
    return r;
  }

  consumeJump(): boolean {
    const j = this.jumpPressed;
    this.jumpPressed = false;
    return j;
  }
}
