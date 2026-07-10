# Pipeline Upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faster, more robust SfM (global mapper + learned-feature rescue), a maintained web renderer (Spark), Node-native SOG compression replacing the Python SPZ bridge, and a working Windows setup script.

**Architecture:** The SfM stage becomes a cheap-to-expensive tier ladder — GLOMAP global mapper → incremental mapper → incremental multi-model rescue → ALIKED+LightGlue re-match — each tier only running when the previous one registers too few frames. The viewer swaps `@mkkellogg/gaussian-splats-3d` (retired upstream) for `@sparkjsdev/spark` behind the same `SplatViewer` props, so ViewerScreen/PosterMaker/ab.tsx don't change. HQ output becomes `scene.sog` via `@playcanvas/splat-transform` (npm, no Python).

**Tech Stack:** COLMAP 4.1 CLI (`global_mapper`, `--FeatureExtraction.type ALIKED`, `--FeatureMatching.type ALIKED_LIGHTGLUE`), `@sparkjsdev/spark` + three.js OrbitControls, `@playcanvas/splat-transform`.

## Global Constraints

- No user-facing options anywhere (Apple-style: one setting, the best one).
- Old captures must keep working (existing `scene.spz`/`scene-hq.ply` URLs still load — Spark reads spz natively).
- Graceful degradation on COLMAP 3.x (no `global_mapper`, no ALIKED): capability-probe and skip those tiers.
- No test framework exists; repo convention is script/manual verification (`server/scripts/verify-*.ts`, ab.html). Verify with real artifacts from `workspace/`.
- Windows dev box: COLMAP 4.1.0 CUDA at `C:\Users\Hridae Walia\tools\bin\colmap.exe` (verified: has `global_mapper` + ALIKED/LightGlue ONNX).

---

### Task 1: SOG export tool (replace Python spz bridge)

**Files:**
- Create: `server/src/tools/sog.ts`
- Delete: `server/src/tools/spz.ts`
- Modify: `server/src/config.ts` (exportSpz → exportSog), `server/src/pipeline.ts:337-344`, `server/package.json` (dep)

**Interfaces:**
- Produces: `convertPlyToSog(inputPath: string, outputPath: string, opts?: { onLog?: (line: string) => void }): Promise<boolean>` — true on success; false (never throws) when the converter is unavailable/fails so the pipeline falls back to the HQ ply.
- `PIPELINE.exportSog: boolean` (env `SOG_EXPORT`, default true) replaces `PIPELINE.exportSpz`.

- [x] **Step 1:** `npm install -w server @playcanvas/splat-transform` (root lockfile updates). Inspect `node_modules/@playcanvas/splat-transform/package.json` → note the `bin` entry path for Step 2.

- [x] **Step 2:** Write `server/src/tools/sog.ts`:

```ts
import { readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
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
```

