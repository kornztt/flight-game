// Ring course: gold target rings hung on the mission waypoints, with a
// light beam over the next ring so the pilot can find it from far away.
import { RING_WAYPOINTS } from './config.js';

export const RING_RADIUS = 17;
export const RING_TUBE = 2.2;

export function buildCourse(ringCount) {
  const rings = [];
  const wps = RING_WAYPOINTS.slice(0, ringCount);
  for (let i = 0; i < wps.length; i++) {
    const w = wps[i];
    const next = wps[Math.min(i + 1, wps.length - 1)];
    const dx = next.x - w.x;
    const dz = next.z - w.z;
    const len = Math.hypot(dx, dz) || 1;
    rings.push({
      index: i,
      x: w.x,
      y: w.y,
      z: w.z,
      nx: dx / len, // ring plane normal (course direction)
      nz: dz / len,
      passed: false,
      flash: 0, // 0..1 green flash after passing
    });
  }
  return rings;
}

// True when the plane crossed this ring's plane inside the hoop this frame.
// prev/next are plane positions before/after the step.
export function ringCrossed(ring, prev, next) {
  const d0 = (prev.x - ring.x) * ring.nx + (prev.z - ring.z) * ring.nz;
  const d1 = (next.x - ring.x) * ring.nx + (next.z - ring.z) * ring.nz;
  if (d0 >= 0 || d1 <= 0) return false; // must cross the plane forward
  const t = d0 / (d0 - d1);
  const cx = prev.x + (next.x - prev.x) * t;
  const cy = prev.y + (next.y - prev.y) * t;
  const cz = prev.z + (next.z - prev.z) * t;
  const dist = Math.hypot(cx - ring.x, cy - ring.y, cz - ring.z);
  return dist < RING_RADIUS - 1;
}

// Annulus mesh for one ring, facing along (nx, nz). Built once per ring.
export function buildRingMesh(ring) {
  const mesh = { pos: [], col: [], nrm: [] };
  // ring local axes: u = horizontal perpendicular, v = up-ish perpendicular
  const ux = -ring.nz;
  const uz = ring.nx;
  const vx = 0;
  const vy = 1;
  const vz = 0;
  const SEG = 28;
  const gold = [1.0, 0.78, 0.25];
  const dark = [0.55, 0.38, 0.08];
  function point(angle, r) {
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    return [
      ring.x + (ux * ca + vx * sa) * r,
      ring.y + (uy0() * ca + vy * sa) * r,
      ring.z + (uz * ca + vz * sa) * r,
    ];
    function uy0() {
      return 0;
    }
  }
  for (let s = 0; s < SEG; s++) {
    const a1 = (s / SEG) * Math.PI * 2;
    const a2 = ((s + 1) / SEG) * Math.PI * 2;
    const o1 = point(a1, RING_RADIUS - RING_TUBE);
    const i1 = point(a1, RING_RADIUS + RING_TUBE);
    const o2 = point(a2, RING_RADIUS - RING_TUBE);
    const i2 = point(a2, RING_RADIUS + RING_TUBE);
    // front face
    push(o1, i1, o2, gold);
    push(i1, i2, o2, gold);
    // back face (same verts, reversed winding, darker)
    push(o1, o2, i1, dark);
    push(i1, o2, i2, dark);
  }
  function push(a, b, c, col) {
    mesh.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) mesh.col.push(col[0], col[1], col[2]);
    mesh.nrm.push(ring.nx, 0, ring.nz, ring.nx, 0, ring.nz, ring.nx, 0, ring.nz);
  }
  return mesh;
}

// Vertical light beam over a ring (two crossed quads, additive-looking pale
// gold). Drawn only for the next ring.
export function buildBeamMesh(ring) {
  const mesh = { pos: [], col: [], nrm: [] };
  const top = 320;
  const c = [1.0, 0.85, 0.4];
  const w = 1.2;
  function quad(a, b, cc, dd, col) {
    mesh.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], cc[0], cc[1], cc[2]);
    mesh.pos.push(a[0], a[1], a[2], cc[0], cc[1], cc[2], dd[0], dd[1], dd[2]);
    for (let i = 0; i < 6; i++) mesh.col.push(col[0], col[1], col[2]);
    for (let i = 0; i < 6; i++) mesh.nrm.push(0, 1, 0);
  }
  quad(
    [ring.x - w, ring.y, ring.z], [ring.x + w, ring.y, ring.z],
    [ring.x + w, top, ring.z], [ring.x - w, top, ring.z], c,
  );
  quad(
    [ring.x, ring.y, ring.z - w], [ring.x, ring.y, ring.z + w],
    [ring.x, top, ring.z + w], [ring.x, top, ring.z - w], c,
  );
  return mesh;
}
