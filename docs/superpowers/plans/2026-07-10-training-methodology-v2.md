# Training Methodology v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut training time ~65% with a fixed 12k-step MCMC recipe, collapse Object/Scene into one floater-free Scene output, pick the sharpest video frames, and show real splat posters in the library.

**Architecture:** All pipeline behavior stays in `server/src` (config → ffmpeg → colmap → brush → splatClean); the web app loses the Subject/Scene toggle and gains a background poster worker. No new dependencies; no test framework exists, so each task verifies with `tsc --noEmit` plus one-off `tsx` scripts run against the real captures in `workspace/`.

**Tech Stack:** Node/TypeScript (tsx), Express, ffmpeg 8 filtergraphs, Brush 0.3 CLI, React + @mkkellogg/gaussian-splats-3d.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-10-training-methodology-v2-design.md`
- No user-facing quality options anywhere.
- Brush flags: `--total-steps 12000`, `--growth-stop-iter 9000`, `--max-splats 1000000`, `--sh-degree 2`; the `--growth-grad-threshold` / `--growth-select-fraction` overrides are REMOVED.
- One cleaned output pair per capture: `scene.ply` (fast) + `scene-hq.ply`/`scene.spz`. No subject-only outputs.
- Cleaning never deletes splats inside the subject's own extent.
- Old captures (with legacy `fullSplatUrl` etc.) must keep working in the viewer.
- Typecheck both workspaces before each commit: `npx -w server tsc --noEmit` and `npm run build` (web).

---

### Task 1: Training recipe

**Files:**
- Modify: `server/src/config.ts:82-95` (PIPELINE block)
- Modify: `server/src/tools/brush.ts:99-110` (arg list)

**Interfaces:**
- Produces: `PIPELINE.trainSteps = 12000`, `PIPELINE.growthStopIter = 9000`, `PIPELINE.maxSplats = 1_000_000`, `PIPELINE.shDegree = 2` (numbers, consumed by brush.ts and pipeline.ts).
- Removes: `PIPELINE.growthGradThreshold`, `PIPELINE.growthSelectFraction` (grep confirms only brush.ts uses them).

- [ ] **Step 1: Update `PIPELINE` in config.ts**

Replace the `trainSteps`/densification block (lines 82–95) with:

```ts
  /**
   * Brush training recipe. Not user-selectable — one setting, the best one.
   * 12k steps with a 9k growth window captures nearly all visible quality:
   * every observed 30k run froze splat growth at 15k and spent the rest on
   * texture polish. --max-splats keeps time/memory/file size predictable and
   * lets Brush's MCMC relocation fill the environment instead of the old
   * aggressive growth overrides (which produced 100k–3.6M splat counts).
   */
  trainSteps: 12000,
  growthStopIter: 9000,
  maxSplats: 1_000_000,
  /** The viewer renders SH degree 2 max — degree 3 is invisible compute. */
  shDegree: 2,
```

- [ ] **Step 2: Update Brush args in brush.ts**

Replace the arg array in `train()`:

```ts
      [
        datasetDir,
        '--total-steps', String(opts.totalSteps),
        '--growth-stop-iter', String(PIPELINE.growthStopIter),
        '--max-splats', String(PIPELINE.maxSplats),
        '--sh-degree', String(PIPELINE.shDegree),
        '--max-resolution', String(opts.maxResolution),
        '--export-path', outputDir,
        '--export-name', 'splat_{iter}.ply',
        '--export-every', String(exportEvery),
      ],
