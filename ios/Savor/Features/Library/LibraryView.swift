import SwiftData
import SwiftUI

struct LibraryView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Capture.createdAt, order: .reverse) private var captures: [Capture]
    @Binding var showCreate: Bool
    var onOpen: (Capture) -> Void
    var onOpenSample: () -> Void

    var body: some View {
        NavigationStack {
            ZStack {
                SavorBackdrop()
                Group {
                    if captures.isEmpty {
                        emptyState
                    } else {
                        ScrollView {
                            LazyVGrid(
                                columns: [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)],
                                spacing: 14
                            ) {
                                ForEach(captures) { capture in
                                    CaptureCardView(capture: capture)
                                        .onTapGesture { onOpen(capture) }
                                }
                            }
                            .padding(.horizontal, 20)
                            .padding(.bottom, 120)
                        }
                    }
                }
            }
            .navigationTitle("Library")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("New", systemImage: "plus") { showCreate = true }
                        .savorProminentGlassButton()
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 18) {
            ZStack {
                Circle()
                    .fill(SavorTheme.accent.opacity(0.12))
                    .frame(width: 96, height: 96)
                Image(systemName: "cube.transparent")
                    .font(.system(size: 40, weight: .light))
                    .foregroundStyle(SavorTheme.accent)
                    .symbolEffect(.pulse, options: .repeating)
            }
            Text("Capture in 3D")
                .font(.title2.bold())
            Text("Orbit a subject with ARKit. Savor trains a gaussian splat on-device with Metal — capture, train, view, and share, all on your iPhone.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 320)
            Button("AR Capture", systemImage: "camera.viewfinder") { showCreate = true }
                .savorProminentGlassButton()
                .controlSize(.large)
            Button("Explore the sample sculpture") { onOpenSample() }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(SavorTheme.accent)
        }
        .padding(28)
    }
}

struct CaptureCardView: View {
    let capture: Capture

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [
                                SavorTheme.cyan.opacity(0.25),
                                SavorTheme.accent.opacity(0.18),
                                SavorTheme.warm.opacity(0.22),
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(height: 120)
                Image(systemName: capture.isSample ? "building.columns.fill" : capture.stage.systemImage)
                    .font(.system(size: 34, weight: .light))
                    .foregroundStyle(.primary.opacity(0.7))
                if capture.isProcessing {
                    ProgressView(value: capture.overallProgress)
                        .tint(SavorTheme.accent)
                        .padding(.horizontal, 16)
                        .frame(maxHeight: .infinity, alignment: .bottom)
                        .padding(.bottom, 12)
                }
            }
            Text(capture.name)
                .font(.headline)
                .lineLimit(1)
            Text(subtitle)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(12)
        .savorGlass(cornerRadius: SavorTheme.tileRadius, interactive: true)
    }

    private var subtitle: String {
        if capture.isReady {
            if let count = capture.gaussianCount {
                return "\(count.formatted()) gaussians"
            }
            return "Ready"
        }
        if capture.isFailed { return "Failed" }
        return capture.stage.title
    }
}
