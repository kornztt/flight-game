// Audio: everything is synthesised with WebAudio — engine hum, ring chime,
// warnings and a landing thud. No audio files, no network.
export class SoundBank {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineOsc2 = null;
    this.engineGain = null;
    this.noiseGain = null;
    this.started = false;
  }

  // Must be called from a user gesture (or after one) — browsers block
  // AudioContext before that. Safe to call repeatedly; it no-ops after init.
  ensure() {
    if (this.started) {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      // engine: two detuned saws through a lowpass, plus looped noise
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      filter.Q.value = 1.2;
      const o1 = ctx.createOscillator();
      o1.type = 'sawtooth';
      o1.frequency.value = 62;
      const o2 = ctx.createOscillator();
      o2.type = 'sawtooth';
      o2.frequency.value = 93;
      const og = ctx.createGain();
      og.gain.value = 0.5;
      o1.connect(og);
      o2.connect(og);
      og.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      o1.start();
      o2.start();
      // wind noise
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      noise.loop = true;
      const nf = ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = 900;
      nf.Q.value = 0.6;
      const ng = ctx.createGain();
      ng.gain.value = 0;
      noise.connect(nf);
      nf.connect(ng);
      ng.connect(ctx.destination);
      noise.start();
      this.engineOsc = o1;
      this.engineOsc2 = o2;
      this.engineGain = gain;
      this.noiseGain = ng;
      this.started = true;
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.ctx.resume().catch(() => {});
  }

  // Called every frame while flying: engine pitch follows throttle/speed.
  engine(throttle, speed, onGround) {
    if (!this.ctx || !this.started || this.muted) {
      if (this.engineGain) this.engineGain.gain.value = 0;
      return;
    }
    const t = this.ctx.currentTime;
    const rpm = 46 + throttle * 58 + speed * 0.12;
    this.engineOsc.frequency.setTargetAtTime(rpm, t, 0.08);
    this.engineOsc2.frequency.setTargetAtTime(rpm * 1.5 + 3, t, 0.08);
    const vol = onGround ? 0.05 + throttle * 0.1 : 0.06 + throttle * 0.12;
    this.engineGain.gain.setTargetAtTime(vol, t, 0.1);
    this.noiseGain.gain.setTargetAtTime(Math.min(0.09, speed * 0.0007), t, 0.2);
  }

  blip(freq, dur, type, vol, when = 0) {
    if (!this.ctx || !this.started || this.muted) return;
    try {
      const t = this.ctx.currentTime + when;
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(this.ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.05);
    } catch {
      /* audio is best-effort */
    }
  }

  ring() {
    this.blip(880, 0.35, 'sine', 0.22);
    this.blip(1318, 0.5, 'sine', 0.18, 0.07);
    this.blip(1760, 0.4, 'sine', 0.1, 0.14);
  }
  warn() {
    this.blip(620, 0.16, 'square', 0.08);
  }
  thud() {
    if (!this.ctx || !this.started || this.muted) return;
    try {
      const t = this.ctx.currentTime;
      const len = Math.floor(this.ctx.sampleRate * 0.18);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 220;
      const g = this.ctx.createGain();
      g.gain.value = 0.5;
      src.connect(f);
      f.connect(g);
      g.connect(this.ctx.destination);
      src.start(t);
    } catch {
      /* best-effort */
    }
  }
  fanfare() {
    const notes = [523, 659, 784, 1046, 784, 1046];
    notes.forEach((n, i) => this.blip(n, 0.4, 'triangle', 0.2, i * 0.13));
  }
  crash() {
    this.blip(160, 0.5, 'sawtooth', 0.2);
    this.blip(90, 0.8, 'sawtooth', 0.2, 0.1);
  }
}