(If Step 1's `bin` entry needs `dirname` handling adjust accordingly; keep imports tidy.)

- [x] **Step 3:** `server/src/config.ts` — replace the `exportSpz` member with:

```ts
  /**
   * Best-effort SOG compression of the HQ output (Node-native via
   * @playcanvas/splat-transform). Falls back to .ply when unavailable.
   */
  exportSog: envBool('SOG_EXPORT', true),
```

- [x] **Step 4:** `server/src/pipeline.ts` — swap the import `convertPlyToSpz` → `convertPlyToSog` from `./tools/sog`, and replace the spz block:

```ts
    if (PIPELINE.exportSog && keepHq) {
      const sceneSogPath = join(outputDir, 'scene.sog');
      const sceneSog = await convertPlyToSog(sceneHqPath, sceneSogPath, { onLog: exportLog });
      if (sceneSog) {
        beautyPath = sceneSogPath;
        beautyBytes = (await stat(sceneSogPath)).size;
      }
    }
```

- [x] **Step 5:** Delete `server/src/tools/spz.ts`. Grep for remaining `spz` references in `server/` (expect none in code; old capture JSON keeps `.spz` URLs, which is fine).

- [x] **Step 6 (verify):** Find an HQ ply from an existing capture (`ls workspace/*/output/scene-hq.ply`), run a scratchpad tsx script that calls `convertPlyToSog` on it, confirm: exit true, `.sog` exists, size ≪ ply size. Record sizes.

- [x] **Step 7:** Commit `feat: SOG compression via splat-transform, drop Python spz bridge`.

---

### Task 2: GLOMAP global mapper as tier 1

**Files:**
- Modify: `server/src/tools/colmap.ts` (add `supportsGlobalMapper`, `globalMapper`), `server/src/pipeline.ts:176-236` (tier ladder)

**Interfaces:**
- Produces: `supportsGlobalMapper(): Promise<boolean>` (cached probe of `colmap help` output for `global_mapper`).
- Produces: `globalMapper(dbPath, imagePath, outputPath, onProgress?, onLog?): Promise<void>` — writes `<outputPath>/0` like `mapper`.
- pipeline keeps: `model0Stats()`, `minRegistered`, final gate messages unchanged.

- [x] **Step 1:** Add to `server/src/tools/colmap.ts`:

```ts
let globalMapperSupport: boolean | null = null;

/** COLMAP ≥ 4.0 integrates GLOMAP as `global_mapper`. Cached capability probe. */
export async function supportsGlobalMapper(): Promise<boolean> {
  if (globalMapperSupport !== null) return globalMapperSupport;
  try {
    const { stdout, stderr } = await run(TOOLS.colmap, ['help']);
    globalMapperSupport = /\bglobal_mapper\b/.test(stdout + stderr);
  } catch {
    globalMapperSupport = false;
  }
  return globalMapperSupport;
}

/**
 * GLOMAP-based global SfM (COLMAP ≥ 4.0): solves all cameras simultaneously —
 * one to two orders of magnitude faster than the incremental mapper and
 * immune to its bad-seed-pair nondeterminism. Writes <outputPath>/0.
 */
export async function globalMapper(
  dbPath: string,
  imagePath: string,
  outputPath: string,
  onProgress?: Progress,
  onLog?: (line: string) => void,
): Promise<void> {
  // GLOMAP logs phase banners, not per-image progress; map them coarsely.
  const phases: [RegExp, number, string][] = [
    [/track establishment|establishing tracks/i, 0.15, 'Establishing tracks…'],
    [/rotation averaging/i, 0.35, 'Averaging camera rotations…'],
    [/global positioning/i, 0.55, 'Positioning cameras…'],
    [/bundle adjustment/i, 0.75, 'Refining cameras…'],
    [/retriangulat/i, 0.9, 'Triangulating points…'],
  ];
  const onLine = (line: string) => {
    onLog?.(line);
    for (const [re, f, msg] of phases) {
      if (re.test(line)) {
        onProgress?.(f, msg);
        break;
      }
    }
  };
  await run(
    TOOLS.colmap,
    [
      'global_mapper',
      '--database_path', dbPath,
      '--image_path', imagePath,
      '--output_path', outputPath,
    ],
    { onStdout: onLine, onStderr: onLine },
  );
}
```

- [x] **Step 2 (verify wrapper before wiring):** Pick an existing capture with `database.db` + `images/` in `workspace/`. Scratchpad tsx script: call `globalMapper(db, images, scratchSparse)`, then `analyzeModel(join(scratchSparse, '0'))`. Confirm the `0/` subdir convention, registration count comparable to the capture's stored `imagesRegistered`, and note wall time vs the incremental run (capture's colmap.log).

- [x] **Step 3:** Restructure `server/src/pipeline.ts` mapping section into the tier ladder. Replace everything from `await mapper(` through the second `stats = await model0Stats();` (the rescue block) with:

