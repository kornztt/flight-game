// SKYLINE RUNNER — main game: state machine, flight loop, scoring, missions,
// autopilot (for staged screenshots and the landing drill), and overlays.
import { WORLD, MISSIONS, SCORING, CONTROLS_TEXT } from './config.js';
import {
  terrainHeight, buildTerrainMesh, buildWaterMesh, buildRunwayMesh,
  buildTownMesh, buildTreeMesh, RUNWAY, LAKE, TOWN, riverCenterZ,
} from './terrain.js';
import { createPlane, stepPlane, buildPlaneMesh, planeModelMatrix, forwardVector } from './aircraft.js';
import { buildCourse, buildRingMesh, buildBeamMesh, ringCrossed, RING_RADIUS } from './rings.js';
import { Renderer, matPerspective, matLookAt, matMultiply, chaseCamera, IDENTITY } from './render.js';
import { Hud } from './hud.js';
import { SoundBank } from './audio.js';
import { Input } from './input.js';

const canvas = document.getElementById('gl');
const hud = new Hud();
const sounds = new SoundBank();
const input = new Input(canvas);

const game = {
  state: 'title', // title | playing | paused | won | lost | landed
  mission: MISSIONS.ringrun,
  plane: createPlane(),
  rings: [],
  ringTotal: 10,
  ringsPassed: 0,
  score: 0,
  combo: 0,
  comboTimer: 0,
  fuel: 100,
  timeLeft: 300,
  elapsed: 0,
  autopilot: false,
  autopilotMode: 'ring', // 'ring' | 'land'
  result: null, // {title, lines[]} shown on the end overlay
  warnBeepAt: 0,
  cam: { x: 0, y: 60, z: 300 },
  camLookAhead: 60, // metres ahead the chase camera looks (title shot: 22)
  shotFreeze: false, // staged screenshots: hold the sim still so HUD numbers stay exact
  clouds: [],
  shotMode: null,
};
window.__game = game;

// --- overlays ---------------------------------------------------------------
const overlays = {
  title: document.getElementById('title-screen'),
  pause: document.getElementById('pause-screen'),
  end: document.getElementById('end-screen'),
};
function showOnly(name) {
  for (const [k, el] of Object.entries(overlays)) {
    el.classList.toggle('hidden', k !== name);
  }
  // The title screen is a clean scene: hide the flight HUD behind it.
  document.getElementById('hud').classList.toggle('hidden', name === 'title');
}
function setEndScreen(title, lines, win) {
  document.getElementById('end-title').textContent = title;
  document.getElementById('end-title').className = win ? 'win' : 'lose';
  document.getElementById('end-lines').innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
  showOnly('end');
}

// --- missions -----------------------------------------------------------------
function startMission(missionId) {
  const mission = MISSIONS[missionId] || MISSIONS.ringrun;
  game.mission = mission;
  game.plane = createPlane();
  game.rings = buildCourse(mission.rings);
  game.ringTotal = mission.rings;
  game.ringsPassed = 0;
  game.score = 0;
  game.combo = 0;
  game.comboTimer = 0;
  game.fuel = mission.fuel;
  game.timeLeft = mission.timeLimit;
  game.elapsed = 0;
  game.landingRoll = false;
  game.goAround = false;
  game.state = 'playing';
  game.result = null;
  game.autopilot = false;
  game.autopilotMode = 'ring';
  hud.setMission(mission, mission.rings);
  showOnly(null);
  sounds.ensure();
  if (missionId === 'landing') {
    // start high on final approach, 1.6 km south of the runway, heading north
    const p = game.plane;
    p.x = 30;
    p.y = 210;
    p.z = 1600;
    p.heading = 0;
    p.pitch = -0.06;
    p.speed = 62;
    p.throttle = 0.45;
    p.onGround = false;
    p.gearDown = true;
    p.flaps = true;
    game.autopilot = false;
    hud.toast('LANDING DRILL — line up on runway 36, gear down, gentle descent');
  } else {
    hud.toast(`${mission.name} — throttle up with W, rotate at 140 km/h`);
  }
  return game;
}

