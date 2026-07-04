import { run } from '../proc';
import { TOOLS } from '../config';

type Progress = (fraction: number, message?: string) => void;

/**
 * COLMAP 4.1 SfM. GPU SIFT is used when the build supports it (the CUDA
 * builds on Windows/Linux run headless fine). On macOS the Homebrew build has
 * no CUDA and its OpenGL SIFT path needs a window/context a spawned backend
 * process doesn't have, so we fall back to CPU there. Override with
 * `COLMAP_USE_GPU=0|1`.
 */
const USE_GPU =
  process.env.COLMAP_USE_GPU != null
    ? process.env.COLMAP_USE_GPU === '1'
    : process.platform !== 'darwin';
const GPU_FLAG = USE_GPU ? '1' : '0';

export async function featureExtractor(
  dbPath: string,
  imagePath: string,
  maxImageSize: number,
  onProgress?: Progress,
  onLog?: (line: string) => void,
): Promise<void> {
  await run(
    TOOLS.colmap,
    [
      'feature_extractor',
      '--database_path', dbPath,
      '--image_path', imagePath,
      '--ImageReader.single_camera', '1',
      '--FeatureExtraction.use_gpu', GPU_FLAG,
      '--FeatureExtraction.max_image_size', String(maxImageSize),
    ],
    {
      onStdout: (line) => {
        onLog?.(line);
        const m = line.match(/\[(\d+)\/(\d+)\]/);
        if (m) onProgress?.(Number(m[1]) / Number(m[2]), `Detecting features ${m[1]}/${m[2]}`);
      },
      onStderr: onLog,
    },
  );
}

export async function exhaustiveMatcher(
  dbPath: string,
  onProgress?: Progress,
  onLog?: (line: string) => void,
): Promise<void> {
  await run(
    TOOLS.colmap,
    [
      'exhaustive_matcher',
      '--database_path', dbPath,
      '--FeatureMatching.use_gpu', GPU_FLAG,
    ],
    {
      onStdout: (line) => {
        onLog?.(line);
        const m = line.match(/block\s*\[(\d+)\/(\d+)/i);
        if (m) onProgress?.(Number(m[1]) / Number(m[2]), `Matching ${m[1]}/${m[2]}`);
      },
      onStderr: onLog,
    },
  );
}

export async function mapper(
  dbPath: string,
  imagePath: string,
  outputPath: string,
  expectedImages: number,
  onProgress?: Progress,
  onLog?: (line: string) => void,
): Promise<void> {
  await run(
    TOOLS.colmap,
    [
      'mapper',
      '--database_path', dbPath,
      '--image_path', imagePath,
      '--output_path', outputPath,
      '--Mapper.multiple_models', '0',
    ],
    {
      onStdout: (line) => {
        onLog?.(line);
        const m = line.match(/Registering image #\d+\s*\((\d+)\)/);
        if (m && expectedImages > 0) {
          onProgress?.(
            Math.min(0.99, Number(m[1]) / expectedImages),
            `Solving camera poses ${m[1]}/${expectedImages}`,
          );
        }
      },
      onStderr: onLog,
    },
  );
}

export interface ModelStats {
  images: number;
  points: number;
}

/** Best-effort sparse-model stats via `colmap model_analyzer`. Non-fatal. */
export async function analyzeModel(modelPath: string): Promise<ModelStats | null> {
  try {
    const { stdout, stderr } = await run(TOOLS.colmap, [
      'model_analyzer',
      '--path', modelPath,
    ]);
    const text = stdout + '\n' + stderr;
    const images = Number(text.match(/Registered images:\s*(\d+)/i)?.[1] ?? text.match(/Images:\s*(\d+)/i)?.[1] ?? 0);
    const points = Number(text.match(/Points:\s*(\d+)/i)?.[1] ?? 0);
    return { images, points };
  } catch {
    return null;
  }
}
