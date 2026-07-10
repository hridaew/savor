import SwiftUI

struct ViewerScreen: View {
    let title: String
    let subjectURL: URL?
    let sceneURL: URL?
    var onDelete: (() -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var mode: ViewMode = .subject
    @State private var autoRotate = true
    @State private var resetToken = 0
    @State private var yaw: Float = 0.35
    @State private var pitch: Float = 0.25
    @State private var radius: Float = 3.4
    @State private var loadProgress: Double = 0
    @State private var isLoaded = false
    @State private var errorMessage: String?
    @State private var showDeleteConfirm = false

    private enum ViewMode: String, CaseIterable, Identifiable {
        case subject
        case scene
        var id: String { rawValue }
        var title: String {
            switch self {
            case .subject: "Subject"
            case .scene: "Scene"
            }
        }
    }

    private var activeURL: URL? {
        mode == .scene ? (sceneURL ?? subjectURL) : subjectURL
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color(.systemGroupedBackground).ignoresSafeArea()

                if let activeURL, errorMessage == nil {
                    SplatMetalView(
                        plyURL: activeURL,
                        autoRotate: autoRotate,
                        resetToken: resetToken,
                        yaw: yaw,
                        pitch: pitch,
                        radius: radius,
                        onLoadProgress: { loadProgress = $0 },
                        onLoaded: { _ in
                            withAnimation(SavorTheme.quick) { isLoaded = true }
                        },
                        onFramed: { framed in
                            radius = framed
                            yaw = 0.35
                            pitch = 0.25
                        },
                        onError: { errorMessage = $0 }
                    )
                    .ignoresSafeArea(edges: .bottom)

                    SplatOrbitGestureOverlay(yaw: $yaw, pitch: $pitch, radius: $radius)
                }

                if !isLoaded && errorMessage == nil && activeURL != nil {
                    ProgressView(loadProgress > 0.05 ? "Loading… \(Int(loadProgress * 100))%" : "Loading…")
                }

                if activeURL == nil && errorMessage == nil {
                    ContentUnavailableView(
                        "No splat file",
                        systemImage: "doc.questionmark",
                        description: Text("The sample PLY wasn’t found in the app bundle. Clean build and reinstall.")
                    )
                }

                if let errorMessage {
                    ContentUnavailableView(
                        "Couldn’t render this splat",
                        systemImage: "exclamationmark.triangle",
                        description: Text(errorMessage)
                    )
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if let activeURL {
                        ShareLink(item: activeURL) {
                            Image(systemName: "square.and.arrow.up")
                        }
                    }
                    if onDelete != nil {
                        Button("Delete", systemImage: "trash", role: .destructive) {
                            showDeleteConfirm = true
                        }
                    }
                }
                ToolbarItemGroup(placement: .bottomBar) {
                    Toggle("Auto-rotate", systemImage: "arrow.triangle.2.circlepath", isOn: $autoRotate)
                    Button("Recenter", systemImage: "viewfinder") {
                        yaw = 0.35
                        pitch = 0.25
                        resetToken += 1
                    }
                    if sceneURL != nil {
                        Picker("Mode", selection: $mode) {
                            ForEach(ViewMode.allCases) { mode in
                                Text(mode.title).tag(mode)
                            }
                        }
                        .pickerStyle(.segmented)
                        .frame(maxWidth: 160)
                    }
                }
            }
            .confirmationDialog("Delete this capture?", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    onDelete?()
                    dismiss()
                }
                Button("Cancel", role: .cancel) {}
            }
            .onChange(of: mode) { _, _ in
                isLoaded = false
                loadProgress = 0
                errorMessage = nil
            }
        }
    }
}