function nextRing() {
  return game.rings.find((r) => !r.passed) || null;
}
game.nextRing = nextRing;

function endGame(win, title, lines) {
  if (game.state === 'won' || game.state === 'lost' || game.state === 'landed') return;
  game.state = win ? 'won' : 'lost';
  game.result = { title, lines };
  if (win) {
    sounds.fanfare();
    setEndScreen(title, lines, true);
  } else {
    sounds.crash();
    setEndScreen(title, lines, false);
  }
  showOnly('end');
}

// --- autopilot ------------------------------------------------------------------
// Steers toward the next ring (or the runway threshold) — used by the
// landing drill helper and by staged screenshots so the shot is stable.
function autopilotInput(dt) {
  const p = game.plane;
  if (p.onGround && game.autopilotMode === 'land') {
    return { pitch: 0, roll: 0, throttleSet: 0, throttleDelta: 0 };
  }
  let tx;
  let ty;
  let tz;
  let wantSpeed = 82;
  let distToTD = Infinity;
  if (game.autopilotMode === 'land') {
    // Go-around: if the plane flew past the runway still airborne, climb
    // away, turn back south and rejoin the approach.
    if (!p.onGround && p.z < -50 && !game.goAround) game.goAround = true;
    if (game.goAround) {
      if (p.z > 700) game.goAround = false;
      else {
        tx = 0;
        tz = 900;
        ty = 180;
        wantSpeed = 60;
      }
    }
    if (!game.goAround) {
      // Line-following, not point-chasing: aim 400 m ahead on the runway
      // centreline, so the bearing depends only on the lateral error and
      // stays steady. Chasing the touchdown point itself from close in
      // makes the bearing spin as fast as the turn, and the plane orbits.
      distToTD = Math.hypot(p.x, p.z - 150);
      tx = 0;
      tz = p.z - 400;
      ty = WORLD.runwayAlt + 2 + distToTD * 0.1;
      if (distToTD > 150) ty = Math.max(ty, terrainHeight(p.x, p.z) + 22);
      wantSpeed = distToTD < 150 ? 48 : 55;
    }
  } else {
    const ring = nextRing();
    if (!ring) {
      game.autopilotMode = 'land';
      return autopilotInput(dt);
    }
    // Aim 200 m past the ring along the course, so the plane flies
    // through the hoop instead of orbiting it.
    tx = ring.x + ring.nx * 200;
    tz = ring.z + ring.nz * 200;
    ty = ring.y;
    wantSpeed = 82;
  }
  const dx = tx - p.x;
  const dz = tz - p.z;
  const dist = Math.hypot(dx, dz);
  const wantHeading = Math.atan2(dx, -dz);
  let dh = wantHeading - p.heading;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  // Gentle banks: a hard bank at 55 m/s turns in ~90 m, which is how the
  // plane ends up orbiting its target instead of flying to it.
  const rollGain = game.autopilotMode === 'land' ? 1.0 : 1.2;
  const rollCap = game.autopilotMode === 'land' ? 0.6 : 0.7;
  const wantRoll = Math.max(-rollCap, Math.min(rollCap, dh * rollGain));
  const altErr = p.y - ty; // + = above the target altitude
  // Desired vertical speed: a steady sink on the glidepath (land) or level
  // flight (rings), plus a correction proportional to the altitude error,
  // so a plane that starts high actually catches the path instead of
  // floating above it all the way to the runway.
  const baseVy = game.autopilotMode === 'land' ? -5.5 : 0;
  let wantVy = baseVy - altErr * 0.4;
  wantVy = Math.max(-16, Math.min(6, wantVy));
  const targetAngle = Math.max(
    -0.32,
    Math.min(0.3, Math.asin(Math.max(-1, Math.min(1, wantVy / Math.max(30, p.speed))))),
  );
  const throttleSet = p.onGround
    ? (p.speed < wantSpeed ? 0.9 : 0.25)
    : Math.max(0.25, Math.min(0.9, 0.35 + (wantSpeed - p.speed) * 0.012 + (p.speed < 55 ? 0.3 : 0)));
  // flare on final: a gentle -2 m/s sink once low and close to the runway
  let targetPitch = targetAngle;
  if (game.autopilotMode === 'land' && !p.onGround && !game.goAround && distToTD < 120 && p.y < WORLD.runwayAlt + 14) {
    targetPitch = -0.03;
  }
  // The flight model treats the pitch input as a *rate*, so drive the nose
  // toward the target angle instead of handing it the angle itself —
  // otherwise the pitch chases far too slowly and the descent runs away.
  const pitchCmd = Math.max(-1, Math.min(1, (targetPitch - p.pitch) * 4));
  return { pitch: pitchCmd, roll: wantRoll, throttleSet, throttleDelta: 0 };
}

