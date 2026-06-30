import { run } from './proc';
import { TOOLS, brushExists } from './config';

export interface ToolStatus {
  ok: boolean;
  version?: string;
  path: string;
  detail?: string;
}

async function tryVersion(
  path: string,
  args: string[],
  pick: (out: string) => string | undefined,
): Promise<ToolStatus> {
  try {
    const { stdout, stderr } = await run(path, args);
    const version = pick(stdout + '\n' + stderr);
    return { ok: true, version: version?.trim(), path };
  } catch (err: any) {
    return { ok: false, path, detail: String(err?.message ?? err).split('\n')[0] };
  }
}

export interface Health {
  ok: boolean;
  tools: Record<'ffmpeg' | 'ffprobe' | 'colmap' | 'brush', ToolStatus>;
}

export async function checkTools(): Promise<Health> {
  const [ffmpeg, ffprobe, colmap, brush] = await Promise.all([
    tryVersion(TOOLS.ffmpeg, ['-hide_banner', '-version'], (o) => o.match(/ffmpeg version (\S+)/)?.[1]),
    tryVersion(TOOLS.ffprobe, ['-hide_banner', '-version'], (o) => o.match(/ffprobe version (\S+)/)?.[1]),
    tryVersion(TOOLS.colmap, ['-h'], (o) => o.match(/COLMAP\s+(\S+)/)?.[1]),
    brushExists()
      ? tryVersion(TOOLS.brush, ['--version'], (o) => o.match(/(\d+\.\d+\.\d+)/)?.[1] ?? o.split('\n')[0])
      : Promise.resolve<ToolStatus>({ ok: false, path: TOOLS.brush, detail: 'binary not found' }),
  ]);
  const tools = { ffmpeg, ffprobe, colmap, brush };
  return { ok: Object.values(tools).every((t) => t.ok), tools };
}
