import { createWriteStream, existsSync, type WriteStream } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { rename } from 'node:fs/promises';
import { WORKSPACE_DIR, PIPELINE } from './config';
import type { Capture } from './types';
import { dirOf, put, get as getCapture } from './store';
import { probe, extractFrames, makeThumb } from './tools/ffmpeg';
import { featureExtractor, exhaustiveMatcher, mapper, analyzeModel, readCameraCenters } from './tools/colmap';
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
  const deleted = () => !getCapture(cap.id);
  const set = (
    patch: Partial<Capture>,
    overall: number,
    force = false,
  ) => {
    // The user deleted this capture mid-run: stop publishing so it can't
    // resurrect in the UI (the tools will fail on the removed dir and unwind).
    if (deleted()) return;
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
    const totalSteps = PIPELINE.trainSteps;
    cap.totalSteps = totalSteps;
    set(
      { status: 'training', stage: 'training', stageProgress: 0, steps: 0, message: `Training splat · 0/${totalSteps}` },
      TRAIN_BASE,
      true,
    );

    // Live preview: clean each intermediate export (centered + framed like the
    // final result) and swap it in atomically so the UI can watch it sharpen.
    let previewBusy = false;
    const previewFinal = join(outputDir, 'preview.ply');
    const previewTmp = join(outputDir, 'preview.tmp.ply');
    const onPreview = (ply: string, iter: number) => {
      if (previewBusy || deleted()) return;
      previewBusy = true;
      void (async () => {
        try {
          await cleanSplat(ply, previewTmp);
          await rename(previewTmp, previewFinal);
          if (deleted()) return;
          cap.previewUrl = fileUrl(previewFinal) + `?v=${iter}`;
          cap.steps = Math.max(cap.steps ?? 0, iter);
          // Brush is silent on non-TTY pipes, so exports are our only training
          // progress signal — drive the bar and headline from them.
          const f = Math.min(1, iter / totalSteps);
          set(
            {
              stage: 'training',
              status: 'training',
              stageProgress: f,
              message: `Training splat · ${iter}/${totalSteps}`,
            },
            TRAIN_BASE + TRAIN_SPAN * f,
            true,
          );
        } catch {
          /* previews are best-effort */
        } finally {
          previewBusy = false;
        }
      })();
    };

    const result = await train(root, outputDir, {
      totalSteps,
      maxResolution: PIPELINE.maxImageDim,
      onProgress: (f, step, msg) => {
        cap.steps = step;
        set({ stage: 'training', status: 'training', stageProgress: f, message: msg ?? `Training splat · ${step}/${totalSteps}` }, TRAIN_BASE + TRAIN_SPAN * f);
      },
      onPreview,
      onLog: brushLog,
    });

    cap.steps = result.steps;
    cap.previewUrl = undefined;
    set(
      { stage: 'training', status: 'training', stageProgress: 1, message: 'Cleaning up the splat…' },
      0.98,
      true,
    );

    // Isolate the subject, keep a floater-free scene, recenter + normalize.
    // Camera centers let the cleaner know where the capture orbit was (and
    // the viewer where to put the Scene camera).
    const cameraCenters = (await readCameraCenters(model0)) ?? undefined;
    const cleanPath = join(outputDir, 'clean.ply');
    const scenePath = join(outputDir, 'scene.ply');
    const clean = await cleanSplat(result.plyPath, cleanPath, scenePath, { cameraCenters });

    cap.splatUrl = fileUrl(cleanPath) + `?v=${result.steps}`;
    cap.fullSplatUrl = fileUrl(scenePath) + `?v=${result.steps}`;
    cap.orbitRadius = clean.orbitRadius > 0 ? clean.orbitRadius : undefined;
    cap.orbitHeight = clean.orbitRadius > 0 ? clean.orbitHeight : undefined;
    cap.splatBytes = clean.cleanBytes;
    cap.gaussians = clean.subjectKept;
    cap.gaussiansFull = clean.sceneKept;
    cap.finishedAt = Date.now();
    set(
      { status: 'ready', stage: 'ready', stageProgress: 1, message: 'Ready to view' },
      1,
      true,
    );
  } catch (err: any) {
    if (deleted()) return; // user deleted the capture mid-run — stay gone
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
