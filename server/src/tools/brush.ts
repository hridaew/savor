import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../proc';
import { TOOLS, PIPELINE } from '../config';

type Progress = (fraction: number, step: number, message?: string) => void;

export interface TrainOptions {
  totalSteps: number;
  maxResolution: number;
  onProgress?: Progress;
  onPreview?: (plyPath: string, iter: number) => void;
  onLog?: (line: string) => void;
}

export interface TrainResult {
  plyPath: string;
  bytes: number;
  gaussians: number;
  steps: number;
}

const PLY_RE = /splat_(\d+)\.ply$/;

async function listSplatPlys(dir: string): Promise<{ path: string; iter: number }[]> {
  let files: string[] = [];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  return files
    .map((f) => {
      const m = f.match(PLY_RE);
      return m ? { path: join(dir, f), iter: Number(m[1]) } : null;
    })
    .filter((x): x is { path: string; iter: number } => x !== null)
    .sort((a, b) => a.iter - b.iter);
}

/** Read the gaussian (vertex) count from a binary .ply header. */
async function readGaussianCount(plyPath: string): Promise<number> {
  try {
    const buf = await readFile(plyPath, { encoding: 'latin1', flag: 'r' });
    const head = buf.slice(0, 2048);
    const m = head.match(/element vertex (\d+)/);
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

/**
 * Train a gaussian splat with Brush from a COLMAP dataset directory
 * (expects `<datasetDir>/images` + `<datasetDir>/sparse/0`).
 * Brush picks the Metal GPU automatically via wgpu. No viewer window.
 */
export async function train(
  datasetDir: string,
  outputDir: string,
  opts: TrainOptions,
): Promise<TrainResult> {
  const exportEvery = Math.max(1000, Math.floor(opts.totalSteps / 12));

  const seen = new Set<number>();
  const poll = setInterval(async () => {
    const plys = await listSplatPlys(outputDir);
    for (const p of plys) {
      if (!seen.has(p.iter)) {
        seen.add(p.iter);
        opts.onPreview?.(p.path, p.iter);
      }
    }
  }, 1500);

  const parseStep = (line: string) => {
    // Brush prints progress with carriage-return updates; try a few shapes.
    let m = line.match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);
    if (m) {
      const cur = Number(m[1].replace(/,/g, ''));
      const tot = Number(m[2].replace(/,/g, '')) || opts.totalSteps;
      if (cur <= tot) {
        opts.onProgress?.(Math.min(1, cur / tot), cur, `Training ${cur}/${tot}`);
        return;
      }
    }
    m = line.match(/step[^\d]*(\d[\d,]*)/i);
    if (m) {
      const cur = Number(m[1].replace(/,/g, ''));
      opts.onProgress?.(
        Math.min(1, cur / opts.totalSteps),
        cur,
        `Training ${cur}/${opts.totalSteps}`,
      );
    }
  };

  try {
    await run(
      TOOLS.brush,
      [
        datasetDir,
        '--total-steps', String(opts.totalSteps),
        '--max-resolution', String(opts.maxResolution),
        '--growth-grad-threshold', String(PIPELINE.growthGradThreshold),
        '--growth-select-fraction', String(PIPELINE.growthSelectFraction),
        '--export-path', outputDir,
        '--export-name', 'splat_{iter}.ply',
        '--export-every', String(exportEvery),
      ],
      {
        onStdout: (line) => {
          opts.onLog?.(line);
          parseStep(line);
        },
        onStderr: (line) => {
          opts.onLog?.(line);
          parseStep(line);
        },
      },
    );
  } finally {
    clearInterval(poll);
  }

  const plys = await listSplatPlys(outputDir);
  const final = plys[plys.length - 1];
  if (!final) {
    throw new Error('Brush finished but produced no .ply export.');
  }
  const { size } = await stat(final.path);
  const gaussians = await readGaussianCount(final.path);
  return { plyPath: final.path, bytes: size, gaussians, steps: final.iter };
}
