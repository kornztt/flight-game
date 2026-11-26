// Input: keyboard + mouse drag. Keys are tracked as a live set; the game
// reads a smoothed control vector from it each frame.
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.drag = { active: false, dx: 0, dy: 0 };
    this.onKey = null; // (code) => void, for one-shot actions
    this.onFirstGesture = null;
    this._gestured = false;
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
      if (!e.repeat) {
        this.keys.add(e.code);
        this.gesture();
        if (this.onKey) this.onKey(e.code);
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('pointerdown', (e) => {
      this.drag.active = true;
      this.drag.dx = 0;
      this.drag.dy = 0;
      this.drag.lastX = e.clientX;
      this.drag.lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      this.gesture();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drag.active) return;
      this.drag.dx += e.clientX - this.drag.lastX;
      this.drag.dy += e.clientY - this.drag.lastY;
      this.drag.lastX = e.clientX;
      this.drag.lastY = e.clientY;
    });
    const endDrag = () => {
      this.drag.active = false;
      this.drag.dx = 0;
      this.drag.dy = 0;
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
  }

  gesture() {
    if (!this._gestured) {
      this._gestured = true;
      if (this.onFirstGesture) this.onFirstGesture();
    }
  }

  // Smoothed control vector for this frame. Mouse drag adds to roll/pitch
  // and decays when the drag ends.
  read(dt) {
    const k = this.keys;
    let pitch = 0;
    let roll = 0;
    if (k.has('ArrowUp')) pitch += 1;
    if (k.has('ArrowDown')) pitch -= 1;
    if (k.has('ArrowLeft')) roll -= 1;
    if (k.has('ArrowRight')) roll += 1;
    if (this.drag.active) {
      roll += Math.max(-1, Math.min(1, this.drag.dx / 90));
      pitch -= Math.max(-1, Math.min(1, this.drag.dy / 90));
      this.drag.dx *= Math.max(0, 1 - dt * 2.5);
      this.drag.dy *= Math.max(0, 1 - dt * 2.5);
    }
    let throttleDelta = 0;
    if (k.has('KeyW')) throttleDelta += 0.55;
    if (k.has('KeyS')) throttleDelta -= 0.55;
    return {
      pitch: Math.max(-1, Math.min(1, pitch)),
      roll: Math.max(-1, Math.min(1, roll)),
      throttleDelta,
    };
  }
}
