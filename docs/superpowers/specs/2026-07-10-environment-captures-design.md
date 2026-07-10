# Environment Captures — Design

Approved 2026-07-10. Captures filmed from *inside* a space (IMG 1037: walking
through a room) already reconstruct and train correctly; they only present
wrong — the viewer orbits every splat from outside, so a room renders as the
smeared backs of its walls. This adds an auto-detected environment mode.
No user-facing options.

## Evidence

- IMG 1037: 141/150 registered, 199k splats, 7.7 min — pipeline fine.
  `orbitRadius` 0.74 (cameras inside the splat's extent); the viewer's
  orbit framing and the poster both show outside-in smears.
- Object captures measure orbitRadius 2.6–8.8 (cameras outside). Clean
  discriminator.
- Pure standing pans (IMG 1048) are unrecoverable: 2/155 registered under
  sequential AND exhaustive matching; 9/155 even with
  `--Mapper.init_min_tri_angle 2 --Mapper.filter_min_tri_angle 0.5`.
  They keep the existing honest failure gate. Out of scope.

## 1. Camera pose extraction (server/src/tools/colmap.ts)

Extend the `images.bin` reader: alongside camera centers, compute each
camera's world-space optical axis (third row of R). New function
`readCameraPoses(modelDir)` returns
`{ centers: [x,y,z][], medianDir: [x,y,z] } | null` where `medianDir` is the
component-wise median of the axes, normalized. `readCameraCenters` becomes a
thin wrapper (or callers migrate).

## 2. Detection + cleaning (server/src/tools/splatClean.ts)

- Environment when `orbitRaw < 1.05 × radius` (median camera distance vs
  subject/framing radius). Exposed on `CleanResult` as
  `isEnvironment: boolean`.
- Environment captures SKIP the orbit-interior haze pass — its geometry
  assumes cameras outside the subject; inside a room it would eat furniture.
  The global scale-aware floater pass still runs.
- New `CleanResult.camPos: [x,y,z] | undefined` — median camera center,
  transformed into normalized output space. (View direction is unaffected by
  translate+uniform-scale, so it passes through the pipeline untransformed.)

## 3. Capture fields (server/src/types.ts, web/src/types.ts)

```ts
kind?: 'object' | 'environment';   // set when cleaning completes
envCamPos?: [number, number, number]; // normalized median capture position
envCamDir?: [number, number, number]; // unit median view direction
```

Old captures lack these → treated as objects (their orbitRadius is > 1.2
anyway). Retry regenerates them.

## 4. Pipeline (server/src/pipeline.ts)

Use `readCameraPoses`; pass centers to `cleanSplat` as today; set
`cap.kind`, and for environments `cap.envCamPos = clean.camPos`,
`cap.envCamDir = medianDir`. Orbit fields keep their current meaning for
objects; for environments they are not set (viewer keys off kind).

## 5. Viewer (web/src/splat/SplatViewer.tsx, ViewerScreen, PosterMaker, ab.tsx)

New SplatViewer props: `cameraPosition?: [x,y,z]`, `cameraTarget?: [x,y,z]`,
`lookAround?: boolean`. When lookAround:

- initial camera at `cameraPosition`, lookAt = `cameraPosition + 0.6 × dir`
  (target just ahead of the camera → head-turn feel with OrbitControls),
- zoom clamps `minDistance 0.1`, `maxDistance 2`, full polar freedom,
- auto-rotate slower (0.6) — a gentle look-around pan.

ViewerScreen/PosterMaker/ab.html choose look-around props when
`kind === 'environment'` (and fall back to object framing otherwise).
Posters for environments render from the capture position — a real view of
the space.

## 6. Capture guidance (web/src/screens/CreateSheet.tsx)

One added sentence to the capture tips: for spaces, walk a slow arc while
looking around — panning from one spot cannot be reconstructed.

## 7. Verification

1. Retry IMG 1037: completes, `kind = 'environment'`, poster shows the room
   interior, viewer opens inside the space and look-around feels right.
2. Retry (or inspect) an object capture: `kind = 'object'`, behavior
   unchanged.
3. IMG 1048 still fails with the pan message.
