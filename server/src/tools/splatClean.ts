import { readFile, writeFile, stat } from 'node:fs/promises';

/**
 * Post-process a Brush gaussian-splat .ply into two aligned views:
 *
 *  Subject (`subjectPath`) — the object, isolated and solid:
 *    1. RANSAC-fit the dominant horizontal support plane (table/floor) and cut
 *       it away, severing the subject from its surroundings,
 *    2. flood-fill voxel connected-components over solid candidate splats and
 *       keep the component under the robust center — walls/pedestal remnants
 *       fall away as disconnected islands,
 *    3. re-admit EVERY splat whose cell lies in (or one voxel around) that
 *       component — including faint low-alpha ones — so surfaces stay opaque
 *       and edges stay soft. Only the plane cut and a size cap still apply.
 *
 *  Scene (`scenePath`) — the subject in its environment, kept exactly as
 *    trained. An orbit capture's background only looks right from near the
 *    original camera path (elsewhere its giant impressionistic gaussians
 *    smear across the lens), so rather than reshaping geometry the viewer
 *    places the Scene camera on that path — `orbitRadius` in the result,
 *    measured from the COLMAP camera centers, tells it where. The only splats
 *    dropped here (besides floaters) are big mid-air blobs hanging above the
 *    support plane *inside* the camera orbit: space the video itself proves
 *    empty.
 *
 *  Floater detection is *scale-aware*. Gaussians live at wildly different
 *  scales: a museum wall may be a handful of splats each the size of the whole
 *  capture, while the subject's surface is thousands of millimetre-sized ones.
 *  Judging both against one fixed voxel grid deletes the environment — giant
 *  splats are always "lonely" at surface scale. Instead each splat is tested
 *  at its own scale: it needs neighbours of comparable-or-larger size within a
 *  3×3×3 voxel neighbourhood whose voxel edge matches its own footprint.
 *  Splats on dense surfaces are never removed, no matter how faint — faint
 *  splats layered on a surface are what make it look solid.
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
  /** Base voxel size as a fraction of the median center-distance. */
  cellFactor?: number;
  /** Scaled-neighbourhood population below which a small splat is "lonely". */
  minNeighbors?: number;
  /** Alpha below which a small splat must ALSO be near-lonely to be dropped. */
  faintAlpha?: number;
  /** Needle spikes: max-scale above this × median size with a thin cross-section. */
  spikeScaleMul?: number;
  /** RANSAC plane inlier thickness as a fraction of median distance. */
  planeEpsFactor?: number;
  /** Subject radius = this percentile of subject distances (for normalization). */
  framePercentile?: number;
  /** Scene: haze-removal zone when camera positions are unknown, × subject radius. */
  nearFieldMul?: number;
  /** COLMAP camera centers (raw splat coordinates); enables orbit-aware cleanup. */
  cameraCenters?: [number, number, number][];
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
  /** Median capture-camera distance from the subject, in normalized (output) units. 0 if unknown. */
  orbitRadius: number;
  /** Median capture-camera height (normalized y, negative = above the subject). 0 if unknown. */
  orbitHeight: number;
}

