import SwiftUI

struct AboutView: View {
    @Environment(CompanionClient.self) private var companion
    var onOpenSample: () -> Void

    private let steps: [(String, String, String, Color)] = [
        ("film", "Film a clip", "Slowly walk around your subject for 20–40 seconds.", Color.teal),
        ("photo", "Extract frames", "ffmpeg pulls evenly-spaced stills from your video.", Color.blue),
        ("viewfinder", "Solve geometry", "COLMAP recovers camera poses and a sparse point cloud.", Color.cyan),
        ("sparkles", "Train the splat", "Brush optimizes gaussians on a Mac/PC GPU.", Color.orange),
        ("cube.transparent", "Orbit on iPhone", "Metal (and RealityKit on iOS 26+) renders the .ply locally.", Color.green),
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

                        sectionTitle("The pipeline")
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

                        sectionTitle("On your iPhone")
                        GlassCard {
                            VStack(alignment: .leading, spacing: 10) {
                                labeledRow("Renderer", "Metal gaussian splat engine")
                                labeledRow("Native path", "RealityKit GaussianSplatComponent (iOS 26+)")
                                labeledRow("UI", "SwiftUI Liquid Glass")
                                labeledRow("Storage", "SwiftData + on-device Files")
                            }
                        }

                        sectionTitle("Mac companion")
                        GlassCard {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("Training still needs ffmpeg, COLMAP, and Brush — those run on your Mac via the existing Savor server. The iPhone app views and organizes the results.")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                                TextField("Companion URL", text: Binding(
                                    get: { companion.baseURL.absoluteString },
                                    set: { if let url = URL(string: $0) { companion.baseURL = url } }
                                ))
                                .textInputAutocapitalization(.never)
                                .keyboardType(.URL)
                                .padding(12)
                                .savorGlass(cornerRadius: 12)
                                Button("Check tools") {
                                    Task { await companion.ping() }
                                }
                                .savorGlassButton()
                                ForEach(["ffmpeg", "colmap", "brush"], id: \.self) { tool in
                                    HStack {
                                        Circle()
                                            .fill(dotColor(for: tool))
                                            .frame(width: 8, height: 8)
                                        Text(tool)
                                            .font(.subheadline.weight(.semibold))
                                        Spacer()
                                        Text(statusText(for: tool))
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }

                        sectionTitle("Capture tips")
                        GlassCard {
                            VStack(alignment: .leading, spacing: 10) {
                                tip("Move slowly — motion blur ruins matching.")
                                tip("Keep the subject filling most of the frame.")
                                tip("Even, diffuse light. Avoid glare and mirrors.")
                                tip("Matte, textured objects work best.")
                                tip("Cover high, low, and all the way around.")
                            }
                        }

                        Text("Savor · native iOS · Metal · Liquid Glass")
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
            .task { await companion.ping() }
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
            Text(value).font(.footnote).foregroundStyle(.secondary)
        }
    }

    private func tip(_ text: String) -> some View {
        Label(text, systemImage: "checkmark")
            .font(.subheadline)
            .foregroundStyle(.primary)
            .labelStyle(.titleAndIcon)
            .symbolRenderingMode(.hierarchical)
            .tint(SavorTheme.accent)
    }

    private func dotColor(for tool: String) -> Color {
        guard companion.isReachable else { return .secondary }
        return companion.toolHealth[tool] == true ? .green : .red
    }

    private func statusText(for tool: String) -> String {
        guard companion.isReachable else { return "—" }
        return companion.toolHealth[tool] == true ? "ready" : "missing"
    }
}