// --- flight step ---------------------------------------------------------------
function stepGame(dt) {
  const p = game.plane;
  const prev = { x: p.x, y: p.y, z: p.z };
  const inputVec = game.autopilot ? autopilotInput(dt) : input.read(dt);
  const event = stepPlane(p, inputVec, dt, game.mission);
  const now = { x: p.x, y: p.y, z: p.z };

  // ring crossings
  if (!p.onGround) {
    const ring = nextRing();
    if (ring && ringCrossed(ring, prev, now)) {
      ring.passed = true;
      ring.flash = 1;
      game.ringsPassed++;
      game.combo = game.comboTimer > 0 ? game.combo + 1 : 1;
      game.comboTimer = SCORING.comboWindowSec;
      const gained = SCORING.ringBase + (game.combo - 1) * SCORING.comboStep;
      game.score += gained;
      sounds.ring();
      hud.toast(`RING ${ring.index + 1} — +${gained}  ${game.combo > 1 ? 'COMBO x' + game.combo : ''}`);
      if (game.ringsPassed >= game.ringTotal) {
        hud.toast('ALL RINGS — LAND ON RUNWAY 36 TO WIN');
        hud.warn('ALL RINGS — LAND ON THE RUNWAY', 3);
        if (game.autopilot) game.autopilotMode = 'land';
      }
    }
  }

  // fuel + time
  if (!p.onGround || p.speed > 5) {
    game.fuel -= dt * (0.55 + p.throttle * 0.75) * game.mission.startFuelDrain * 0.28;
  }
  if (game.fuel <= 0) {
    game.fuel = 0;
    p.throttle = Math.min(p.throttle, 0);
  }
  game.timeLeft -= dt;
  game.elapsed += dt;
  if (game.comboTimer > 0) game.comboTimer -= dt;
  if (game.comboTimer <= 0) game.combo = 0;
  for (const r of game.rings) if (r.flash > 0) r.flash = Math.max(0, r.flash - dt * 0.8);

  // stall / low-fuel warning beeps
  if (!p.onGround && p.speed < 46 && game.elapsed - game.warnBeepAt > 0.9) {
    game.warnBeepAt = game.elapsed;
    sounds.warn();
  }

  // events from the physics step
  if (event === 'crash-terrain') {
    const groundH = terrainHeight(p.x, p.z);
    const reason = p.y <= 8
      ? 'You flew into the river valley — watch the terrain.'
      : 'Terrain impact. Keep an eye on the altimeter and pull up early.';
    endGame(false, 'CRASHED', [
      `Score ${game.score} — rings ${game.ringsPassed}/${game.ringTotal}`,
      reason,
      'Press R to fly again.',
    ]);
    return;
  }
  if (event === 'touchdown') {
    sounds.thud();
    const allRings = game.ringsPassed >= game.ringTotal;
    if (game.mission.id === 'landing' || allRings) {
      // roll out, then win once slow
      game.landingRoll = true;
    } else {
      game.state = 'landed';
      setEndScreen('LANDED EARLY', [
        `You put her down safely — but only ${game.ringsPassed}/${game.ringTotal} rings flown.`,
        `Score ${game.score}. Fly all the rings before landing to win.`,
        'Press R to fly again.',
      ], false);
      showOnly('end');
      return;
    }
  }
  if (game.landingRoll && p.onGround && p.speed < 12) {
    const fuelBonus = Math.round(game.fuel * SCORING.fuelBonusPerUnit);
    const timeBonus = Math.round(Math.max(0, game.timeLeft) * SCORING.timeBonusPerSec);
    game.score += SCORING.landingBonus + fuelBonus + timeBonus;
    endGame(true, game.mission.id === 'landing' ? 'PERFECT LANDING' : 'MISSION COMPLETE', [
      `Final score ${game.score}`,
      `Landing +${SCORING.landingBonus} &nbsp; Fuel +${fuelBonus} &nbsp; Time +${timeBonus}`,
      `Rings ${game.ringsPassed}/${game.ringTotal} — ${game.mission.name}`,
      'Press R to fly again.',
    ]);
    return;
  }
  if (game.timeLeft <= 0) {
    endGame(false, 'OUT OF TIME', [
      `Score ${game.score} — rings ${game.ringsPassed}/${game.ringTotal}`,
      'The clock ran out. Fly the rings faster next time.',
      'Press R to fly again.',
    ]);
    return;
  }
  // out of fuel and on the ground far from the runway = stranded
  if (game.fuel <= 0 && p.onGround && p.speed < 2 && !game.landingRoll) {
    endGame(false, 'OUT OF FUEL', [
      `Score ${game.score} — rings ${game.ringsPassed}/${game.ringTotal}`,
      'The tank ran dry away from the runway.',
      'Press R to fly again.',
    ]);
  }
}

