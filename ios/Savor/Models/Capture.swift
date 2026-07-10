import Foundation
import SwiftData

public enum CaptureStage: String, Codable, Sendable, CaseIterable {
    case queued
    case extracting
    case reconstructing
    case training
    case ready
    case failed

    public var title: String {
        switch self {
        case .queued: "Queued"
        case .extracting: "Extracting frames"
        case .reconstructing: "Solving cameras"
        case .training: "Training splat"
        case .ready: "Ready"
        case .failed: "Failed"
        }
    }

    public var systemImage: String {
        switch self {
        case .queued: "clock"
        case .extracting: "film"
        case .reconstructing: "viewfinder"
        case .training: "sparkles"
        case .ready: "checkmark.circle.fill"
        case .failed: "exclamationmark.triangle.fill"
        }
    }
}

public enum CaptureQuality: String, Codable, Sendable, CaseIterable, Identifiable {
    case fast
    case balanced
    case high

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .fast: "Fast"
        case .balanced: "Balanced"
        case .high: "High"
        }
    }

    public var subtitle: String {
        switch self {
        case .fast: "~3k steps · quicker preview"
        case .balanced: "~8k steps · great everyday quality"
        case .high: "~20k steps · maximum detail"
        }
    }

    public var systemImage: String {
        switch self {
        case .fast: "bolt.fill"
        case .balanced: "gauge.with.dots.needle.33percent"
        case .high: "diamond.fill"
        }
    }
}

@Model
public final class Capture {
    @Attribute(.unique) public var id: UUID
    public var name: String
    public var createdAt: Date
    public var qualityRaw: String
    public var stageRaw: String
    public var stageProgress: Double
    public var overallProgress: Double
    public var statusMessage: String
    public var errorMessage: String?
    public var videoRelativePath: String?
    public var subjectPlyRelativePath: String?
    public var scenePlyRelativePath: String?
    public var thumbnailRelativePath: String?
    public var gaussianCount: Int?
    public var sceneGaussianCount: Int?
    public var isSample: Bool
    public var companionJobID: String?

    public init(
        id: UUID = UUID(),
        name: String,
        quality: CaptureQuality = .balanced,
        stage: CaptureStage = .queued,
        isSample: Bool = false
    ) {
        self.id = id
        self.name = name
        self.createdAt = .now
        self.qualityRaw = quality.rawValue
        self.stageRaw = stage.rawValue
        self.stageProgress = 0
        self.overallProgress = 0
        self.statusMessage = stage.title
        self.isSample = isSample
    }

    public var quality: CaptureQuality {
        get { CaptureQuality(rawValue: qualityRaw) ?? .balanced }
        set { qualityRaw = newValue.rawValue }
    }

    public var stage: CaptureStage {
        get { CaptureStage(rawValue: stageRaw) ?? .queued }
        set { stageRaw = newValue.rawValue }
    }

    public var isReady: Bool { stage == .ready }
    public var isFailed: Bool { stage == .failed }
    public var isProcessing: Bool {
        switch stage {
        case .queued, .extracting, .reconstructing, .training: true
        case .ready, .failed: false
        }
    }
}
