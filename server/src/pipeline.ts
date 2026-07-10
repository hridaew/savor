import { createWriteStream, existsSync, type WriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { WORKSPACE_DIR, PIPELINE } from './config';
import type { Capture } from './types';
import { dirOf, put, get as getCapture } from './store';
import { probe, extractFrames, makeThumb } from './tools/ffmpeg';
import {
  featureExtractor,
  exhaustiveMatcher,
  sequentialMatcher,
  mapper,
  analyzeModel,
  readCameraPoses,
} from './tools/colmap';
import { train } from './tools/brush';
import { cleanSplat } from './tools/splatClean';
import { convertPlyToSpz } from './tools/spz';

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

    const sfmMode = PIPELINE.sfmMatcher === 'sequential' ? 'sequential' : 'exhaustive';
    set(
      {
        stageProgress: 0.3,
        message:
          sfmMode === 'sequential'
            ? 'Matching nearby frames (video-aware)…'
            : 'Matching features across frames…',
      },
      SFM_BASE + SFM_SPAN * 0.3,
      true,
    );
    const onMatchProgress = (f: number, msg?: string) =>
      set(
        {
          stage: 'sfm',
          status: 'sfm',
          stageProgress: 0.3 + 0.3 * f,
          message:
            msg ??
            (sfmMode === 'sequential'
              ? 'Matching nearby frames…'
              : 'Matching features…'),
        },
        SFM_BASE + SFM_SPAN * (0.3 + 0.3 * f),
      );
    if (sfmMode === 'sequential') {
      try {
        await sequentialMatcher(dbPath, onMatchProgress, colmapLog);
      } catch (err) {
        // First-run loop detection can fail if the vocab tree is unavailable.
        // Fall back to sequential matching without loop detection.
        if (!PIPELINE.sequentialLoopDetection) throw err;
        colmapLog(
          `sequential_matcher failed with loop detection, retrying without it: ${String(
            (err as any)?.message ?? err,
          )}`,
        );
        await sequentialMatcher(dbPath, onMatchProgress, colmapLog, {
          loopDetection: false,
        });
      }
    } else {
      await exhaustiveMatcher(dbPath, onMatchProgress, colmapLog);
    }

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
    const minRegistered = Math.max(12, Math.ceil(frameCount * 0.3));
    const model0Stats = async () => {
      if (!existsSync(join(model0, 'cameras.bin')) && !existsSync(join(model0, 'images.bin'))) {
        return null;
      }
      return analyzeModel(model0);
    };
    let stats = await model0Stats();
    if (!stats || (stats.images > 0 && stats.images < minRegistered)) {
      // The incremental mapper is nondeterministic: on low-parallax walks a
      // bad seed pair can strand the whole reconstruction (observed: 5/150
      // one run, 141/150 the next, same inputs). Rescue: allow multiple
      // sub-models with a relaxed init and keep the largest.
      colmapLog(
        `mapper registered ${stats?.images ?? 0}/${frameCount}; rescue run with multiple models`,
      );
      set({ stageProgress: 0.6, message: 'Re-solving camera positions…' }, SFM_BASE + SFM_SPAN * 0.6, true);
      await rm(sparseDir, { recursive: true, force: true });
      await mkdir(sparseDir, { recursive: true });
      await mapper(
        dbPath,
        imagesDir,
        sparseDir,
        frameCount,
        (f, msg) =>
          set({ stage: 'sfm', status: 'sfm', stageProgress: 0.6 + 0.4 * f, message: msg ?? 'Re-solving camera positions…' }, SFM_BASE + SFM_SPAN * (0.6 + 0.4 * f)),
        colmapLog,
        { multipleModels: true, initMinTriAngle: 8 },
      );
      let best: { name: string; images: number } | null = null;
      for (const entry of await readdir(sparseDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const s = await analyzeModel(join(sparseDir, entry.name));
        if (s && (!best || s.images > best.images)) best = { name: entry.name, images: s.images };
      }
      if (best && best.name !== '0') {
        // Replace, don't keep: Brush scans all of sparse/, so a leftover dud
        // model would get picked up for training.
        if (existsSync(model0)) await rm(model0, { recursive: true, force: true });
        await rename(join(sparseDir, best.name), model0);
      }
      // Drop any remaining sub-models for the same reason.
      for (const entry of await readdir(sparseDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== '0') {
          await rm(join(sparseDir, entry.name), { recursive: true, force: true });
        }
      }
      stats = await model0Stats();
    }
    if (!stats) {
      throw new Error(
        'COLMAP could not reconstruct this scene. Capture a slower, steadier orbit with lots of overlap and texture.',
      );
    }
    cap.imagesRegistered = stats.images;
    cap.sparsePoints = stats.points;
    // Registration quality gate. A rotation-only pan (no parallax) solves to
    // a handful of cameras even in rescue mode; training on that produces a
    // splat that only reads from the original viewpoints — floaters
    // everywhere else. Fail honestly instead.
    if (stats.images > 0 && stats.images < minRegistered) {
      throw new Error(
        `Only ${stats.images} of ${frameCount} frames could be placed in 3D. ` +
          'This usually means the camera panned in place. Move around the subject ' +
          'in an arc — every frame should see it from a new position.',
      );
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
      { stage: 'training', status: 'training', stageProgress: 1, message: 'Finalizing splat outputs…' },
      0.98,
      true,
    );

    // One cleaned output: the scene — subject intact, air floaters gone,
    // environment preserved. Camera centers drive the orbit-aware haze pass
    // and tell the viewer where to put the camera.
    const poses = await readCameraPoses(model0);
    const cameraCenters = poses?.centers;
    const scenePath = join(outputDir, 'scene.ply');
    const sceneHqPath = join(outputDir, 'scene-hq.ply');
    const exportLog = logger('export');
    const keepHq = PIPELINE.keepShOutputs;
    const clean = await cleanSplat(result.plyPath, scenePath, {
      cameraCenters,
      sceneHqPath: keepHq ? sceneHqPath : undefined,
    });

    let beautyPath: string | undefined = keepHq ? sceneHqPath : undefined;
    let beautyBytes = clean.sceneBytesHq;
    if (PIPELINE.exportSpz && keepHq) {
      const sceneSpzPath = join(outputDir, 'scene.spz');
      const sceneSpz = await convertPlyToSpz(sceneHqPath, sceneSpzPath, { onLog: exportLog });
      if (sceneSpz) {
        beautyPath = sceneSpzPath;
        beautyBytes = (await stat(sceneSpzPath)).size;
      }
    }

    cap.splatUrl = fileUrl(scenePath) + `?v=${result.steps}`;
    cap.splatHqUrl = beautyPath ? fileUrl(beautyPath) + `?v=${result.steps}` : undefined;
    cap.kind = clean.isEnvironment ? 'environment' : 'object';
    if (clean.isEnvironment) {
      // Inside-out capture: the viewer looks around from the capture path.
      cap.envCamPos = clean.camPos;
      cap.envCamDir = poses?.medianDir;
      cap.orbitRadius = undefined;
      cap.orbitHeight = undefined;
    } else {
      cap.orbitRadius = clean.orbitRadius > 0 ? clean.orbitRadius : undefined;
      cap.orbitHeight = clean.orbitRadius > 0 ? clean.orbitHeight : undefined;
    }
    cap.splatBytes = clean.sceneBytes;
    cap.splatBytesHq = beautyBytes;
    cap.gaussians = clean.sceneKept;
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