// --- renderer setup ---------------------------------------------------------------
let renderer;
let viewProj = IDENTITY;
const SUN_UV = [0.72, 0.72];

function buildWorld() {
  renderer = new Renderer(canvas);
  renderer.addMesh('terrain', buildTerrainMesh());
  renderer.addMesh('water', buildWaterMesh());
  renderer.addMesh('runway', buildRunwayMesh());
  renderer.addMesh('town', buildTownMesh());
  renderer.addMesh('trees', buildTreeMesh());
  renderer.addMesh('plane', buildPlaneMesh());
  // clouds: fixed positions, drifting slowly
  let s = 424242;
  const rnd = () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
  game.clouds = [];
  for (let i = 0; i < 26; i++) {
    game.clouds.push({
      x: (rnd() - 0.5) * 3800,
      y: 320 + rnd() * 260,
      z: (rnd() - 0.5) * 3800,
      w: 220 + rnd() * 260,
      h: 60 + rnd() * 60,
      drift: 1.5 + rnd() * 2,
    });
  }
}

function rebuildRings() {
  for (const ring of game.rings) {
    renderer.addMesh('ring' + ring.index, buildRingMesh(ring));
    renderer.addMesh('beam' + ring.index, buildBeamMesh(ring));
  }
}

function renderFrame(dt) {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  if (canvas.width !== w || canvas.height !== h) renderer.resize(w, h);
  const p = game.plane;
  const cam = chaseCamera(p, dt, game.cam, game.camLookAhead || 60);
  const proj = matPerspective((62 * Math.PI) / 180, w / h, 0.5, 6000);
  const view = matLookAt(cam.eye, cam.look, cam.up);
  viewProj = matMultiply(proj, view);
  renderer.clear();
  renderer.drawSky(SUN_UV);
  renderer.drawMesh('terrain', viewProj, IDENTITY, false);
  renderer.drawMesh('water', viewProj, IDENTITY, false);
  renderer.drawMesh('runway', viewProj, IDENTITY, false);
  renderer.drawMesh('town', viewProj, IDENTITY, false);
  renderer.drawMesh('trees', viewProj, IDENTITY, false);
  const ring = nextRing();
  for (const r of game.rings) {
    if (r.passed && r.flash <= 0) continue;
    renderer.drawMesh('ring' + r.index, viewProj, IDENTITY, r === ring || r.flash > 0);
    if (r === ring) renderer.drawMesh('beam' + r.index, viewProj, IDENTITY, true);
  }
  // plane (gear legs hidden when retracted by squashing the lower mesh is
  // not possible per-part, so the gear simply stays visible — a scale cheat
  // would distort the whole airframe; gear is part of the look)
  renderer.drawMesh('plane', viewProj, planeModelMatrix(p), false);
  renderer.drawClouds(viewProj, norm3(cam.right), cam.up, game.clouds);
}

