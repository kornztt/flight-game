// Aircraft: a built-from-triangles stunt plane mesh, plus the arcade flight
// model (throttle, pitch, roll, turn coordination, stall, ground handling).
import { WORLD } from './config.js';
import { terrainHeight, isOnRunway, RUNWAY } from './terrain.js';

export function createPlane() {
  return {
    x: 0,
    y: WORLD.runwayAlt + 1.2,
    z: 240,
    heading: 0, // radians, 0 = north (-z)
    pitch: 0, // radians, + = nose up
    roll: 0, // radians, + = right wing down
    speed: 0, // m/s
    throttle: 0, // 0..1
    vy: 0, // vertical speed m/s (derived, for HUD + landing checks)
    onGround: true,
    gearDown: true,
    flaps: false,
    airborneTime: 0,
  };
}

// Forward unit vector from heading + pitch.
export function forwardVector(p) {
  const cp = Math.cos(p.pitch);
  return [
    Math.sin(p.heading) * cp,
    Math.sin(p.pitch),
    -Math.cos(p.heading) * cp,
  ];
}

// Step the flight model one frame. `input` is {pitch, roll, throttleDelta,
// throttleSet} with pitch/roll in -1..1. Returns an event string or ''.
export function stepPlane(p, input, dt, mission) {
  const prevY = p.y;
  const groundH = terrainHeight(p.x, p.z);

  // --- throttle ------------------------------------------------------------
  if (typeof input.throttleSet === 'number') {
    p.throttle = Math.max(0, Math.min(1, input.throttleSet));
  } else {
    p.throttle += (input.throttleDelta || 0) * dt;
    p.throttle = Math.max(0, Math.min(1, p.throttle));
  }

  // --- attitude --------------------------------------------------------------
  const rollTarget = (input.roll || 0) * 1.05; // max ~60 deg bank
  p.roll += (rollTarget - p.roll) * Math.min(1, dt * 3.2);
  const pitchRate = (input.pitch || 0) * 0.55;
  p.pitch += pitchRate * dt;
  p.pitch = Math.max(-0.6, Math.min(0.65, p.pitch));
  if (p.onGround && p.speed < 30) p.pitch = Math.max(0, Math.min(p.pitch, 0.12));

  // coordinated turn: banking right (positive roll) turns the nose right,
  // i.e. heading increases, forward swinging from north toward east.
  const turnRate = Math.sin(p.roll) * (0.55 + p.speed * 0.004);
  p.heading += turnRate * dt;

  // --- speed -----------------------------------------------------------------
  const targetSpeed = p.throttle * WORLD.maxSpeed;
  const accel = p.onGround ? 0.55 : 0.32;
  p.speed += (targetSpeed - p.speed) * Math.min(1, accel * dt);
  // drag on the ground, and a little extra drag with flaps / gear out
  if (p.onGround) p.speed -= p.speed * 0.12 * dt;
  if (p.flaps && !p.onGround) p.speed -= 2.2 * dt;
  if (p.speed < 0) p.speed = 0;

  // --- vertical ---------------------------------------------------------------
  const stalled = p.speed < WORLD.stallSpeed;
  let vy;
  if (p.onGround) {
    vy = 0;
    // rotate: enough speed + nose up lifts off
    if (p.speed > 38 && p.pitch > 0.06) {
      p.onGround = false;
      p.airborneTime = 0;
      vy = p.speed * Math.sin(p.pitch);
    }
  } else {
    p.airborneTime += dt;
    vy = p.speed * Math.sin(p.pitch);
    if (stalled) {
      // wing drops: sink fast, nose falls
      vy -= (WORLD.stallSpeed - p.speed) * 0.55;
      p.pitch -= 0.35 * dt;
    }
    // gear/flaps drag bleeds a little climb
    if (p.flaps) vy -= 1.5;
  }
  p.vy = vy;

  // --- integrate ---------------------------------------------------------------
  const f = forwardVector(p);
  p.x += f[0] * p.speed * dt;
  p.z += f[2] * p.speed * dt;
  p.y += vy * dt;

  // world edge: soft turn-back (bounce heading, no hard wall)
  const half = WORLD.size / 2 - 60;
  if (Math.abs(p.x) > half || Math.abs(p.z) > half) {
    p.heading += Math.PI * dt * 0.4;
    p.x = Math.max(-half, Math.min(half, p.x));
    p.z = Math.max(-half, Math.min(half, p.z));
  }

  // --- ground contact ----------------------------------------------------------
  const newGroundH = terrainHeight(p.x, p.z);
  if (!p.onGround && p.y <= newGroundH + 1.1) {
    // touchdown evaluation
    const onRwy = isOnRunway(p.x, p.z);
    const gentle = vy > -9 && Math.abs(p.roll) < 0.45 && p.speed < 112;
    if (onRwy && gentle) {
      p.onGround = true;
      p.y = newGroundH + 1.1;
      p.pitch = 0;
      p.roll *= 0.4;
      return 'touchdown';
    }
    return 'crash-terrain';
  }
  if (p.onGround) {
    p.y = groundH + 1.1;
    if (p.y < newGroundH + 1.1) p.y = newGroundH + 1.1;
  }
  return '';
}

