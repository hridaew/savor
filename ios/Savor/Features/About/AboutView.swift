import SwiftUI

struct AboutView: View {
    var onOpenSample: () -> Void

    private let steps: [(String, String, String, Color)] = [
        ("camera.viewfinder", "ARKit capture", "Orbit your subject. ARKit records camera poses from the IMU + visual tracking — no COLMAP.", Color.teal),
        ("lidar", "LiDAR seeds", "Scene depth builds the initial point cloud that gaussians grow from.", Color.blue),
        ("cpu", "Metal training", "On-device forward + backward pass optimizes scales, rotations, colors, and opacity on the phone GPU.", Color.orange),
        ("cube.transparent", "Orbit & share", "View the .ply in Metal, then ShareLink it anywhere.", Color.green),
    ]

    var body: some View {
        NavigationStack {
            ZStack {
                SavorBackdrop()
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        Button {
                            onOpenSample()
                        } label: {
                            Label("Explore the sample sculpture", systemImage: "building.columns.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .savorProminentGlassButton()
                        .controlSize(.large)

                        sectionTitle("All on your iPhone")
                        GlassCard(padding: 0) {
                            VStack(alignment: .leading, spacing: 0) {
                                ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                                    HStack(alignment: .top, spacing: 14) {
                                        VStack(spacing: 0) {
                                            ZStack {
                                                Circle().fill(step.3).frame(width: 40, height: 40)
                                                Image(systemName: step.0)
                                                    .foregroundStyle(.white)
                                                    .font(.body.weight(.semibold))
                                            }
                                            if index < steps.count - 1 {
                                                Rectangle()
                                                    .fill(Color.secondary.opacity(0.2))
                                                    .frame(width: 2, height: 28)
                                            }
                                        }
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(step.1).font(.headline)
                                            Text(step.2)
                                                .font(.footnote)
                                                .foregroundStyle(.secondary)
                                                .fixedSize(horizontal: false, vertical: true)
                                        }
                                        .padding(.bottom, 16)
                                    }
                                    .padding(.horizontal, 16)
                                    .padding(.top, index == 0 ? 16 : 0)
                                }
                            }
                        }

                        sectionTitle("Native stack")
                        GlassCard {
                            VStack(alignment: .leading, spacing: 10) {
                                labeledRow("Poses", "ARKit world tracking")
                                labeledRow("Depth", "LiDAR sceneDepth (when available)")
                                labeledRow("Training", "Metal compute (on-device 3DGS)")
                                labeledRow("Viewer", "Metal splat renderer")
                                labeledRow("UI", "SwiftUI Liquid Glass")
                                labeledRow("Storage", "SwiftData + Files")
                            }
                        }

                        sectionTitle("What we replaced")
                        GlassCard {
                            VStack(alignment: .leading, spacing: 10) {
                                labeledRow("COLMAP", "→ ARKit transforms")
                                labeledRow("Brush / CUDA", "→ Metal trainer")
                                labeledRow("WebGL viewer", "→ Metal / RealityKit")
                                labeledRow("Mac companion", "→ removed — all on-device")
                            }
                        }

                        sectionTitle("Capture tips")
                        GlassCard {
                            VStack(alignment: .leading, spacing: 10) {
                                tip("Move slowly — ARKit needs stable tracking.")
                                tip("Keep the subject filling most of the frame.")
                                tip("Even light. Avoid mirrors and pure glass.")
                                tip("LiDAR iPhones get much better seed clouds.")
                                tip("Cover high, low, and all the way around.")
                            }
                        }

                        Text("Savor · capture · train · view · share — on iPhone")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                    }
                    .padding(20)
                    .padding(.bottom, 100)
                }
            }
            .navigationTitle("About")
        }
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 4)
    }

    private func labeledRow(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title).font(.subheadline.weight(.semibold))
            Spacer()
            Text(value)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.trailing)
        }
    }

    private func tip(_ text: String) -> some View {
        Label(text, systemImage: "checkmark")
            .font(.subheadline)
            .symbolRenderingMode(.hierarchical)
            .tint(SavorTheme.accent)
    }
}
