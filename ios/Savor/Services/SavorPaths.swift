import Foundation

enum SavorPaths {
    static var documents: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    static var capturesRoot: URL {
        documents.appendingPathComponent("Captures", isDirectory: true)
    }

    static func captureDirectory(for id: UUID) -> URL {
        capturesRoot.appendingPathComponent(id.uuidString, isDirectory: true)
    }

    static func ensureCaptureDirectory(for id: UUID) throws -> URL {
        let url = captureDirectory(for: id)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    static func resolve(_ relative: String?) -> URL? {
        guard let relative, !relative.isEmpty else { return nil }
        return documents.appendingPathComponent(relative)
    }

    static func relativePath(for url: URL) -> String {
        let root = documents.standardizedFileURL.path
        let path = url.standardizedFileURL.path
        if path.hasPrefix(root + "/") {
            return String(path.dropFirst(root.count + 1))
        }
        return url.lastPathComponent
    }
}

enum BundleSample {
    static var subjectURL: URL? {
        Bundle.main.url(forResource: "sample", withExtension: "ply", subdirectory: "Samples")
            ?? Bundle.main.url(forResource: "sample", withExtension: "ply")
    }

    static var sceneURL: URL? {
        Bundle.main.url(forResource: "sample-scene", withExtension: "ply", subdirectory: "Samples")
            ?? Bundle.main.url(forResource: "sample-scene", withExtension: "ply")
    }
}
