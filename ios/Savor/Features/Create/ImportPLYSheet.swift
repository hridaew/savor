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
            Form {
                Section {
                    TextField("Name", text: $name)
                    Button("Choose .ply file", systemImage: "doc.badge.plus") {
                        isImporterPresented = true
                    }
                } footer: {
                    Text("Import a Gaussian splat `.ply` from Scaniverse, Brush, or another exporter.")
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                            .font(.footnote)
                    }
                }
            }
            .navigationTitle("Import PLY")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .fileImporter(
                isPresented: $isImporterPresented,
                allowedContentTypes: [UTType(filenameExtension: "ply") ?? .data],
                allowsMultipleSelection: false
            ) { result in
                // SDK returns Result<[URL], Error> even when allowsMultipleSelection is false.
                switch result {
                case .success(let urls):
                    guard let url = urls.first else { return }
                    Task { await importPLY(url) }
                case .failure(let error):
                    errorMessage = error.localizedDescription
                }
            }
        }
    }

    private func importPLY(_ url: URL) async {
        do {
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
