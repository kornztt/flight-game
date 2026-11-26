// Terrain: a seeded heightfield with a river valley, a lake, a town, a
// mountain rim and a flattened runway strip. Everything is generated from
// code — no heightmap file, no copied data.
import { WORLD } from './config.js';

// --- deterministic value noise --------------------------------------------
function hash2(ix, iz) {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >> 16)) >>> 0;
  return h / 4294967295;
}
function smooth(t) {
  return t * t * (3 - 2 * t);
}
export function noise2(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  const u = smooth(fx);
  const v = smooth(fz);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z) {
  let s = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 4; i++) {
    s += amp * noise2(x * freq, z * freq);
    amp *= 0.5;
    freq *= 2.03;
  }
  return s; // 0..~1
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function smoothstep(a, b, t) {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
}

// --- feature locations ------------------------------------------------------
export const RIVER = { z0: 620 }; // river meanders around z = 620 + 260*sin(...)
export const LAKE = { x: 980, z: -720, r: 270 };
export const TOWN = { x: -620, z: 560, r: 330 };
export const RUNWAY = { x: 0, z: 0, halfLen: 320, halfW: 24 };

export function riverCenterZ(x) {
  return RIVER.z0 + 260 * Math.sin(x * 0.00085) + 90 * Math.sin(x * 0.0023 + 1.7);
}
export function riverDistance(x, z) {
  return Math.abs(z - riverCenterZ(x));
}

// --- height ------------------------------------------------------------------
export function terrainHeight(x, z) {
  const half = WORLD.size / 2;
  // rolling hills
  let h = 14 + 46 * fbm(x * 0.0011 + 7.3, z * 0.0011 + 2.9);
  h += 12 * fbm(x * 0.004 + 1.1, z * 0.004 + 5.5);
  // mountain rim near the world edge
  const edge = Math.max(Math.abs(x), Math.abs(z)) / half; // 0 centre .. 1 edge
  const rim = smoothstep(0.62, 1.0, edge);
  h += rim * (150 + 190 * fbm(x * 0.0016 + 3.1, z * 0.0016 + 8.8));
  // river valley carve
  const rd = riverDistance(x, z);
  h -= 30 * Math.exp(-((rd / 110) * (rd / 110)));
  // lake bowl
  const ld = Math.hypot(x - LAKE.x, z - LAKE.z);
  if (ld < LAKE.r + 120) {
    const t = smoothstep(LAKE.r + 120, LAKE.r * 0.55, ld);
    h = lerp(h, 1.5, t);
  }
  // town plateau
  const td = Math.hypot(x - TOWN.x, z - TOWN.z);
  if (td < TOWN.r + 100) {
    const t = smoothstep(TOWN.r + 100, TOWN.r * 0.6, td);
    h = lerp(h, 26, t);
  }
  // runway strip flatten
  const rx = Math.abs(x - RUNWAY.x);
  const rz = Math.abs(z - RUNWAY.z);
  if (rx < 90 && rz < RUNWAY.halfLen + 90) {
    const t = smoothstep(90, 30, rx) * smoothstep(RUNWAY.halfLen + 90, RUNWAY.halfLen + 10, rz);
    h = lerp(h, WORLD.runwayAlt, t);
  }
  return h;
}

export function isOnRunway(x, z) {
  return (
    Math.abs(x - RUNWAY.x) < RUNWAY.halfW + 6 &&
    Math.abs(z - RUNWAY.z) < RUNWAY.halfLen + 6
  );
}

// --- colour by height / feature ----------------------------------------------
function terrainColor(x, z, h) {
  // returns [r,g,b] 0..1
  const n = fbm(x * 0.01 + 4.4, z * 0.01 + 9.1);
  if (h < WORLD.waterLevel + 1.5) return [0.76, 0.72, 0.45]; // sandy shore
  if (h > 165) return [0.82, 0.84, 0.88]; // snow caps
  if (h > 105) return [0.42, 0.38, 0.34]; // bare rock
  if (h > 70) return [0.36, 0.44, 0.24]; // high scrub
  // meadow green with patchy fields
  const field = Math.floor(noise2(Math.floor(x / 170) + 40, Math.floor(z / 170) + 9) * 5);
  const greens = [
    [0.24, 0.5, 0.2],
    [0.32, 0.56, 0.22],
    [0.45, 0.58, 0.24],
    [0.28, 0.48, 0.3],
    [0.52, 0.55, 0.26],
  ];
  const g = greens[field];
  const v = 0.92 + n * 0.16;
  return [g[0] * v, g[1] * v, g[2] * v];
}

