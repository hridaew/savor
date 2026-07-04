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
  maxImageDim: 1600,
  /**
   * Brush --total-steps. Not user-selectable: every capture trains at full
   * quality (Brush's own default step count). One setting, the best one.
   */
  trainSteps: 30000,
};