```

- [ ] **Step 3: Typecheck**

Run: `npx -w server tsc --noEmit` — expected: no output. (`grep -r growthGradThreshold server/` must return nothing.)

- [ ] **Step 4: Commit**

```bash
git add server/src/config.ts server/src/tools/brush.ts
git commit -m "Training recipe v2: 12k steps, MCMC splat budget, SH degree 2"
```

---

### Task 2: splatClean v3 — single scene output, measurement-only subject

**Files:**
- Rewrite: `server/src/tools/splatClean.ts`
- Create: `server/scripts/verify-clean.ts` (verification script, committed)

**Interfaces:**
- Produces: `cleanSplat(rawPath: string, scenePath: string, opts?: CleanOptions): Promise<CleanResult>` — note: subject path parameter is GONE; second positional is the scene output.
- `CleanOptions` drops `subjectHqPath`, keeps `sceneHqPath`, `cameraCenters`, and tuning fields; adds `hazeAlpha` (default 0.08) and `hazeSupportMul` (default 2).
- `CleanResult` becomes: `{ center, radius, total, sceneKept, floaters, hazeRemoved, planeFound, sceneBytes, sceneBytesHq?, orbitRadius, orbitHeight }` (no `subjectKept`, no `cleanBytes*`).

- [ ] **Step 1: Rewrite splatClean.ts**

Keep unchanged: header parsing (`parseHeader`, `sizeOf`), `median`/`percentile`, `KEEP_PROPS_FAST`, the multi-scale voxel grids + `support()`, the global floater/needle pass, the RANSAC plane fit, and `writePly` (transform included). Delete: `candMask`, connected components (`occ`/`inComp`/`dilated`), footprint filter, subject membership, degenerate fallback, subject output writes.

Read the two new options next to the existing ones: `const hazeAlpha = opts.hazeAlpha ?? 0.08;` and `const hazeSupportMul = opts.hazeSupportMul ?? 2;`.

New flow after the floater pass and plane fit:

```ts
  // ── Subject center + extent — MEASUREMENT ONLY, never deletes splats ──
  // Solid subject-scale splats near the robust center, above the support
  // plane if one was found; their median is the pivot, their spread the
  // framing radius.
  const est: number[] = [];
  for (let i = 0; i < N; i++) {
    if (isFloater[i]) continue;
    if (size[i] > subjectCap) continue;
    if (dist[i] > 1.5 * medD) continue;
    if (plane && aboveness(i) > planeCut) continue; // at/below the table
    est.push(i);
  }
  const pool = est.length > 500 ? est : Array.from({ length: N }, (_, i) => i);
  const c: [number, number, number] = [
    median(pool.map((i) => xs[i])),
    median(pool.map((i) => ys[i])),
    median(pool.map((i) => zs[i])),
  ];
  const subjDists = pool
    .map((i) => Math.hypot(xs[i] - c[0], ys[i] - c[1], zs[i] - c[2]))
    .sort((a, b) => a - b);
  const radius = percentile(subjDists, framePercentile) || medD;
```

Orbit radius (same as before) then the strengthened haze pass:

```ts
  // ── Orbit-interior haze pass ──────────────────────────────────────────
  // The camera physically swept the air between the subject's surface and
  // the orbit path. Anything hanging there without solid support is haze:
  // small splats need double the usual neighbours, faint ones triple, big
  // ones must not be near-alone, and giant ones don't belong there at all.
  const hazeR = orbitRaw > 0 ? 0.9 * orbitRaw : nearFieldMul * radius;
  const isHaze = new Uint8Array(N);
  let hazeRemoved = 0;
  for (let i = 0; i < N; i++) {
    if (isFloater[i]) continue;
    const d = Math.hypot(xs[i] - c[0], ys[i] - c[1], zs[i] - c[2]);
    if (d < 1.3 * radius || d > hazeR) continue;       // subject core / far field
    if (plane && aboveness(i) > planeCut) continue;    // table surface, not air
    const sup = support(i);
    const giant = size[i] > subjectCap;
    const weakSmall = levelOf[i] <= 2 && sup < hazeSupportMul * minNeighbors;
    const faint = alpha[i] < hazeAlpha && sup < 3 * minNeighbors;
    const bigLonely = levelOf[i] > 2 && sup < 2;
    if (giant || weakSmall || faint || bigLonely) {
      isHaze[i] = 1;
      hazeRemoved++;
    }
  }

  const sceneIdx: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!isFloater[i] && !isHaze[i]) sceneIdx.push(i);
  }
