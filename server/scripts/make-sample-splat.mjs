// Generates a synthetic gaussian splat (INRIA .ply, SH degree 0) so the viewer
// has a hero object on first launch. A little ringed planet — reads as clearly
// 3D from any angle. Run: `npm run sample`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Writes to synthetic.ply so it never clobbers the bundled real sample (sample.ply).
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../../samples/synthetic.ply');

const C0 = 0.28209479177387814;
const shc = (c) => (c - 0.5) / C0; // color -> SH DC coefficient
const logit = (a) => Math.log(a / (1 - a)); // alpha -> stored opacity
const rnd = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

const g = []; // {x,y,z, r,g,b, a, s}

// ── Planet ────────────────────────────────────────────────────────────
const polar = [0.16, 0.45, 0.85]; // cool blue
const equator = [0.10, 0.80, 0.74]; // teal
const warm = [0.95, 0.55, 0.35]; // sunlit edge
for (let i = 0; i < 26000; i++) {
  // even point on a sphere
  let x = 0, y = 0, z = 0, l = 0;
  do {
    x = rnd(-1, 1); y = rnd(-1, 1); z = rnd(-1, 1);
    l = Math.hypot(x, y, z);
  } while (l < 0.0001 || l > 1);
  x /= l; y /= l; z /= l;
  const radius = 1 + rnd(-0.02, 0.02);
  const lat = (y + 1) / 2; // 0..1 pole-to-pole
  let col = mix(equator, polar, Math.abs(y) ** 1.3);
  // sunlit rim facing +x/+y
  const sun = Math.max(0, x * 0.5 + y * 0.4 + z * 0.3);
  col = mix(col, warm, sun * 0.35);
  // subtle speckle for texture
  const sp = rnd(0.85, 1.12);
  g.push({
    x: x * radius, y: y * radius, z: z * radius,
    r: Math.min(1, col[0] * sp), g: Math.min(1, col[1] * sp), b: Math.min(1, col[2] * sp),
    a: 0.96, s: rnd(0.014, 0.02),
  });
}

// ── Ring (tilted) ─────────────────────────────────────────────────────
const tilt = -0.42; // radians around X
const ct = Math.cos(tilt), st = Math.sin(tilt);
const ringInner = [0.98, 0.82, 0.45];
const ringOuter = [0.78, 0.5, 0.28];
for (let i = 0; i < 11000; i++) {
  const t = Math.random();
  const rr = lerp(1.45, 2.15, t);
  const th = rnd(0, Math.PI * 2);
  let x = Math.cos(th) * rr;
  let z = Math.sin(th) * rr;
  let y = rnd(-0.015, 0.015) * rr;
  // tilt around X
  const y2 = y * ct - z * st;
  const z2 = y * st + z * ct;
  const col = mix(ringInner, ringOuter, t);
  const sp = rnd(0.8, 1.1) * (0.6 + 0.4 * Math.abs(Math.sin(th * 3))); // faint banding
  g.push({
    x, y: y2, z: z2,
    r: Math.min(1, col[0] * sp), g: Math.min(1, col[1] * sp), b: Math.min(1, col[2] * sp),
    a: 0.7, s: rnd(0.01, 0.016),
  });
}

// ── Starfield halo ────────────────────────────────────────────────────
for (let i = 0; i < 1400; i++) {
  let x = rnd(-1, 1), y = rnd(-1, 1), z = rnd(-1, 1);
  const l = Math.hypot(x, y, z) || 1;
  const rad = rnd(3.2, 5.5);
  x = (x / l) * rad; y = (y / l) * rad; z = (z / l) * rad;
  const b = rnd(0.5, 1);
  g.push({ x, y, z, r: b, g: b, b: b * rnd(0.9, 1), a: rnd(0.4, 0.8), s: rnd(0.01, 0.03) });
}

// ── Write binary .ply ─────────────────────────────────────────────────
const N = g.length;
const STRIDE = 17; // x,y,z,nx,ny,nz,f_dc0-2,opacity,scale0-2,rot0-3
const header =
  'ply\n' +
  'format binary_little_endian 1.0\n' +
  `element vertex ${N}\n` +
  ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3']
    .map((p) => `property float ${p}`)
    .join('\n') +
  '\nend_header\n';

const body = Buffer.alloc(N * STRIDE * 4);
let o = 0;
const f = (v) => { body.writeFloatLE(v, o); o += 4; };
for (const p of g) {
  f(p.x); f(p.y); f(p.z);
  f(0); f(0); f(0); // normals
  f(shc(p.r)); f(shc(p.g)); f(shc(p.b));
  f(logit(p.a));
  const ls = Math.log(p.s);
  f(ls); f(ls); f(ls);
  f(1); f(0); f(0); f(0); // identity quaternion (w,x,y,z)
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.concat([Buffer.from(header, 'ascii'), body]));
console.log(`Wrote ${OUT} · ${N.toLocaleString()} gaussians · ${(body.length / 1e6).toFixed(1)} MB`);
