import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** Project root (the folder that contains `server/`, `web/`, `tools/`, ...). */
export const PROJECT_ROOT = resolve(__dirname, '../..');

export const WORKSPACE_DIR = process.env.WORKSPACE_DIR || resolve(PROJECT_ROOT, 'workspace');
export const SAMPLES_DIR = process.env.SAMPLES_DIR || resolve(PROJECT_ROOT, 'samples');

export const PORT = Number(process.env.PORT || 8787);

/** True if `bin -version` runs — guards against wrong-arch bundled binaries. */
function canExec(bin: string): boolean {
  try {
    return spawnSync(bin, ['-version'], { stdio: 'ignore', timeout: 5000 }).status === 0;
  } catch {
    return false;
  }
}

/** Binary shipped by an npm package (ffmpeg-static / @ffprobe-installer). */
function bundledBin(pkg: string, pick: (mod: any) => string | undefined): string | null {
  try {
    const p = pick(require(pkg));
    return p && existsSync(p) && canExec(p) ? p : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the per-platform Brush binary that setup fetches. The found path is
 * cached, but while missing we re-scan on every access — the server can
 * install Brush in the background mid-session (see tools/brushInstall).
 */
let brushCache: string | null = null;
function resolveBrush(): string {
  if (process.env.BRUSH_BIN) return process.env.BRUSH_BIN;
  if (brushCache && existsSync(brushCache)) return brushCache;
  const base = resolve(PROJECT_ROOT, 'tools/brush');
  const exe = process.platform === 'win32' ? 'brush_app.exe' : 'brush_app';
  const known = [
    'brush-app-aarch64-apple-darwin', // macOS Apple Silicon
    'brush-app-x86_64-unknown-linux-gnu', // Linux x64
    'brush-app-x86_64-pc-windows-msvc', // Windows x64
  ];
  for (const d of known) {
    const p = resolve(base, d, exe);
    if (existsSync(p)) return (brushCache = p);
  }
  // Fallback: scan whatever setup extracted into tools/brush/.
  try {
    for (const d of readdirSync(base)) {
      const p = resolve(base, d, exe);
      if (existsSync(p)) return (brushCache = p);
    }
  } catch {
    /* tools/brush/ doesn't exist until setup runs */
  }
  return resolve(base, known[0], exe);
}

/** Root of the per-platform COLMAP that setup fetches (Windows only today). */
export const COLMAP_DIR = resolve(PROJECT_ROOT, 'tools/colmap');

/**
 * Resolve the COLMAP CLI. On Windows we auto-fetch the official prebuilt zip
 * into tools/colmap/ (like Brush) and point at its colmap.exe; on macOS/Linux
 * COLMAP comes from the system (Homebrew / apt), so we fall back to PATH.
 * Re-scans while the bundled copy is missing so a mid-session install is seen.
 */
let colmapCache: string | null = null;
function findColmapExe(dir: string, depth = 0): string | null {
  const exe = process.platform === 'win32' ? 'colmap.exe' : 'colmap';
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const direct = entries.find((e) => e.toLowerCase() === exe);
  if (direct) return resolve(dir, direct);
  if (depth >= 3) return null;
  for (const e of entries) {
    const child = resolve(dir, e);
    try {
      if (readdirSync(child)) {
        const hit = findColmapExe(child, depth + 1);
        if (hit) return hit;
      }
    } catch {
      /* not a directory */
    }
  }
  return null;
}
function resolveColmap(): string {
  if (process.env.COLMAP_BIN) return process.env.COLMAP_BIN;
  if (colmapCache && existsSync(colmapCache)) return colmapCache;
  // Windows: prefer the bundled build; fall back to PATH ('colmap') otherwise.
  if (process.platform === 'win32') {
    const hit = findColmapExe(COLMAP_DIR);
    if (hit) return (colmapCache = hit);
  }
  return 'colmap';
}

export const TOOLS = {
  ffmpeg:
    process.env.FFMPEG_BIN ||
    bundledBin('ffmpeg-static', (m) => m?.default ?? m) ||
    'ffmpeg',
  ffprobe:
    process.env.FFPROBE_BIN ||
    bundledBin('@ffprobe-installer/ffprobe', (m) => m?.path) ||
    'ffprobe',
  get colmap(): string {
    return resolveColmap();
  },
  get brush(): string {
    return resolveBrush();
  },
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

/** True when COLMAP resolves to a real file we bundled (not a bare PATH name). */
export function colmapIsBundled(): boolean {
  const c = TOOLS.colmap;
  return (c.includes('/') || c.includes('\\')) && existsSync(c);
}

/** Is Homebrew available? Gates the macOS "Install COLMAP" button. */
let brewCache: boolean | null = null;
export function brewExists(): boolean {
  if (brewCache !== null) return brewCache;
  if (process.platform !== 'darwin') return (brewCache = false);
  return (brewCache = spawnSync('which', ['brew'], { stdio: 'ignore' }).status === 0);
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
   * Brush training recipe. Not user-selectable — one setting, the best one.
   * 12k steps with a 9k growth window captures nearly all visible quality:
   * every observed 30k run froze splat growth at 15k and spent the rest on
   * texture polish. --max-splats keeps time/memory/file size predictable and
   * lets Brush's MCMC relocation fill the environment instead of the old
   * aggressive growth overrides (which produced 100k–3.6M splat counts).
   */
  trainSteps: 12000,
  growthStopIter: 9000,
  maxSplats: 1_000_000,
  /** The viewer renders SH degree 2 max — degree 3 is invisible compute. */
  shDegree: 2,
  /**
   * Keep a second high-fidelity output with full SH bands for beauty-first viewing.
   * The existing stripped output is still produced for fast fallback/export.
   */
  keepShOutputs: envBool('KEEP_SH_OUTPUTS', true),
  /**
   * Best-effort SOG compression of the HQ output (Node-native via
   * @playcanvas/splat-transform). Falls back to .ply when unavailable.
   */
  exportSog: envBool('SOG_EXPORT', true),
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
