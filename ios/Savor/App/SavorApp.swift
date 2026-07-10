import SwiftData
import SwiftUI

@main
struct SavorApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .tint(SavorTheme.accent)
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
                showCreate: $showCapture,
                onOpen: open,
                onOpenSample: { showSample = true }
            )
            .tabItem { Label("Library", systemImage: "cube.transparent") }
            .tag(AppTab.library)

            AboutView(onOpenSample: { showSample = true })
                .tabItem { Label("About", systemImage: "info.circle") }
                .tag(AppTab.about)
        }
        .overlay(alignment: .bottom) {
            if selectedTab == .library {
                newButton
            }
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
                // Never fall back to the sample for a user capture — that made failed
                // captures look like a broken sample PLY.
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

    private var newButton: some View {
        Menu {
            Button("AR Capture & Train", systemImage: "camera.viewfinder") { showCapture = true }
            Button("Import .ply", systemImage: "doc.badge.plus") { showImportPLY = true }
        } label: {
            Image(systemName: "plus")
                .font(.title3.weight(.bold))
                .foregroundStyle(.white)
                .frame(width: 58, height: 58)
                .background(SavorTheme.accent.gradient, in: Circle())
                .shadow(color: SavorTheme.accent.opacity(0.35), radius: 16, y: 8)
        }
        .padding(.bottom, 8)
        .accessibilityLabel("New")
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