// --- plane mesh ---------------------------------------------------------------
// A single-prop stunt plane, red over white with a gold cheatline, built from
// flat-shaded triangles. Nose points -z, wings span x, up is +y.
function tri(mesh, a, b, c, col) {
  mesh.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  for (let i = 0; i < 3; i++) mesh.col.push(col[0], col[1], col[2]);
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  for (let i = 0; i < 3; i++) mesh.nrm.push(nx, ny, nz);
}
function quad(mesh, a, b, c, d, col) {
  tri(mesh, a, b, c, col);
  tri(mesh, a, c, d, col);
}

export function buildPlaneMesh() {
  const mesh = { pos: [], col: [], nrm: [] };
  const red = [0.78, 0.12, 0.1];
  const white = [0.94, 0.94, 0.92];
  const gold = [0.95, 0.72, 0.2];
  const dark = [0.12, 0.12, 0.14];
  const glass = [0.35, 0.65, 0.8];
  const silver = [0.72, 0.74, 0.78];
  // fuselage: tapered box, nose at z=-3.4, tail at z=+2.6
  const nose = [0, 0.1, -3.4];
  const nTop = [0, 0.55, -3.1];
  const nBot = [0, -0.35, -3.1];
  const nL = [-0.5, 0.1, -3.1];
  const nR = [0.5, 0.1, -3.1];
  const mTop = [0, 0.62, 0.4];
  const mBot = [0, -0.42, 0.4];
  const mL = [-0.62, 0.1, 0.4];
  const mR = [0.62, 0.1, 0.4];
  const tTop = [0, 0.5, 2.6];
  const tBot = [0, -0.3, 2.6];
  const tL = [-0.34, 0.08, 2.6];
  const tR = [0.34, 0.08, 2.6];
  // nose cone (red)
  tri(mesh, nose, nTop, nL, red);
  tri(mesh, nose, nR, nTop, red);
  tri(mesh, nose, nBot, nR, red);
  tri(mesh, nose, nL, nBot, red);
  // mid fuselage (white with gold cheatline quads)
  quad(mesh, nTop, mTop, mR, nR, white);
  quad(mesh, nR, mR, mBot, nBot, white);
  quad(mesh, nBot, mBot, mL, nL, white);
  quad(mesh, nL, mL, mTop, nTop, white);
  quad(mesh, mTop, tTop, tR, mR, white);
  quad(mesh, mR, tR, tBot, mBot, white);
  quad(mesh, mBot, tBot, tL, mL, white);
  quad(mesh, mL, tL, tTop, mTop, white);
  // gold cheatline along both flanks
  quad(mesh, [ -0.63, 0.18, -2.6], [-0.63, 0.18, 2.4], [-0.63, -0.02, 2.4], [-0.63, -0.02, -2.6], gold);
  quad(mesh, [0.63, 0.18, -2.6], [0.63, 0.18, 2.4], [0.63, -0.02, 2.4], [0.63, -0.02, -2.6], gold);
  // tail cap (red)
  tri(mesh, tTop, tL, tR, red);
  tri(mesh, tBot, tR, tL, red);
  // canopy (glass) over the cockpit
  quad(mesh, [-0.42, 0.55, -0.7], [0.42, 0.55, -0.7], [0.34, 0.95, 0.35], [-0.34, 0.95, 0.35], glass);
  quad(mesh, [-0.42, 0.55, -0.7], [-0.34, 0.95, 0.35], [-0.3, 0.95, 0.9], [-0.38, 0.55, 0.9], glass);
  quad(mesh, [0.42, 0.55, -0.7], [0.38, 0.55, 0.9], [0.3, 0.95, 0.9], [0.34, 0.95, 0.35], glass);
  quad(mesh, [-0.34, 0.95, 0.35], [0.34, 0.95, 0.35], [0.3, 0.95, 0.9], [-0.3, 0.95, 0.9], glass);
  // main wing (red top, white bottom), slight dihedral
  const wl = [-5.4, 0.28, 0.55];
  const wr = [5.4, 0.28, 0.55];
  const wl2 = [-5.4, 0.28, -0.55];
  const wr2 = [5.4, 0.28, -0.55];
  const rootL = [-0.6, 0.18, 0.9];
  const rootR = [0.6, 0.18, 0.9];
  const rootL2 = [-0.6, 0.18, -0.75];
  const rootR2 = [0.6, 0.18, -0.75];
  quad(mesh, wl, wr, rootR, rootL, red); // top
  quad(mesh, wl2, rootL2, rootR2, wr2, white); // bottom
  quad(mesh, wl, rootL, rootL2, wl2, dark); // left tip
  quad(mesh, wr, wr2, rootR2, rootR, dark); // right tip
  quad(mesh, wl, wl2, wr2, wr, red); // leading edge band
  // tailplane
  quad(mesh, [-2.1, 0.3, 2.35], [2.1, 0.3, 2.35], [0.3, 0.3, 2.9], [-0.3, 0.3, 2.9], red);
  quad(mesh, [-2.1, 0.3, 2.35], [-0.3, 0.3, 2.9], [0.3, 0.3, 2.9], [2.1, 0.3, 2.35], white);
  // fin
  quad(mesh, [0, 0.45, 1.6], [0, 0.45, 2.6], [0, 1.75, 2.5], [0, 1.75, 1.95], red);
  quad(mesh, [0.02, 0.45, 1.6], [0.02, 1.75, 1.95], [0.02, 1.75, 2.5], [0.02, 0.45, 2.6], red);
  // propeller: two dark blades + silver spinner, spinning around z
  quad(mesh, [-0.09, 0.1, -3.55], [0.09, 0.1, -3.55], [0.09, 1.5, -3.55], [-0.09, 1.5, -3.55], dark);
  quad(mesh, [-0.09, -1.3, -3.55], [0.09, -1.3, -3.55], [0.09, 0.1, -3.55], [-0.09, 0.1, -3.55], dark);
  tri(mesh, [0, 0.35, -3.62], [-0.22, 0.1, -3.62], [0.22, 0.1, -3.62], silver);
  tri(mesh, [0, -0.15, -3.62], [0.22, 0.1, -3.62], [-0.22, 0.1, -3.62], silver);
  // landing gear legs + wheels (visible when gear down; mesh always built,
  // the renderer hides it by scale when the gear is up)
  for (const sx of [-1, 1]) {
    quad(mesh, [sx * 0.5, -0.35, -0.6], [sx * 0.7, -0.35, -0.6], [sx * 0.7, -1.05, -0.6], [sx * 0.5, -1.05, -0.6], silver);
    quad(mesh, [sx * 0.5 - 0.18, -1.25, -0.78], [sx * 0.5 + 0.18, -1.25, -0.78], [sx * 0.5 + 0.18, -0.85, -0.78], [sx * 0.5 - 0.18, -0.85, -0.78], dark);
  }
  return mesh;
}

// Model matrix for the plane: yaw (heading), pitch, roll, in that order.
export function planeModelMatrix(p) {
  const ch = Math.cos(p.heading);
  const sh = Math.sin(p.heading);
  const cp = Math.cos(p.pitch);
  const sp = Math.sin(p.pitch);
  const cr = Math.cos(p.roll);
  const sr = Math.sin(p.roll);
  // R = Ry(-heading) * Rx(pitch) * Rz(-roll): heading 0 flies north (-z),
  // positive pitch raises the nose, positive roll drops the right wing.
  const m00 = ch * cr + sh * sp * sr;
  const m01 = ch * sr - sh * sp * cr;
  const m02 = -sh * cp;
  const m10 = -cp * sr;
  const m11 = cp * cr;
  const m12 = -sp;
  const m20 = sh * cr - ch * sp * sr;
  const m21 = sh * sr + ch * sp * cr;
  const m22 = ch * cp;
  return [
    m00, m10, m20, 0,
    m01, m11, m21, 0,
    m02, m12, m22, 0,
    p.x, p.y, p.z, 1,
  ];
}