```

Then the existing normalize/write machinery: `writePly(scenePath, sceneIdx, keepFast)` and `if (opts.sceneHqPath) writePly(opts.sceneHqPath, sceneIdx, keepHq)`. Update the module doc comment to describe the new contract (one scene output; subject stats are framing metadata only). Signature: `cleanSplat(rawPath, scenePath, opts)`.

- [ ] **Step 2: Write the verification script (failing first)**

`server/scripts/verify-clean.ts`:

```ts
// Verify splatClean v3 against real captures: environment must survive,
// haze must go, output must exist. Usage: npx tsx server/scripts/verify-clean.ts
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, existsSync } from 'node:fs';
import { cleanSplat } from '../src/tools/splatClean';
import { readCameraCenters } from '../src/tools/colmap';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ids = readdirSync(join(ROOT, 'workspace')).filter((d) =>
  existsSync(join(ROOT, 'workspace', d, 'output')),
);
let failed = false;
for (const id of ids) {
  const out = join(ROOT, 'workspace', id, 'output');
  const raws = readdirSync(out)
    .filter((f) => /^splat_\d+\.ply$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (!raws.length) continue;
  const cameraCenters =
    (await readCameraCenters(join(ROOT, 'workspace', id, 'sparse', '0'))) ?? undefined;
  const r = await cleanSplat(join(out, raws[raws.length - 1]), join(out, 'verify-scene.ply'), {
    cameraCenters,
  });
  const keptPct = (100 * r.sceneKept) / r.total;
  const ok = keptPct >= 85 && r.sceneKept > 0 && r.radius > 0;
  console.log(
    `${id}: kept=${r.sceneKept}/${r.total} (${keptPct.toFixed(1)}%) ` +
      `floaters=${r.floaters} haze=${r.hazeRemoved} plane=${r.planeFound} ` +
      `orbitR=${r.orbitRadius.toFixed(2)} ${ok ? 'OK' : 'FAIL: kept<85% or degenerate'}`,
  );
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
```

(The script targets the NEW signature, so it cannot pass against the old code — it is the acceptance test for Step 1.)

- [ ] **Step 3: Run the verification script**

Run: `npx tsx server/scripts/verify-clean.ts`
Expected: one OK line per capture (4 captures), ≥85% kept on each, exit 0. If an environment-heavy capture drops below 85%, the haze pass is over-cutting — inspect which predicate fired (add a temporary counter per predicate) before loosening anything.

- [ ] **Step 4: Typecheck (splatClean has downstream users that still break — that's Task 3)**

Run: `npx -w server tsc --noEmit` — expected errors ONLY in `pipeline.ts` and `scripts/clean-capture.ts` (old call shape). No errors inside splatClean.ts itself.

- [ ] **Step 5: Commit**

```bash
git add server/src/tools/splatClean.ts server/scripts/verify-clean.ts
git commit -m "splatClean v3: single scene output, measurement-only subject, orbit haze pass"
```

---

### Task 3: Pipeline + server plumbing for the single output

**Files:**
- Modify: `server/src/pipeline.ts:264-307` (post-training block), `server/src/pipeline.ts:212-243` (preview closure — call shape only)
- Modify: `server/src/types.ts` (add `posterUrl?: string`; keep legacy fields)
- Modify: `server/src/index.ts:202-243` (retry reset list)
- Modify: `server/scripts/clean-capture.ts` (new call shape)

**Interfaces:**
- Consumes: `cleanSplat(raw, scenePath, opts)` and `CleanResult.sceneKept/sceneBytes/sceneBytesHq/hazeRemoved` from Task 2.
- Produces: `Capture.splatUrl` = fast scene ply, `Capture.splatHqUrl` = scene spz/hq ply, `Capture.gaussians` = sceneKept. `fullSplatUrl`/`fullSplatHqUrl`/`gaussiansFull` are no longer set (types keep them optional for legacy captures).

- [ ] **Step 1: Update pipeline.ts post-training block**

```ts
    // One cleaned output: the scene — subject intact, air floaters gone,
    // environment preserved. Camera centers drive the orbit-aware haze pass
    // and tell the viewer where to put the camera.
    const cameraCenters = (await readCameraCenters(model0)) ?? undefined;
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
    cap.orbitRadius = clean.orbitRadius > 0 ? clean.orbitRadius : undefined;
    cap.orbitHeight = clean.orbitRadius > 0 ? clean.orbitHeight : undefined;
    cap.splatBytes = clean.sceneBytes;
    cap.splatBytesHq = beautyBytes;
    cap.gaussians = clean.sceneKept;
```

(The preview closure's `cleanSplat(ply, previewTmp)` call already matches the new signature — no change needed there.) Remove the now-unused `fullSplatUrl`/`fullSplatHqUrl`/`gaussiansFull` assignments.

- [ ] **Step 2: types.ts — add poster, keep legacy**

In `server/src/types.ts` (and mirror in `web/src/types.ts`) add to `Capture`:

```ts
  /** Rendered splat poster for the library card (replaces thumbUrl when set). */
  posterUrl?: string;
```

Mark `fullSplatUrl`, `fullSplatHqUrl`, `gaussiansFull` with `/** Legacy (pre-v2 captures): scene file when subject/scene were separate. */`.

- [ ] **Step 3: index.ts retry reset — clear legacy + poster fields too**

In the retry route's `Object.assign(cap, {...})` keep the existing list (it already clears `fullSplatUrl`/`fullSplatHqUrl`) and add `posterUrl: undefined, gaussiansFull: undefined, orbitRadius: undefined, orbitHeight: undefined,`.

- [ ] **Step 4: clean-capture.ts — new call shape**

Replace the clean + meta patch section:

```ts
const scenePath = join(outDir, 'scene.ply');
const t0 = Date.now();
const r = await cleanSplat(raw, scenePath);
console.log(
  `plane=${r.planeFound}  floaters=${r.floaters}  haze=${r.hazeRemoved}  ` +
    `scene=${r.sceneKept}/${r.total}  radius=${r.radius.toFixed(3)}  (${Date.now() - t0}ms)`,
);

const metaPath = join(dir, 'meta.json');
const meta = JSON.parse(await readFile(metaPath, 'utf8'));
const v = (meta.steps || 1) + (Date.now() % 1000);
meta.splatUrl = `/files/${id}/output/scene.ply?v=${v}`;
meta.fullSplatUrl = undefined;
meta.gaussians = r.sceneKept;
meta.splatBytes = r.sceneBytes;
await writeFile(metaPath, JSON.stringify(meta, null, 2));

await copyFile(scenePath, join(ROOT, 'samples', 'sample-scene.ply'));
console.log('patched meta.json + refreshed samples/sample-scene.ply');
```

- [ ] **Step 5: Typecheck server clean**

Run: `npx -w server tsc --noEmit` — expected: no output at all now.

- [ ] **Step 6: Commit**

```bash
git add server/src/pipeline.ts server/src/types.ts server/src/index.ts server/scripts/clean-capture.ts
git commit -m "Pipeline emits a single scene output; poster field; legacy fields kept for old captures"
```

---

### Task 4: Viewer — one mode, orbit-aware always

**Files:**
- Modify: `web/src/screens/ViewerScreen.tsx`
- Modify: `web/src/App.tsx:230-246`
- Modify: `web/src/types.ts` (same Capture edits as server)

**Interfaces:**
- Consumes: `Capture.posterUrl` (Task 3 types), legacy URL fields.
- Produces: `ViewerScreen` props lose `sceneUrl`; single `url`.

- [ ] **Step 1: ViewerScreen — remove the mode**

Delete: `mode` state, `sceneUrl` prop, the `viewer-seg` toggle JSX, and the `mode === 'scene'` conditionals. `activeUrl` becomes `url`. Camera hint is now unconditional:

```ts
  // Orbit where the capture cameras were — the environment was trained to be
  // seen from there. Zoom/elevation stay clamped near that band.
  const sceneDist = orbitRadius && orbitRadius > 1.2 ? Math.min(orbitRadius, 8) : undefined;
  const camProps = sceneDist
    ? {
        cameraDistance: sceneDist,
        cameraHeight: orbitHeight ?? 0,
        minDistance: 0.45 * sceneDist,
        maxDistance: 1.2 * sceneDist,
      }
    : {};
```

Export filename drops the `_scene` suffix logic: `a.download = name.replace(/[^\w\-]+/g, '_') + '.' + exportExt`.

- [ ] **Step 2: App.tsx — prefer scene files for any capture generation**

```tsx
            {overlay.kind === 'viewer' && cap?.splatUrl && (
              <ViewerScreen
                name={cap.name}
                url={cap.fullSplatHqUrl ?? cap.fullSplatUrl ?? cap.splatHqUrl ?? cap.splatUrl}
                orbitRadius={cap.orbitRadius}
                orbitHeight={cap.orbitHeight}
                ...
```

(New captures only set `splatHqUrl`/`splatUrl` = scene; legacy captures resolve to their old scene file.) The sample viewer entry passes `url="/samples/sample-scene.ply"` and no `sceneUrl`.

- [ ] **Step 3: Build web**

Run: `npm run build` — expected: success, no TS errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/screens/ViewerScreen.tsx web/src/App.tsx web/src/types.ts
git commit -m "Viewer: single orbit-aware Scene mode, no toggle"
```

---

### Task 5: Sharpness-aware frame selection

**Files:**
- Modify: `server/src/tools/ffmpeg.ts` (add scoring + selection; keep uniform fallback)
- Create: `server/scripts/verify-frames.ts`

**Interfaces:**
- Consumes: existing `run()` helper, `probe()`.
- Produces: `extractFrames` signature unchanged (drop-in). Internal helpers `scoreFrames(input: string, totalFrames: number): Promise<Float64Array>` and `pickSharpest(scores: ArrayLike<number>, targetFrames: number): number[]` (exported for the verify script).

- [ ] **Step 1: Add scoring + window-max selection to ffmpeg.ts**

```ts
/**
 * Per-frame sharpness proxy: mean Sobel edge magnitude at 480px. One fast
 * decode pass; ~10× realtime. metadata=print emits one YAVG line per frame.
 */
export async function scoreFrames(input: string, totalFrames: number): Promise<Float64Array> {
  const scores = new Float64Array(Math.max(1, totalFrames));
  let idx = 0;
  await run(TOOLS.ffmpeg, [
    '-hide_banner', '-y',
    '-i', input,
    '-vf', 'scale=480:-2,format=gray,sobel,signalstats,metadata=print:file=-',
    '-an', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null',
  ], {
    onStdout: (line) => {
      const m = line.match(/signalstats\.YAVG=([\d.]+)/);
      if (m && idx < scores.length) scores[idx++] = Number(m[1]);
    },
  });
  return scores.slice(0, Math.max(1, idx));
}

/** Split frames into targetFrames windows; keep the sharpest frame of each. */
export function pickSharpest(scores: ArrayLike<number>, targetFrames: number): number[] {
  const total = scores.length;
  const n = Math.min(targetFrames, total);
  const picks: number[] = [];
  for (let w = 0; w < n; w++) {
    const start = Math.floor((w * total) / n);
    const end = Math.max(start + 1, Math.floor(((w + 1) * total) / n));
    let best = start;
    for (let i = start + 1; i < end; i++) if (scores[i] > scores[best]) best = i;
    picks.push(best);
  }
  return picks;
}
```

In `extractFrames`, before building `vf`: try scoring; on any throw (or `< targetFrames/2` scored frames) fall back to the existing stride expression.

```ts
  let selectExpr: string;
  let expected: number;
  try {
    const scores = await scoreFrames(input, total);
    const picks = pickSharpest(scores, opts.targetFrames);
    if (picks.length < Math.min(opts.targetFrames, scores.length) / 2) throw new Error('too few scored frames');
    selectExpr = picks.map((n) => `eq(n\\,${n})`).join('+');
    expected = picks.length;
  } catch {
    const stride = Math.max(1, Math.round(total / opts.targetFrames));
    selectExpr = `not(mod(n\\,${stride}))`;
    expected = Math.max(1, Math.floor(total / stride));
  }
  const vf =
    `select=${selectExpr},` +
    `scale=w=${opts.maxDim}:h=${opts.maxDim}:force_original_aspect_ratio=decrease`;
```

(`stride` in the returned `ExtractResult` becomes `Math.max(1, Math.round(total / expected))` — it's only informational.)

- [ ] **Step 2: Verify script (run failing first if written before Step 1)**

`server/scripts/verify-frames.ts`:

```ts
// Verify sharpness scoring on a real capture's source video.
// Usage: npx tsx server/scripts/verify-frames.ts <captureId>
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { probe, scoreFrames, pickSharpest } from '../src/tools/ffmpeg';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const id = process.argv[2];
const dir = join(ROOT, 'workspace', id);
const src = readdirSync(dir).find((f) => f.startsWith('source.'));
if (!src) throw new Error('no source video');
const info = await probe(join(dir, src));
const scores = await scoreFrames(join(dir, src), info.totalFrames);
const picks = pickSharpest(scores, 150);
const uniform = Array.from({ length: picks.length }, (_, w) =>
  Math.floor((w * scores.length) / picks.length),
);
const avg = (ix: number[]) => ix.reduce((s, i) => s + scores[i], 0) / ix.length;
console.log(`frames scored: ${scores.length}/${info.totalFrames}`);
console.log(`picked ${picks.length}; sharpness picked=${avg(picks).toFixed(2)} uniform=${avg(uniform).toFixed(2)}`);
const monotonic = picks.every((p, k) => k === 0 || p > picks[k - 1]);
if (!monotonic || avg(picks) < avg(uniform)) {
  console.error('FAIL: picks not monotonic or not sharper than uniform');
  process.exit(1);
}
console.log('OK');
```

Run: `npx tsx server/scripts/verify-frames.ts I4oNg3Jrqf`
Expected: `OK`, picked sharpness ≥ uniform sharpness, monotonic picks.

- [ ] **Step 3: Typecheck**

Run: `npx -w server tsc --noEmit` — expected: clean.

- [ ] **Step 4: Commit**

```bash
git add server/src/tools/ffmpeg.ts server/scripts/verify-frames.ts
git commit -m "Sharpness-aware frame selection: pick the sharpest frame per window"
```

---

### Task 6: Poster endpoint

**Files:**
- Modify: `server/src/index.ts` (new route after the logs route)

**Interfaces:**
- Produces: `POST /api/captures/:id/poster` accepting raw `image/jpeg` body (≤10 MB) → writes `<capture>/poster.jpg`, sets `cap.posterUrl = /files/<id>/poster.jpg?v=<ts>`, `store.put(cap, { flush: true })`, responds `{ ok: true, posterUrl }`.

- [ ] **Step 1: Add the route**

```ts
app.post(
  '/api/captures/:id/poster',
  express.raw({ type: 'image/jpeg', limit: '10mb' }),
  (req, res) => {
    const cap = store.get(req.params.id);
    if (!cap) return res.status(404).json({ error: 'not found' });
    if (cap.status !== 'ready') return res.status(409).json({ error: 'capture not ready' });
    if (!Buffer.isBuffer(req.body) || req.body.length < 1000) {
      return res.status(400).json({ error: 'expected a JPEG body' });
    }
    const posterPath = join(store.dirOf(cap.id), 'poster.jpg');
    writeFileSync(posterPath, req.body);
    cap.posterUrl = `/files/${cap.id}/poster.jpg?v=${Date.now() % 1e7}`;
    store.put(cap, { flush: true });
    res.json({ ok: true, posterUrl: cap.posterUrl });
  },
);
```

Add `writeFileSync` to the `node:fs` import.

- [ ] **Step 2: Verify with curl against a running server**

Run (with `npm run dev:server` up): create a tiny jpeg and post it —

```powershell
ffmpeg -y -f lavfi -i color=c=gray:s=64x64 -frames:v 1 $env:TEMP\p.jpg
curl.exe -s -X POST -H "Content-Type: image/jpeg" --data-binary "@$env:TEMP\p.jpg" http://localhost:8787/api/captures/I4oNg3Jrqf/poster
```

Expected: `{"ok":true,"posterUrl":"/files/I4oNg3Jrqf/poster.jpg?v=..."}` and the file exists. A bogus id returns 404.

- [ ] **Step 3: Typecheck + commit**

```bash
npx -w server tsc --noEmit
git add server/src/index.ts
git commit -m "Poster endpoint: save a rendered splat poster per capture"
```

---

### Task 7: Web poster worker + card

**Files:**
- Create: `web/src/components/PosterMaker.tsx`
- Modify: `web/src/App.tsx` (mount it), `web/src/components/CaptureCard.tsx:47-51` (poster-first background)

**Interfaces:**
- Consumes: `SplatViewer` (`captureRef`, `onLoaded`, `cameraDistance/Height` props), `Capture.posterUrl`, poster endpoint from Task 6.
- Produces: `<PosterMaker captures={captures} />` — renders `null` or one hidden 480×360 viewer.

- [ ] **Step 1: PosterMaker component**

```tsx
import { useEffect, useRef, useState } from 'react';
import type { Capture } from '../types';
import { Suspense } from 'react';
import { SplatViewerLazy } from '../splat/SplatViewerLazy';

/** Fast (SH-stripped) scene file — cheap to load offscreen. */
function fastUrl(c: Capture): string | undefined {
  return c.fullSplatUrl ?? c.splatUrl;
}

/**
 * Background poster factory: one at a time, quietly loads a finished splat in
 * a hidden viewer, snapshots it, and posts the JPEG to the server. The WS
 * update then flips every client's card from video thumb to splat poster.
 */
export function PosterMaker({ captures }: { captures: Capture[] }) {
  const attempted = useRef(new Set<string>());
  const [job, setJob] = useState<Capture | null>(null);
  const captureRef = useRef<(() => string) | null>(null);

  useEffect(() => {
    if (job) return;
    const next = captures.find(
      (c) => c.status === 'ready' && !c.posterUrl && fastUrl(c) && !attempted.current.has(c.id),
    );
    if (next) setJob(next);
  }, [captures, job]);

  const finish = () => {
    if (job) attempted.current.add(job.id);
    captureRef.current = null;
    setJob(null);
  };

  const snap = async () => {
    if (!job) return;
    try {
      // Let progressive refinement settle for a beat before the shot.
      await new Promise((r) => setTimeout(r, 800));
      const dataUrl = captureRef.current?.();
      if (!dataUrl) return finish();
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, 640, 480);
      const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
      if (blob) {
        await fetch(`/api/captures/${job.id}/poster`, {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg' },
          body: blob,
        });
      }
    } catch { /* posters are best-effort */ }
    finish();
  };

  if (!job) return null;
  const dist = job.orbitRadius && job.orbitRadius > 1.2 ? Math.min(job.orbitRadius, 8) : undefined;
  return (
    <div style={{ position: 'fixed', left: -10000, top: 0, width: 480, height: 360, overflow: 'hidden', pointerEvents: 'none' }} aria-hidden>
      <Suspense fallback={null}>
        <SplatViewerLazy
          url={fastUrl(job)!}
          autoRotate={false}
          sphericalHarmonicsDegree={0}
          cameraDistance={dist}
          cameraHeight={dist ? job.orbitHeight ?? 0 : undefined}
          captureRef={captureRef}
          onLoaded={snap}
          onError={finish}
        />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 2: Mount in App.tsx and prefer posters on cards**

In `App.tsx`, next to the screens (inside the top-level layout, always mounted): `<PosterMaker captures={captures} />` (use whatever the captures array variable is named there).

In `CaptureCard.tsx` replace the thumb background block:

```tsx
      {(() => {
        const art = cap.posterUrl ?? cap.thumbUrl;
        return (
          <div
            className={`cap-thumb ${art ? '' : 'placeholder'}`}
            style={art ? { backgroundImage: `url(${art})` } : undefined}
          >
            {!art && <Icon name="cube" size={34} weight={1.5} />}
```

(keep the badge/veil children unchanged, close the IIFE after the div).

- [ ] **Step 3: Build + live check**

Run: `npm run build` — clean. Then with `npm run dev` running and the library open, watch an existing ready capture: within ~10s its card should switch from the video frame to a rendered splat poster (check `workspace/<id>/poster.jpg` appears). Delete a poster.jpg + reload to test retroactive generation.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/PosterMaker.tsx web/src/App.tsx web/src/components/CaptureCard.tsx
git commit -m "Library posters: offscreen splat render replaces video thumbnails"
```

---

### Task 8: Verification — A/B checkpoints, then end-to-end

**Files:**
- Create: `server/scripts/prep-ab.ts` (throwaway helper, committed for repeatability)

**Interfaces:** consumes everything above.

- [ ] **Step 1: Prepare 12.5k vs 30k A/B files for two captures**

`server/scripts/prep-ab.ts`:

```ts
// Clean two checkpoints of a capture for visual A/B in the viewer.
// Usage: npx tsx server/scripts/prep-ab.ts <captureId>
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanSplat } from '../src/tools/splatClean';
import { readCameraCenters } from '../src/tools/colmap';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const id = process.argv[2];
const out = join(ROOT, 'workspace', id, 'output');
const cameraCenters =
  (await readCameraCenters(join(ROOT, 'workspace', id, 'sparse', '0'))) ?? undefined;
for (const [src, dst] of [
  ['splat_12500.ply', 'ab-12k.ply'],
  ['splat_30000.ply', 'ab-30k.ply'],
] as const) {
  const r = await cleanSplat(join(out, src), join(out, dst), { cameraCenters });
  console.log(`${dst}: kept ${r.sceneKept}/${r.total}, orbitR=${r.orbitRadius.toFixed(2)}`);
  console.log(`  http://localhost:8787/files/${id}/output/${dst}`);
}
```

Run for `I4oNg3Jrqf` (Mighty Hand) and `JC3fXM9Rff` (BrokenCar). Give the user the two URL pairs to A/B in the viewer (open via the app's viewer by URL or a temporary card). **User judges:** if 12k reads "good enough", keep `trainSteps: 12000`; otherwise bump to 15000 (and growthStopIter to 11000) in config.ts.

- [ ] **Step 2: End-to-end run with the new recipe**

Retry an existing capture (uses its stored source video): `curl.exe -s -X POST http://localhost:8787/api/captures/iNXl5xooCH/retry`. Watch `meta.json`/UI. Confirm:
- wall time vs the old 9.9–31 min (expect roughly a third),
- frames extracted = ~150 sharp frames (extraction log),
- scene looks right: subject whole, no air floaters near it, environment present,
- poster.jpg appears in the library after completion.

- [ ] **Step 3: Cleanup + final commit**

Delete `verify-scene.ply`/`ab-*.ply` outputs from workspace (runtime dir, not committed). Commit the helper script:

```bash
git add server/scripts/prep-ab.ts
git commit -m "Add A/B checkpoint prep script for step-count validation"
```
