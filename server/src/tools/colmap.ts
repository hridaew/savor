import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../proc';
import { PIPELINE, TOOLS } from '../config';

type Progress = (fraction: number, message?: string) => void;

/**
 * COLMAP 4.1 SfM. GPU SIFT is used when the build supports it (the CUDA
 * builds on Windows/Linux run headless fine). On macOS the Homebrew build has
 * no CUDA and its OpenGL SIFT path needs a window/context a spawned backend
 * process doesn't have, so we fall back to CPU there. Override with
 * `COLMAP_USE_GPU=0|1`.
 */
const USE_GPU =
  process.env.COLMAP_USE_GPU != null
    ? process.env.COLMAP_USE_GPU === '1'
    : process.platform !== 'darwin';
const GPU_FLAG = USE_GPU ? '1' : '0';

export async function featureExtractor(
  dbPath: string,
  imagePath: string,
  maxImageSize: number,
  onProgress?: Progress,
  onLog?: (line: string) => void,
): Promise<void> {
  await run(
    TOOLS.colmap,
    [
      'feature_extractor',
      '--database_path', dbPath,
      '--image_path', imagePath,
      '--ImageReader.single_camera', '1',
      '--FeatureExtraction.use_gpu', GPU_FLAG,
      '--FeatureExtraction.max_image_size', String(maxImageSize),
    ],
    {
      onStdout: (line) => {
        onLog?.(line);
        const m = line.match(/\[(\d+)\/(\d+)\]/);
        if (m) onProgress?.(Number(m[1]) / Number(m[2]), `Detecting features ${m[1]}/${m[2]}`);
      },
      onStderr: onLog,
    },
  );
}

