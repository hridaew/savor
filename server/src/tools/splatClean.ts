import { readFile, writeFile, stat } from 'node:fs/promises';

/**
 * Post-process a Brush gaussian-splat .ply into ONE cleaned scene:
 * the subject intact in its environment, with floaters removed.
 *
 * Two scale-aware cleanup passes, both conservative about surfaces:
 *
 *  1. Global floater pass — every splat is tested at its own scale: it needs
 *     neighbours of comparable-or-larger size within a 3×3×3 voxel
 *     neighbourhood whose voxel edge matches its own footprint. Gaussians
 *     live at wildly different scales (a museum wall may be a handful of
 *     splats the size of the whole capture, the subject's surface thousands
 *     of millimetre-sized ones); judging both against one fixed grid deletes
 *     the environment. Splats on dense surfaces are never removed, no matter
 *     how faint — faint splats layered on a surface are what make it look
 *     solid. Giant thread-like "needles" are also removed.
 *
 *  2. Orbit-interior haze pass — the capture video physically swept the air
 *     between the subject's surface and the camera orbit, so anything
 *     hanging in that region without solid support is reconstruction haze:
 *     small splats need double the usual neighbour support there, faint ones
 *     triple, large ones must not be near-alone, and giant ones don't belong
 *     there at all. Fog also arrives as coherent CLUMPS that pass every
 *     loneliness test (populous but collectively faint), so splats in the
 *     zone additionally need real opacity mass around them: the summed
 *     neighbour alpha at their own scale must clear a floor that any true
 *     surface beats by an order of magnitude. The same opacity-mass test
 *     (plus a faintness requirement) runs BELOW the support plane too — but
 *     only clearly beneath the surface layer, where fog hangs between table
 *     level and floor; the plane's own surface layer stays untouchable.
 *     Space outside the orbit (the environment) is left exactly as trained.
 *
 * The subject's center and extent are still estimated — for recentering,
 * ~unit-radius normalization (so the viewer's fixed framing works), and the
 * orbit camera hints — but they are MEASUREMENT ONLY: nothing inside the
 * subject's extent is ever deleted. `orbitRadius`, measured from the COLMAP
 * camera centers, tells the viewer where the capture orbit was.
 *
 * The fast output is rewritten with SH bands stripped (14 float props
 * instead of 59 — cutting files by ~76%); the optional HQ output keeps all
 * float attributes for beauty-first rendering.
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

/** Fast-view props (SH rest bands dropped; all float32 in Brush plys). */
const KEEP_PROPS_FAST = [
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
  /** Haze zone when camera positions are unknown, × subject radius. */
  nearFieldMul?: number;
  /** Haze pass: alpha below which an interior splat needs 3× neighbour support. */
  hazeAlpha?: number;
  /** Haze pass: small interior splats need this × minNeighbors support. */
  hazeSupportMul?: number;
  /**
   * Haze pass: minimum summed neighbour alpha (own-scale neighbourhood) for
   * interior splats. Fog clumps measure in the tens; real surfaces in the
   * hundreds-to-thousands (MightyHand fog p90 ≈ 70 vs subject p10 ≈ 150,
   * museum floor p5 ≈ 380).
   */
  hazeClumpAlphaSupport?: number;
  /** COLMAP camera centers (raw splat coordinates); enables orbit-aware cleanup. */
  cameraCenters?: [number, number, number][];
  /** Optional high-fidelity scene output that keeps full SH properties. */
  sceneHqPath?: string;
}

