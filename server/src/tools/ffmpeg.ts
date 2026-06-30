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
 * Pull ~targetFrames evenly-spaced stills from the video into `outDir`,
 * downscaling so the longest edge is <= maxDim (4K is wasteful for SfM).
 */
export async function extractFrames(
  input: string,
  outDir: string,
  probeInfo: ProbeResult,
  opts: ExtractOptions,
): Promise<ExtractResult> {
  const total = probeInfo.totalFrames || opts.targetFrames;
  const stride = Math.max(1, Math.round(total / opts.targetFrames));
  const expected = Math.max(1, Math.floor(total / stride));

  // Note: spawned without a shell, so escape the comma for ffmpeg's filtergraph
  // parser and omit shell quotes.
  const vf =
    `select=not(mod(n\\,${stride})),` +
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
  return { frameCount: files.length, stride };
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
