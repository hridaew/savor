import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { run } from '../proc';
import { PROJECT_ROOT } from '../config';

export interface SogOptions {
  onLog?: (line: string) => void;
}

/**
 * Resolve the splat-transform CLI script (workspaces hoist it to the root
 * node_modules). Returns null when not installed.
 */
async function resolveCli(): Promise<string | null> {
  const pkgDir = join(PROJECT_ROOT, 'node_modules', '@playcanvas', 'splat-transform');
  const pkgPath = join(pkgDir, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
      bin?: string | Record<string, string>;
    };
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['splat-transform'];
    if (!bin) return null;
    const cli = join(pkgDir, bin);
    return existsSync(cli) ? cli : null;
  } catch {
    return null;
  }
}

/**
 * PLY → single-file SOG bundle via @playcanvas/splat-transform (pure Node —
 * replaces the old best-effort Python `spz` bridge). SOG keeps the SH bands
 * at a fraction of even the SH-stripped ply's size. Best-effort: returns
 * false when the converter is missing or fails, so callers fall back to ply.
 */
export async function convertPlyToSog(
  inputPath: string,
  outputPath: string,
  opts: SogOptions = {},
): Promise<boolean> {
  const cli = await resolveCli();
  if (!cli) {
    opts.onLog?.('sog: @playcanvas/splat-transform not installed; keeping ply');
    return false;
  }
  try {
    await rm(outputPath, { force: true }); // retries re-run into the same dir
    await run(process.execPath, [cli, inputPath, outputPath], {
      onStdout: (line) => opts.onLog?.(`sog: ${line}`),
      onStderr: (line) => opts.onLog?.(`sog: ${line}`),
    });
    opts.onLog?.(`sog: wrote ${outputPath}`);
    return true;
  } catch (err: any) {
    opts.onLog?.(`sog failed: ${String(err?.message ?? err).split('\n')[0]}`);
    return false;
  }
}