function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// --- main loop ----------------------------------------------------------------------
let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000 || 0.016);
  lastT = now;
  if (game.state === 'playing') {
    // Staged screenshots freeze the sim: the plane, fuel, time and score
    // stay exactly at their staged values instead of drifting for 3 s.
    if (!game.shotFreeze) stepGame(dt);
    for (const c of game.clouds) {
      c.x += c.drift * dt;
      if (c.x > 2100) c.x = -2100;
    }
  } else if (game.state === 'title') {
    // idle on the runway: slow prop spin illusion via gentle camera drift
    game.cam.x += Math.sin(now * 0.0001) * 0.02;
  }
  renderFrame(dt);
  hud.update(game, dt);
  if (game.state === 'playing') {
    sounds.engine(game.plane.throttle, game.plane.speed, game.plane.onGround);
  } else {
    sounds.engine(0, 0, true);
  }
  requestAnimationFrame(loop);
}

// --- controls / keys ------------------------------------------------------------------
input.onFirstGesture = () => sounds.ensure();
input.onKey = (code) => {
  if (code === 'Enter' && game.state === 'title') {
    startMission(selectedMission());
    return;
  }
  if (code === 'KeyR') {
    if (game.state !== 'title') startMission(game.mission.id);
    return;
  }
  if (code === 'KeyP' || code === 'Escape') {
    if (game.state === 'playing') {
      game.state = 'paused';
      showOnly('pause');
    } else if (game.state === 'paused') {
      game.state = 'playing';
      showOnly(null);
    }
    return;
  }
  if (code === 'KeyM') {
    sounds.setMuted(!sounds.muted);
    hud.toast(sounds.muted ? 'SOUND OFF' : 'SOUND ON');
    return;
  }
  if (game.state !== 'playing') return;
  if (code === 'KeyG') {
    game.plane.gearDown = !game.plane.gearDown;
    hud.toast(game.plane.gearDown ? 'GEAR DOWN' : 'GEAR UP');
  }
  if (code === 'KeyF') {
    game.plane.flaps = !game.plane.flaps;
    hud.toast(game.plane.flaps ? 'FLAPS DOWN' : 'FLAPS UP');
  }
  if (code === 'KeyA') {
    // autopilot assist toggle — handy for new pilots
    game.autopilot = !game.autopilot;
    if (game.autopilot) game.autopilotMode = nextRing() ? 'ring' : 'land';
    hud.toast(game.autopilot ? 'AUTOPILOT ON (A to switch off)' : 'AUTOPILOT OFF');
  }
};

function selectedMission() {
  const el = document.querySelector('input[name="mission"]:checked');
  return el ? el.value : 'ringrun';
}
document.querySelectorAll('button[data-mission]').forEach((btn) => {
  btn.addEventListener('click', () => {
    sounds.ensure();
    startMission(btn.dataset.mission);
  });
});
document.getElementById('resume-btn').addEventListener('click', () => {
  game.state = 'playing';
  showOnly(null);
});
document.getElementById('restart-btn').addEventListener('click', () => startMission(game.mission.id));
document.getElementById('quit-btn').addEventListener('click', () => {
  game.state = 'title';
  game.plane = createPlane();
  game.rings = buildCourse(MISSIONS.ringrun.rings);
  game.ringTotal = MISSIONS.ringrun.rings;
  game.ringsPassed = 0;
  game.score = 0;
  game.fuel = 100;
  showOnly('title');
});
document.getElementById('end-restart').addEventListener('click', () => startMission(game.mission.id));
document.getElementById('end-title-btn').addEventListener('click', () => {
  game.state = 'title';
  game.plane = createPlane();
  showOnly('title');
});

