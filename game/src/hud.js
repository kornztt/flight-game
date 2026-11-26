// HUD: DOM readouts (altitude, speed, heading, score, rings, fuel, time),
// a compass strip, an attitude gauge canvas and a top-down minimap canvas.
import { RUNWAY, TOWN, LAKE, riverCenterZ } from './terrain.js';

export class Hud {
  constructor() {
    this.el = {};
    for (const id of [
      'alt', 'spd', 'hdg', 'score', 'rings', 'fuelFill', 'fuelText', 'time',
      'mission', 'target', 'warn', 'toast', 'thrFill', 'gear', 'flaps',
      'combo', 'wind',
    ]) {
      this.el[id] = document.getElementById(id);
    }
    this.compass = document.getElementById('compass');
    this.att = document.getElementById('attitude');
    this.map = document.getElementById('minimap');
    this.attCtx = this.att.getContext('2d');
    this.mapCtx = this.map.getContext('2d');
    this.lastWarn = '';
    this.warnUntil = 0;
  }

  setMission(mission, ringTotal) {
    this.el.mission.textContent = mission.name;
    this.el.rings.textContent = `0 / ${ringTotal}`;
  }

  update(g, dt) {
    const p = g.plane;
    const altM = Math.max(0, Math.round(p.y - 30));
    this.el.alt.textContent = String(altM).padStart(4, '0');
    const kmh = Math.round(p.speed * 3.6);
    this.el.spd.textContent = String(kmh).padStart(3, '0');
    const hdg = Math.round(((p.heading * 180) / Math.PI % 360 + 360) % 360);
    this.el.hdg.textContent = String(hdg).padStart(3, '0') + '°';
    this.el.score.textContent = String(g.score);
    this.el.rings.textContent = `${g.ringsPassed} / ${g.ringTotal}`;
    this.el.fuelFill.style.width = `${Math.max(0, g.fuel)}%`;
    this.el.fuelFill.className = 'fill' + (g.fuel < 25 ? ' low' : '');
    this.el.fuelText.textContent = `${Math.round(g.fuel)}%`;
    const t = Math.max(0, Math.ceil(g.timeLeft));
    this.el.time.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    this.el.time.className = t < 30 ? 'warn-num' : '';
    this.el.thrFill.style.height = `${Math.round(p.throttle * 100)}%`;
    this.el.gear.textContent = p.gearDown ? 'GEAR DOWN' : 'GEAR UP';
    this.el.gear.className = p.gearDown ? 'on' : 'off';
    this.el.flaps.textContent = p.flaps ? 'FLAPS' : 'FLAPS —';
    this.el.flaps.className = p.flaps ? 'on' : 'off';
    this.el.combo.textContent = g.combo > 1 ? `COMBO x${g.combo}` : '';
    // next target readout
    const ring = g.nextRing();
    if (ring) {
      const d = Math.round(Math.hypot(ring.x - p.x, ring.y - p.y, ring.z - p.z));
      this.el.target.textContent = `NEXT RING ${ring.index + 1} — ${d} m`;
    } else if (g.mission.id === 'landing' || g.ringsPassed >= g.ringTotal) {
      this.el.target.textContent = 'LAND ON THE RUNWAY — RWY 36';
    } else {
      this.el.target.textContent = '';
    }
    // wind (fixed light crosswind, shown for flavour + realism)
    this.el.wind.textContent = 'WIND 270° / 8 KT';
    this.drawCompass(hdg);
    this.drawAttitude(p);
    this.drawMinimap(g);
    this.updateWarning(g, dt);
  }

  warn(text, seconds = 2) {
    this.lastWarn = text;
    this.warnUntil = performance.now() + seconds * 1000;
  }

  updateWarning(g, dt) {
    let text = '';
    if (g.state === 'playing') {
      if (g.fuel <= 0) text = 'FUEL EMPTY — GLIDE TO THE RUNWAY';
      else if (g.plane.speed < 46 && !g.plane.onGround) text = 'STALL — NOSE DOWN, FULL THROTTLE';
      else if (g.fuel < 20) text = 'LOW FUEL';
      else if (g.plane.y < 60 && !g.plane.onGround && g.plane.vy < -6) text = 'PULL UP — TERRAIN';
      else if (g.timeLeft < 30) text = 'TIME RUNNING OUT';
    }
    if (performance.now() < this.warnUntil) text = this.lastWarn;
    if (text !== this.el.warn.textContent) {
      this.el.warn.textContent = text;
      this.el.warn.style.visibility = text ? 'visible' : 'hidden';
    }
  }