export async function exhaustiveMatcher(
  dbPath: string,
  onProgress?: Progress,
  onLog?: (line: string) => void,
): Promise<void> {
  await run(
    TOOLS.colmap,
    [
      'exhaustive_matcher',
      '--database_path', dbPath,
      '--FeatureMatching.use_gpu', GPU_FLAG,
    ],
    {
      onStdout: (line) => {
        onLog?.(line);
        const m = line.match(/block\s*\[(\d+)\/(\d+)/i);
        if (m) onProgress?.(Number(m[1]) / Number(m[2]), `Matching ${m[1]}/${m[2]}`);
      },
      onStderr: onLog,
    },
  );
}

export interface SequentialMatcherOptions {
  overlap?: number;
  loopDetection?: boolean;
  loopPeriod?: number;
  loopNumImages?: number;
}

function parseMatcherProgress(line: string): { cur: number; total: number } | null {
  // COLMAP's matcher progress varies by command/version. Accept the common forms.
  const m =
    line.match(/(?:image|pair|block)\D+\[?(\d+)\s*\/\s*(\d+)/i) ??
    line.match(/\[(\d+)\s*\/\s*(\d+)\]/);
  if (!m) return null;
  const cur = Number(m[1]);
  const total = Number(m[2]);
  if (!Number.isFinite(cur) || !Number.isFinite(total) || total <= 0) return null;
  return { cur, total };
}

export async function sequentialMatcher(
  dbPath: string,
  onProgress?: Progress,
  onLog?: (line: string) => void,
  opts: SequentialMatcherOptions = {},
): Promise<void> {
  const overlap = Math.max(2, Math.round(opts.overlap ?? PIPELINE.sequentialOverlap));
  const loopDetection = opts.loopDetection ?? PIPELINE.sequentialLoopDetection;
  const loopPeriod = Math.max(2, Math.round(opts.loopPeriod ?? PIPELINE.sequentialLoopPeriod));
  const loopNumImages = Math.max(
    5,
    Math.round(opts.loopNumImages ?? PIPELINE.sequentialLoopNumImages),
  );

  const args = [
    'sequential_matcher',
    '--database_path', dbPath,
    '--FeatureMatching.use_gpu', GPU_FLAG,
    '--SequentialMatching.overlap', String(overlap),
    '--SequentialMatching.loop_detection', loopDetection ? '1' : '0',
  ];
  if (loopDetection) {
    args.push(
      '--SequentialMatching.loop_detection_period', String(loopPeriod),
      '--SequentialMatching.loop_detection_num_images', String(loopNumImages),
    );
  }

  await run(TOOLS.colmap, args, {
    onStdout: (line) => {
      onLog?.(line);
      const p = parseMatcherProgress(line);
      if (p) onProgress?.(p.cur / p.total, `Matching ${p.cur}/${p.total}`);
    },
    onStderr: (line) => {
      onLog?.(line);
      const p = parseMatcherProgress(line);
      if (p) onProgress?.(p.cur / p.total, `Matching ${p.cur}/${p.total}`);
    },
  });
}

export async function mapper(
  dbPath: string,
  imagePath: string,
  outputPath: string,
  expectedImages: number,
  onProgress?: Progress,
  onLog?: (line: string) => void,
): Promise<void> {
  await run(
    TOOLS.colmap,
    [
      'mapper',
      '--database_path', dbPath,
      '--image_path', imagePath,
      '--output_path', outputPath,
      '--Mapper.multiple_models', '0',
    ],
    {
      onStdout: (line) => {
        onLog?.(line);
        const m = line.match(/Registering image #\d+\s*\((\d+)\)/);
        if (m && expectedImages > 0) {
          onProgress?.(
            Math.min(0.99, Number(m[1]) / expectedImages),
            `Solving camera poses ${m[1]}/${expectedImages}`,
          );
        }
      },
      onStderr: onLog,
    },
  );
}

export interface ModelStats {
  images: number;
  points: number;
}

export interface CameraPoses {
  /** Camera centers C = −Rᵀ·t (world coords). */
  centers: [number, number, number][];
  /** Normalized component-wise median of the cameras' optical axes. */
  medianDir: [number, number, number];
}

/**
 * Camera poses (world coords) from a sparse model's `images.bin`.
 * Binary layout per registered image: image_id u32, qvec 4×f64 (w,x,y,z),
 * tvec 3×f64, camera_id u32, name (NUL-terminated), num_points2D u64,
 * then num_points2D × (x f64, y f64, point3D_id u64). Pose is world→camera,
 * so the center is C = −Rᵀ·t and the optical axis is Rᵀ·ẑ (third row of R).
 * Best-effort: returns null on any problem.
 */
export async function readCameraPoses(modelDir: string): Promise<CameraPoses | null> {
  try {
    const buf = await readFile(join(modelDir, 'images.bin'));
    let off = 0;
    const numImages = Number(buf.readBigUInt64LE(off));
    off += 8;
    const centers: [number, number, number][] = [];
    const axes: [number, number, number][] = [];
    for (let n = 0; n < numImages; n++) {
      off += 4; // image_id
      let qw = buf.readDoubleLE(off);
      let qx = buf.readDoubleLE(off + 8);
      let qy = buf.readDoubleLE(off + 16);
      let qz = buf.readDoubleLE(off + 24);
      off += 32;
      const tx = buf.readDoubleLE(off);
      const ty = buf.readDoubleLE(off + 8);
      const tz = buf.readDoubleLE(off + 16);
      off += 24;
      off += 4; // camera_id
      while (buf[off] !== 0) off++;
      off += 1; // name NUL
      const npts = Number(buf.readBigUInt64LE(off));
      off += 8 + npts * 24;

      const ql = Math.hypot(qw, qx, qy, qz) || 1;
      qw /= ql; qx /= ql; qy /= ql; qz /= ql;
      // rows of R (world→camera)
      const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
      const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
      const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
      centers.push([
        -(r00 * tx + r10 * ty + r20 * tz),
        -(r01 * tx + r11 * ty + r21 * tz),
        -(r02 * tx + r12 * ty + r22 * tz),
      ]);
      axes.push([r20, r21, r22]);
    }
    if (!centers.length) return null;
    const med = (pick: (a: [number, number, number]) => number) => {
      const s = axes.map(pick).sort((a, b) => a - b);
      return s[s.length >> 1];
    };
    let dx = med((a) => a[0]), dy = med((a) => a[1]), dz = med((a) => a[2]);
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    return { centers, medianDir: [dx, dy, dz] };
  } catch {
    return null;
  }
}

/** Back-compat: just the camera centers. */
export async function readCameraCenters(modelDir: string): Promise<[number, number, number][] | null> {
  return (await readCameraPoses(modelDir))?.centers ?? null;
}

/** Best-effort sparse-model stats via `colmap model_analyzer`. Non-fatal. */
export async function analyzeModel(modelPath: string): Promise<ModelStats | null> {
  try {
    const { stdout, stderr } = await run(TOOLS.colmap, [
      'model_analyzer',
      '--path', modelPath,
    ]);
    const text = stdout + '\n' + stderr;
    const images = Number(text.match(/Registered images:\s*(\d+)/i)?.[1] ?? text.match(/Images:\s*(\d+)/i)?.[1] ?? 0);
    const points = Number(text.match(/Points:\s*(\d+)/i)?.[1] ?? 0);
    return { images, points };
  } catch {
    return null;
  }
}