// --- mesh builders -------------------------------------------------------------
// Each builder appends triangles into {pos, col, nrm} arrays.
function pushTri(mesh, a, b, c, ca, cb, cc) {
  mesh.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  mesh.col.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
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

export function buildTerrainMesh() {
  const mesh = { pos: [], col: [], nrm: [] };
  const N = 110; // grid cells per side
  const half = WORLD.size / 2;
  const step = WORLD.size / N;
  const heights = new Float32Array((N + 1) * (N + 1));
  const colors = new Float32Array((N + 1) * (N + 1) * 3);
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = -half + i * step;
      const z = -half + j * step;
      const h = terrainHeight(x, z);
      heights[j * (N + 1) + i] = h;
      const c = terrainColor(x, z, h);
      colors[(j * (N + 1) + i) * 3] = c[0];
      colors[(j * (N + 1) + i) * 3 + 1] = c[1];
      colors[(j * (N + 1) + i) * 3 + 2] = c[2];
    }
  }
  const P = (i, j) => [-half + i * step, heights[j * (N + 1) + i], -half + j * step];
  const C = (i, j) => [
    colors[(j * (N + 1) + i) * 3],
    colors[(j * (N + 1) + i) * 3 + 1],
    colors[(j * (N + 1) + i) * 3 + 2],
  ];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      pushTri(mesh, P(i, j), P(i + 1, j), P(i, j + 1), C(i, j), C(i + 1, j), C(i, j + 1));
      pushTri(mesh, P(i + 1, j), P(i + 1, j + 1), P(i, j + 1), C(i + 1, j), C(i + 1, j + 1), C(i, j + 1));
    }
  }
  return mesh;
}

// Water: a ribbon following the river plus a disc over the lake.
export function buildWaterMesh() {
  const mesh = { pos: [], col: [], nrm: [] };
  const y = WORLD.waterLevel;
  const blue = [0.16, 0.42, 0.62];
  // river ribbon
  let prev = null;
  for (let x = -2100; x <= 2100; x += 60) {
    const cz = riverCenterZ(x);
    const w = 55;
    const a = [x, y, cz - w];
    const b = [x, y, cz + w];
    if (prev) {
      pushTri(mesh, prev[0], prev[1], a, blue, blue, blue);
      pushTri(mesh, prev[1], b, a, blue, blue, blue);
    }
    prev = [a, b];
  }
  // lake disc (triangle fan)
  const cx = LAKE.x;
  const cz = LAKE.z;
  const center = [cx, y, cz];
  const SEG = 26;
  for (let s = 0; s < SEG; s++) {
    const a1 = (s / SEG) * Math.PI * 2;
    const a2 = ((s + 1) / SEG) * Math.PI * 2;
    const p1 = [cx + Math.cos(a1) * LAKE.r, y, cz + Math.sin(a1) * LAKE.r];
    const p2 = [cx + Math.cos(a2) * LAKE.r, y, cz + Math.sin(a2) * LAKE.r];
    pushTri(mesh, center, p1, p2, blue, blue, blue);
  }
  return mesh;
}

// Runway: dark asphalt strip, white centre dashes, threshold bars, plus a
// grass apron and a small windsock pole beside it.
export function buildRunwayMesh() {
  const mesh = { pos: [], col: [], nrm: [] };
  const y = WORLD.runwayAlt + 0.35;
  const { x, halfLen, halfW } = RUNWAY;
  const asphalt = [0.16, 0.16, 0.18];
  const white = [0.92, 0.92, 0.9];
  const grass = [0.3, 0.5, 0.22];
  function quad(x0, z0, x1, z1, yy, c) {
    pushTri(mesh, [x0, yy, z0], [x1, yy, z0], [x0, yy, z1], c, c, c);
    pushTri(mesh, [x1, yy, z0], [x1, yy, z1], [x0, yy, z1], c, c, c);
  }
  quad(x - 70, -halfLen - 60, x + 70, halfLen + 60, y - 0.15, grass); // apron
  quad(x - halfW, -halfLen, x + halfW, halfLen, y, asphalt); // strip
  // centre dashes
  for (let z = -halfLen + 30; z < halfLen - 20; z += 40) {
    quad(x - 1.2, z, x + 1.2, z + 22, y + 0.05, white);
  }
  // threshold bars at both ends
  for (const zend of [-halfLen + 8, halfLen - 26]) {
    for (let k = -2; k <= 2; k++) {
      quad(x + k * 8 - 2.5, zend, x + k * 8 + 2.5, zend + 18, y + 0.05, white);
    }
  }
  // edge lines
  quad(x - halfW, -halfLen, x - halfW + 1.5, halfLen, y + 0.05, white);
  quad(x + halfW - 1.5, -halfLen, x + halfW, halfLen, y + 0.05, white);
  // windsock pole + orange cone flag
  const px = x + 46;
  const pz = 60;
  const pole = [0.75, 0.75, 0.75];
  const sock = [1.0, 0.45, 0.1];
  const base = terrainHeight(px, pz);
  // pole as two thin triangles (billboard-ish, read fine from the air)
  pushTri(mesh, [px - 0.6, base, pz], [px + 0.6, base, pz], [px - 0.6, base + 14, pz], pole, pole, pole);
  pushTri(mesh, [px + 0.6, base, pz], [px + 0.6, base + 14, pz], [px - 0.6, base + 14, pz], pole, pole, pole);
  pushTri(mesh, [px, base + 13.4, pz], [px + 9, base + 11.8, pz], [px, base + 10.6, pz], sock, sock, sock);
  return mesh;
}