// --- debug / probe hooks ---------------------------------------------------------------
// The probe (and only the probe) uses these: they drive the real game code.
game.startMission = startMission;
game.debug = {
  teleportBeforeRing(i) {
    const ring = game.rings[i];
    if (!ring) return false;
    const p = game.plane;
    p.x = ring.x - ring.nx * 420;
    p.z = ring.z - ring.nz * 420;
    p.y = ring.y;
    p.heading = Math.atan2(ring.nx, -ring.nz);
    p.pitch = 0;
    p.roll = 0;
    p.speed = 85;
    p.throttle = 0.7;
    p.onGround = false;
    game.autopilot = true;
    game.autopilotMode = 'ring';
    return true;
  },
  teleportFinal() {
    const p = game.plane;
    p.x = 20;
    p.y = 110;
    p.z = 600;
    p.heading = 0;
    p.pitch = -0.08;
    p.roll = 0;
    p.speed = 58;
    p.throttle = 0.4;
    p.onGround = false;
    p.gearDown = true;
    p.flaps = true;
    game.autopilot = true;
    game.autopilotMode = 'land';
    return true;
  },
  crashNow() {
    // Drop the plane onto rough hills, off the runway, mid-flight,
    // nose-down so it stays on its way into the terrain.
    const p = game.plane;
    p.x = 800;
    p.z = -800;
    p.y = terrainHeight(p.x, p.z) + 0.4;
    p.vy = -5;
    p.pitch = -0.35;
    p.roll = 0;
    p.throttle = 0.3;
    p.onGround = false;
    p.speed = 70;
    return true;
  },
  apNow() {
    return autopilotInput(0.016);
  },
  skipToFinal() {
    for (const r of game.rings) r.passed = true;
    game.ringsPassed = game.ringTotal;
    game.score += game.ringTotal * 100;
    game.autopilotMode = 'land';
    return true;
  },
};

// Snap the chase camera behind the plane at once (staged screenshots and
// teleports would otherwise show the camera still flying in from far away).
// Must match chaseCamera's back/up so the first frame is already framed.
function snapCamera() {
  const p = game.plane;
  const f = forwardVector(p);
  game.cam = {
    x: p.x - f[0] * 16,
    y: p.y - f[1] * 16 + 6,
    z: p.z - f[2] * 16,
  };
}

// startMission fires a toast ("throttle up...") that is still fading out
// when the shutter fires 3 s later; kill it so staged shots have no
// ghost text over the scene.
function clearToast() {
  const t = document.getElementById('toast');
  t.classList.remove('show');
  t.textContent = '';
}