```ts
    const model0 = join(sparseDir, '0');
    const minRegistered = Math.max(12, Math.ceil(frameCount * 0.3));
    const model0Stats = async () => {
      if (!existsSync(join(model0, 'cameras.bin')) && !existsSync(join(model0, 'images.bin'))) {
        return null;
      }
      return analyzeModel(model0);
    };
    const goodEnough = (s: { images: number } | null): boolean =>
      !!s && s.images >= minRegistered;
    const resetSparse = async () => {
      await rm(sparseDir, { recursive: true, force: true });
      await mkdir(sparseDir, { recursive: true });
    };
    const mapProgress = (f: number, msg?: string) =>
      set(
        { stage: 'sfm', status: 'sfm', stageProgress: 0.6 + 0.4 * f, message: msg ?? 'Solving camera positions…' },
        SFM_BASE + SFM_SPAN * (0.6 + 0.4 * f),
      );

    // The mapper runs as a cheap-to-expensive tier ladder; each tier only
    // fires when the previous one registered too few frames.
    let stats: Awaited<ReturnType<typeof model0Stats>> = null;

    // ── Tier 1: global mapper (GLOMAP, COLMAP ≥ 4). Solves all cameras at
    // once — far faster than incremental and deterministic.
    if (await supportsGlobalMapper()) {
      try {
        await globalMapper(dbPath, imagesDir, sparseDir, mapProgress, colmapLog);
      } catch (err) {
        colmapLog(`global_mapper failed: ${String((err as any)?.message ?? err)}`);
      }
      stats = await model0Stats();
      if (!goodEnough(stats)) {
        colmapLog(
          `global_mapper registered ${stats?.images ?? 0}/${frameCount}; falling back to incremental`,
        );
      }
    }

    // ── Tier 2: incremental mapper (the pre-4.x default).
    if (!goodEnough(stats)) {
      await resetSparse();
      set({ stageProgress: 0.6, message: 'Solving camera positions…' }, SFM_BASE + SFM_SPAN * 0.6, true);
      await mapper(dbPath, imagesDir, sparseDir, frameCount, mapProgress, colmapLog);
      stats = await model0Stats();
    }

    // ── Tier 3: incremental rescue. The incremental mapper is
    // nondeterministic: on low-parallax walks a bad seed pair can strand the
    // whole reconstruction (observed: 5/150 one run, 141/150 the next, same
    // inputs). Allow multiple sub-models with a relaxed init, keep the largest.
    if (!goodEnough(stats)) {
      colmapLog(
        `mapper registered ${stats?.images ?? 0}/${frameCount}; rescue run with multiple models`,
      );
      set({ stageProgress: 0.6, message: 'Re-solving camera positions…' }, SFM_BASE + SFM_SPAN * 0.6, true);
      await resetSparse();
      await mapper(
        dbPath,
        imagesDir,
        sparseDir,
        frameCount,
        (f, msg) => mapProgress(f, msg ?? 'Re-solving camera positions…'),
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
```

(The existing final gate — `if (!stats) throw`, registration-ratio pan error — stays below, unchanged. Task 3 inserts its tier between Tier 3 and the gate.)

- [x] **Step 4:** Update imports in pipeline.ts (`supportsGlobalMapper`, `globalMapper` from `./tools/colmap`).

- [x] **Step 5 (verify):** `npx tsx --eval` typecheck isn't enough — run `npm -w server exec tsc -- --noEmit` (or `npx tsc -p server --noEmit`) to confirm types. Then end-to-end smoke: covered in Task 7's full-pipeline run.

- [x] **Step 6:** Commit `feat: GLOMAP global mapper as the primary SfM tier`.

---

### Task 3: ALIKED + LightGlue rescue tier

**Files:**
- Modify: `server/src/tools/colmap.ts` (`supportsAliked`, extractor/matcher type options), `server/src/pipeline.ts` (tier 4)

**Interfaces:**
- Produces: `supportsAliked(): Promise<boolean>` (cached probe of `colmap feature_extractor --help` for `AlikedExtraction`).
- `featureExtractor(dbPath, imagePath, maxImageSize, onProgress?, onLog?, opts?: { type?: 'SIFT' | 'ALIKED' })`.
- `SequentialMatcherOptions` gains `featureType?: 'sift' | 'aliked'` — `'aliked'` sets `--FeatureMatching.type ALIKED_LIGHTGLUE` and forces loop detection off (the vocab tree is SIFT-only).

- [x] **Step 1:** colmap.ts — add probe:

```ts
let alikedSupport: boolean | null = null;

/** COLMAP ≥ 4.1 built with ONNX ships ALIKED + LightGlue. Cached probe. */
export async function supportsAliked(): Promise<boolean> {
  if (alikedSupport !== null) return alikedSupport;
  try {
    const { stdout, stderr } = await run(TOOLS.colmap, ['feature_extractor', '--help']);
    alikedSupport = /AlikedExtraction/i.test(stdout + stderr);
  } catch {
    alikedSupport = false;
  }
  return alikedSupport;
}
```