// Town: merged boxes (walls + roofs) on the plateau.
export function buildTownMesh() {
  const mesh = { pos: [], col: [], nrm: [] };
  const wallCols = [
    [0.82, 0.72, 0.58],
    [0.72, 0.68, 0.62],
    [0.85, 0.78, 0.66],
    [0.66, 0.6, 0.55],
  ];
  const roofCols = [
    [0.62, 0.25, 0.2],
    [0.3, 0.32, 0.38],
    [0.55, 0.4, 0.28],
  ];
  function box(cx, cz, w, d, h, wall, roof) {
    const y0 = terrainHeight(cx, cz) - 0.5;
    const y1 = y0 + h;
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const z0 = cz - d / 2;
    const z1 = cz + d / 2;
    // four walls (two triangles each)
    const faces = [
      [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]],
      [[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]],
      [[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]],
      [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]],
    ];
    for (const f of faces) {
      pushTri(mesh, f[0], f[1], f[2], wall, wall, wall);
      pushTri(mesh, f[0], f[2], f[3], wall, wall, wall);
    }
    // flat roof
    pushTri(mesh, [x0, y1, z0], [x0, y1, z1], [x1, y1, z0], roof, roof, roof);
    pushTri(mesh, [x1, y1, z0], [x0, y1, z1], [x1, y1, z1], roof, roof, roof);
  }
  // seeded pseudo-random placement on a grid with jitter
  let s = 12345;
  const rnd = () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
  for (let gx = -5; gx <= 5; gx++) {
    for (let gz = -5; gz <= 5; gz++) {
      if (rnd() < 0.3) continue;
      const cx = TOWN.x + gx * 52 + (rnd() - 0.5) * 22;
      const cz = TOWN.z + gz * 52 + (rnd() - 0.5) * 22;
      if (Math.hypot(cx - TOWN.x, cz - TOWN.z) > TOWN.r) continue;
      const w = 14 + rnd() * 16;
      const d = 14 + rnd() * 16;
      const h = 8 + rnd() * rnd() * 22;
      box(cx, cz, w, d, h, wallCols[Math.floor(rnd() * wallCols.length)], roofCols[Math.floor(rnd() * roofCols.length)]);
    }
  }
  return mesh;
}

// Conifer trees: dark green cones scattered on meadow (not on runway/town).
export function buildTreeMesh() {
  const mesh = { pos: [], col: [], nrm: [] };
  let s = 987654;
  const rnd = () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
  const green = [0.12, 0.32, 0.14];
  const trunk = [0.3, 0.2, 0.12];
  let placed = 0;
  let tries = 0;
  while (placed < 260 && tries < 4000) {
    tries++;
    const x = (rnd() - 0.5) * 3800;
    const z = (rnd() - 0.5) * 3800;
    const h = terrainHeight(x, z);
    if (h < 8 || h > 95) continue;
    if (riverDistance(x, z) < 80) continue;
    if (Math.hypot(x - TOWN.x, z - TOWN.z) < TOWN.r + 40) continue;
    if (Math.abs(x) < 120 && Math.abs(z) < 420) continue; // runway clear zone
    const r = 4 + rnd() * 4;
    const th = 12 + rnd() * 12;
    const y0 = h - 0.5;
    // cone: 6 segments, apex + base ring
    const SEG = 6;
    const apex = [x, y0 + th, z];
    for (let k = 0; k < SEG; k++) {
      const a1 = (k / SEG) * Math.PI * 2;
      const a2 = ((k + 1) / SEG) * Math.PI * 2;
      const p1 = [x + Math.cos(a1) * r, y0 + th * 0.25, z + Math.sin(a1) * r];
      const p2 = [x + Math.cos(a2) * r, y0 + th * 0.25, z + Math.sin(a2) * r];
      pushTri(mesh, apex, p1, p2, green, green, green);
    }
    // trunk stub
    pushTri(mesh, [x - 0.8, y0, z], [x + 0.8, y0, z], [x - 0.8, y0 + th * 0.3, z], trunk, trunk, trunk);
    placed++;
  }
  return mesh;
}
