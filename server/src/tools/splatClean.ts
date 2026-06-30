import { readFile, writeFile, stat } from 'node:fs/promises';

/**
 * Post-process a Brush gaussian-splat .ply:
 *  - find the subject via a robust (median) center,
 *  - drop stray "floater" gaussians (far from the subject, or near-transparent),
 *  - recenter the subject to the origin and normalize scale to ~unit radius,
 *    so the viewer can orbit + frame every splat consistently.
 *
 * Produces two aligned outputs (same center + scale):
 *  - cleanPath: just the subject (default view)
 *  - scenePath: the full capture incl. environment (optional "Scene" view)
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
  text: string;
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
  return { props, offset, stride: off, count, dataStart, text };
}

function median(arr: Float64Array): number {
  const a = Array.from(arr).sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export interface CleanOptions {
  distMul?: number; // keep gaussians within distMul × median distance
  minAlpha?: number; // drop gaussians fainter than this (0..1)
  minDensity?: number; // drop points whose voxel has fewer than this many points
  cellFactor?: number; // voxel size as a fraction of the median distance
  scaleMul?: number; // drop gaussians larger than scaleMul × median size (spikes)
  framePercentile?: number; // subject radius = this percentile of kept distances
  targetRadius?: number; // normalize subject to this radius
}

export interface CleanResult {
  center: [number, number, number];
  radius: number;
  kept: number;
  total: number;
  cleanBytes: number;
}

export async function cleanSplat(
  rawPath: string,
  cleanPath: string,
  scenePath: string,
  opts: CleanOptions = {},
): Promise<CleanResult> {
  const distMul = opts.distMul ?? 4.5;
  const minAlpha = opts.minAlpha ?? 0.03;
  const framePercentile = opts.framePercentile ?? 0.9;
  const targetRadius = opts.targetRadius ?? 1;

  const buf = await readFile(rawPath);
  const h = parseHeader(buf);
  const { offset, stride, dataStart, count: N } = h;
  for (const k of ['x', 'y', 'z', 'opacity']) {
    if (!(k in offset)) throw new Error(`PLY missing property "${k}"`);
  }

  const xs = new Float64Array(N);
  const ys = new Float64Array(N);
  const zs = new Float64Array(N);
  const alpha = new Float64Array(N);
  const maxScale = new Float64Array(N);
  const hasScale = 'scale_0' in offset && 'scale_1' in offset && 'scale_2' in offset;
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
      maxScale[i] = Math.max(s0, s1, s2);
    }
  }

  const center: [number, number, number] = [median(xs), median(ys), median(zs)];
  const dist = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    dist[i] = Math.hypot(xs[i] - center[0], ys[i] - center[1], zs[i] - center[2]);
  }
  const medD = median(dist) || 1;
  const distThresh = distMul * medD;

  // Voxel density: scattered floaters/streaks live in sparse cells, while the
  // subject's surface is dense. Drop points whose cell has too few neighbours.
  const cell = medD * (opts.cellFactor ?? 0.12);
  const minDensity = opts.minDensity ?? 3;
  const keys = new Array<string>(N);
  const counts = new Map<string, number>();
  for (let i = 0; i < N; i++) {
    const k = `${Math.floor(xs[i] / cell)},${Math.floor(ys[i] / cell)},${Math.floor(zs[i] / cell)}`;
    keys[i] = k;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const scaleThresh = hasScale ? (opts.scaleMul ?? 6) * median(maxScale) : Infinity;

  const keep: number[] = [];
  for (let i = 0; i < N; i++) {
    if (
      dist[i] < distThresh &&
      alpha[i] >= minAlpha &&
      (counts.get(keys[i]) ?? 0) >= minDensity &&
      maxScale[i] < scaleThresh
    ) {
      keep.push(i);
    }
  }
  if (keep.length === 0) keep.push(...Array.from({ length: N }, (_, i) => i));

  // subject radius = framePercentile of kept distances → normalization factor
  const keptDists = keep.map((i) => dist[i]).sort((a, b) => a - b);
  const radius = keptDists[Math.floor(keptDists.length * framePercentile)] || medD;
  const norm = targetRadius / (radius || 1);
  const lnNorm = Math.log(norm);

  const scaleKeys = ['scale_0', 'scale_1', 'scale_2'].filter((k) => k in offset);

  const writePly = async (path: string, indices: number[]) => {
    const headerText = h.text.replace(/element vertex \d+/, `element vertex ${indices.length}`);
    const headerBuf = Buffer.from(headerText, 'latin1');
    const out = Buffer.alloc(headerBuf.length + indices.length * stride);
    headerBuf.copy(out, 0);
    let o = headerBuf.length;
    for (const i of indices) {
      const b = dataStart + i * stride;
      buf.copy(out, o, b, b + stride);
      out.writeFloatLE((xs[i] - center[0]) * norm, o + offset.x);
      out.writeFloatLE((ys[i] - center[1]) * norm, o + offset.y);
      out.writeFloatLE((zs[i] - center[2]) * norm, o + offset.z);
      for (const k of scaleKeys) {
        out.writeFloatLE(buf.readFloatLE(b + offset[k]) + lnNorm, o + offset[k]);
      }
      o += stride;
    }
    await writeFile(path, out);
  };

  await writePly(cleanPath, keep);
  await writePly(scenePath, Array.from({ length: N }, (_, i) => i));

  const { size } = await stat(cleanPath);
  return { center, radius, kept: keep.length, total: N, cleanBytes: size };
}