- [x] **Step 2:** colmap.ts — extend `featureExtractor` signature with trailing `opts: { type?: 'SIFT' | 'ALIKED' } = {}`; when `opts.type === 'ALIKED'` push `'--FeatureExtraction.type', 'ALIKED'` (model ONNX weights auto-download on first use; leave `AlikedExtraction.*` defaults).

- [x] **Step 3:** colmap.ts — extend `SequentialMatcherOptions` with `featureType?: 'sift' | 'aliked'`; in `sequentialMatcher`, when `'aliked'`: push `'--FeatureMatching.type', 'ALIKED_LIGHTGLUE'` and treat `loopDetection` as false regardless of option/config.

- [x] **Step 4:** pipeline.ts — insert Tier 4 between Tier 3 and the final gate:

```ts
    // ── Tier 4: learned features. SIFT starves on texture-poor or
    // motion-blurred consumer video; ALIKED + LightGlue (ONNX, COLMAP ≥ 4.1)
    // often still registers. Fresh database so SIFT matches can't contaminate.
    if (!goodEnough(stats) && (await supportsAliked())) {
      colmapLog(
        `SIFT tiers registered ${stats?.images ?? 0}/${frameCount}; retrying with ALIKED+LightGlue`,
      );
      set(
        { stageProgress: 0.6, message: 'Retrying with learned features…' },
        SFM_BASE + SFM_SPAN * 0.6,
        true,
      );
      const dbAliked = join(root, 'database-aliked.db');
      await rm(dbAliked, { force: true });
      await featureExtractor(
        dbAliked,
        imagesDir,
        PIPELINE.maxImageDim,
        (f, msg) => mapProgress(0.1 * f, msg ?? 'Detecting learned features…'),
        colmapLog,
        { type: 'ALIKED' },
      );
      await sequentialMatcher(
        dbAliked,
        (f, msg) => mapProgress(0.1 + 0.2 * f, msg ?? 'Matching learned features…'),
        colmapLog,
        { featureType: 'aliked', loopDetection: false },
      );
      await resetSparse();
      if (await supportsGlobalMapper()) {
        try {
          await globalMapper(dbAliked, imagesDir, sparseDir, (f, msg) => mapProgress(0.3 + 0.7 * f, msg), colmapLog);
        } catch (err) {
          colmapLog(`global_mapper (aliked) failed: ${String((err as any)?.message ?? err)}`);
        }
        stats = await model0Stats();
      }
      if (!goodEnough(stats)) {
        await resetSparse();
        await mapper(dbAliked, imagesDir, sparseDir, frameCount, (f, msg) => mapProgress(0.3 + 0.7 * f, msg), colmapLog);
        stats = await model0Stats();
      }
    }
```

- [x] **Step 5 (verify mechanics):** Scratchpad: copy ~30 frames from an existing capture's `images/`, run ALIKED extraction + ALIKED_LIGHTGLUE sequential matching + `global_mapper` through the new wrappers via a tsx script. Confirms: ONNX models download, matching produces pairs, mapper registers most of the 30. (Forcing a genuine SIFT failure isn't practical here; IMG 1048-style pans still legitimately fail all four tiers.)

- [x] **Step 6:** `npx tsc -p server --noEmit`, then commit `feat: ALIKED+LightGlue learned-feature rescue tier`.

---

### Task 4: Spark viewer migration

**Files:**
- Modify: `web/package.json` (swap dep), `web/src/splat/SplatViewer.tsx` (rewrite internals, same props)
- Delete: `web/src/mkkellogg.d.ts`
- Unchanged by design: `SplatViewerLazy.tsx`, `ViewerScreen.tsx`, `PosterMaker.tsx`, `ab.tsx`

**Interfaces:**
- `SplatViewerProps` stays byte-identical (url, autoRotate, resetKey, sphericalHarmonicsDegree, cameraDistance, cameraHeight, minDistance, maxDistance, cameraPosition, cameraTarget, lookAround, captureRef, onProgress, onLoaded, onError). `sphericalHarmonicsDegree` becomes a no-op (Spark renders whatever SH the file has) but stays for API compatibility.

- [x] **Step 1 (reference screenshots BEFORE the swap):** `npm run dev` via the preview browser, open `/ab.html` (defaults to `samples/sample-scene.ply`), screenshot → this is the orientation/framing reference.

