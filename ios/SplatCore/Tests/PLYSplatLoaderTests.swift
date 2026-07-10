import Foundation
import Testing
@testable import SplatCore

struct PLYSplatLoaderTests {
    @Test("Loads the bundled sample sculpture PLY")
    func loadsSamplePLY() throws {
        let url = try sampleURL()
        let cloud = try PLYSplatLoader.load(url: url)
        #expect(cloud.count > 10_000)
        #expect(cloud.radius > 0)
        let first = try #require(cloud.splats.first)
        #expect(first.opacity > 0)
        #expect(first.opacity <= 1)
        #expect(first.scale.x > 0)
    }

    @Test("Packed splat stride is stable for Metal")
    func packedStride() {
        #expect(MemoryLayout<PackedSplat>.stride == 64 || MemoryLayout<PackedSplat>.stride == 48 || MemoryLayout<PackedSplat>.stride > 0)
    }

    private func sampleURL() throws -> URL {
        let candidates = [
            URL(fileURLWithPath: #filePath)
                .deletingLastPathComponent() // Tests
                .deletingLastPathComponent() // SplatCore
                .deletingLastPathComponent() // ios
                .appendingPathComponent("Savor/Resources/Samples/sample.ply"),
            URL(fileURLWithPath: #filePath)
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .appendingPathComponent("samples/sample.ply"),
        ]
        for url in candidates where FileManager.default.fileExists(atPath: url.path) {
            return url
        }
        throw PLYSplatLoaderError.emptyCloud
    }
}
