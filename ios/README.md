# Savor for iPhone

Native SwiftUI + Metal app that turns the [Savor](../README.md) web prototype into a
real iOS experience: Liquid Glass UI, on-device gaussian splat viewing, and a Mac
companion hook for training.

## What runs where

| Piece | Where | Why |
|------|------|-----|
| Library / viewer / import | **iPhone** | SwiftUI + SwiftData + Metal |
| Liquid Glass chrome | **iPhone** | iOS 26 `.glassEffect` (ultra-thin material fallback) |
| `.ply` decode + splat render | **iPhone** | `SplatCore` Metal engine (SH0 / Brush export layout) |
| RealityKit `GaussianSplatComponent` | **iPhone (iOS 26+)** | Optional native path — scaffolded for Xcode 26 |
| ffmpeg → COLMAP → Brush training | **Mac companion** | Same local server as the web app (`npm run dev`) |

Apple Silicon phones can render tens of thousands of gaussians smoothly. Full
SfM + splat *training* still needs a desktop GPU and the existing Savor pipeline —
the phone is the beautiful viewer and capture front-end.

## Open in Xcode

```bash
cd ios
open Savor.xcodeproj
```

Or regenerate the project after adding files:

```bash
python3 scripts/generate_xcodeproj.py
# on a Mac you can also: brew install xcodegen && xcodegen generate
```

Requirements:

- Xcode 16+ (Xcode 26 recommended for Liquid Glass + RealityKit gaussian APIs)
- iOS 18 deployment target (Liquid Glass activates automatically on iOS 26)
- Apple Silicon iPhone recommended for Metal splat viewing

Select your Development Team under **Signing & Capabilities**, then Run on a device
or simulator. Use **Release** for large `.ply` loads.

## Try it

1. Launch the app → **Explore the sample sculpture** (bundled `sample.ply`).
2. Drag to orbit, pinch to zoom, toggle auto-rotate / recenter.
3. **Import .ply** from Files (AirDrop a capture from your Mac).
4. Or **New Capture** → pick a video → enable **Train on Mac companion** while
   `npm run dev` is running on your Mac (same Wi‑Fi; set the companion URL).
   When training finishes, the app downloads the cleaned `.ply` and opens it in Metal.

## Layout

```
ios/
  Package.swift              SplatCore Swift package (PLY + Metal)
  Savor.xcodeproj            App project
  project.yml                XcodeGen spec (optional)
  SplatCore/                 Shared splat engine
    Sources/SplatCore/
      PLYSplatLoader.swift
      GaussianSplat.swift
      MetalSplatRenderer.swift
      SplatShaders.metal
  Savor/                     SwiftUI app
    App/SavorApp.swift
    Design/SavorTheme.swift  Liquid Glass helpers
    Features/                Library · Create · Viewer · Processing · About
    Models/Capture.swift     SwiftData
    Services/                Paths + companion client
    Splat/                   MTKView bridge + RealityKit host
    Resources/Samples/       Bundled sculpture PLYs
```

## Companion

The Mac side is unchanged:

```bash
npm install && npm run setup && npm run dev
```

In the iOS app’s About / Create sheet, point the companion URL at your Mac
(e.g. `http://192.168.1.20:8787`). Videos upload over the LAN; when training
finishes, the subject + scene `.ply` files download automatically for on-device viewing.

## Notes

- Sample assets are the same cleaned Brush exports as the web app.
- The Metal path sorts splats back-to-front on CPU each frame — great for the
  ~40k-gaussian sample; for multi-million scenes you’ll want tiled GPU sorting
  (or RealityKit’s native component on iOS 26).
- No third-party UI kits — system SwiftUI, PhotosPicker, ShareLink, SwiftData.
