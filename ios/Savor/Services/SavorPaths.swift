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
    static var subjectURL: URL? { findPLY(named: "sample") }
    static var sceneURL: URL? { findPLY(named: "sample-scene") }

    /// Folder-reference packaging can put PLYs under Samples/, at the bundle root,
    /// or nested one level deeper depending on how Xcode copied resources.
    private static func findPLY(named name: String) -> URL? {
        let bundle = Bundle.main
        let candidates: [URL?] = [
            bundle.url(forResource: name, withExtension: "ply", subdirectory: "Samples"),
            bundle.url(forResource: name, withExtension: "ply"),
            bundle.resourceURL?
                .appendingPathComponent("Samples", isDirectory: true)
                .appendingPathComponent("\(name).ply"),
            bundle.bundleURL
                .appendingPathComponent("Samples", isDirectory: true)
                .appendingPathComponent("\(name).ply"),
        ]
        for url in candidates {
            if let url, FileManager.default.fileExists(atPath: url.path) {
                return url
            }
        }
        // Last resort: walk the bundle for a matching filename.
        if let root = bundle.resourceURL,
           let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil) {
            for case let fileURL as URL in enumerator where fileURL.lastPathComponent == "\(name).ply" {
                return fileURL
            }
        }
        return nil
    }
}