export interface CleanResult {
  center: [number, number, number];
  radius: number;
  total: number;
  sceneKept: number;
  floaters: number;
  hazeRemoved: number;
  planeFound: boolean;
  sceneBytes: number;
  sceneBytesHq?: number;
  /** Median capture-camera distance from the subject, in normalized (output) units. 0 if unknown. */
  orbitRadius: number;
  /** Median capture-camera height (normalized y, negative = above the subject). 0 if unknown. */
  orbitHeight: number;
  /**
   * Cameras sit inside the splat's own extent: an inside-out capture of a
   * space, not an orbit around an object. The viewer should look around from
   * the capture position instead of orbiting.
   */
  isEnvironment: boolean;
  /** Median capture-camera position in normalized (output) space, if cameras are known. */
  camPos?: [number, number, number];
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
  scenePath: string,
  opts: CleanOptions = {},
): Promise<CleanResult> {
  const cellFactor = opts.cellFactor ?? 0.1;
  const minNeighbors = opts.minNeighbors ?? 4;
  const faintAlpha = opts.faintAlpha ?? 0.04;
  const spikeScaleMul = opts.spikeScaleMul ?? 8;
  const planeEpsFactor = opts.planeEpsFactor ?? 0.04;
  const framePercentile = opts.framePercentile ?? 0.92;
  const nearFieldMul = opts.nearFieldMul ?? 2.2;
  const hazeAlpha = opts.hazeAlpha ?? 0.08;
  const hazeSupportMul = opts.hazeSupportMul ?? 2;
  const hazeClumpAlphaSupport = opts.hazeClumpAlphaSupport ?? 100;

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
  const gridsA: Map<number, number>[] = []; // alpha mass per voxel
  for (let L = 0; L <= MAXL; L++) {
    grids.push(new Map());
    gridsA.push(new Map());
  }
  for (let i = 0; i < N; i++) {
    for (let L = 0; L <= MAXL; L++) {
      if (levelOf[i] >= L - 2) {
        const k = keyAt(i, L);
        const g = grids[L];
        g.set(k, (g.get(k) ?? 0) + 1);
        const ga = gridsA[L];
        ga.set(k, (ga.get(k) ?? 0) + alpha[i]);
      }
    }
  }

  const sumNeighborhood = (maps: Map<number, number>[], i: number, cache: Map<number, number>[]): number => {
    const L = levelOf[i];
    const k = keyAt(i, L);
    const cached = cache[L].get(k);
    if (cached !== undefined) return cached;
    const g = maps[L];
    let n = 0;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          n += g.get(k + (dx * KDIM + dy) * KDIM + dz) ?? 0;
        }
    cache[L].set(k, n);
    return n;
  };
  const supCache: Map<number, number>[] = grids.map(() => new Map());
  /** Comparable-or-larger neighbours within 3×3×3 own-level voxels (self excluded). */
  const support = (i: number): number => sumNeighborhood(grids, i, supCache) - 1;
  const asupCache: Map<number, number>[] = gridsA.map(() => new Map());
  /** Summed neighbour alpha in the same neighbourhood (self excluded). */
  const alphaSupport = (i: number): number => sumNeighborhood(gridsA, i, asupCache) - alpha[i];

  // ── Floater mask (global cleanup) ─────────────────────────────────────
  // Small splats (≤ ~4 cells) need a few peers; big splats only need to not
  // be utterly alone at their own scale. Faintness alone never kills a splat
  // with surface support. Needles are giant thread-like artifacts.
  const medSize = hasScale ? median(size) : 0;
  const needleSize = hasScale ? spikeScaleMul * medSize : Infinity;
  const isFloater = new Uint8Array(N);
  let floaters = 0;
  for (let i = 0; i < N; i++) {
    const sup = support(i);
    const small = levelOf[i] <= 2;
    const lonely = sup < (small ? minNeighbors : 1);
    const faintAndSparse = small && alpha[i] < faintAlpha && sup < minNeighbors * 3;
    const needle = size[i] > needleSize && sizeMid[i] < size[i] / 25;
    if (lonely || faintAndSparse || needle) {
      isFloater[i] = 1;
      floaters++;
    }
  }

  // ── RANSAC: dominant horizontal support plane (up ≈ ±Y in this frame) ─
  // Advisory only: tells the haze pass what counts as "in the air" vs "on
  // the table". Returns [nx,ny,nz,d] with the normal oriented "down" (+Y).
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
        const a = pick(), b = pick(), c2 = pick();
        const ax = xs[a], ay = ys[a], az = zs[a];
        let ux = xs[b] - ax, uy = ys[b] - ay, uz = zs[b] - az;
        let vx = xs[c2] - ax, vy = ys[c2] - ay, vz = zs[c2] - az;
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
  // aboveness < 0 = above the plane (in the air); > 0 = at/below the surface
  const planeCut = -0.35 * planeEps;

  // ── Subject center + extent — MEASUREMENT ONLY, never deletes splats ──
  // Solid subject-scale splats near the robust center, above the support
  // plane if one was found; their median is the pivot, their spread the
  // framing radius.
  const est: number[] = [];
  for (let i = 0; i < N; i++) {
    if (isFloater[i]) continue;
    if (size[i] > subjectCap) continue;
    if (dist[i] > 1.5 * medD) continue;
    if (planeFound && aboveness(i) > planeCut) continue; // at/below the table
    est.push(i);
  }
  const pool = est.length > 500 ? est : Array.from({ length: N }, (_, i) => i);
  const c: [number, number, number] = [
    median(pool.map((i) => xs[i])),
    median(pool.map((i) => ys[i])),
    median(pool.map((i) => zs[i])),
  ];
  const subjDists = pool
    .map((i) => Math.hypot(xs[i] - c[0], ys[i] - c[1], zs[i] - c[2]))
    .sort((a, b) => a - b);
  const radius = percentile(subjDists, framePercentile) || medD;
  const norm = 1 / radius;
  const lnNorm = Math.log(norm);

  // ── Capture orbit (camera centers → viewer camera hints) ─────────────
  let orbitRaw = 0;
  let orbitHeightRaw = 0;
  let camPos: [number, number, number] | undefined;
  if (opts.cameraCenters?.length) {
    const ds = opts.cameraCenters
      .map(([px, py, pz]) => Math.hypot(px - c[0], py - c[1], pz - c[2]))
      .sort((a, b) => a - b);
    orbitRaw = ds[ds.length >> 1];
    const hs = opts.cameraCenters.map(([, py]) => py - c[1]).sort((a, b) => a - b);
    orbitHeightRaw = hs[hs.length >> 1];
    const medOf = (pick: (p: [number, number, number]) => number) => {
      const s = opts.cameraCenters!.map(pick).sort((a, b) => a - b);
      return s[s.length >> 1];
    };
    camPos = [
      (medOf((p) => p[0]) - c[0]) * norm,
      (medOf((p) => p[1]) - c[1]) * norm,
      (medOf((p) => p[2]) - c[2]) * norm,
    ];
  }
  // Cameras inside the splat's own extent = inside-out capture of a space.
  const isEnvironment = orbitRaw > 0 && orbitRaw < 1.05 * radius;

  // ── Orbit-interior haze pass ──────────────────────────────────────────
  // The camera physically swept the air between the subject's surface and
  // the orbit path. Anything hanging there without solid support is haze:
  // small splats need double the usual neighbours, faint ones triple, big
  // ones must not be near-alone, and giant ones don't belong there at all.
  // Fog also arrives as coherent clumps that pass every loneliness test
  // (populous but collectively faint) — those are caught by opacity mass:
  // real surfaces carry hundreds of summed neighbour alpha, fog tens.
  // Below the support plane only unmistakable fog is taken (faint AND
  // weak), and never from the plane's own surface layer.
  // Environment captures skip it: its geometry assumes cameras outside the
  // subject — inside a room it would eat the furniture.
  const hazeR = orbitRaw > 0 ? 0.9 * orbitRaw : nearFieldMul * radius;
  const isHaze = new Uint8Array(N);
  let hazeRemoved = 0;
  if (!isEnvironment) {
    for (let i = 0; i < N; i++) {
      if (isFloater[i]) continue;
      const d = Math.hypot(xs[i] - c[0], ys[i] - c[1], zs[i] - c[2]);
      if (d < 1.3 * radius || d > hazeR) continue; // subject core / far field
      const ab = planeFound ? aboveness(i) : -Infinity;
      if (planeFound && ab > planeCut && ab <= 4 * planeEps) continue; // table surface layer
      const asup = alphaSupport(i);
      if (planeFound && ab > 4 * planeEps) {
        // Deep below the plane (between table level and floor).
        if (asup < hazeClumpAlphaSupport && alpha[i] < 0.3) {
          isHaze[i] = 1;
          hazeRemoved++;
        }
        continue;
      }
      const sup = support(i);
      const giant = size[i] > subjectCap;
      const weakSmall = levelOf[i] <= 2 && sup < hazeSupportMul * minNeighbors;
      const faint = alpha[i] < hazeAlpha && sup < 3 * minNeighbors;
      const bigLonely = levelOf[i] > 2 && sup < 2;
      const weakClump = asup < hazeClumpAlphaSupport;
      if (giant || weakSmall || faint || bigLonely || weakClump) {
        isHaze[i] = 1;
        hazeRemoved++;
      }
    }
  }

  const sceneIdx: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!isFloater[i] && !isHaze[i]) sceneIdx.push(i);
  }

  // ── Write transformed outputs ─────────────────────────────────────────
  // Shared transform: center on subject, normalize to ~unit radius. Fast
  // output strips SH rest for size/load speed. HQ output keeps all float32
  // attributes (including SH) for beauty-first rendering.
  const keepFast = KEEP_PROPS_FAST.filter((p) => p in offset);
  const keepHq = h.props
    .filter((p) => p.type === 'float' || p.type === 'float32')
    .map((p) => p.name)
    .filter((p) => p in offset);
  const scaleSet = new Set(['scale_0', 'scale_1', 'scale_2']);

  const writePly = async (path: string, indices: number[], keep: string[]) => {
    const outStride = keep.length * 4;
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

  await writePly(scenePath, sceneIdx, keepFast);
  if (opts.sceneHqPath) await writePly(opts.sceneHqPath, sceneIdx, keepHq);

  const { size: sceneBytes } = await stat(scenePath);
  const sceneBytesHq = opts.sceneHqPath ? (await stat(opts.sceneHqPath)).size : undefined;
  return {
    center: c,
    radius,
    total: N,
    sceneKept: sceneIdx.length,
    floaters,
    hazeRemoved,
    planeFound,
    sceneBytes,
    sceneBytesHq,
    orbitRadius: orbitRaw / radius,
    orbitHeight: orbitHeightRaw / radius,
    isEnvironment,
    camPos,
  };
}
