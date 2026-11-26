// Renderer: one WebGL program for lit coloured meshes, one for the sky
// gradient + sun, plus soft billboard clouds. No libraries, no textures
// loaded from disk — the cloud puff is painted on an offscreen canvas.
import { planeModelMatrix } from './aircraft.js';

// --- matrix helpers (column-major) ------------------------------------------
export function matPerspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ];
}
export function matLookAt(eye, target, up) {
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len;
  zy /= len;
  zz /= len;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len;
  xy /= len;
  xz /= len;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  return [
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1,
  ];
}
export function matMultiply(a, b) {
  // returns a * b (column-major)
  const out = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const MESH_VERT = `
attribute vec3 aPos;
attribute vec3 aCol;
attribute vec3 aNrm;
uniform mat4 uMVP;
uniform mat4 uModel;
uniform vec3 uCamPos;
varying vec3 vCol;
varying vec3 vNrm;
varying vec3 vWorld;
varying float vDist;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vCol = aCol;
  vNrm = mat3(uModel) * aNrm;
  vec4 v = uMVP * w;
  vDist = -v.z;
  gl_Position = v;
}`;
const MESH_FRAG = `
precision mediump float;
uniform vec3 uSunDir;
uniform vec3 uFogCol;
uniform float uEmissive;
varying vec3 vCol;
varying vec3 vNrm;
varying vec3 vWorld;
varying float vDist;
void main() {
  vec3 n = normalize(vNrm);
  // Meshes are built with mixed winding, so light both faces: an up-facing
  // slope must never render black just because its triangles wind downward.
  float diff = abs(dot(n, uSunDir));
  float amb = 0.45;
  vec3 col = vCol * (amb + 0.75 * diff);
  col = mix(col, vCol * 1.25, uEmissive);
  float fog = clamp((vDist - 700.0) / 2200.0, 0.0, 0.85);
  col = mix(col, uFogCol, fog);
  gl_FragColor = vec4(col, 1.0);
}`;

const SKY_VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 1.0, 1.0); }`;
const SKY_FRAG = `
precision mediump float;
uniform vec2 uSunPos; // sun position in uv space
varying vec2 vUv;
void main() {
  vec3 zen = vec3(0.16, 0.42, 0.78);
  vec3 mid = vec3(0.45, 0.68, 0.90);
  vec3 hor = vec3(0.86, 0.90, 0.94);
  vec3 col = mix(hor, mid, smoothstep(0.42, 0.62, vUv.y));
  col = mix(col, zen, smoothstep(0.62, 1.0, vUv.y));
  float d = distance(vUv * vec2(1.6, 1.0), uSunPos * vec2(1.6, 1.0));
  // Soft sun: a wide faint halo plus a smaller warm core. The old full
  // white disc read as a flat sticker pasted on the sky.
  col += vec3(1.0, 0.8, 0.45) * smoothstep(0.34, 0.0, d) * 0.30;
  col += vec3(1.0, 0.9, 0.6) * smoothstep(0.05, 0.0, d) * 0.75;
  gl_FragColor = vec4(col, 1.0);
}`;

const CLOUD_VERT = `
attribute vec3 aPos;
attribute vec2 aUv;
uniform mat4 uMVP;
varying vec2 vUv;
void main() { vUv = aUv; gl_Position = uMVP * vec4(aPos, 1.0); }`;
const CLOUD_FRAG = `
precision mediump float;
uniform sampler2D uTex;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(uTex, vUv);
  if (t.a < 0.02) discard;
  gl_FragColor = vec4(t.rgb, t.a * 0.9);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('link: ' + gl.getProgramInfoLog(p));
  }
  return p;
}
function makeBuffer(gl, mesh) {
  const pos = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pos);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.pos), gl.STATIC_DRAW);
  const col = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, col);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.col), gl.STATIC_DRAW);
  const nrm = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, nrm);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.nrm), gl.STATIC_DRAW);
  return { pos, col, nrm, count: mesh.pos.length / 3 };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    this.meshProg = program(gl, MESH_VERT, MESH_FRAG);
    this.skyProg = program(gl, SKY_VERT, SKY_FRAG);
    this.cloudProg = program(gl, CLOUD_VERT, CLOUD_FRAG);
    this.buffers = new Map();
    // sky fullscreen triangle
    this.skyBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    // cloud texture: soft white puffs painted once
    this.cloudTex = this.makeCloudTexture();
    this.cloudBuf = { pos: gl.createBuffer(), uv: gl.createBuffer() };
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.sunDir = norm3([0.55, 0.62, 0.35]);
  }

  makeCloudTexture() {
    const gl = this.gl;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 256, 128);
    const puffs = [
      [70, 78, 46], [120, 66, 56], [175, 80, 48], [100, 88, 40], [150, 92, 38], [205, 66, 30],
    ];
    for (const [x, y, r] of puffs) {
      const g = ctx.createRadialGradient(x, y, 2, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  addMesh(name, mesh) {
    this.buffers.set(name, makeBuffer(this.gl, mesh));
  }

  resize(w, h) {
    const gl = this.gl;
    this.canvas.width = w;
    this.canvas.height = h;
    gl.viewport(0, 0, w, h);
  }

  drawMesh(name, mvp, model, emissive) {
    const gl = this.gl;
    const b = this.buffers.get(name);
    if (!b) return;
    gl.useProgram(this.meshProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.meshProg, 'uMVP'), false, new Float32Array(mvp));
    gl.uniformMatrix4fv(gl.getUniformLocation(this.meshProg, 'uModel'), false, new Float32Array(model));
    gl.uniform3fv(gl.getUniformLocation(this.meshProg, 'uSunDir'), new Float32Array(this.sunDir));
    gl.uniform3fv(gl.getUniformLocation(this.meshProg, 'uFogCol'), new Float32Array([0.82, 0.87, 0.92]));
    gl.uniform1f(gl.getUniformLocation(this.meshProg, 'uEmissive'), emissive ? 1 : 0);
    bindAttr(gl, this.meshProg, 'aPos', b.pos);
    bindAttr(gl, this.meshProg, 'aCol', b.col);
    bindAttr(gl, this.meshProg, 'aNrm', b.nrm);
    gl.drawArrays(gl.TRIANGLES, 0, b.count);
  }

  drawSky(sunUv) {
    const gl = this.gl;
    gl.useProgram(this.skyProg);
    gl.disable(gl.DEPTH_TEST);
    gl.uniform2fv(gl.getUniformLocation(this.skyProg, 'uSunPos'), new Float32Array(sunUv));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuf);
    const loc = gl.getAttribLocation(this.skyProg, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
  }

  drawClouds(viewProj, camRight, camUp, clouds) {
    const gl = this.gl;
    gl.useProgram(this.cloudProg);
    gl.depthMask(false);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.cloudTex);
    gl.uniform1i(gl.getUniformLocation(this.cloudProg, 'uTex'), 0);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.cloudProg, 'uMVP'), false, new Float32Array(viewProj));
    const posLoc = gl.getAttribLocation(this.cloudProg, 'aPos');
    const uvLoc = gl.getAttribLocation(this.cloudProg, 'aUv');
    const posArr = new Float32Array(clouds.length * 18);
    const uvArr = new Float32Array(clouds.length * 12);
    clouds.forEach((c, i) => {
      const hw = c.w / 2;
      const hh = c.h / 2;
      const corners = [
        [-hw, -hh, 0, 0], [hw, -hh, 1, 0], [-hw, hh, 0, 1],
        [hw, -hh, 1, 0], [hw, hh, 1, 1], [-hw, hh, 0, 1],
      ];
      corners.forEach((k, j) => {
        const px = c.x + camRight[0] * k[0] + camUp[0] * k[1];
        const py = c.y + camRight[1] * k[0] + camUp[1] * k[1];
        const pz = c.z + camRight[2] * k[0] + camUp[2] * k[1];
        posArr.set([px, py, pz], i * 18 + j * 3);
        uvArr.set([k[2], k[3]], i * 12 + j * 2);
      });
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cloudBuf.pos);
    gl.bufferData(gl.ARRAY_BUFFER, posArr, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cloudBuf.uv);
    gl.bufferData(gl.ARRAY_BUFFER, uvArr, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, clouds.length * 6);
    gl.depthMask(true);
  }

  clear() {
    const gl = this.gl;
    gl.clearColor(0.45, 0.68, 0.9, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }
}