/** Grid levels: level L voxel edge = cell × 2^L. Level 7 ≈ 12.8 × medD. */
const MAXL = 7;
/** Pack integer voxel coords into one number key (fast Map lookups). */
const KDIM = 2048;
const KHALF = 1024;
function vkey(cx: number, cy: number, cz: number): number {
  const x = Math.max(-KHALF + 1, Math.min(KHALF - 1, cx)) + KHALF;
  const y = Math.max(-KHALF + 1, Math.min(KHALF - 1, cy)) + KHALF;
  const z = Math.max(-KHALF + 1, Math.min(KHALF - 1, cz)) + KHALF;
  return (x * KDIM + y) * KDIM + z;
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
  const nearFieldMul = opts.nearFieldMul ?? 2.2;

  const buf = await readFile(rawPath);
  const h = parseHeader(buf);
  const { offset, stride, dataStart, count: N } = h;
  for (const k of ['x', 'y', 'z', 'opacity']) {
    if (!(k in offset)) throw new Error(`PLY missing property "${k}"`);
  }
  const hasScale = 'scale_0' in offset && 'scale_1' in offset && 'scale_2' in offset;

  // ── Read positions / alpha / size (max + mid extent) ──────────────────
  const xs = new Float64Array(N);
  const ys = new Float64Array(N);
  const zs = new Float64Array(N);
  const alpha = new Float64Array(N);
  const size = new Float64Array(N); // largest extent
  const sizeMid = new Float64Array(N); // middle extent (needle detection)
  for (let i = 0; i < N; i++) {
    const b = dataStart + i * stride;
    xs[i] = buf.readFloatLE(b + offset.x);
    ys[i] = buf.readFloatLE(b + offset.y);
    zs[i] = buf.readFloatLE(b + offset.z);
    alpha[i] = 1 / (1 + Math.exp(-buf.readFloatLE(b + offset.opacity)));
    if (hasScale) {
      const s0 = Math.exp(buf.readFloatLE(b + offset.scale_0));
      const s1 = Math.exp(buf.readFloatLE(b + offset.scale_1));
      const s2 = Math.exp(buf.readFloatLE(b + offset.scale_2));
      size[i] = Math.max(s0, s1, s2);
      sizeMid[i] = s0 + s1 + s2 - Math.max(s0, s1, s2) - Math.min(s0, s1, s2);
    }
  }

  // ── Robust center + scale of the capture ──────────────────────────────
  const center0: [number, number, number] = [median(xs), median(ys), median(zs)];
  const dist = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    dist[i] = Math.hypot(xs[i] - center0[0], ys[i] - center0[1], zs[i] - center0[2]);
  }
  const medD = median(dist) || 1;

  // ── Multi-scale voxel grids ───────────────────────────────────────────
  // grids[L] counts, per level-L voxel, the splats of comparable-or-larger
  // size (their own level ≥ L−2, i.e. within ~4× smaller). A splat's support
  // is then read from the grid matching its own footprint.
  const cell = medD * cellFactor;
  const levelOf = new Uint8Array(N);
  if (hasScale) {
    for (let i = 0; i < N; i++) {
      const l = Math.round(Math.log2(Math.max(size[i], cell) / cell));
      levelOf[i] = l < 0 ? 0 : l > MAXL ? MAXL : l;
    }
  }
  const cellAt = new Float64Array(MAXL + 1);
  for (let L = 0; L <= MAXL; L++) cellAt[L] = cell * 2 ** L;
  const keyAt = (i: number, L: number) =>
    vkey(Math.floor(xs[i] / cellAt[L]), Math.floor(ys[i] / cellAt[L]), Math.floor(zs[i] / cellAt[L]));

  const grids: Map<number, number>[] = [];
  for (let L = 0; L <= MAXL; L++) grids.push(new Map());
  for (let i = 0; i < N; i++) {
    for (let L = 0; L <= MAXL; L++) {
      if (levelOf[i] >= L - 2) {
        const g = grids[L];
        const k = keyAt(i, L);
        g.set(k, (g.get(k) ?? 0) + 1);
      }
    }
  }

  const supCache: Map<number, number>[] = grids.map(() => new Map());
  const support = (i: number): number => {
    const L = levelOf[i];
    const k = keyAt(i, L);
    const cached = supCache[L].get(k);
    if (cached !== undefined) return cached - 1;
    const g = grids[L];
    let n = 0;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          n += g.get(k + (dx * KDIM + dy) * KDIM + dz) ?? 0;
        }
    supCache[L].set(k, n);
    return n - 1; // exclude self
  };

  // Level-0 keys drive the connected-component pass below.
  const keys = new Float64Array(N);
  for (let i = 0; i < N; i++) keys[i] = keyAt(i, 0);

  // ── Floater mask (scene-level cleanup) ────────────────────────────────
  // Small splats (≤ ~4 cells) need a few peers; big splats only need to not
  // be utterly alone at their own scale. Faintness alone never kills a splat
  // with surface support. Needles are giant thread-like artifacts.
  const medSize = hasScale ? median(size) : 0;
  const needleSize = hasScale ? spikeScaleMul * medSize : Infinity;
  const isFloater = new Uint8Array(N);
  const isNeedle = new Uint8Array(N);
  let floaters = 0;
  for (let i = 0; i < N; i++) {
    const sup = support(i);
    const small = levelOf[i] <= 2;
    const lonely = sup < (small ? minNeighbors : 1);
    const faintAndSparse = small && alpha[i] < faintAlpha && sup < minNeighbors * 3;
    const needle = size[i] > needleSize && sizeMid[i] < size[i] / 25;
    if (needle) isNeedle[i] = 1;
    if (lonely || faintAndSparse || needle) {
      isFloater[i] = 1;
      floaters++;
    }
  }

  // ── RANSAC: dominant horizontal support plane (up ≈ ±Y in this frame) ─
  // Returns [nx,ny,nz,d] with the normal oriented "down" (+Y), or null.
  const planeEps = planeEpsFactor * medD;
  const subjectCap = 0.5 * medD; // splats bigger than this are environment
  let plane: [number, number, number, number] | null = null;
  {
    const cand: number[] = [];
    for (let i = 0; i < N; i++) {
      // sample from solid, subject-scale, below-or-near-center points (down is +Y)
      if (!isFloater[i] && size[i] < subjectCap && ys[i] > center0[1] - 0.3 * medD && dist[i] < 8 * medD)
        cand.push(i);
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
        // Prefer the plane closest below the subject (table over far floor).
        // The penalty must be strong: at high splat densities a distant floor
        // can out-inlier the tabletop several times over.
        const planeY = ySum / inl;
        const dy = Math.max(0, (planeY - center0[1]) / medD);
        const score = inl / (1 + 3 * dy * dy);
        if (score > bestScore) { bestScore = score; best = [nx, ny, nz, d]; }
      }
    }
    plane = best;
  }
  const planeFound = plane !== null;
  const aboveness = (i: number): number =>
    plane ? plane[0] * xs[i] + plane[1] * ys[i] + plane[2] * zs[i] - plane[3] : -1;
  // aboveness < 0 = above the plane (subject side); > 0 = below (under the table)
  // Gentle cut: deep enough to sever the table, shallow enough to keep the base.
  const planeCut = -0.35 * planeEps;
  const passesPlaneCut = (i: number) => !planeFound || aboveness(i) < planeCut;
  // Splats between planeCut and bandTop hug the table surface. At high splat
  // densities the tabletop's upper crust lives in this band, so letting it
  // into the connected component would carry the component across the whole
  // table (and to whatever sits on its far edge). The band is excluded from
  // component growth and re-admitted later, footprint-limited.
  const bandTop = -2.5 * planeEps;

  // ── Subject candidates: solid, subject-scale, clearly above the plane ─
  const candMask = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (isFloater[i]) continue;
    if (dist[i] > 6 * medD) continue;
    if (size[i] > subjectCap) continue;
    if (planeFound ? aboveness(i) > bandTop : false) continue;
    candMask[i] = 1;
  }

  // ── Connected components over candidate voxels; keep the center one ──
  const occ = new Map<number, number>(); // level-0 cell -> candidate count
  for (let i = 0; i < N; i++) {
    if (candMask[i]) occ.set(keys[i], (occ.get(keys[i]) ?? 0) + 1);
  }
  // seed = densest candidate cell near the robust center
  let seedKey: number | null = null;
  {
    let bestC = 0;
    for (const [k, cnt] of occ) {
      const cx = Math.floor(k / (KDIM * KDIM)) - KHALF;
      const cy = (Math.floor(k / KDIM) % KDIM) - KHALF;
      const cz = (k % KDIM) - KHALF;
      const px = (cx + 0.5) * cell, py = (cy + 0.5) * cell, pz = (cz + 0.5) * cell;
      const d = Math.hypot(px - center0[0], py - center0[1], pz - center0[2]);
      if (d < 1.5 * medD && cnt > bestC) { bestC = cnt; seedKey = k; }
    }
    if (seedKey === null) for (const [k, cnt] of occ) if (cnt > bestC) { bestC = cnt; seedKey = k; }
  }
  const inComp = new Set<number>();
  if (seedKey !== null) {
    const queue = [seedKey];
    inComp.add(seedKey);
    while (queue.length) {
      const k = queue.pop()!;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            if (!dx && !dy && !dz) continue;
            const nk = k + (dx * KDIM + dy) * KDIM + dz;
            if (!inComp.has(nk) && occ.has(nk)) { inComp.add(nk); queue.push(nk); }
          }
    }
  }
  // dilate by one cell so soft edge splats (excluded from candidates) survive
  const dilated = new Set<number>(inComp);
  for (const k of inComp) {
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) dilated.add(k + (dx * KDIM + dy) * KDIM + dz);
  }

  // ── Membership ────────────────────────────────────────────────────────
  // Subject: EVERY splat inside the (dilated) component volume — faint and
  // "lonely" ones included, they're what keeps surfaces opaque — subject to
  // the plane cut and the size cap. Near the plane one more guard applies:
  // the table's surface is thicker than the cut at high splat densities, so
  // its upper crust stays "above the plane" and rides the component out to
  // the table edge. Splats in that near-plane band must lie within the
  // footprint of the part of the subject that is clearly above the table.
  const inSubject = new Uint8Array(N);
  const subjectIdx: number[] = [];
  const sceneIdx: number[] = [];
  const isMember = (i: number) =>
    dilated.has(keys[i]) && passesPlaneCut(i) && size[i] <= subjectCap && !isNeedle[i];
  let footX = 0, footZ = 0, footR = Infinity;
  if (planeFound) {
    // footprint of the clearly-above-table part (plane is near-horizontal,
    // so x/z are a fine proxy for in-plane position)
    const coreX: number[] = [];
    const coreZ: number[] = [];
    for (let i = 0; i < N; i++) {
      if (isMember(i) && aboveness(i) <= bandTop) {
        coreX.push(xs[i]);
        coreZ.push(zs[i]);
      }
    }
    if (coreX.length > 200) {
      footX = median(coreX);
      footZ = median(coreZ);
      const rs = coreX.map((x, k) => Math.hypot(x - footX, coreZ[k] - footZ)).sort((a, b) => a - b);
      const r90 = percentile(rs, 0.9);
      footR = 1.25 * r90 + 2 * planeEps;
    }
  }
  for (let i = 0; i < N; i++) {
    if (!isMember(i)) continue;
    if (planeFound && aboveness(i) > bandTop && footR < Infinity) {
      // near-plane band: inside the subject's footprint only
      if (Math.hypot(xs[i] - footX, zs[i] - footZ) > footR) continue;
    }
    inSubject[i] = 1;
    subjectIdx.push(i);
  }
  // degenerate fallback: if the component collapsed, isolate by distance only
  if (subjectIdx.length < Math.max(500, N * 0.02)) {
    subjectIdx.length = 0;
    inSubject.fill(0);
    for (let i = 0; i < N; i++) {
      if (!isFloater[i] && dist[i] < 3 * medD && size[i] <= subjectCap && passesPlaneCut(i)) {
        inSubject[i] = 1;
        subjectIdx.push(i);
      }
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

  // ── Scene membership ──────────────────────────────────────────────────
  // The environment is kept exactly as Brush trained it — the viewer handles
  // the rest by orbiting where the capture cameras were (see orbitRadius).
  // The only extra cleanup: big splats hanging above the support plane inside
  // the camera orbit that aren't the subject. The video flew through that
  // space, so anything solid there is reconstruction haze, not environment.
  let orbitRaw = 0;
  let orbitHeightRaw = 0;
  if (opts.cameraCenters?.length) {
    const ds = opts.cameraCenters
      .map(([px, py, pz]) => Math.hypot(px - c[0], py - c[1], pz - c[2]))
      .sort((a, b) => a - b);
    orbitRaw = ds[ds.length >> 1];
    const hs = opts.cameraCenters.map(([, py]) => py - c[1]).sort((a, b) => a - b);
    orbitHeightRaw = hs[hs.length >> 1];
  }
  const hazeR = orbitRaw > 0 ? 0.95 * orbitRaw : nearFieldMul * radius;
  for (let i = 0; i < N; i++) {
    if (isFloater[i] && !inSubject[i]) continue;
    if (!inSubject[i] && planeFound && size[i] > subjectCap && aboveness(i) < planeCut) {
      const dSub = Math.hypot(xs[i] - c[0], ys[i] - c[1], zs[i] - c[2]);
      if (dSub < hazeR) continue;
    }
    sceneIdx.push(i);
  }

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
    orbitRadius: orbitRaw / radius,
    orbitHeight: orbitHeightRaw / radius,
  };
}