- [x] **Step 2:** `npm uninstall -w web @mkkellogg/gaussian-splats-3d && npm install -w web @sparkjsdev/spark`. Check Spark's three peer range (`npm info @sparkjsdev/spark peerDependencies`); bump `three`/`@types/three` in web/package.json if 0.170 is below the floor. Delete `web/src/mkkellogg.d.ts`.

- [x] **Step 3:** Rewrite `web/src/splat/SplatViewer.tsx` internals:

```tsx
import { useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
```

Keep the existing props interface, `CAM_DIR`/`CAM_LEN`, and camera-position math verbatim. Effect body replaces the GaussianSplats3D.Viewer with:

- `THREE.WebGLRenderer({ antialias: false })`, `setPixelRatio(min(devicePixelRatio, 2))`, size from container, `setClearColor(0xeef1f6, 1)`, canvas appended to the outer div.
- `THREE.PerspectiveCamera(50, aspect, 0.02, 500)`; `camera.up.set(0, -1, 0)` (splats are cleaned to −Y up — same convention as before); position/target from the existing math.
- `new SparkRenderer({ renderer })` added to the scene.
- `new OrbitControls(camera, renderer.domElement)` with the same damping/speed/clamps/auto-rotate-idle logic as today (incl. the polar-clamp formula and lookAround clamps); `controls.saveState()` after setup so `resetKey` → `controls.reset()` keeps working.
- `new SplatMesh({ url, onProgress: (e) => e.lengthComputable && onProgress?.((100 * e.loaded) / e.total), onLoad: () => { … onLoaded?.() } })`, added to scene **unrotated** (verify orientation in Step 4; if Spark flips PLY coords internally, apply `splats.quaternion.set(1, 0, 0, 0)` and mirror the hint vectors `v → (x, −y, −z)` + `camera.up.set(0, 1, 0)` at the component boundary instead).
- Load errors: wire whatever rejection surface SplatMesh exposes (check `node_modules/@sparkjsdev/spark/dist/*.d.ts` for an `initialized`/`loaded` promise) to `onError`; also try/catch construction.
- `renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); })`.
- `captureRef.current = () => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); }`.
- `ResizeObserver` on the container → `renderer.setSize` + `camera.aspect`/`updateProjectionMatrix`.
- Cleanup: `setAnimationLoop(null)`, controls.dispose(), `splats.dispose?.()`, scene.remove, renderer.dispose(), canvas removal, observer.disconnect().

- [x] **Step 4 (verify in browser):** Reload `/ab.html` → sample loads, orientation matches the Step 1 reference (fix per Step 3's flip note if not). Check console for errors. `window.__loaded[0]` true; `window.__cap[0]()` returns a data-URL PNG (poster path). Then the main app: open a library capture in the Viewer — HQ file (spz for old captures) loads, orbit/zoom clamps behave, Recenter works, snapshot works. Load the Task 1 `.sog` in ab.html (`/ab.html?a=<sog-url>`) to confirm SOG renders. Screenshot proof.

- [x] **Step 5:** `npm -w web run build` (vite build + tsc) passes. Commit `feat: swap retired gaussian-splats-3d viewer for Spark`.

---

### Task 5: Windows setup zip fix

**Files:**
- Modify: `scripts/setup.mjs:70-95`

- [x] **Step 1:** Replace the extraction block: on win32 + `.zip`, extract with PowerShell `Expand-Archive` directly into `join(brushDir, m.dir)` (GNU tar on PATH misparses `E:\…` as `host:file`); keep `tar -xf` for the `.tar.xz` platforms. Handle a possible nested top-level folder by moving `dest/m.dir/*` up when `binPath` is missing. Drop the old `tar -tf`-based flat-move logic for the zip path.

```js
  let extracted = false;
  if (process.platform === 'win32' && m.asset.endsWith('.zip')) {
    // GNU tar (often first on PATH via Git) misreads `E:\…` as a remote
    // host spec; PowerShell's Expand-Archive has no such failure mode.
    const dest = join(brushDir, m.dir);
    mkdirSync(dest, { recursive: true });
    const psq = (s) => `'${s.replace(/'/g, "''")}'`;
    const ps = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath ${psq(archive)} -DestinationPath ${psq(dest)} -Force`,
    ], { stdio: 'inherit' });
    extracted = ps.status === 0;
    // A future zip may gain a top-level folder; flatten it if so.
    const nested = join(dest, m.dir, m.exe);
    if (extracted && !existsSync(binPath) && existsSync(nested)) {
      for (const entry of readdirSync(join(dest, m.dir))) {
        renameSync(join(dest, m.dir, entry), join(dest, entry));
      }
      rmSync(join(dest, m.dir), { recursive: true, force: true });
    }
  } else {
    const ex = spawnSync('tar', ['-xf', archive, '-C', brushDir], { stdio: 'inherit' });
    extracted = ex.status === 0;
  }
  if (!extracted) {
    console.log(c.r(`  ✗  Could not extract ${m.asset}.`));
    return false;
  }
```

