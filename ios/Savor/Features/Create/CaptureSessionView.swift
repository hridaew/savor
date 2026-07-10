import ARKit
import SwiftData
import SwiftUI

struct CaptureSessionView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var session = ARCaptureSession()
    @State private var name = ""
    @State private var quality: CaptureQuality = .balanced

    var onFinished: (Capture) -> Void

    var body: some View {
        ZStack {
            ARPreviewView(arSession: session.session)
                .ignoresSafeArea()

            LinearGradient(
                colors: [.black.opacity(0.45), .clear, .black.opacity(0.55)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            .allowsHitTesting(false)

            VStack {
                topBar
                Spacer()
                if session.status == .idle || session.status == .requestingPermissions || isFailed {
                    setupCard
                } else {
                    liveHUD
                }
            }
            .padding(16)
        }
        .background(Color.black)
        .statusBarHidden(true)
        .onDisappear {
            if session.status == .running {
                session.cancel()
            }
        }
    }

    private var isFailed: Bool {
        if case .failed = session.status { return true }
        return false
    }

    private var topBar: some View {
        HStack {
            Button {
                session.cancel()
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.body.weight(.bold))
                    .foregroundStyle(.white)
                    .padding(12)
            }
            .savorGlass(cornerRadius: 999, interactive: true)

            Spacer()

            Text(session.trackingState)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .savorGlass(cornerRadius: 999)
        }
    }

    private var setupCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("New Capture")
                .font(.title2.bold())
            Text("Orbit your subject slowly. ARKit records camera poses — no COLMAP. LiDAR depth seeds the splat when available.")
                .font(.footnote)
                .foregroundStyle(.secondary)

            TextField("Name", text: $name)
                .padding(12)
                .savorGlass(cornerRadius: 12)

            Picker("Quality", selection: $quality) {
                ForEach(CaptureQuality.allCases) { q in
                    Text(q.title).tag(q)
                }
            }
            .pickerStyle(.segmented)

            Button {
                Task {
                    await session.start(name: name.isEmpty ? "Capture" : name)
                }
            } label: {
                Label("Start AR Capture", systemImage: "camera.viewfinder")
                    .frame(maxWidth: .infinity)
            }
            .savorProminentGlassButton()
            .controlSize(.large)

            if case .failed(let msg) = session.status {
                Text(msg).font(.footnote).foregroundStyle(.red)
            }
        }
        .padding(18)
        .savorGlass(cornerRadius: 24)
    }

    private var liveHUD: some View {
        VStack(spacing: 14) {
            HStack(spacing: 18) {
                metric("\(session.frameCount)", "Frames")
                metric(timeString(session.elapsed), "Time")
                metric("\(session.pointCount)", session.hasLiDAR ? "LiDAR pts" : "Seeds")
            }
            .padding(14)
            .savorGlass(cornerRadius: 18)

            Text(session.hasLiDAR
                 ? "Walk a slow circle. LiDAR is seeding the point cloud."
                 : "Walk a slow circle. Depth seeds will be estimated from poses.")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 12)

            Button {
                Task { await finish() }
            } label: {
                Label(
                    session.status == .finishing ? "Saving…" : "Finish & Train",
                    systemImage: "sparkles"
                )
                .frame(maxWidth: .infinity)
            }
            .savorProminentGlassButton()
            .controlSize(.large)
            .disabled(session.frameCount < 8 || session.status == .finishing)
            .opacity(session.frameCount < 8 ? 0.5 : 1)
        }
    }

    private func metric(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.title3.bold().monospacedDigit())
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private func timeString(_ t: TimeInterval) -> String {
        let s = Int(t)
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    private func finish() async {
        guard let capture = await session.stop() else { return }
        capture.quality = quality
        modelContext.insert(capture)
        try? modelContext.save()
        onFinished(capture)
        dismiss()
    }
}

struct ARPreviewView: UIViewRepresentable {
    let arSession: ARSession

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView()
        view.session = arSession
        view.automaticallyUpdatesLighting = true
        view.rendersCameraGrain = false
        return view
    }

    func updateUIView(_ uiView: ARSCNView, context: Context) {
        if uiView.session !== arSession {
            uiView.session = arSession
        }
    }
}
