import SwiftUI

struct AboutView: View {
    var onOpenSample: () -> Void

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button {
                        onOpenSample()
                    } label: {
                        Label("Explore sample sculpture", systemImage: "building.columns")
                    }
                }

                Section {
                    Label("ARKit world tracking for camera poses", systemImage: "arkit")
                    Label("Optional LiDAR depth as seed points", systemImage: "lidar.ranged")
                    Label("On-device Metal SH0 training", systemImage: "cpu")
                    Label("Metal splat viewer + ShareLink", systemImage: "square.and.arrow.up")
                } header: {
                    Text("How it works")
                } footer: {
                    Text("Capture, train, view, and share — all on your iPhone. No Mac companion.")
                }

                Section("Native stack") {
                    LabeledContent("Poses", value: "ARKit world tracking")
                    LabeledContent("Depth", value: "LiDAR sceneDepth")
                    LabeledContent("Training", value: "Metal compute")
                    LabeledContent("Viewer", value: "Metal splat renderer")
                    LabeledContent("Storage", value: "SwiftData + Files")
                }

                Section("Limits") {
                    Text("Training is a mobile prototype (SH0, limited steps). Expect lower quality than desktop Brush/COLMAP. A physical iPhone is required for AR capture.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Capture tips") {
                    Text("Move slowly — ARKit needs stable tracking.")
                    Text("Keep the subject filling most of the frame.")
                    Text("Even light. Avoid mirrors and pure glass.")
                    Text("LiDAR iPhones get much better seed clouds.")
                    Text("Cover high, low, and all the way around.")
                }
            }
            .navigationTitle("About")
        }
    }
}
