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
        NavigationStack {
            ZStack {
                ARPreviewView(arSession: session.session)
                    .ignoresSafeArea()

                VStack {
                    Spacer()
                    if session.status == .idle || session.status == .requestingPermissions || isFailed {
                        setupPanel
                    } else {
                        liveHUD
                    }
                }
            }
            .background(Color.black)
            .navigationTitle(session.status == .running ? session.trackingState : "New Capture")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        session.cancel()
                        dismiss()
                    }
                }
            }
            .onDisappear {
                if session.status == .running {
                    session.cancel()
                }
            }
        }
    }

    private var isFailed: Bool {
        if case .failed = session.status { return true }
        return false
    }

    private var setupPanel: some View {
        Form {
            Section {
                TextField("Name", text: $name)
                Picker("Quality", selection: $quality) {
                    ForEach(CaptureQuality.allCases) { q in
                        Text(q.title).tag(q)
                    }
                }
                .pickerStyle(.segmented)
            } footer: {
                Text("Orbit your subject slowly. ARKit records camera poses — no COLMAP. LiDAR depth seeds the splat when available.")
            }

            Section {
                Button {
                    Task {
                        await session.start(name: name.isEmpty ? "Capture" : name)
                    }
                } label: {
                    Label("Start AR Capture", systemImage: "camera.viewfinder")
                }
                .disabled(session.status == .requestingPermissions)
            }

            if case .failed(let msg) = session.status {
                Section {
                    Text(msg)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .frame(maxHeight: 320)
        .background(.regularMaterial)
    }

    private var liveHUD: some View {
        VStack(spacing: 12) {
            HStack(spacing: 20) {
                metric("\(session.frameCount)", "Frames")
                metric(timeString(session.elapsed), "Time")
                metric("\(session.pointCount)", session.hasLiDAR ? "LiDAR pts" : "Seeds")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))

            Text(session.hasLiDAR
                 ? "Walk a slow circle. LiDAR is seeding the point cloud."
                 : "Walk a slow circle. Keep the subject centered and well lit.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            Button {
                Task { await finish() }
            } label: {
                Label(
                    session.status == .finishing ? "Saving…" : "Finish & Train",
                    systemImage: "sparkles"
                )
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(session.frameCount < 8 || session.status == .finishing)
        }
        .padding(16)
        .background(.bar)
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
