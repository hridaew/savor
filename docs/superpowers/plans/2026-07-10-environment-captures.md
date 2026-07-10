# Environment Captures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-detect inside-out (environment) captures and view them from within — camera at the capture position, look-around controls, real posters.

**Architecture:** Camera view directions come from COLMAP's images.bin (colmap.ts); detection + normalized capture position from splatClean.ts; `kind`/`envCamPos`/`envCamDir` flow through pipeline → meta → web; SplatViewer gains look-around props consumed by ViewerScreen, PosterMaker, and ab.tsx.

**Tech Stack:** Node/TypeScript (tsx), React, @mkkellogg/gaussian-splats-3d.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-10-environment-captures-design.md`
- No user-facing options; detection is automatic (`orbitRaw < 1.05 × radius`).
- Environment captures skip the orbit-interior haze pass; global floater pass unchanged.
- Old captures without `kind` behave exactly as today (object framing).
- Verify with `npx -w server tsc --noEmit` and `npm run build` before each commit.

---

### Task 1: Camera poses + detection + plumbing (server)

**Files:**
- Modify: `server/src/tools/colmap.ts` (readCameraPoses)
- Modify: `server/src/tools/splatClean.ts` (isEnvironment, camPos, conditional haze)
- Modify: `server/src/pipeline.ts` (use readCameraPoses, set kind/envCamPos/envCamDir)
- Modify: `server/src/types.ts`, `web/src/types.ts` (new fields)

**Interfaces:**
- Produces: `readCameraPoses(modelDir): Promise<{ centers: [number,number,number][]; medianDir: [number,number,number] } | null>`
- Produces: `CleanResult.isEnvironment: boolean`, `CleanResult.camPos?: [number,number,number]`
- Produces: `Capture.kind?: 'object' | 'environment'`, `Capture.envCamPos?`, `Capture.envCamDir?`

- [ ] **Step 1: colmap.ts — refactor reader to also collect optical axes**

Rename the parsing core to `readCameraPoses`; per image, after computing the
rotation rows, the world-space optical axis is `(r20, r21, r22)` (third
column of Rᵀ). Collect axes; medianDir = component-wise median, normalized.
Keep `readCameraCenters` as a wrapper returning `.centers ?? null`.

- [ ] **Step 2: splatClean.ts — detection, camPos, conditional haze**

After computing `orbitRaw`: `const isEnvironment = orbitRaw > 0 && orbitRaw < 1.05 * radius;`
Skip the haze loop when `isEnvironment` (leave `hazeRemoved = 0`).
Median camera center `[mx,my,mz]` (component-wise) transformed:
`camPos = [(mx-c[0])*norm, (my-c[1])*norm, (mz-c[2])*norm]` when centers exist.
Add both to `CleanResult`.

- [ ] **Step 3: pipeline.ts + types**

`const poses = await readCameraPoses(model0);` pass `poses?.centers` as
`cameraCenters`. After clean: `cap.kind = clean.isEnvironment ? 'environment' : 'object';`
and when environment: `cap.envCamPos = clean.camPos; cap.envCamDir = poses?.medianDir;`
and do NOT set `orbitRadius`/`orbitHeight`. Add the three fields to both
types files (with legacy comment).

- [ ] **Step 4: Verify + commit**

`npx tsx server/scripts/verify-clean.ts` still passes (objects unchanged;
env capture logs isEnvironment via a temporary console check if needed).
`npx -w server tsc --noEmit` clean.

```bash
git add server/src/tools/colmap.ts server/src/tools/splatClean.ts server/src/pipeline.ts server/src/types.ts web/src/types.ts
git commit -m "Detect environment captures; camera poses and haze-pass skip"
```

### Task 2: Look-around viewing (web)

**Files:**
- Modify: `web/src/splat/SplatViewer.tsx` (cameraPosition/cameraTarget/lookAround props)
- Modify: `web/src/screens/ViewerScreen.tsx` (env props)
- Modify: `web/src/App.tsx` (pass kind/envCamPos/envCamDir)
- Modify: `web/src/components/PosterMaker.tsx` (env framing)
- Modify: `web/src/ab.tsx` (pos/dir query params)
- Modify: `web/src/screens/CreateSheet.tsx` (one guidance sentence)

**Interfaces:**
- Consumes: `Capture.kind/envCamPos/envCamDir` from Task 1.
- Produces: `SplatViewerProps.cameraPosition?: [number,number,number]`,
  `cameraTarget?: [number,number,number]`, `lookAround?: boolean`.

- [ ] **Step 1: SplatViewer props**

When `cameraPosition` given it wins over distance/height math; target =
`cameraTarget ?? [0,0,0]`. When `lookAround`: `initialCameraLookAt = target`,
controls get `minDistance 0.1`, `maxDistance 2`, `autoRotateSpeed 0.6`, no
polar clamping.

- [ ] **Step 2: ViewerScreen/App/PosterMaker/ab.tsx**

ViewerScreen takes `kind/envCamPos/envCamDir`; when environment:
`cameraPosition = envCamPos`, `cameraTarget = envCamPos + 0.6·envCamDir`,
`lookAround`. PosterMaker same mapping. ab.tsx reads `pos=x,y,z&dir=x,y,z`.
CreateSheet: add the walk-an-arc sentence to the tips copy.

- [ ] **Step 3: Verify + commit**

`npm run build` clean. Retry IMG 1037 (`curl -X POST .../rYREdf3FoQ/retry`);
after ready: `kind === 'environment'`, poster shows the room interior,
viewer opens inside. Spot-check an object capture unchanged and IMG_1048
still fails with the pan message.

```bash
git add web/src server/src
git commit -m "Environment captures: look-around viewer, posters from inside"
```
