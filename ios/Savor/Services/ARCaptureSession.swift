import ARKit
import AVFoundation
import CoreImage
import Observation
import simd
import SplatCore
import UIKit

/// Records ARKit frames + poses (+ LiDAR depth when available).
/// This completely replaces COLMAP Structure-from-Motion on iPhone.
@Observable
@MainActor
final class ARCaptureSession: NSObject {
    enum Status: Equatable {
        case idle
        case requestingPermissions
        case running
        case finishing
        case finished
        case failed(String)
    }

    var status: Status = .idle
    var frameCount = 0
    var pointCount = 0
    var trackingState: String = "…"
    var hasLiDAR = false
    var elapsed: TimeInterval = 0

    /// Shared with the preview `ARSCNView` so we only run one ARSession.
    let session = ARSession()

    private var captureID = UUID()
    private var captureName = "Capture"
    private var directory: URL?
    private var framesDir: URL?
    private var frames: [CaptureFrame] = []
    private var seeds: [SeedPoint] = []
    private var lastKeyframeTransform: simd_float4x4?
    private var startedAt: Date?
    private var timer: Timer?
    private let ciContext = CIContext(options: [.useSoftwareRenderer: false])
    private let maxFrames = 120
    private let maxSeeds = 25_000
    private let minTranslation: Float = 0.04
    private let minAngle: Float = 0.08

    func start(name: String) async {
        captureName = name.isEmpty ? "Capture" : name
        status = .requestingPermissions
        let ok = await requestCameraAccess()
        guard ok else {
            status = .failed("Camera access is required to capture.")
            return
        }

        captureID = UUID()
        do {
            directory = try SavorPaths.ensureCaptureDirectory(for: captureID)
            framesDir = directory!.appendingPathComponent("frames", isDirectory: true)
            try FileManager.default.createDirectory(at: framesDir!, withIntermediateDirectories: true)
        } catch {
            status = .failed(error.localizedDescription)
            return
        }

        frames = []
        seeds = []
        frameCount = 0
        pointCount = 0
        lastKeyframeTransform = nil
        startedAt = .now
        elapsed = 0

        let config = ARWorldTrackingConfiguration()
        config.planeDetection = []
        if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
            config.frameSemantics.insert(.sceneDepth)
            hasLiDAR = true
        } else if ARWorldTrackingConfiguration.supportsFrameSemantics(.smoothedSceneDepth) {
            config.frameSemantics.insert(.smoothedSceneDepth)
            hasLiDAR = true
        } else {
            hasLiDAR = false
        }