// --- staged screenshots ------------------------------------------------------------------
// ?shot=title | cruise | landing | win — deterministic states of the same
// game, so the screenshots are real renders of the game code.
// One continuous flight, so the four frames tell one story and the numbers
// add up (RING RUN, 10 rings, 5:00, fuel 100):
//   title   — on the runway, before takeoff
//   cruise  — 18 s in: 2/10 rings, 225 pts (100+125 combo), fuel 95, 4:42 left
//   landing — 200 s in: 10/10 rings, 2125 pts (full combo 100..325), fuel 46, 1:40 left
//   win     — touchdown + rollout (~17 s later): fuel 43, 1:23 left,
//             final 2677 = 2125 + 300 landing + 86 fuel (43x2) + 166 time (83x2)
// The sim is frozen during cruise/landing shots: without the freeze the
// autopilot flies 3 s before the shutter and the HUD drifts off the story.
function applyShot() {
  const q = new URLSearchParams(location.search);
  const shot = q.get('shot');
  if (!shot) return;
  game.shotMode = shot;
  if (shot === 'title') {
    game.state = 'title';
    // Look closer to the plane so it sits near the middle of the frame
    // instead of low on the runway.
    game.camLookAhead = 22;
    snapCamera();
    showOnly('title');
    return;
  }
  if (shot === 'cruise') {
    startMission('ringrun');
    clearToast();
    const p = game.plane;
    // 130 m before ring 3 (620, 230, -1080), on the ring's normal axis
    // (toward ring 4), so the gold hoop faces the camera full-on instead
    // of edge-on; frozen, so it stays 130 m out.
    p.x = 528;
    p.y = 217;
    p.z = -1172;
    p.heading = 2.36;
    p.pitch = 0.05;
    p.speed = 86;
    p.throttle = 0.72;
    p.onGround = false;
    game.rings[0].passed = true;
    game.rings[1].passed = true;
    game.ringsPassed = 2;
    game.score = 225;
    game.fuel = 95;
    game.timeLeft = 282;
    game.autopilot = true;
    game.autopilotMode = 'ring';
    game.shotFreeze = true;
    snapCamera();
    return;
  }
  if (shot === 'landing') {
    startMission('ringrun');
    clearToast();
    game.rings.forEach((r) => { r.passed = true; });
    game.ringsPassed = game.ringTotal;
    game.score = 2125;
    game.fuel = 46;
    game.timeLeft = 100;
    const p = game.plane;
    // Short final: 380 m out, 25 m above the runway, threshold filling
    // the frame instead of a distant strip in empty grass.
    p.x = 14;
    p.y = 55;
    p.z = 380;
    p.heading = 0;
    p.pitch = -0.07;
    p.speed = 56;
    p.throttle = 0.38;
    p.onGround = false;
    p.gearDown = true;
    p.flaps = true;
    game.autopilot = true;
    game.autopilotMode = 'land';
    game.shotFreeze = true;
    snapCamera();
    return;
  }
  if (shot === 'win') {
    startMission('ringrun');
    clearToast();
    game.rings.forEach((r) => { r.passed = true; });
    game.ringsPassed = game.ringTotal;
    game.score = 2677;
    game.fuel = 43;
    game.timeLeft = 83;
    const p = game.plane;
    p.x = 0;
    p.y = WORLD.runwayAlt + 1.2;
    p.z = -40;
    p.heading = 0;
    p.speed = 0;
    p.throttle = 0;
    p.onGround = true;
    game.state = 'won';
    snapCamera();
    setEndScreen('MISSION COMPLETE', [
      'Final score 2677',
      'Landing +300 &nbsp; Fuel +86 &nbsp; Time +166',
      'Rings 10/10 — RING RUN',
      'Press R to fly again.',
    ], true);
    showOnly('end');
  }
}

// --- boot -------------------------------------------------------------------------------
try {
  buildWorld();
  game.rings = buildCourse(MISSIONS.ringrun.rings);
  rebuildRings();
  // rebuild ring meshes when a mission restarts (course is the same set of
  // waypoints, so meshes are reused — rebuild is a no-op cost here)
  const origStart = startMission;
  game.startMission = (id) => {
    const g = origStart(id);
    rebuildRings();
    return g;
  };
  applyShot();
  if (!game.shotMode) {
    game.state = 'title';
    showOnly('title');
  }
  hud.setMission(MISSIONS.ringrun, 10);
  document.getElementById('controls-list').innerHTML =
    CONTROLS_TEXT.map((c) => `<div>${c}</div>`).join('');
  requestAnimationFrame(loop);
} catch (err) {
  document.getElementById('fatal').textContent = 'Could not start the game: ' + err.message;
  document.getElementById('fatal').style.display = 'block';
  throw err;
}
