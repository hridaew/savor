import SwiftData
import SwiftUI

@main
struct SavorApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
        .modelContainer(for: Capture.self)
    }
}

struct RootView: View {
    @Environment(\.modelContext) private var modelContext

    @State private var selectedTab: AppTab = .library
    @State private var showCapture = false
    @State private var showImportPLY = false
    @State private var presentedCapture: Capture?
    @State private var showSample = false
    @State private var showProcessing: Capture?

    private enum AppTab: Hashable {
        case library
        case about
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            LibraryView(
                showCapture: $showCapture,
                showImportPLY: $showImportPLY,
                onOpen: open,
                onOpenSample: { showSample = true }
            )
            .tabItem { Label("Library", systemImage: "square.stack.3d.up") }
            .tag(AppTab.library)

            AboutView(onOpenSample: { showSample = true })
                .tabItem { Label("About", systemImage: "info.circle") }
                .tag(AppTab.about)
        }
        .fullScreenCover(isPresented: $showCapture) {
            CaptureSessionView { capture in
                showProcessing = capture
            }
        }
        .sheet(isPresented: $showImportPLY) {
            ImportPLYSheet { capture in
                presentedCapture = capture
            }
        }
        .fullScreenCover(item: $presentedCapture) { capture in
            ViewerScreen(
                title: capture.name,
                subjectURL: SavorPaths.resolve(capture.subjectPlyRelativePath),
                sceneURL: SavorPaths.resolve(capture.scenePlyRelativePath),
                onDelete: { delete(capture) }
            )
        }
        .fullScreenCover(item: $showProcessing) { capture in
            ProcessingScreen(
                capture: capture,
                onView: {
                    showProcessing = nil
                    presentedCapture = capture
                },
                onDelete: { delete(capture) }
            )
        }
        .fullScreenCover(isPresented: $showSample) {
            ViewerScreen(
                title: "Sample · Sculpture",
                subjectURL: BundleSample.subjectURL,
                sceneURL: BundleSample.sceneURL
            )
        }
    }

    private func open(_ capture: Capture) {
        if capture.isReady {
            presentedCapture = capture
        } else {
            showProcessing = capture
        }
    }

    private func delete(_ capture: Capture) {
        let dir = SavorPaths.captureDirectory(for: capture.id)
        try? FileManager.default.removeItem(at: dir)
        modelContext.delete(capture)
        try? modelContext.save()
        presentedCapture = nil
        showProcessing = nil
    }
}