function bindAttr(gl, prog, name, buf) {
  const loc = gl.getAttribLocation(prog, name);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
}
function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// Chase camera: behind and above the plane, smoothed, rolling a little with
// the plane so turns feel banked but never disorienting. Kept close (16 m)
// so the plane reads clearly at 1280 px wide instead of a speck.
export function chaseCamera(plane, dt, cam, lookAhead = 60) {
  const f = forwardFrom(plane);
  const back = 16;
  const up = 6;
  const tx = plane.x - f[0] * back;
  const ty = plane.y - f[1] * back + up;
  const tz = plane.z - f[2] * back;
  const k = 1 - Math.exp(-dt * 6.5);
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
  cam.z += (tz - cam.z) * k;
  // look ahead of the plane
  const look = [plane.x + f[0] * lookAhead, plane.y + f[1] * lookAhead, plane.z + f[2] * lookAhead];
  // up vector rolled with the plane (half the bank)
  const roll = plane.roll * 0.55;
  const upVec = [Math.sin(roll), Math.cos(roll), 0];
  return { eye: [cam.x, cam.y, cam.z], look, up: upVec, right: cross3(f, upVec) };
}
function forwardFrom(p) {
  const cp = Math.cos(p.pitch);
  return [Math.sin(p.heading) * cp, Math.sin(p.pitch), -Math.cos(p.heading) * cp];
}
function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export { IDENTITY, planeModelMatrix };
