import SwiftData
import SwiftUI

struct ProcessingScreen: View {
    @Bindable var capture: Capture
    var onView: () -> Void
    var onDelete: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(CompanionClient.self) private var companion

    private let stages: [CaptureStage] = [.extracting, .reconstructing, .training]

    var body: some View {
        NavigationStack {
            ZStack {
                SavorBackdrop()
                ScrollView {
                    VStack(spacing: 22) {
                        hero
                        timeline
                        stats
                        actions
                    }
                    .padding(20)
                    .padding(.bottom, 40)
                }
            }
            .navigationTitle(capture.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Library", systemImage: "chevron.left") { dismiss() }
                }
            }
            .task {
                await pollCompanionIfNeeded()
            }
        }
    }

    private var hero: some View {
        GlassCard {
            VStack(spacing: 16) {
                ZStack {
                    Circle()
                        .stroke(SavorTheme.accent.opacity(0.15), lineWidth: 8)
                        .frame(width: 96, height: 96)
                    Circle()
                        .trim(from: 0, to: capture.overallProgress)
                        .stroke(SavorTheme.accent, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                        .frame(width: 96, height: 96)
                        .rotationEffect(.degrees(-90))
                        .animation(.easeOut(duration: 0.4), value: capture.overallProgress)
                    Image(systemName: capture.stage.systemImage)
                        .font(.title)
                        .foregroundStyle(SavorTheme.accent)
                        .symbolEffect(.pulse, options: .repeating, isActive: capture.isProcessing)
                }
                Text(capture.statusMessage)
                    .font(.headline)
                    .multilineTextAlignment(.center)
                if capture.isFailed, let error = capture.errorMessage {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private var timeline: some View {
        GlassCard {
            HStack(spacing: 0) {
                ForEach(Array(stages.enumerated()), id: \.element) { index, stage in
                    timelineNode(stage, index: index)
                    if index < stages.count - 1 {
                        Capsule()
                            .fill(lineFill(before: index + 1) ? SavorTheme.accent : Color.secondary.opacity(0.2))
                            .frame(height: 3)
                            .frame(maxWidth: .infinity)
                    }
                }
            }
        }
    }

    private func timelineNode(_ stage: CaptureStage, index: Int) -> some View {
        let done = isDone(stage)
        let active = capture.stage == stage
        return VStack(spacing: 8) {
            ZStack {
                Circle()
                    .fill(done || active ? SavorTheme.accent : Color.secondary.opacity(0.15))
                    .frame(width: 36, height: 36)
                Image(systemName: done ? "checkmark" : stage.systemImage)
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(done || active ? .white : .secondary)
            }
            Text(shortName(stage))
                .font(.caption2.weight(.semibold))
                .foregroundStyle(done || active ? .primary : .secondary)
        }
        .frame(width: 72)
    }

    private var stats: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            stat("Quality", capture.quality.title)
            stat("Progress", "\(Int(capture.overallProgress * 100))%")
            if let count = capture.gaussianCount {
                stat("Gaussians", count.formatted())
            }
            if capture.companionJobID != nil {
                stat("Companion", companion.isReachable ? "Online" : "Offline")
            }
        }
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value).font(.title3.bold().monospacedDigit())
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .savorGlass(cornerRadius: 16)
    }

    private var actions: some View {
        VStack(spacing: 12) {
            if capture.isReady {
                Button("View splat", systemImage: "cube.transparent") { onView() }
                    .savorProminentGlassButton()
                    .controlSize(.large)
                    .frame(maxWidth: .infinity)
            }
            if capture.isFailed || (!capture.isReady && capture.videoRelativePath != nil && capture.companionJobID == nil) {
                NavigationLink {
                    ImportPLYSheet { imported in
                        capture.subjectPlyRelativePath = imported.subjectPlyRelativePath
                        capture.stage = .ready
                        capture.overallProgress = 1
                        capture.statusMessage = "Ready"
                        onView()
                    }
                } label: {
                    Label("Import finished .ply", systemImage: "doc.badge.plus")
                        .frame(maxWidth: .infinity)
                }
                .savorGlassButton()
                .controlSize(.large)
            }
            Button("Delete capture", systemImage: "trash", role: .destructive) {
                onDelete()
                dismiss()
            }
            .savorGlassButton()
        }
    }

    private func shortName(_ stage: CaptureStage) -> String {
        switch stage {
        case .extracting: "Frames"
        case .reconstructing: "Cameras"
        case .training: "Train"
        default: stage.title
        }
    }

    private func isDone(_ stage: CaptureStage) -> Bool {
        if capture.isReady { return true }
        guard let current = stages.firstIndex(of: capture.stage),
              let target = stages.firstIndex(of: stage) else {
            return false
        }
        return target < current
    }

    private func lineFill(before index: Int) -> Bool {
        if capture.isReady { return true }
        guard let current = stages.firstIndex(of: capture.stage) else { return false }
        return index <= current
    }

    private func pollCompanionIfNeeded() async {
        guard let jobID = capture.companionJobID else { return }
        await companion.ping()
        while !Task.isCancelled {
            do {
                let url = companion.baseURL
                    .appendingPathComponent("api/captures")
                    .appendingPathComponent(jobID)
                let (data, _) = try await URLSession.shared.data(from: url)
                if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    let becameReady = await applyCompanionJSON(json)
                    if becameReady || capture.isFailed {
                        break
                    }
                }
            } catch {
                capture.statusMessage = "Waiting for companion…"
            }
            if !capture.isProcessing { break }
            try? await Task.sleep(for: .seconds(2))
        }
    }

    @discardableResult
    private func applyCompanionJSON(_ json: [String: Any]) async -> Bool {
        if let progress = json["progress"] as? Double {
            capture.overallProgress = progress
        }
        if let message = json["message"] as? String {
            capture.statusMessage = message
        }
        if let gaussians = json["gaussians"] as? Int {
            capture.gaussianCount = gaussians
        }
        if let gaussiansFull = json["gaussiansFull"] as? Int {
            capture.sceneGaussianCount = gaussiansFull
        }

        guard let status = json["status"] as? String else { return false }
        switch status {
        case "extracting":
            capture.stage = .extracting
        case "sfm":
            capture.stage = .reconstructing
        case "training":
            capture.stage = .training
        case "ready":
            capture.statusMessage = "Downloading splat…"
            do {
                try await downloadOutputs(from: json)
                capture.stage = .ready
                capture.overallProgress = 1
                capture.statusMessage = "Ready"
                return true
            } catch {
                capture.stage = .failed
                capture.errorMessage = "Could not download splat: \(error.localizedDescription)"
                return true
            }
        case "failed":
            capture.stage = .failed
            capture.errorMessage = json["error"] as? String ?? "Training failed"
            return true
        default:
            break
        }
        return false
    }

    private func downloadOutputs(from json: [String: Any]) async throws {
        let dir = try SavorPaths.ensureCaptureDirectory(for: capture.id)
        if let splatUrl = json["splatUrl"] as? String {
            let dest = dir.appendingPathComponent("subject.ply")
            try await companion.downloadPLY(from: splatUrl, to: dest)
            capture.subjectPlyRelativePath = SavorPaths.relativePath(for: dest)
        }
        if let fullUrl = json["fullSplatUrl"] as? String {
            let dest = dir.appendingPathComponent("scene.ply")
            try await companion.downloadPLY(from: fullUrl, to: dest)
            capture.scenePlyRelativePath = SavorPaths.relativePath(for: dest)
        }
    }
}
