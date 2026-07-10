import SwiftData
import SwiftUI

struct ProcessingScreen: View {
    @Bindable var capture: Capture
    var onView: () -> Void
    var onDelete: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var trainTask: Task<Void, Never>?

    private let stages: [CaptureStage] = [.preparing, .training]

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
                await maybeStartTraining()
            }
            .onDisappear {
                // Don't cancel — training continues if user leaves; they can reopen.
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
                    timelineNode(stage)
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

    private func timelineNode(_ stage: CaptureStage) -> some View {
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
            Text(stage == .preparing ? "Seeds" : "Train")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(done || active ? .primary : .secondary)
        }
        .frame(width: 72)
    }

    private var stats: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            stat("Quality", capture.quality.title)
            stat("Progress", "\(Int(capture.overallProgress * 100))%")
            if let frames = capture.frameCount {
                stat("AR frames", "\(frames)")
            }
            if let seeds = capture.seedCount {
                stat(capture.hasLiDAR ? "LiDAR seeds" : "Seeds", seeds.formatted())
            }
            if let count = capture.gaussianCount {
                stat("Gaussians", count.formatted())
            }
            if let loss = capture.trainLoss {
                stat("Loss", String(format: "%.3f", loss))
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
            if capture.isFailed || capture.stage == .queued {
                Button("Train on-device", systemImage: "sparkles") {
                    Task { await startTraining() }
                }
                .savorProminentGlassButton()
                .controlSize(.large)
            }
            Button("Delete capture", systemImage: "trash", role: .destructive) {
                trainTask?.cancel()
                onDelete()
                dismiss()
            }
            .savorGlassButton()
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

    private func maybeStartTraining() async {
        if capture.stage == .queued || capture.stage == .failed {
            await startTraining()
        }
    }

    private func startTraining() async {
        trainTask?.cancel()
        trainTask = Task {
            await OnDevicePipeline().train(capture, modelContext: modelContext)
        }
        await trainTask?.value
    }
}
