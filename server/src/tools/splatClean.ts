import { readFile, writeFile, stat } from 'node:fs/promises';

/**
 * Post-process a Brush gaussian-splat .ply into two aligned views:
 *
 *  Subject (`subjectPath`) — the object, truly isolated:
 *    1. drop "floaters" (spatially lonely splats — see below),
 *    2. RANSAC-fit the dominant horizontal support plane (table/floor) and cut
 *       it away, severing the subject from its surroundings,
 *    3. flood-fill voxel connected-components and keep the component under the
 *       robust center — walls/pedestal remnants fall away as disconnected islands.
 *
 *  Scene (`scenePath`) — the full capture as a backdrop: everything except
 *    floaters. Tables, floors and walls are kept; mid-air junk is not.
 *
 *  A splat is a *floater* only if it is spatially lonely (its 3×3×3 voxel
 *  neighbourhood is nearly empty), or faint AND lonely, or a giant "spike"
 *  gaussian. Splats on dense surfaces are never removed, no matter how faint —
 *  faint splats layered on a surface are what make it look solid.
 *
 * Both outputs share one transform: recentered on the subject and normalized to
 * ~unit radius (so the viewer's fixed framing works), and both are rewritten
 * with SH bands stripped (14 float props instead of 59 — the viewer renders
 * SH degree 0 anyway), cutting files by ~76%.
 */

interface Prop {
  name: string;
  type: string;
}
interface Header {
  props: Prop[];
  offset: Record<string, number>;
  stride: number;
  count: number;
  dataStart: number;
}

function sizeOf(t: string): number {
  switch (t) {
    case 'double':
    case 'float64':
      return 8;
    case 'float':
    case 'float32':
    case 'int':
    case 'uint':
    case 'int32':
    case 'uint32':
      return 4;
    case 'short':
    case 'ushort':
    case 'int16':
    case 'uint16':
      return 2;
    default:
      return 1; // char/uchar
  }
}

function parseHeader(buf: Buffer): Header {
  const marker = buf.indexOf('end_header');
  if (marker < 0) throw new Error('Not a .ply (no end_header)');
  const nl = buf.indexOf(0x0a, marker);
  const dataStart = nl + 1;
  const text = buf.slice(0, dataStart).toString('latin1');
  const props = [...text.matchAll(/property\s+(\w+)\s+(\w+)/g)].map((m) => ({ type: m[1], name: m[2] }));
  const count = Number(text.match(/element vertex (\d+)/)?.[1] ?? 0);
  const offset: Record<string, number> = {};
  let off = 0;
  for (const p of props) {
    offset[p.name] = off;
    off += sizeOf(p.type);
  }
  return { props, offset, stride: off, count, dataStart };
}