        session.delegate = self
        session.run(config, options: [.resetTracking, .removeExistingAnchors])
        status = .running

        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let started = self.startedAt else { return }
                self.elapsed = Date().timeIntervalSince(started)
            }
        }
    }

    func stop() async -> Capture? {
        guard status == .running, let directory else { return nil }
        status = .finishing
        session.pause()
        timer?.invalidate()
        timer = nil

        let seedURL = directory.appendingPathComponent("seeds.ply")
        if !seeds.isEmpty {
            try? PLYSplatWriter.writeSeedCloud(seeds, to: seedURL)
        }

        let manifest = CaptureManifest(
            id: captureID.uuidString,
            name: captureName,
            frames: frames,
            pointCloudFile: seeds.isEmpty ? nil : "seeds.ply",
            pointCount: seeds.count,
            hasSceneDepth: hasLiDAR,
            deviceModel: UIDevice.current.model
        )
        try? manifest.save(to: directory)

        let capture = Capture(id: captureID, name: captureName, stage: .queued)
        capture.manifestRelativePath = SavorPaths.relativePath(for: directory.appendingPathComponent("manifest.json"))
        capture.videoRelativePath = SavorPaths.relativePath(for: directory)
        capture.seedCount = seeds.count
        capture.frameCount = frames.count
        capture.hasLiDAR = hasLiDAR
        capture.statusMessage = "Ready to train on-device"
        capture.stage = .queued
        status = .finished
        return capture
    }

    func cancel() {
        session.pause()
        timer?.invalidate()
        timer = nil
        if let directory {
            try? FileManager.default.removeItem(at: directory)
        }
        status = .idle
    }

    private func requestCameraAccess() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return true
        case .notDetermined:
            return await AVCaptureDevice.requestAccess(for: .video)
        default: return false
        }
    }

    private func shouldKeep(_ transform: simd_float4x4) -> Bool {
        guard let last = lastKeyframeTransform else { return true }
        let t0 = SIMD3(last.columns.3.x, last.columns.3.y, last.columns.3.z)
        let t1 = SIMD3(transform.columns.3.x, transform.columns.3.y, transform.columns.3.z)
        if length(t1 - t0) >= minTranslation { return true }

        // Compare forward axes — avoids quaternion helpers that confuse some SDKs.
        let f0 = SIMD3(last.columns.2.x, last.columns.2.y, last.columns.2.z)
        let f1 = SIMD3(transform.columns.2.x, transform.columns.2.y, transform.columns.2.z)
        let dotForward = max(-1 as Float, min(1 as Float, dot(normalize(f0), normalize(f1))))
        let angle = acos(dotForward)
        return angle >= minAngle
    }

    private func saveJPEG(from frame: ARFrame, named name: String) -> Bool {
        guard let framesDir else { return false }
        let buffer = frame.capturedImage
        let ci = CIImage(cvPixelBuffer: buffer).oriented(.right)
        guard let cg = ciContext.createCGImage(ci, from: ci.extent) else { return false }
        let ui = UIImage(cgImage: cg)
        guard let data = ui.jpegData(compressionQuality: 0.82) else { return false }
        let url = framesDir.appendingPathComponent(name)
        do {
            try data.write(to: url, options: .atomic)
            return true
        } catch {
            return false
        }
    }

    private func ingestDepth(_ frame: ARFrame, transform: simd_float4x4) {
        guard seeds.count < maxSeeds else { return }
        let depthData = frame.sceneDepth ?? frame.smoothedSceneDepth
        guard let depthData else { return }

        let depthMap = depthData.depthMap
        CVPixelBufferLockBaseAddress(depthMap, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(depthMap, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(depthMap) else { return }
        let dw = CVPixelBufferGetWidth(depthMap)
        let dh = CVPixelBufferGetHeight(depthMap)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(depthMap)

        let cam = frame.camera
        let intrinsics = cam.intrinsics
        let sx = Float(dw) / Float(cam.imageResolution.width)
        let sy = Float(dh) / Float(cam.imageResolution.height)
        let fx = intrinsics[0, 0] * sx
        let fy = intrinsics[1, 1] * sy
        let cx = intrinsics[2, 0] * sx
        let cy = intrinsics[2, 1] * sy

        let step = max(2, min(dw, dh) / 40)
        let ptr = base.assumingMemoryBound(to: Float32.self)
        let floatsPerRow = bytesPerRow / MemoryLayout<Float32>.size

        for v in stride(from: 0, to: dh, by: step) {
            for u in stride(from: 0, to: dw, by: step) {
                let z = ptr[v * floatsPerRow + u]
                guard z.isFinite, z > 0.15, z < 4.5 else { continue }
                let x = (Float(u) - cx) * z / fx
                let y = (Float(v) - cy) * z / fy
                let world = transform * SIMD4(x, y, z, 1)
                let position = SIMD3(world.x, world.y, world.z)
                let color = SIMD3<Float>(0.55 + Float(u % 7) * 0.02, 0.55, 0.52)
                seeds.append(SeedPoint(position: position, color: color))
                if seeds.count >= maxSeeds { return }
            }
        }
        pointCount = seeds.count
    }

    private func handle(_ frame: ARFrame) {
        guard status == .running, frames.count < maxFrames else { return }
        let transform = frame.camera.transform
        guard shouldKeep(transform) else {
            if frameCount % 5 == 0 { ingestDepth(frame, transform: transform) }
            return
        }

        let name = String(format: "frame_%04d.jpg", frames.count)
        guard saveJPEG(from: frame, named: name) else { return }

        let captureFrame = CaptureFrame(
            id: frames.count,
            imageFile: name,
            timestamp: frame.timestamp,
            transform: transform,
            intrinsics: frame.camera.intrinsics,
            imageWidth: Int(frame.camera.imageResolution.width),
            imageHeight: Int(frame.camera.imageResolution.height)
        )
        frames.append(captureFrame)
        lastKeyframeTransform = transform
        frameCount = frames.count
        ingestDepth(frame, transform: transform)
    }
}

extension ARCaptureSession: ARSessionDelegate {
    nonisolated func session(_ session: ARSession, didUpdate frame: ARFrame) {
        Task { @MainActor in
            self.handle(frame)
        }
    }

    nonisolated func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
        Task { @MainActor in
            switch camera.trackingState {
            case .normal: self.trackingState = "Tracking"
            case .limited(let reason):
                switch reason {
                case .initializing: self.trackingState = "Initializing…"
                case .excessiveMotion: self.trackingState = "Move slower"
                case .insufficientFeatures: self.trackingState = "Need more texture"
                case .relocalizing: self.trackingState = "Relocalizing…"
                @unknown default: self.trackingState = "Limited"
                }
            case .notAvailable: self.trackingState = "Unavailable"
            @unknown default: self.trackingState = "…"
            }
        }
    }
}
