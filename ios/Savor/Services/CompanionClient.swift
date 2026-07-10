import Foundation
import Observation

/// Talks to the local Savor Mac companion (`npm run dev` → localhost:8787).
///
/// On-device iPhone cannot run COLMAP / Brush. Capture videos here, then either:
/// 1. AirDrop / Files-import a finished `.ply`, or
/// 2. Point the phone at a Mac running the Savor companion on the same network.
@Observable
@MainActor
final class CompanionClient {
    var baseURL: URL {
        didSet { UserDefaults.standard.set(baseURL.absoluteString, forKey: "savor.companionURL") }
    }

    var isReachable = false
    var lastError: String?
    var toolHealth: [String: Bool] = [:]

    init() {
        if let saved = UserDefaults.standard.string(forKey: "savor.companionURL"),
           let url = URL(string: saved) {
            baseURL = url
        } else {
            baseURL = URL(string: "http://127.0.0.1:8787")!
        }
    }

    func ping() async {
        do {
            let url = baseURL.appendingPathComponent("api/health")
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                isReachable = false
                lastError = "Companion returned an error."
                return
            }
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                isReachable = json["ok"] as? Bool ?? true
                if let tools = json["tools"] as? [String: [String: Any]] {
                    toolHealth = tools.mapValues { ($0["ok"] as? Bool) ?? false }
                }
                lastError = nil
            } else {
                isReachable = true
                lastError = nil
            }
        } catch {
            isReachable = false
            lastError = error.localizedDescription
        }
    }

    func uploadVideo(
        fileURL: URL,
        name: String,
        quality: CaptureQuality
    ) async throws -> String {
        let boundary = "Boundary-\(UUID().uuidString)"
        var request = URLRequest(url: baseURL.appendingPathComponent("api/captures"))
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        let fileData = try Data(contentsOf: fileURL)
        var body = Data()
        func append(_ string: String) { body.append(Data(string.utf8)) }

        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"name\"\r\n\r\n")
        append("\(name)\r\n")

        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"quality\"\r\n\r\n")
        append("\(quality.rawValue)\r\n")

        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"video\"; filename=\"\(fileURL.lastPathComponent)\"\r\n")
        append("Content-Type: video/mp4\r\n\r\n")
        body.append(fileData)
        append("\r\n--\(boundary)--\r\n")

        request.httpBody = body
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let id = json?["id"] as? String else {
            throw URLError(.cannotParseResponse)
        }
        return id
    }

    func downloadPLY(from relativePath: String, to destination: URL) async throws {
        let cleaned = relativePath.split(separator: "?").first.map(String.init) ?? relativePath
        let url: URL
        if cleaned.hasPrefix("http") {
            guard let absolute = URL(string: cleaned) else { throw URLError(.badURL) }
            url = absolute
        } else if cleaned.hasPrefix("/") {
            url = URL(string: cleaned, relativeTo: baseURL)!.absoluteURL
        } else {
            url = baseURL.appendingPathComponent(cleaned)
        }
        let (temp, response) = try await URLSession.shared.download(from: url)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        if FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.removeItem(at: destination)
        }
        try FileManager.default.moveItem(at: temp, to: destination)
    }
}
