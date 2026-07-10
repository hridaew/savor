import SwiftUI
import UniformTypeIdentifiers
import SwiftData

struct ImportPLYSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var name = "Imported splat"
    @State private var isImporterPresented = false
    @State private var errorMessage: String?

    var onImported: (Capture) -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                TextField("Name", text: $name)
                    .padding(14)
                    .savorGlass(cornerRadius: 14)
                Button("Choose .ply file", systemImage: "doc.badge.plus") {
                    isImporterPresented = true
                }
                .savorProminentGlassButton()
                .controlSize(.large)
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red).font(.footnote)
                }
                Spacer()
            }
            .padding(20)
            .background(SavorBackdrop())
            .navigationTitle("Import PLY")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .fileImporter(
                isPresented: $isImporterPresented,
                allowedContentTypes: [UTType(filenameExtension: "ply") ?? .data]
            ) { result in
                Task { await importPLY(result) }
            }
        }
    }

    private func importPLY(_ result: Result<[URL], Error>) async {
        do {
            let urls = try result.get()
            guard let url = urls.first else { return }
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }

            let capture = Capture(name: name, stage: .ready)
            let dir = try SavorPaths.ensureCaptureDirectory(for: capture.id)
            let dest = dir.appendingPathComponent("subject.ply")
            if FileManager.default.fileExists(atPath: dest.path) {
                try FileManager.default.removeItem(at: dest)
            }
            try FileManager.default.copyItem(at: url, to: dest)
            capture.subjectPlyRelativePath = SavorPaths.relativePath(for: dest)
            capture.statusMessage = "Ready"
            capture.overallProgress = 1
            modelContext.insert(capture)
            try modelContext.save()
            onImported(capture)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
