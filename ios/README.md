# Savor for iPhone

Fully on-device SwiftUI + ARKit + Metal app: **capture → train → view → share** on a single iPhone. No Mac companion. No COLMAP. No Brush.

## Architecture (what replaced what)

| Desktop Savor | Native iPhone |
|---------------|---------------|
| ffmpeg frames | ARKit `capturedImage` keyframes |
| COLMAP SfM | ARKit `ARCamera.transform` (+ IMU) |
| Sparse COLMAP cloud | LiDAR `sceneDepth` seed points |
| Brush (CUDA/Metal desktop) | On-device Metal 3DGS trainer |
| WebGL viewer | Metal splat renderer (+ RealityKit path) |

The earlier “Mac companion” approach was wrong for this product. Training runs on the phone GPU.

## Open in Xcode

```bash
cd ios
open Savor.xcodeproj
```

Requirements:

- Xcode 16+ (Xcode 26 recommended for Liquid Glass)
- **Physical iPhone** with ARKit (LiDAR Pro/Max strongly preferred for seed quality)
- iOS 18+ deployment target

Simulator cannot run ARKit world tracking meaningfully — use a device.

## Flow

1. **AR Capture** — orbit the subject; ARKit stores JPEG keyframes + 4×4 poses + LiDAR seeds
2. **Train** — Metal forward/backward loop optimizes SH0 gaussians on-device
3. **View** — orbit the resulting `.ply` in the Metal viewer
4. **Share** — ShareLink exports the `.ply`

Sample sculpture still ships for viewer testing without a capture.

## Layout

```
ios/
  SplatCore/          PLY I/O · Metal viewer · Metal trainer · capture manifest
  Savor/
    Services/         ARCaptureSession · OnDevicePipeline
    Features/         Library · Capture · Processing · Viewer · About
    Design/           Liquid Glass helpers
```

## Honest limits

- The Metal trainer is a **mobile SH0** loop (PocketGS-style budget: hundreds of steps, tens of thousands of gaussians). It is not a full desktop Brush / msplat densification stack.
- LiDAR phones produce far better seeds than non-LiDAR (pose-only bootstrap).
- Keep the phone cool; long High-quality runs can thermal-throttle.
- `msplat` (excellent Metal trainer) is currently **macOS-oriented**; this app ships a self-contained iOS trainer instead of a companion binary.

## Regenerate Xcode project

```bash
python3 scripts/generate_xcodeproj.py
```
