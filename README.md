# Savor

Turn a simple video into a 3D **gaussian splat** you can orbit in your browser.
Record a slow loop around an object → Savor extracts frames, solves the camera
geometry, trains a splat **on your machine's GPU**, cleans it up, and lets you spin it
around (and export a `.ply`). Apple-style Liquid Glass UI.

```
 video ──ffmpeg──▶ frames ──COLMAP──▶ camera poses + point cloud ──Brush──▶ .ply ──▶ WebGL viewer
```

## Why it runs locally (not a website)

The hard part — COLMAP (camera solving) and Brush (splat training) — is heavy,
GPU-accelerated **native** compute. There's no practical way to host that on a normal
web host, and renting cloud GPUs per user is expensive. So Savor runs **on your own
hardware**: a tiny local server drives the pipeline and serves a web UI at
`localhost`. Your videos never leave your machine. Setup is one command.

## Requirements

- A reasonably modern computer with a GPU:
  - **macOS on Apple Silicon** — smoothest path (Metal, no extra drivers)
  - **Windows x64** or **Linux x64** — also supported (Vulkan/DX12 GPU)
- **[Node.js](https://nodejs.org) 18+**
- **ffmpeg** and **COLMAP** (the setup step tells you exactly what's missing)

## Quick start

```bash
git clone https://github.com/hridaew/savor.git
cd savor
npm install
npm run setup     # fetches the right Brush binary + checks ffmpeg/COLMAP
npm run dev       # starts the app
```

Then open **http://localhost:5173**. Run `npm run doctor` any time to re-check tools.

### Installing ffmpeg + COLMAP

`npm run setup` checks for these and prints the command for your OS. For reference:

| OS | ffmpeg | COLMAP |
|----|--------|--------|
| macOS | `brew install ffmpeg` | `brew install colmap` |
| Linux | `sudo apt install ffmpeg` | `sudo apt install colmap` |
| Windows | `winget install Gyan.FFmpeg` | [colmap.github.io/install](https://colmap.github.io/install.html) |

Brush itself is fetched automatically by `npm run setup` — no manual install.

## Making a good capture

The splat is only as good as the video:

- **Move slowly and steadily** — motion blur ruins feature matching.
- **20–40 seconds**, walking a full circle (plus some height variation) around the subject.
- **Keep the subject filling the frame**, with even, diffuse lighting.
- **Matte, textured objects** work best. Glass, mirrors, and blank walls are hard.

In the app: tap **New** (or just drag a video onto the window) and watch it run —
every capture trains at full quality (no settings to tweak), and once training
starts you get a **live 3D preview** that sharpens as the splat trains. You can leave
the screen; it keeps processing. When it's done, orbit it, toggle **Subject / Scene**,
save a **photo** of the current angle, or export a `.ply`.

> First run is slower: Brush compiles GPU shaders on first launch. A 20–30s clip
> typically takes a few minutes end-to-end depending on your hardware and quality.

## How it works

| Stage | Tool | What happens |
|------|------|--------------|
| Extract | `ffmpeg` | ~150 evenly-spaced frames, downscaled to ≤ 1600px |
| Solve | `COLMAP` | SIFT extraction → matching → sparse mapper (camera poses + point cloud) |
| Train | `Brush` | Optimizes gaussians on your GPU (densification tuned up so the environment gets real coverage, not just the subject); exports `.ply` (live-previewed in the UI) |
| Clean | built-in | Two aligned outputs: **Subject** (the support plane RANSAC-detected and cut, the subject isolated by connected-component analysis, then every splat inside that volume kept — surfaces stay solid — recentered + normalized) and **Scene** (the full environment kept as trained; only scale-awarely "unsupported" junk and haze inside the capture orbit removed). Unused spherical-harmonics bands are stripped, shrinking files ~76% for fast loading. |
| View | WebGL | [`@mkkellogg/gaussian-splats-3d`](https://github.com/mkkellogg/GaussianSplats3D) renders it. Scene mode orbits at the capture cameras' own distance and height (read from COLMAP) — a splat background only looks right from where the video was shot, so the viewer stays there. |

A small Node/Express service orchestrates the CLIs as a one-at-a-time job queue and
streams live progress to the UI over a WebSocket. Each job lives in `workspace/<id>/`.

## Project structure

```
server/                Node + Express + ws pipeline backend (TypeScript via tsx)
  src/tools/           ffmpeg / colmap / brush wrappers + splatClean (floater removal)
  src/pipeline.ts      orchestration + weighted progress
web/                   Vite + React + TypeScript frontend (Liquid Glass UI)
scripts/setup.mjs      cross-platform Brush fetch + tool check
tools/brush/           Brush binary (fetched by setup; git-ignored)
samples/sample.ply     bundled sample splat (a real sculpture) for the viewer
workspace/             per-capture working dirs (git-ignored)
```

## Troubleshooting

- **`npm run doctor` shows a tool missing** — install it (table above) and re-run setup.
- **"COLMAP could not reconstruct this scene"** — too little overlap, motion blur, or a
  textureless subject. Re-shoot a slower, fuller orbit.
- **macOS: "brush_app" can't be opened** — `npm run setup` ad-hoc signs it; if it still
  complains, run `xattr -dr com.apple.quarantine tools/brush/*/brush_app`.
- **Splat looks off-center** — drag to orbit, scroll to zoom, **Recenter**. Captures are
  auto-centered, but gravity is unknown to COLMAP so some need a manual orbit to level.
- **A job is stuck after restarting the server** — in-flight jobs can't resume; use
  **Retry** (your video is kept) or delete and re-upload.

## Notes

- No prebuilt Brush exists for Intel Macs; build from source
  ([ArthurBrussee/brush](https://github.com/ArthurBrussee/brush)) and set `BRUSH_BIN`.
- Built on [ffmpeg](https://ffmpeg.org), [COLMAP](https://colmap.github.io),
  [Brush](https://github.com/ArthurBrussee/brush),
  [gaussian-splats-3d](https://github.com/mkkellogg/GaussianSplats3D), and
  [liquidGL](https://github.com/naughtyduk/liquidGL). A prototype for a future iOS app.
