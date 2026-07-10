import PhotosUI
import SwiftData
import SwiftUI
import UniformTypeIdentifiers

struct CreateCaptureSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @Environment(CompanionClient.self) private var companion

    @State private var name = ""
    @State private var quality: CaptureQuality = .balanced
    @State private var pickedVideo: PhotosPickerItem?
    @State private var videoURL: URL?
    @State private var videoName: String?
    @State private var isImportingFile = false
    @State private var isBusy = false
    @State private var errorMessage: String?
    @State private var useCompanion = false

    var onCreated: (Capture) -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("New Capture")
                        .font(.largeTitle.bold())
                        .padding(.top, 8)

                    videoPicker

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Name")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.secondary)
                        TextField("Sculpture, mug, plant…", text: $name)
                            .textFieldStyle(.plain)
                            .padding(14)
                            .savorGlass(cornerRadius: SavorTheme.buttonRadius)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Quality")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.secondary)
                        ForEach(CaptureQuality.allCases) { q in
                            Button {
                                withAnimation(SavorTheme.quick) { quality = q }
                            } label: {
                                HStack(spacing: 14) {
                                    Image(systemName: q.systemImage)
                                        .font(.title3)
                                        .foregroundStyle(quality == q ? SavorTheme.accent : .secondary)
                                        .frame(width: 28)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(q.title).font(.headline)
                                        Text(q.subtitle).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if quality == q {
                                        Image(systemName: "checkmark.circle.fill")
                                            .foregroundStyle(SavorTheme.accent)
                                    }
                                }
                                .padding(14)
                                .savorGlass(
                                    cornerRadius: SavorTheme.buttonRadius,
                                    interactive: true,
                                    tint: quality == q ? SavorTheme.accent.opacity(0.18) : nil
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    companionSection

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }

                    Button {
                        Task { await create() }
                    } label: {
                        Label(isBusy ? "Working…" : "Create Capture", systemImage: "sparkles")
                            .frame(maxWidth: .infinity)
                    }
                    .savorProminentGlassButton()
                    .controlSize(.large)
                    .disabled(videoURL == nil || isBusy)
                    .padding(.bottom, 24)
                }
                .padding(.horizontal, 20)
            }
            .background(SavorBackdrop())
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .fileImporter(
                isPresented: $isImportingFile,
                allowedContentTypes: [.movie, .mpeg4Movie, .quickTimeMovie],
                allowsMultipleSelection: false
            ) { result in
                if case .success(let urls) = result, let url = urls.first {
                    ingestVideo(url: url)
                }
            }
            .onChange(of: pickedVideo) { _, item in
                guard let item else { return }
                Task { await loadPickerItem(item) }
            }
        }
    }

    private var videoPicker: some View {
        VStack(spacing: 12) {
            if let videoName {
                HStack(spacing: 12) {
                    Image(systemName: "film")
                        .font(.title2)
                        .foregroundStyle(SavorTheme.accent)
                    VStack(alignment: .leading) {
                        Text(videoName).font(.headline).lineLimit(1)
                        Text("Tap to change").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                }
            } else {
                Image(systemName: "film")
                    .font(.system(size: 34, weight: .light))
                    .foregroundStyle(SavorTheme.accent)
                Text("Choose a video").font(.headline)
                Text("A 20–40s clip slowly circling your subject")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            HStack(spacing: 10) {
                PhotosPicker(selection: $pickedVideo, matching: .videos) {
                    Label("Photos", systemImage: "photo.on.rectangle")
                        .frame(maxWidth: .infinity)
                }
                .savorGlassButton()

                Button {
                    isImportingFile = true
                } label: {
                    Label("Files", systemImage: "folder")
                        .frame(maxWidth: .infinity)
                }
                .savorGlassButton()
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .savorGlass(cornerRadius: SavorTheme.cardRadius, interactive: true)
    }

    private var companionSection: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                Toggle(isOn: $useCompanion) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Train on Mac companion")
                            .font(.headline)
                        Text("COLMAP + Brush need a Mac/PC GPU. Your iPhone views the result locally in Metal.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .tint(SavorTheme.accent)

                if useCompanion {
                    TextField("Companion URL", text: Binding(
                        get: { companion.baseURL.absoluteString },
                        set: { if let url = URL(string: $0) { companion.baseURL = url } }
                    ))
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    .padding(12)
                    .savorGlass(cornerRadius: 12)

                    Button("Check connection") {
                        Task { await companion.ping() }
                    }
                    .savorGlassButton()

                    HStack {
                        Circle()
                            .fill(companion.isReachable ? Color.green : Color.red)
                            .frame(width: 8, height: 8)
                        Text(companion.isReachable ? "Companion reachable" : (companion.lastError ?? "Not connected"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Text("Without a companion, import a finished `.ply` from Files after training on your Mac.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func loadPickerItem(_ item: PhotosPickerItem) async {
        do {
            if let url = try await item.loadTransferable(type: VideoFileTransferable.self)?.url {
                ingestVideo(url: url)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func ingestVideo(url: URL) {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        videoURL = url
        videoName = url.lastPathComponent
        if name.isEmpty {
            name = url.deletingPathExtension().lastPathComponent
        }
    }

    private func create() async {
        guard let videoURL else { return }
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }

        let capture = Capture(name: name.isEmpty ? "Capture" : name, quality: quality)
        do {
            let dir = try SavorPaths.ensureCaptureDirectory(for: capture.id)
            let dest = dir.appendingPathComponent("source.mp4")
            let accessed = videoURL.startAccessingSecurityScopedResource()
            defer { if accessed { videoURL.stopAccessingSecurityScopedResource() } }
            if FileManager.default.fileExists(atPath: dest.path) {
                try FileManager.default.removeItem(at: dest)
            }
            try FileManager.default.copyItem(at: videoURL, to: dest)
            capture.videoRelativePath = SavorPaths.relativePath(for: dest)

            if useCompanion {
                capture.stage = .queued
                capture.statusMessage = "Uploading to Mac companion…"
                let jobID = try await companion.uploadVideo(fileURL: dest, name: capture.name, quality: quality)
                capture.companionJobID = jobID
                capture.stage = .extracting
                capture.statusMessage = "Training on companion…"
            } else {
                capture.stage = .queued
                capture.statusMessage = "Video saved. Import a .ply or connect a Mac companion to train."
            }

            modelContext.insert(capture)
            try modelContext.save()
            onCreated(capture)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct VideoFileTransferable: Transferable {
    let url: URL
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { video in
            SentTransferredFile(video.url)
        } importing: { received in
            VideoFileTransferable(url: received.file)
        }
    }
}

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
            .fileImporter(isPresented: $isImporterPresented, allowedContentTypes: [UTType(filenameExtension: "ply") ?? .data]) { result in
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
