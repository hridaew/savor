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
- **[Node.js](https://nodejs.org) 22+**
- That's really it. **ffmpeg, Brush, and — on Windows — COLMAP are all
  provisioned for you.** The only case needing a manual step is **COLMAP on
  macOS/Linux**, and the app installs even that for you with one click (macOS)
  or a copy-paste command (Linux).

How each tool is handled:

| Tool | How it's installed |
|------|--------------------|
| **ffmpeg / ffprobe** | Bundled with the app (npm) — nothing to do |
| **Brush** (trainer) | Auto-downloads for your platform on `npm install`, and self-heals at runtime if ever missing |
| **COLMAP** — Windows | Auto-downloads the official prebuilt build, just like Brush |
| **COLMAP** — macOS | One-click **Install COLMAP** button in the app (runs Homebrew for you) |
| **COLMAP** — Linux | App shows the `sudo apt install colmap` command to paste |

COLMAP **4.x is recommended**: it unlocks the fast global mapper and the
learned-feature rescue tier (3.x still works — Savor detects what your build
supports and falls back automatically; `npm run doctor` shows both).

## Quick start

```bash
git clone https://github.com/hridaew/savor.git
cd savor
npm install       # auto-fetches Brush (+ COLMAP on Windows)
npm run dev       # starts the app
```

Then open **http://localhost:5173**. If anything still needs installing, the app
shows a **setup card** — a one-click install where possible, a command otherwise —
and new captures wait until it's ready instead of failing mid-pipeline. Run
`npm run doctor` any time for a terminal view of the same status.

> ffmpeg note: the bundled build covers virtually every phone/camera video. To
> use a system build instead, install ffmpeg and set `FFMPEG_BIN` / `FFPROBE_BIN`.
> COLMAP is found on your `PATH`; override it with `COLMAP_BIN` if needed.

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
| Extract | `ffmpeg` | ~150 sharpest-per-window frames, downscaled to ≤ 1920px |
| Solve | `COLMAP` | SIFT extraction → sequential matching, then a cheap-to-expensive **mapper ladder**: the global mapper (GLOMAP, COLMAP ≥ 4 — solves all cameras at once, much faster and deterministic) → incremental mapper → incremental multi-model rescue → **ALIKED + LightGlue learned features** (ONNX, COLMAP ≥ 4.1) as the last resort for texture-poor or blurred video. Each tier only runs when the previous registered too few frames. |
| Train | `Brush` | Optimizes gaussians on your GPU with an MCMC splat budget (predictable time/memory/size); exports `.ply` (live-previewed in the UI) |
| Clean | built-in | One **Scene** output: the subject intact in its environment, scale-aware floater + orbit-haze removal, recentered + normalized. Ships two files: a fast SH-stripped `.ply` and a **`.sog`** (compressed via [splat-transform](https://github.com/playcanvas/splat-transform), ~9× smaller than the HQ ply *with* view-dependent shading intact). |
| View | WebGL | [Spark](https://sparkjs.dev) renders it (ply/spz/sog). Objects orbit at the capture cameras' own distance and height (read from COLMAP) — a splat background only looks right from where the video was shot, so the viewer stays there. Environment captures are viewed from inside, look-around style. |

A small Node/Express service orchestrates the CLIs as a one-at-a-time job queue and
streams live progress to the UI over a WebSocket. Each job lives in `workspace/<id>/`.

## Project structure

```
server/                Node + Express + ws pipeline backend (TypeScript via tsx)
  src/tools/           ffmpeg / colmap / brush wrappers + splatClean (floater removal)
  src/pipeline.ts      orchestration + weighted progress
web/                   Vite + React + TypeScript frontend (Liquid Glass UI)
scripts/setup.mjs      cross-platform Brush + COLMAP(Windows) fetch, runs on npm install
tools/brush/           Brush binary (auto-fetched; git-ignored)
tools/colmap/          COLMAP build on Windows (auto-fetched; git-ignored)
samples/sample.ply     bundled sample splat (a real sculpture) for the viewer
workspace/             per-capture working dirs (git-ignored)
```

## Troubleshooting

- **`npm run doctor` shows a tool missing** — Brush and (on Windows) COLMAP
  download automatically; a failure usually means no internet at install time, so
  re-run `npm run setup`. For COLMAP on macOS, use the app's **Install COLMAP**
  button (or `brew install colmap`); on Linux, `sudo apt install colmap`.
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
  [Spark](https://sparkjs.dev),
  [splat-transform](https://github.com/playcanvas/splat-transform), and
  [liquidGL](https://github.com/naughtyduk/liquidGL). A prototype for a future iOS app.
