import SwiftData
import SwiftUI

@main
struct SavorApp: App {
    @State private var companion = CompanionClient()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(companion)
                .tint(SavorTheme.accent)
        }
        .modelContainer(for: Capture.self)
    }
}

struct RootView: View {
    @Environment(\.modelContext) private var modelContext

    @State private var selectedTab: AppTab = .library
    @State private var showCreate = false
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
                showCreate: $showCreate,
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
        .sheet(isPresented: $showCreate) {
            CreateCaptureSheet { capture in
                if capture.isReady {
                    presentedCapture = capture
                } else {
                    showProcessing = capture
                }
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showImportPLY) {
            ImportPLYSheet { capture in
                presentedCapture = capture
            }
        }
        .fullScreenCover(item: $presentedCapture) { capture in
            ViewerScreen(
                title: capture.name,
                subjectURL: SavorPaths.resolve(capture.subjectPlyRelativePath) ?? BundleSample.subjectURL,
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
            Button("New capture from video", systemImage: "film") { showCreate = true }
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
