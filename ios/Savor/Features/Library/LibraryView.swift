import SwiftData
import SwiftUI

struct LibraryView: View {
    @Query(sort: \Capture.createdAt, order: .reverse) private var captures: [Capture]
    @Binding var showCapture: Bool
    @Binding var showImportPLY: Bool
    var onOpen: (Capture) -> Void
    var onOpenSample: () -> Void

    var body: some View {
        NavigationStack {
            Group {
                if captures.isEmpty {
                    ContentUnavailableView {
                        Label("No Captures", systemImage: "camera.viewfinder")
                    } description: {
                        Text("Orbit a subject with ARKit, then train a gaussian splat on this iPhone.")
                    } actions: {
                        Button("AR Capture", systemImage: "camera.viewfinder") {
                            showCapture = true
                        }
                        .buttonStyle(.borderedProminent)
                        Button("Explore Sample") {
                            onOpenSample()
                        }
                        .buttonStyle(.bordered)
                    }
                } else {
                    List {
                        Section {
                            ForEach(captures) { capture in
                                Button {
                                    onOpen(capture)
                                } label: {
                                    CaptureRowView(capture: capture)
                                }
                            }
                        }
                        Section {
                            Button("Explore Sample Sculpture", systemImage: "building.columns") {
                                onOpenSample()
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("Library")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu("Add", systemImage: "plus") {
                        Button("AR Capture", systemImage: "camera.viewfinder") {
                            showCapture = true
                        }
                        Button("Import PLY", systemImage: "doc.badge.plus") {
                            showImportPLY = true
                        }
                    }
                }
            }
        }
    }
}

struct CaptureRowView: View {
    let capture: Capture

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: capture.stage.systemImage)
                .font(.title2)
                .foregroundStyle(capture.isFailed ? .red : .accentColor)
                .frame(width: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(capture.name)
                    .foregroundStyle(.primary)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if capture.isProcessing {
                ProgressView(value: capture.overallProgress)
                    .frame(width: 48)
            } else {
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
        }
        .contentShape(Rectangle())
    }

    private var subtitle: String {
        if capture.isReady {
            if let count = capture.gaussianCount {
                return "\(count.formatted()) gaussians"
            }
            return "Ready"
        }
        if capture.isFailed { return capture.errorMessage ?? "Failed" }
        return capture.stage.title
    }
}
