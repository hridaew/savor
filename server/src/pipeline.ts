import { createWriteStream, existsSync, type WriteStream } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { WORKSPACE_DIR, PIPELINE } from './config';
import type { Capture } from './types';
import { dirOf, put } from './store';
import { probe, extractFrames, makeThumb } from './tools/ffmpeg';
import { featureExtractor, exhaustiveMatcher, mapper, analyzeModel } from './tools/colmap';
import { train } from './tools/brush';
import { cleanSplat } from './tools/splatClean';

function fileUrl(absPath: string): string {
  return '/files/' + relative(WORKSPACE_DIR, absPath).split('\\').join('/');
}

// Overall-progress budget per stage (must sum to ~1).
const EXTRACT_SPAN = 0.12;
const SFM_BASE = 0.12;
const SFM_SPAN = 0.5;
const TRAIN_BASE = 0.62;
const TRAIN_SPAN = 0.38;

/** Runs ffmpeg → COLMAP → Brush for one capture, mutating + publishing it. */
export async function runPipeline(cap: Capture, videoPath: string): Promise<void> {
  const root = dirOf(cap.id);
  const imagesDir = join(root, 'images');
  const sparseDir = join(root, 'sparse');
  const outputDir = join(root, 'output');
  const logsDir = join(root, 'logs');
  const dbPath = join(root, 'database.db');
  const thumbPath = join(root, 'thumb.jpg');

  await mkdir(imagesDir, { recursive: true });
  await mkdir(sparseDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  const streams = new Map<string, WriteStream>();
  const logger = (tool: string) => {
    let s = streams.get(tool);
    if (!s) {
      s = createWriteStream(join(logsDir, `${tool}.log`), { flags: 'a' });
      streams.set(tool, s);
    }
    return (line: string) => s!.write(line + '\n');
  };

  let lastEmit = 0;
  const set = (
    patch: Partial<Capture>,
    overall: number,
    force = false,
  ) => {
    Object.assign(cap, patch, { progress: Math.max(cap.progress, overall) });
    const now = Date.now();
    if (force || now - lastEmit > 100) {
      lastEmit = now;
      put(cap, { flush: force });
    }
  };

  try {
    cap.startedAt = Date.now();

    // ── 1. Extract frames ─────────────────────────────────────────────
    set(
      { status: 'extracting', stage: 'extracting', stageProgress: 0, message: 'Reading video…' },
      0.01,
      true,
    );
    const info = await probe(videoPath);
    cap.durationSec = info.durationSec;
    cap.fps = info.fps;
    cap.width = info.width;
    cap.height = info.height;

    const { frameCount } = await extractFrames(videoPath, imagesDir, info, {
      targetFrames: PIPELINE.targetFrames,
      maxDim: PIPELINE.maxImageDim,
      onProgress: (f, frame, exp) =>
        set(
          { stage: 'extracting', status: 'extracting', stageProgress: f, message: `Extracting frames · ${frame}/${exp}` },
          EXTRACT_SPAN * f,
        ),
    });
    cap.frameCount = frameCount;
    if (frameCount < 12) {
      throw new Error(
        `Only ${frameCount} usable frames. Use a longer video (20–40s) that slowly circles the subject.`,
      );
    }

    // Thumbnail from a middle frame.
    const frames = (await readdir(imagesDir)).filter((f) => f.endsWith('.jpg')).sort();
    const mid = frames[Math.floor(frames.length / 2)] ?? frames[0];
    if (mid) {
      await makeThumb(join(imagesDir, mid), thumbPath);
      cap.thumbUrl = fileUrl(thumbPath);
    }

    // ── 2. Structure-from-Motion (COLMAP) ─────────────────────────────
    const colmapLog = logger('colmap');
    set(
      { status: 'sfm', stage: 'sfm', stageProgress: 0, message: `Got ${frameCount} frames · detecting features…` },
      SFM_BASE,
      true,
    );

    await featureExtractor(
      dbPath,
      imagesDir,
      PIPELINE.maxImageDim,
      (f, msg) =>
        set({ stage: 'sfm', status: 'sfm', stageProgress: 0.3 * f, message: msg ?? 'Detecting features…' }, SFM_BASE + SFM_SPAN * (0.3 * f)),
      colmapLog,
    );

    set({ stageProgress: 0.3, message: 'Matching features across frames…' }, SFM_BASE + SFM_SPAN * 0.3, true);
    await exhaustiveMatcher(
      dbPath,
      (f, msg) =>
        set({ stage: 'sfm', status: 'sfm', stageProgress: 0.3 + 0.3 * f, message: msg ?? 'Matching features…' }, SFM_BASE + SFM_SPAN * (0.3 + 0.3 * f)),
      colmapLog,
    );

    set({ stageProgress: 0.6, message: 'Solving camera positions…' }, SFM_BASE + SFM_SPAN * 0.6, true);
    await mapper(
      dbPath,
      imagesDir,
      sparseDir,
      frameCount,
      (f, msg) =>
        set({ stage: 'sfm', status: 'sfm', stageProgress: 0.6 + 0.4 * f, message: msg ?? 'Solving camera positions…' }, SFM_BASE + SFM_SPAN * (0.6 + 0.4 * f)),
      colmapLog,
    );

    const model0 = join(sparseDir, '0');
    if (!existsSync(join(model0, 'cameras.bin')) && !existsSync(join(model0, 'images.bin'))) {
      throw new Error(
        'COLMAP could not reconstruct this scene. Capture a slower, steadier orbit with lots of overlap and texture.',
      );
    }
    const stats = await analyzeModel(model0);
    if (stats) {
      cap.imagesRegistered = stats.images;
      cap.sparsePoints = stats.points;
    }

    // ── 3. Train the splat (Brush) ────────────────────────────────────
    const brushLog = logger('brush');
    const totalSteps = PIPELINE.steps[cap.quality] ?? PIPELINE.steps.balanced;
    cap.totalSteps = totalSteps;
    set(
      { status: 'training', stage: 'training', stageProgress: 0, steps: 0, message: `Training splat · 0/${totalSteps}` },
      TRAIN_BASE,
      true,
    );

    const result = await train(root, outputDir, {
      totalSteps,
      maxResolution: PIPELINE.maxImageDim,
      onProgress: (f, step, msg) => {
        cap.steps = step;
        set({ stage: 'training', status: 'training', stageProgress: f, message: msg ?? `Training splat · ${step}/${totalSteps}` }, TRAIN_BASE + TRAIN_SPAN * f);
      },
      onPreview: (ply, iter) => {
        cap.previewUrl = fileUrl(ply) + `?v=${iter}`;
        cap.steps = Math.max(cap.steps ?? 0, iter);
        put(cap, { flush: true });
      },
      onLog: brushLog,
    });

    cap.steps = result.steps;
    cap.previewUrl = undefined;
    set(
      { stage: 'training', status: 'training', stageProgress: 1, message: 'Cleaning up the splat…' },
      0.98,
      true,
    );

    // Remove stray floaters, recenter the subject, normalize scale.
    const cleanPath = join(outputDir, 'clean.ply');
    const scenePath = join(outputDir, 'scene.ply');
    const clean = await cleanSplat(result.plyPath, cleanPath, scenePath);

    cap.splatUrl = fileUrl(cleanPath) + `?v=${result.steps}`;
    cap.fullSplatUrl = fileUrl(scenePath) + `?v=${result.steps}`;
    cap.splatBytes = clean.cleanBytes;
    cap.gaussians = clean.kept;
    cap.gaussiansFull = clean.total;
    cap.finishedAt = Date.now();
    set(
      { status: 'ready', stage: 'ready', stageProgress: 1, message: 'Ready to view' },
      1,
      true,
    );
  } catch (err: any) {
    cap.status = 'failed';
    cap.stage = 'failed';
    cap.error = String(err?.message ?? err);
    cap.message = 'Something went wrong';
    cap.finishedAt = Date.now();
    put(cap, { flush: true });
  } finally {
    for (const s of streams.values()) s.end();
  }
}
