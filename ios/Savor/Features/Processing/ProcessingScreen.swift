import SwiftData
import SwiftUI

struct ProcessingScreen: View {
    @Bindable var capture: Capture
    var onView: () -> Void
    var onDelete: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var trainTask: Task<Void, Never>?
    @State private var showDeleteConfirm = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Status", value: capture.stage.title)
                    ProgressView(value: capture.overallProgress) {
                        Text(capture.statusMessage)
                    }
                    if capture.isFailed, let error = capture.errorMessage {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                } header: {
                    Text("Training")
                } footer: {
                    Text("On-device Metal training runs a mobile SH0 prototype. Quality is limited compared with desktop Brush/COLMAP pipelines.")
                }

                Section("Details") {
                    LabeledContent("Quality", value: capture.quality.title)
                    if let frames = capture.frameCount {
                        LabeledContent("AR frames", value: "\(frames)")
                    }
                    if let seeds = capture.seedCount {
                        LabeledContent(capture.hasLiDAR ? "LiDAR seeds" : "Seeds", value: seeds.formatted())
                    }
                    if let count = capture.gaussianCount {
                        LabeledContent("Gaussians", value: count.formatted())
                    }
                    if let loss = capture.trainLoss {
                        LabeledContent("Loss", value: String(format: "%.3f", loss))
                    }
                }

                Section {
                    if capture.isReady {
                        Button("View splat", systemImage: "cube.transparent") {
                            onView()
                        }
                    }
                    if capture.isFailed || capture.stage == .queued {
                        Button("Train on-device", systemImage: "sparkles") {
                            Task { await startTraining() }
                        }
                        .disabled(trainTask != nil && capture.isProcessing)
                    }
                    Button("Delete capture", systemImage: "trash", role: .destructive) {
                        showDeleteConfirm = true
                    }
                }
            }
            .navigationTitle(capture.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .confirmationDialog("Delete this capture?", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    trainTask?.cancel()
                    onDelete()
                    dismiss()
                }
                Button("Cancel", role: .cancel) {}
            }
            .task {
                await maybeStartTraining()
            }
        }
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
