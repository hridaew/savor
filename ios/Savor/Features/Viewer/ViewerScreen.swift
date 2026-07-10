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
    @State private var gaussianCount = 0
    @State private var showHint = true
    @State private var confirmDelete = false

    private enum ViewMode: String, CaseIterable {
        case subject
        case scene
    }

    private var activeURL: URL? {
        mode == .scene ? (sceneURL ?? subjectURL) : subjectURL
    }

    var body: some View {
        ZStack {
            SavorBackdrop()

            if let activeURL, errorMessage == nil {
                SplatMetalView(
                    plyURL: activeURL,
                    autoRotate: autoRotate,
                    resetToken: resetToken,
                    yaw: yaw,
                    pitch: pitch,
                    radius: radius,
                    onLoadProgress: { loadProgress = $0 },
                    onLoaded: { count in
                        gaussianCount = count
                        withAnimation(SavorTheme.quick) { isLoaded = true }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
                            withAnimation { showHint = false }
                        }
                    },
                    onError: { errorMessage = $0 }
                )
                .ignoresSafeArea()

                SplatOrbitGestureOverlay(yaw: $yaw, pitch: $pitch, radius: $radius)
                    .ignoresSafeArea()
            }

            if !isLoaded && errorMessage == nil && activeURL != nil {
                loadingOverlay
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

            VStack {
                topBar
                if sceneURL != nil {
                    modePicker
                        .padding(.top, 8)
                }
                Spacer()
                if showHint && isLoaded {
                    hint
                        .transition(.opacity.combined(with: .move(edge: .bottom)))
                }
                bottomBar
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 20)
        }
        .onChange(of: mode) { _, _ in
            isLoaded = false
            loadProgress = 0
            errorMessage = nil
        }
        .onChange(of: confirmDelete) { _, armed in
            guard armed else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                confirmDelete = false
            }
        }
        .statusBarHidden(true)
    }

    private var topBar: some View {
        HStack {
            GlassControlButton(systemImage: "chevron.left", action: { dismiss() })
            Spacer()
            Text(title)
                .font(.headline)
                .lineLimit(1)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .savorGlass(cornerRadius: 999)
            Spacer()
            ShareLink(item: activeURL ?? URL(fileURLWithPath: "/")) {
                Image(systemName: "square.and.arrow.up")
                    .font(.body.weight(.semibold))
                    .padding(12)
            }
            .savorGlass(cornerRadius: 999, interactive: true)
            .disabled(activeURL == nil)
            .opacity(activeURL == nil ? 0.4 : 1)
        }
    }

    private var modePicker: some View {
        Picker("Mode", selection: $mode) {
            Text("Subject").tag(ViewMode.subject)
            Text("Scene").tag(ViewMode.scene)
        }
        .pickerStyle(.segmented)
        .frame(maxWidth: 240)
        .padding(6)
        .savorGlass(cornerRadius: 14)
    }

    private var bottomBar: some View {
        HStack(spacing: 10) {
            GlassControlButton(
                systemImage: "arrow.triangle.2.circlepath",
                label: autoRotate ? "Auto-rotate" : "Rotate",
                isOn: autoRotate
            ) {
                autoRotate.toggle()
            }
            GlassControlButton(systemImage: "viewfinder", label: "Recenter") {
                withAnimation(SavorTheme.spring) {
                    yaw = 0.35
                    pitch = 0.25
                    radius = 3.4
                    resetToken += 1
                }
            }
            if onDelete != nil {
                GlassControlButton(
                    systemImage: "trash",
                    label: confirmDelete ? "Delete?" : nil,
                    tint: .red
                ) {
                    if confirmDelete {
                        onDelete?()
                        dismiss()
                    } else {
                        confirmDelete = true
                    }
                }
            }
        }
    }

    private var hint: some View {
        Label("Drag to orbit · pinch to zoom", systemImage: "hand.draw")
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .savorGlass(cornerRadius: 999)
            .padding(.bottom, 12)
    }

    private var loadingOverlay: some View {
        VStack(spacing: 14) {
            ProgressView(value: loadProgress)
                .frame(width: 120)
            Text(loadProgress > 0.05 ? "Loading splat… \(Int(loadProgress * 100))%" : "Loading splat…")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(24)
        .savorGlass(cornerRadius: 22)
    }
}
