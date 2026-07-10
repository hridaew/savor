import { run } from '../proc';

export interface SpzOptions {
  onLog?: (line: string) => void;
  pythonBins?: string[];
}

const PY_CONVERT = 'import spz,sys; spz.convert(sys.argv[1], sys.argv[2])';

/**
 * Best-effort PLY -> SPZ conversion using Python bindings (`pip install spz`).
 * Returns true when conversion succeeded, false when no usable converter exists.
 */
export async function convertPlyToSpz(
  inputPath: string,
  outputPath: string,
  opts: SpzOptions = {},
): Promise<boolean> {
  const bins = Array.from(
    new Set(
      [
        ...(opts.pythonBins ?? []),
        process.env.PYTHON_BIN,
        'python',
        'python3',
      ].filter((x): x is string => Boolean(x && x.trim())),
    ),
  );

  for (const bin of bins) {
    try {
      opts.onLog?.(`spz: trying ${bin}`);
      await run(bin, ['-c', PY_CONVERT, inputPath, outputPath], {
        onStdout: (line) => opts.onLog?.(`spz:${bin}: ${line}`),
        onStderr: (line) => opts.onLog?.(`spz:${bin}: ${line}`),
      });
      opts.onLog?.(`spz: wrote ${outputPath}`);
      return true;
    } catch (err: any) {
      opts.onLog?.(
        `spz:${bin} unavailable (${String(err?.message ?? err).split('\n')[0]})`,
      );
    }
  }
  return false;
}