(`readdirSync` needs adding to the fs import.)

- [x] **Step 2 (verify for real):** Rename `tools/brush/brush-app-x86_64-pc-windows-msvc` → `…-msvc.bak`, run `npm run setup` — it must download + extract + land `brush_app.exe` in the right dir on this machine (the exact path that used to fail). Then delete the `.bak`. `npm run doctor` green.

- [x] **Step 3:** Commit `fix: extract Brush zip with Expand-Archive on Windows`.

---

### Task 6: doctor reports COLMAP capabilities

**Files:**
- Modify: `server/src/doctor.ts`

- [x] **Step 1:** After the tool table, when colmap is ok, probe + print capabilities:

```ts
import { supportsGlobalMapper, supportsAliked } from './tools/colmap';
// … after the tool loop:
if (tools.colmap.ok) {
  const [glob, aliked] = await Promise.all([supportsGlobalMapper(), supportsAliked()]);
  const cap = (b: boolean) => (b ? '\x1b[32myes\x1b[0m' : '\x1b[33mno\x1b[0m');
  console.log(`     global mapper: ${cap(glob)} · learned features: ${cap(aliked)}  \x1b[2m(COLMAP ≥ 4.x unlocks both)\x1b[0m`);
  console.log();
}
```

Also fix the stray `Diorama` header string → `Savor`.

- [x] **Step 2 (verify):** `npm run doctor` → both capabilities "yes" on this machine.

- [x] **Step 3:** Commit `feat: doctor shows COLMAP global-mapper/learned-feature support`.

---

### Task 7: End-to-end run + README

**Files:**
- Modify: `README.md`

- [x] **Step 1 (full-pipeline verification):** Run a fresh capture end-to-end (re-use a known-good video, e.g. `E:\Documents\Splatting\data\video.mov`, via the UI or `POST /api/captures`). Confirm: global mapper solves it (colmap.log shows no incremental fallback), wall-time for the SfM stage drops vs. an old log, training runs, `scene.ply` + `scene.sog` produced, viewer shows it via Spark, poster appears. Record before/after SfM timings.

- [x] **Step 2:** README updates:
  - Pipeline diagram/table: Solve row → "SIFT + sequential matching → **global mapper** (GLOMAP, COLMAP ≥ 4) with incremental + learned-feature (ALIKED+LightGlue) fallback tiers"; Train row unchanged; View row → Spark; Clean row → mention `.sog` HQ output.
  - Requirements: recommend COLMAP ≥ 4.x (3.x works; fallback tiers cover it).
  - Notes: swap gaussian-splats-3d link for Spark; drop the spz/Python mention if present.

- [x] **Step 3:** Commit `docs: README for global mapper, learned features, Spark, SOG`.

## Self-Review

- Spec coverage: global mapper (T2), ALIKED rescue (T3), Spark (T4), SOG replacing spz (T1), Windows setup fix (T5), plus doctor/README support tasks. ✓
- Placeholders: none — code blocks are complete; T4 Step 3 intentionally defers two empirically-determined details (orientation flip, error-promise name) with explicit decision procedures. ✓
- Type consistency: `supportsGlobalMapper`/`globalMapper`/`supportsAliked` names match across T2/T3/T6; `convertPlyToSog` matches T1 pipeline wiring; `goodEnough`/`resetSparse`/`mapProgress` defined in T2 and reused in T3. ✓
