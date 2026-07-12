import { run } from './proc';
import { TOOLS, brushExists } from './config';

export interface ToolStatus {
  ok: boolean;
  version?: string;
  path: string;
  detail?: string;
  /** How to install this tool on this machine (present when !ok). */
  hint?: string;
  /** The server is downloading/installing it right now. */
  installing?: boolean;
  /**
   * How the app can install this tool when missing:
   *   'auto'   — the server fetches it automatically (Brush, Windows COLMAP)
   *   'button' — one click runs an installer (macOS COLMAP via Homebrew)
   *   'manual' — the user must run the `hint` command themselves
   */
  action?: 'auto' | 'button' | 'manual';
}

type ToolName = 'ffmpeg' | 'ffprobe' | 'colmap' | 'brush';

/** Per-platform install hints, shown by the API/UI when a tool is missing. */
const HINTS: Record<string, Partial<Record<ToolName, string>>> = {
  darwin: {
    ffmpeg: 'brew install ffmpeg',
    ffprobe: 'brew install ffmpeg',
    colmap: 'brew install colmap',
    brush: 'npm run setup',
  },
  linux: {
    ffmpeg: 'sudo apt-get install -y ffmpeg',
    ffprobe: 'sudo apt-get install -y ffmpeg',
    colmap: 'sudo apt-get install -y colmap',
    brush: 'npm run setup',
  },
  win32: {
    ffmpeg: 'winget install Gyan.FFmpeg',
    ffprobe: 'winget install Gyan.FFmpeg',
    colmap: 'install from https://github.com/colmap/colmap/releases and add to PATH',
    brush: 'npm run setup',
  },
};

export function hintFor(tool: ToolName): string {
  return HINTS[process.platform]?.[tool] ?? HINTS.linux[tool]!;
}

async function tryVersion(
  tool: ToolName,
  path: string,
  args: string[],
  pick: (out: string) => string | undefined,
): Promise<ToolStatus> {
  try {
    const { stdout, stderr } = await run(path, args);
    const version = pick(stdout + '\n' + stderr);
    return { ok: true, version: version?.trim(), path };
  } catch (err: any) {
    return {
      ok: false,
      path,
      detail: String(err?.message ?? err).split('\n')[0],
      hint: hintFor(tool),
    };
  }
}

export interface Health {
  ok: boolean;
  tools: Record<ToolName, ToolStatus>;
}

export async function checkTools(): Promise<Health> {
  const [ffmpeg, ffprobe, colmap, brush] = await Promise.all([
    tryVersion('ffmpeg', TOOLS.ffmpeg, ['-hide_banner', '-version'], (o) => o.match(/ffmpeg version (\S+)/)?.[1]),
    tryVersion('ffprobe', TOOLS.ffprobe, ['-hide_banner', '-version'], (o) => o.match(/ffprobe version (\S+)/)?.[1]),
    tryVersion('colmap', TOOLS.colmap, ['-h'], (o) => o.match(/COLMAP\s+(\S+)/)?.[1]),
    brushExists()
      ? tryVersion('brush', TOOLS.brush, ['--version'], (o) => o.match(/(\d+\.\d+\.\d+)/)?.[1] ?? o.split('\n')[0])
      : Promise.resolve<ToolStatus>({
          ok: false,
          path: TOOLS.brush,
          detail: 'binary not found',
          hint: hintFor('brush'),
        }),
  ]);
  const tools = { ffmpeg, ffprobe, colmap, brush };
  return { ok: Object.values(tools).every((t) => t.ok), tools };
}