  toast(text) {
    this.el.toast.textContent = text;
    this.el.toast.classList.remove('show');
    void this.el.toast.offsetWidth; // restart animation
    this.el.toast.classList.add('show');
  }

  drawCompass(hdg) {
    const ctx = this.compass.getContext('2d');
    const W = this.compass.width;
    const H = this.compass.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(6, 14, 26, 0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(140, 200, 255, 0.5)';
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    ctx.fillStyle = '#bfe3ff';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = 0; d < 360; d += 15) {
      let rel = ((d - hdg + 540) % 360) - 180; // -180..180
      if (Math.abs(rel) > 90) continue;
      const x = W / 2 + (rel / 90) * (W / 2 - 14);
      const major = d % 45 === 0;
      ctx.strokeStyle = major ? '#7fd0ff' : 'rgba(127,208,255,0.35)';
      ctx.beginPath();
      ctx.moveTo(x, major ? 8 : 16);
      ctx.lineTo(x, 26);
      ctx.stroke();
      if (major) ctx.fillText(labels[d] || String(d), x, 42);
    }
    // centre lubber line
    ctx.fillStyle = '#ffd34d';
    ctx.beginPath();
    ctx.moveTo(W / 2 - 6, 0);
    ctx.lineTo(W / 2 + 6, 0);
    ctx.lineTo(W / 2, 9);
    ctx.closePath();
    ctx.fill();
  }

  drawAttitude(p) {
    const ctx = this.attCtx;
    const W = this.att.width;
    const H = this.att.height;
    const cx = W / 2;
    const cy = H / 2;
    const R = W / 2 - 4;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    // sky / ground halves, rotated by roll, shifted by pitch
    ctx.translate(cx, cy);
    ctx.rotate(-p.roll);
    const pitchPx = Math.max(-R, Math.min(R, p.pitch * R * 1.6));
    ctx.translate(0, pitchPx);
    ctx.fillStyle = '#2f7fd0';
    ctx.fillRect(-R - 4, -R * 2 - 4, (R + 4) * 2, R * 2 + 4);
    ctx.fillStyle = '#7a5230';
    ctx.fillRect(-R - 4, 0, (R + 4) * 2, R * 2 + 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-R, 0);
    ctx.lineTo(R, 0);
    ctx.stroke();
    // pitch ladder
    ctx.lineWidth = 1;
    ctx.font = '10px monospace';
    ctx.fillStyle = '#fff';
    for (const deg of [-20, -10, 10, 20]) {
      const y = (-deg * Math.PI) / 180 * R * 1.6;
      ctx.beginPath();
      ctx.moveTo(-22, y);
      ctx.lineTo(22, y);
      ctx.stroke();
    }
    ctx.restore();
    // bezel + fixed aircraft symbol
    ctx.strokeStyle = '#9fd4ff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#ffd34d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 26, cy);
    ctx.lineTo(cx - 8, cy);
    ctx.moveTo(cx + 8, cy);
    ctx.lineTo(cx + 26, cy);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy + 6);
    ctx.stroke();
    ctx.fillStyle = '#ffd34d';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  drawMinimap(g) {
    const ctx = this.mapCtx;
    const W = this.map.width;
    const H = this.map.height;
    const S = W / 4200; // world -> map scale
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10, 26, 16, 0.78)';
    ctx.fillRect(0, 0, W, H);
    const mx = (x) => (x + 2100) * S;
    const mz = (z) => (z + 2100) * S;
    // river
    ctx.strokeStyle = '#3f8fd0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = -2100; x <= 2100; x += 120) {
      const px = mx(x);
      const py = mz(riverCenterZ(x));
      if (x === -2100) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // lake
    ctx.fillStyle = '#3f8fd0';
    ctx.beginPath();
    ctx.arc(mx(LAKE.x), mz(LAKE.z), LAKE.r * S, 0, Math.PI * 2);
    ctx.fill();
    // town
    ctx.fillStyle = '#8a7f6a';
    ctx.fillRect(mx(TOWN.x - 330), mz(TOWN.z - 330), 660 * S, 660 * S);
    // runway
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(mx(-24), mz(-320), 48 * S, 640 * S);
    // rings
    g.rings.forEach((r) => {
      ctx.fillStyle = r.passed ? '#39d353' : '#ffd34d';
      ctx.beginPath();
      ctx.arc(mx(r.x), mz(r.z), r.passed ? 3 : 4.5, 0, Math.PI * 2);
      ctx.fill();
    });
    // plane arrow
    const p = g.plane;
    ctx.save();
    ctx.translate(mx(p.x), mz(p.z));
    ctx.rotate(p.heading); // arrow points up at heading 0 (north)
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(160,210,255,0.5)';
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }
}