function median(arr: Float64Array | number[]): number {
  const a = Array.from(arr).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/** Props kept in outputs (SH rest bands dropped; all float32 in Brush plys). */
const KEEP_PROPS = [
  'x', 'y', 'z',
  'f_dc_0', 'f_dc_1', 'f_dc_2',
  'opacity',
  'scale_0', 'scale_1', 'scale_2',
  'rot_0', 'rot_1', 'rot_2', 'rot_3',
];

export interface CleanOptions {
  /** Voxel size as a fraction of the median center-distance. */
  cellFactor?: number;
  /** 3×3×3 neighbourhood population below which a splat is "lonely". */
  minNeighbors?: number;
  /** Alpha below which a splat must ALSO be near-lonely to survive. */
  faintAlpha?: number;
  /** Gaussians larger than this × median size are spike artifacts. */
  spikeScaleMul?: number;
  /** RANSAC plane inlier thickness as a fraction of median distance. */
  planeEpsFactor?: number;
  /** Subject radius = this percentile of subject distances (for normalization). */
  framePercentile?: number;
}

export interface CleanResult {
  center: [number, number, number];
  radius: number;
  total: number;
  subjectKept: number;
  sceneKept: number;
  floaters: number;
  planeFound: boolean;
  cleanBytes: number;
}

export async function cleanSplat(
  rawPath: string,
  subjectPath: string,
  scenePath?: string,
  opts: CleanOptions = {},
): Promise<CleanResult> {
  const cellFactor = opts.cellFactor ?? 0.1;
  const minNeighbors = opts.minNeighbors ?? 4;
  const faintAlpha = opts.faintAlpha ?? 0.04;
  const spikeScaleMul = opts.spikeScaleMul ?? 8;
  const planeEpsFactor = opts.planeEpsFactor ?? 0.04;
  const framePercentile = opts.framePercentile ?? 0.92;

  const buf = await readFile(rawPath);
  const h = parseHeader(buf);
  const { offset, stride, dataStart, count: N } = h;
  for (const k of ['x', 'y', 'z', 'opacity']) {
    if (!(k in offset)) throw new Error(`PLY missing property "${k}"`);
  }
  const hasScale = 'scale_0' in offset && 'scale_1' in offset && 'scale_2' in offset;

  // ── Read positions / alpha / size ─────────────────────────────────────
  const xs = new Float64Array(N);
  const ys = new Float64Array(N);
  const zs = new Float64Array(N);
  const alpha = new Float64Array(N);
  const size = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const b = dataStart + i * stride;
    xs[i] = buf.readFloatLE(b + offset.x);
    ys[i] = buf.readFloatLE(b + offset.y);
    zs[i] = buf.readFloatLE(b + offset.z);
    alpha[i] = 1 / (1 + Math.exp(-buf.readFloatLE(b + offset.opacity)));
    if (hasScale) {
      size[i] = Math.max(
        Math.exp(buf.readFloatLE(b + offset.scale_0)),
        Math.exp(buf.readFloatLE(b + offset.scale_1)),
        Math.exp(buf.readFloatLE(b + offset.scale_2)),
      );
    }
  }

  // ── Robust center + scale of the capture ──────────────────────────────
  const center0: [number, number, number] = [median(xs), median(ys), median(zs)];
  const dist = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    dist[i] = Math.hypot(xs[i] - center0[0], ys[i] - center0[1], zs[i] - center0[2]);
  }
  const medD = median(dist) || 1;

  // ── Voxel occupancy + 3×3×3 neighbourhood populations ────────────────
  const cell = medD * cellFactor;
  const keyOf = (i: number) =>
    `${Math.floor(xs[i] / cell)},${Math.floor(ys[i] / cell)},${Math.floor(zs[i] / cell)}`;
  const counts = new Map<string, number>();
  const keys = new Array<string>(N);
  for (let i = 0; i < N; i++) {
    const k = keyOf(i);
    keys[i] = k;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const nbrCache = new Map<string, number>();
  const neighborhood = (k: string): number => {
    let n = nbrCache.get(k);
    if (n !== undefined) return n;
    const [cx, cy, cz] = k.split(',').map(Number);
    n = 0;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          n += counts.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? 0;
        }
    nbrCache.set(k, n);
    return n;
  };

  // ── Floater mask (scene-level cleanup) ────────────────────────────────
  const medSize = hasScale ? median(size) : 0;
  const spikeThresh = hasScale ? spikeScaleMul * medSize : Infinity;
  const bigThresh = hasScale ? 0.5 * spikeScaleMul * medSize : Infinity;
  const isFloater = new Uint8Array(N);
  let floaters = 0;
  for (let i = 0; i < N; i++) {
    const nbr = neighborhood(keys[i]);
    const lonely = nbr < minNeighbors;
    const faintAndSparse = alpha[i] < faintAlpha && nbr < minNeighbors * 3;
    const spike = size[i] > spikeThresh || (size[i] > bigThresh && nbr < minNeighbors * 3);
    if (lonely || faintAndSparse || spike) {
      isFloater[i] = 1;
      floaters++;
    }
  }

  // ── RANSAC: dominant horizontal support plane (up ≈ ±Y in this frame) ─
  // Returns [nx,ny,nz,d] with the normal oriented "down" (+Y), or null.
  const planeEps = planeEpsFactor * medD;
  let plane: [number, number, number, number] | null = null;
  {
    const cand: number[] = [];
    for (let i = 0; i < N; i++) {
      // sample from solid, below-or-near-center points (down is +Y)
      if (!isFloater[i] && ys[i] > center0[1] - 0.3 * medD && dist[i] < 8 * medD) cand.push(i);
    }
    const S = Math.min(cand.length, 16000);
    // deterministic LCG so cleanup is reproducible
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pick = () => cand[Math.floor(rnd() * cand.length)];
    let bestScore = 0;
    let best: [number, number, number, number] | null = null;
    if (cand.length > 300) {
      for (let it = 0; it < 400; it++) {
        const a = pick(), b = pick(), c = pick();
        const ax = xs[a], ay = ys[a], az = zs[a];
        let ux = xs[b] - ax, uy = ys[b] - ay, uz = zs[b] - az;
        let vx = xs[c] - ax, vy = ys[c] - ay, vz = zs[c] - az;
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz);
        if (len < 1e-9) continue;
        nx /= len; ny /= len; nz /= len;
        if (Math.abs(ny) < 0.85) continue; // not horizontal
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; } // orient down (+Y)
        const d = nx * ax + ny * ay + nz * az;
        let inl = 0;
        let ySum = 0;
        for (let s = 0; s < S; s++) {
          const p = cand[(s * 2654435761) % cand.length];
          const dd = nx * xs[p] + ny * ys[p] + nz * zs[p] - d;
          if (Math.abs(dd) < planeEps) { inl++; ySum += ys[p]; }
        }
        if (inl < S * 0.02) continue;
        // prefer the plane closest below the subject (table over far floor)
        const planeY = ySum / inl;
        const dy = Math.max(0, (planeY - center0[1]) / medD);
        const score = inl / (1 + dy);
        if (score > bestScore) { bestScore = score; best = [nx, ny, nz, d]; }
      }
    }
    plane = best;
  }
  const planeFound = plane !== null;
  const aboveness = (i: number): number =>
    plane ? plane[0] * xs[i] + plane[1] * ys[i] + plane[2] * zs[i] - plane[3] : -1;
  // aboveness < 0 = above the plane (subject side); > 0 = below (under the table)

  // ── Subject candidates: solid, above the plane, not absurdly far ─────
  const candMask = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (isFloater[i]) continue;
    if (dist[i] > 6 * medD) continue;
    if (planeFound && aboveness(i) > -0.6 * planeEps) continue; // on/below plane
    candMask[i] = 1;
  }

  // ── Connected components over candidate voxels; keep the center one ──
  const occ = new Map<string, number>(); // cell -> candidate count
  for (let i = 0; i < N; i++) {
    if (candMask[i]) occ.set(keys[i], (occ.get(keys[i]) ?? 0) + 1);
  }
  // seed = densest candidate cell near the robust center
  let seedKey: string | null = null;
  {
    let bestC = 0;
    for (const [k, c] of occ) {
      const [cx, cy, cz] = k.split(',').map(Number);
      const px = (cx + 0.5) * cell, py = (cy + 0.5) * cell, pz = (cz + 0.5) * cell;
      const d = Math.hypot(px - center0[0], py - center0[1], pz - center0[2]);
      if (d < 1.5 * medD && c > bestC) { bestC = c; seedKey = k; }
    }
    if (!seedKey) for (const [k, c] of occ) if (c > bestC) { bestC = c; seedKey = k; }
  }
  const inComp = new Set<string>();
  if (seedKey) {
    const queue = [seedKey];
    inComp.add(seedKey);
    while (queue.length) {
      const k = queue.pop()!;
      const [cx, cy, cz] = k.split(',').map(Number);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            if (!dx && !dy && !dz) continue;
            const nk = `${cx + dx},${cy + dy},${cz + dz}`;
            if (!inComp.has(nk) && occ.has(nk)) { inComp.add(nk); queue.push(nk); }
          }
    }
  }
  // dilate by one cell so soft edge splats survive
  const dilated = new Set<string>(inComp);
  for (const k of inComp) {
    const [cx, cy, cz] = k.split(',').map(Number);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) dilated.add(`${cx + dx},${cy + dy},${cz + dz}`);
  }

  const subjectIdx: number[] = [];
  const sceneIdx: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!isFloater[i]) sceneIdx.push(i);
    if (candMask[i] && dilated.has(keys[i])) subjectIdx.push(i);
  }
  // degenerate fallback: if the component collapsed, isolate by distance only
  if (subjectIdx.length < Math.max(500, N * 0.02)) {
    subjectIdx.length = 0;
    for (let i = 0; i < N; i++) {
      if (!isFloater[i] && dist[i] < 3 * medD) subjectIdx.push(i);
    }
  }

  // ── Shared transform: center on subject, normalize to ~unit radius ───
  const c: [number, number, number] = [
    median(subjectIdx.map((i) => xs[i])),
    median(subjectIdx.map((i) => ys[i])),
    median(subjectIdx.map((i) => zs[i])),
  ];
  const subjDists = subjectIdx
    .map((i) => Math.hypot(xs[i] - c[0], ys[i] - c[1], zs[i] - c[2]))
    .sort((a, b) => a - b);
  const radius = percentile(subjDists, framePercentile) || medD;
  const norm = 1 / radius;
  const lnNorm = Math.log(norm);

  // ── Write SH-stripped, transformed outputs ────────────────────────────
  const keep = KEEP_PROPS.filter((p) => p in offset);
  const scaleSet = new Set(['scale_0', 'scale_1', 'scale_2']);
  const outStride = keep.length * 4;

  const writePly = async (path: string, indices: number[]) => {
    const headerText =
      'ply\nformat binary_little_endian 1.0\n' +
      `element vertex ${indices.length}\n` +
      keep.map((p) => `property float ${p}`).join('\n') +
      '\nend_header\n';
    const headerBuf = Buffer.from(headerText, 'latin1');
    const out = Buffer.alloc(headerBuf.length + indices.length * outStride);
    headerBuf.copy(out, 0);
    let o = headerBuf.length;
    for (const i of indices) {
      const b = dataStart + i * stride;
      for (const p of keep) {
        let v = buf.readFloatLE(b + offset[p]);
        if (p === 'x') v = (v - c[0]) * norm;
        else if (p === 'y') v = (v - c[1]) * norm;
        else if (p === 'z') v = (v - c[2]) * norm;
        else if (scaleSet.has(p)) v = v + lnNorm;
        out.writeFloatLE(v, o);
        o += 4;
      }
    }
    await writeFile(path, out);
  };

  await writePly(subjectPath, subjectIdx);
  if (scenePath) await writePly(scenePath, sceneIdx);

  const { size: cleanBytes } = await stat(subjectPath);
  return {
    center: c,
    radius,
    total: N,
    subjectKept: subjectIdx.length,
    sceneKept: sceneIdx.length,
    floaters,
    planeFound,
    cleanBytes,
  };
}
