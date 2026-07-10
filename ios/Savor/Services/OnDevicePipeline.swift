import Foundation
import SplatCore
import SwiftData

/// Runs the full on-device pipeline: load ARKit capture → Metal train → write .ply.
@MainActor
final class OnDevicePipeline {
    func train(_ capture: Capture, modelContext: ModelContext) async {
        capture.stage = .preparing
        capture.statusMessage = "Loading ARKit capture…"
        capture.overallProgress = 0.05
        capture.errorMessage = nil

        guard let dirRel = capture.videoRelativePath,
              let directory = SavorPaths.resolve(dirRel) else {
            fail(capture, "Missing capture directory.")
            return
        }

        do {
            let manifest = try CaptureManifest.load(from: directory)
            capture.frameCount = manifest.frames.count
            capture.seedCount = manifest.pointCount
            capture.hasLiDAR = manifest.hasSceneDepth
            capture.stage = .training
            capture.statusMessage = "Training on-device with Metal…"

            let config: TrainConfig
            switch capture.quality {
            case .fast: config = .fast
            case .balanced: config = .balanced
            case .high: config = .high
            }

            let bridge = TrainProgressBridge()
            bridge.handler = { [capture] progress in
                capture.stage = .training
                capture.stageProgress = progress.fraction
                capture.overallProgress = 0.1 + progress.fraction * 0.85
                capture.statusMessage = progress.message
                capture.gaussianCount = progress.splatCount
                capture.trainLoss = Double(progress.loss)
            }

            let trainer = try OnDeviceTrainer()
            let cloud = try await trainer.train(
                manifest: manifest,
                captureDirectory: directory,
                config: config,
                onProgress: { progress in
                    bridge.emit(progress)
                }
            )

            let plyURL = directory.appendingPathComponent("subject.ply")
            try PLYSplatWriter.writeGaussianCloud(cloud, to: plyURL)
            capture.subjectPlyRelativePath = SavorPaths.relativePath(for: plyURL)
            capture.gaussianCount = cloud.count
            capture.stage = .ready
            capture.overallProgress = 1
            capture.stageProgress = 1
            capture.statusMessage = "Ready"
            try modelContext.save()
        } catch is CancellationError {
            capture.stage = .failed
            capture.errorMessage = "Training cancelled."
            capture.statusMessage = "Cancelled"
        } catch {
            fail(capture, error.localizedDescription)
        }
    }

    private func fail(_ capture: Capture, _ message: String) {
        capture.stage = .failed
        capture.errorMessage = message
        capture.statusMessage = "Something went wrong"
    }
}

/// Bridges Sendable trainer callbacks back onto the main actor for SwiftData models.
private final class TrainProgressBridge: @unchecked Sendable {
    @MainActor var handler: ((TrainProgress) -> Void)?

    func emit(_ progress: TrainProgress) {
        Task { @MainActor in
            handler?(progress)
        }
    }
}
