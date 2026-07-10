import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../proc';
import { TOOLS } from '../config';

export interface ProbeResult {
  durationSec: number;
  fps: number;
  width: number;
  height: number;
  totalFrames: number;
}

function parseRate(r: string | undefined): number {
  if (!r) return 0;
  const [a, b] = r.split('/').map(Number);
  if (!b) return a || 0;
  return a / b;
}

export async function probe(input: string): Promise<ProbeResult> {
  const { stdout } = await run(TOOLS.ffprobe, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=avg_frame_rate,width,height,nb_frames,duration',
    '-show_entries', 'format=duration',
    '-of', 'json',
    input,
  ]);
  const data = JSON.parse(stdout);
  const s = data.streams?.[0] ?? {};
  const fps = parseRate(s.avg_frame_rate);
  const durationSec =
    Number(s.duration) || Number(data.format?.duration) || 0;
  const nb = Number(s.nb_frames);
  const totalFrames =
    Number.isFinite(nb) && nb > 0 ? nb : Math.round(durationSec * fps);
  return {
    durationSec,
    fps,
    width: Number(s.width) || 0,
    height: Number(s.height) || 0,
    totalFrames,
  };
}

export interface ExtractOptions {
  targetFrames: number;
  maxDim: number;
  onProgress?: (fraction: number, frame: number, expected: number) => void;
}

export interface ExtractResult {
  frameCount: number;
  stride: number;
}

/**
 * Per-frame sharpness proxy: mean Sobel edge magnitude at 480px. One fast
 * decode pass (~10× realtime); metadata=print emits one YAVG line per frame.
 */
export async function scoreFrames(input: string, totalFrames: number): Promise<Float64Array> {
  const scores = new Float64Array(Math.max(1, totalFrames));
  let idx = 0;
  const onLine = (line: string) => {
    const m = line.match(/signalstats\.YAVG=([\d.]+)/);
    if (m && idx < scores.length) scores[idx++] = Number(m[1]);
  };
  await run(
    TOOLS.ffmpeg,
    [
      '-hide_banner', '-y',
      '-i', input,
      '-vf', 'scale=480:-2,format=gray,sobel,signalstats,metadata=print:file=-',
      '-an', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null',
    ],
    { onStdout: onLine, onStderr: onLine },
  );
  return scores.slice(0, Math.max(1, idx));
}

/** Split frames into targetFrames windows; keep the sharpest frame of each. */
export function pickSharpest(scores: ArrayLike<number>, targetFrames: number): number[] {
  const total = scores.length;
  const n = Math.min(targetFrames, total);
  const picks: number[] = [];
  for (let w = 0; w < n; w++) {
    const start = Math.floor((w * total) / n);
    const end = Math.max(start + 1, Math.floor(((w + 1) * total) / n));
    let best = start;
    for (let i = start + 1; i < end; i++) if (scores[i] > scores[best]) best = i;
    picks.push(best);
  }
  return picks;
}

/**
 * Pull ~targetFrames stills from the video into `outDir`, downscaling so the
 * longest edge is <= maxDim (4K is wasteful for SfM). Frames are chosen
 * sharpness-first: one scoring pass finds the crispest frame per time-window,
 * so motion-blurred frames never reach COLMAP or training. Falls back to
 * evenly-spaced sampling if scoring fails.
 */
export async function extractFrames(
  input: string,
  outDir: string,
  probeInfo: ProbeResult,
  opts: ExtractOptions,
): Promise<ExtractResult> {
  const total = probeInfo.totalFrames || opts.targetFrames;

  let selectExpr: string;
  let expected: number;
  try {
    const scores = await scoreFrames(input, total);
    const picks = pickSharpest(scores, opts.targetFrames);
    if (picks.length < Math.min(opts.targetFrames, scores.length) / 2) {
      throw new Error('too few scored frames');
    }
    selectExpr = picks.map((n) => `eq(n\\,${n})`).join('+');
    expected = picks.length;
  } catch {
    const stride = Math.max(1, Math.round(total / opts.targetFrames));
    selectExpr = `not(mod(n\\,${stride}))`;
    expected = Math.max(1, Math.floor(total / stride));
  }

  // Note: spawned without a shell, so escape the comma for ffmpeg's filtergraph
  // parser and omit shell quotes.
  const vf =
    `select=${selectExpr},` +
    `scale=w=${opts.maxDim}:h=${opts.maxDim}:force_original_aspect_ratio=decrease`;

  await run(
    TOOLS.ffmpeg,
    [
      '-hide_banner',
      '-y',
      '-i', input,
      '-vf', vf,
      '-fps_mode', 'vfr',
      '-q:v', '2',
      '-progress', 'pipe:1',
      '-nostats',
      join(outDir, 'frame_%04d.jpg'),
    ],
    {
      onStdout: (line) => {
        const m = line.match(/^frame=(\d+)/);
        if (m) {
          const frame = Number(m[1]);
          opts.onProgress?.(Math.min(1, frame / expected), frame, expected);
        }
      },
    },
  );

  const files = (await readdir(outDir)).filter((f) => f.endsWith('.jpg'));
  return { frameCount: files.length, stride: Math.max(1, Math.round(total / expected)) };
}

/** Make a downscaled thumbnail from an already-extracted frame. */
export async function makeThumb(src: string, dest: string, size = 720): Promise<void> {
  await run(TOOLS.ffmpeg, [
    '-hide_banner',
    '-y',
    '-i', src,
    '-vf', `scale=w=${size}:h=${size}:force_original_aspect_ratio=decrease`,
    '-q:v', '3',
    dest,
  ]);
}
