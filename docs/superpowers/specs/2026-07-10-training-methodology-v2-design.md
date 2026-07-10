# Training Methodology v2 — Design

Approved 2026-07-10. Goal: faster, predictable training; one Scene mode with a
clean subject and intact environment; sharper input frames; real splat posters
in the library. No user-facing quality options anywhere.

## 1. Training recipe (server/src/config.ts, server/src/tools/brush.ts)

One hardcoded recipe passed to Brush:

| Flag | Value | Was | Why |
|---|---|---|---|
| `--total-steps` | 12000 | 30000 | Growth froze at 15k in every observed run; 15k–30k is texture polish only. ~60–70% wall-time saved. |
| `--growth-stop-iter` | 9000 | 15000 (default) | 75% growth window (vs default 50%) gives the environment time to densify. |
| `--max-splats` | 1000000 | 10M (default) | MCMC budget: predictable time/memory/file size. Replaces the aggressive growth overrides. |
| `--sh-degree` | 2 | 3 (default) | Viewer renders SH degree 2 max; degree 3 is invisible compute + ~35% file bloat. |

Removed: `--growth-grad-threshold` / `--growth-select-fraction` overrides
(caused 100k–3.6M splat-count lottery). Brush's MCMC relocation handles
environment coverage under the cap.

Export cadence stays `totalSteps / 12` (= every 1000 steps).

## 2. Single Scene output (server/src/tools/splatClean.ts, pipeline.ts, web)

- `cleanSplat` emits ONE output pair: `scene.ply` (fast, SH-stripped) and
  `scene-hq.ply` → `scene.spz` when available. The subject-isolation
  machinery (plane-cut membership, connected-component keep, footprint
  filter) is deleted — it amputated subjects.
- Cleaning = two scale-aware passes:
  1. **Global floater pass** (unchanged): lonely-at-own-scale + needle
     removal. Dense surfaces and big environment splats survive by design.
  2. **Orbit-interior haze pass** (strengthened): inside the camera-orbit
     radius (from COLMAP centers; fallback `nearFieldMul × radius`) but
     outside the subject's own extent, splats of ANY size need stronger
     neighbor support, and faint splats are dropped at a higher alpha
     threshold. The video swept that space; anything lonely there is haze.
- Subject center/radius are still estimated for recentering, ~unit-radius
  normalization, and orbit framing — measurement only, never deletion.
- `pipeline.ts`: one cleanSplat call; sets `splatUrl` (scene fast) and
  `splatHqUrl` (scene spz/hq). Stops emitting `fullSplatUrl`/`fullSplatHqUrl`
  and subject-only files. Old captures keep working.
- Viewer (`web/src/screens/ViewerScreen.tsx`): Subject/Scene toggle removed;
  always the orbit-aware scene camera (existing `orbitRadius`/`orbitHeight`
  clamps). Export/share offers the scene file.
- Live training previews clean intermediates the same way (cheaper now).

## 3. Sharpness-aware frame selection (server/src/tools/ffmpeg.ts)

Target stays ~150 frames. Extraction becomes two passes:

1. Scoring pass: ffmpeg `blurdetect` over the video → per-frame sharpness.
2. Selection: split duration into `targetFrames` windows, pick the sharpest
   frame per window, extract those timestamps at full resolution.

Fallback to current uniform sampling if the scoring pass fails. Frame-count
floor (12) and progress reporting behave as today.

## 4. Library posters (server/src/index.ts, web)

- `POST /api/captures/:id/poster` (JPEG body): saves `poster.jpg` in the
  capture dir, sets `posterUrl`, broadcasts the capture update.
- Web: a one-at-a-time background worker finds ready captures without
  `posterUrl`, mounts a hidden small viewer on the FAST scene ply, frames it
  with the stored orbit hints, snapshots a JPEG, posts it. Cards render
  `posterUrl ?? thumbUrl`. Retroactive for existing captures.

## 5. Out of scope

Trainer swaps (nerfstudio/gsplat), segmentation-based masking, user-facing
quality options, changes to COLMAP settings.

## 6. Verification plan

1. Clean `splat_12500.ply` vs `splat_30000.ply` from two existing captures
   with the new cleaner; user A/Bs them in the viewer (bump to 15k if 12k
   disappoints).
2. Fresh end-to-end run: confirm timing drop, no near-subject air floaters,
   environment present, poster appears in the library.
