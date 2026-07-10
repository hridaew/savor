import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Project root (the folder that contains `server/`, `web/`, `tools/`, ...). */
export const PROJECT_ROOT = resolve(__dirname, '../..');

export const WORKSPACE_DIR = process.env.WORKSPACE_DIR || resolve(PROJECT_ROOT, 'workspace');
export const SAMPLES_DIR = process.env.SAMPLES_DIR || resolve(PROJECT_ROOT, 'samples');

export const PORT = Number(process.env.PORT || 8787);

/** Resolve the per-platform Brush binary that `npm run setup` fetches. */
function resolveBrush(): string {
  if (process.env.BRUSH_BIN) return process.env.BRUSH_BIN;
  const base = resolve(PROJECT_ROOT, 'tools/brush');
  const exe = process.platform === 'win32' ? 'brush_app.exe' : 'brush_app';
  const known = [
    'brush-app-aarch64-apple-darwin', // macOS Apple Silicon
    'brush-app-x86_64-unknown-linux-gnu', // Linux x64
    'brush-app-x86_64-pc-windows-msvc', // Windows x64
  ];
  for (const d of known) {
    const p = resolve(base, d, exe);
    if (existsSync(p)) return p;
  }
  // Fallback: scan whatever setup extracted into tools/brush/.
  try {
    for (const d of readdirSync(base)) {
      const p = resolve(base, d, exe);
      if (existsSync(p)) return p;
    }
  } catch {
    /* tools/brush/ doesn't exist until setup runs */
  }
  return resolve(base, known[0], exe);
}

export const TOOLS = {
  ffmpeg: process.env.FFMPEG_BIN || 'ffmpeg',
  ffprobe: process.env.FFPROBE_BIN || 'ffprobe',
  colmap: process.env.COLMAP_BIN || 'colmap',
  brush: resolveBrush(),
};

function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v == null) return fallback;
  return v === '1' || v.toLowerCase() === 'true';
}

export function brushExists(): boolean {
  // A bare command name (env override on PATH) can't be cheaply stat-checked.
  const b = TOOLS.brush;
  if (process.env.BRUSH_BIN && !b.includes('/') && !b.includes('\\')) return true;
  return existsSync(b);
}

/** Pipeline tuning. Frames are capped for SfM speed; Brush re-caps at train time. */
export const PIPELINE = {
  /** Target number of stills pulled from the video. */
  targetFrames: 150,
  /** Longest image edge (px) kept for COLMAP + training. 4K is overkill for SfM. */
  maxImageDim: 1920,
  /** Video frames are ordered, so default to COLMAP's sequential matcher. */
  sfmMatcher: (process.env.SFM_MATCHER === 'exhaustive' ? 'exhaustive' : 'sequential') as
    | 'sequential'
    | 'exhaustive',
  /** Sequential matcher overlap window (neighbors before/after each frame). */
  sequentialOverlap: Math.max(2, Math.round(envNumber('COLMAP_SEQ_OVERLAP', 8))),
  /** Loop detection recovers non-local matches for global consistency. */
  sequentialLoopDetection: envBool('COLMAP_SEQ_LOOP_DETECTION', true),
  sequentialLoopPeriod: Math.max(2, Math.round(envNumber('COLMAP_SEQ_LOOP_PERIOD', 10))),
  sequentialLoopNumImages: Math.max(5, Math.round(envNumber('COLMAP_SEQ_LOOP_NUM_IMAGES', 50))),
  /**
   * Brush --total-steps. Not user-selectable: every capture trains at full
   * quality (Brush's own default step count). One setting, the best one.
   */
  trainSteps: 30000,
  /**
   * Densification, tuned up from Brush's defaults (4e-5 / 0.1). Gradients
   * concentrate on the subject, so with defaults the background never wins
   * densification and stays a handful of giant smears. Growing more
   * aggressively gives the environment real coverage; the floater filter
   * cleans up any extra noise.
   */
  growthGradThreshold: 2e-5,
  growthSelectFraction: 0.25,
  /**
   * Keep a second high-fidelity output with full SH bands for beauty-first viewing.
   * The existing stripped output is still produced for fast fallback/export.
   */
  keepShOutputs: envBool('KEEP_SH_OUTPUTS', true),
  /**
   * Best-effort SPZ conversion (via Python `spz` module). If unavailable, the
   * pipeline falls back to .ply high-fidelity outputs.
   */
  exportSpz: envBool('SPZ_EXPORT', true),
};

/**
 * Upload preflight gates so bad captures fail fast before expensive SfM/training.
 * Keep these broad: they're guardrails, not strict capture recommendations.
 */
export const UPLOAD = {
  minDurationSec: Math.max(1, envNumber('UPLOAD_MIN_DURATION_SEC', 5)),
  maxDurationSec: Math.max(10, envNumber('UPLOAD_MAX_DURATION_SEC', 180)),
  minLongEdgePx: Math.max(64, envNumber('UPLOAD_MIN_LONG_EDGE_PX', 320)),
  maxLongEdgePx: Math.max(512, envNumber('UPLOAD_MAX_LONG_EDGE_PX', 8192)),
};
