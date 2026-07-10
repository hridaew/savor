import Foundation
import simd
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

    @Test("Packed splat stride is 64 bytes for Metal float4 layout")
    func packedStride() {
        #expect(MemoryLayout<PackedSplat>.stride == 64)
    }

    @Test("cleanedAndNormalized recenters and unit-scales")
    func cleansCloud() {
        let splats = (0..<100).map { i -> GaussianSplat in
            let t = Float(i) / 100
            return GaussianSplat(
                position: SIMD3(t, t * 0.2, -t),
                color: SIMD3(0.4, 0.5, 0.6),
                opacity: 0.8,
                scale: SIMD3(repeating: 0.02),
                rotation: simd_quatf(ix: 0, iy: 0, iz: 0, r: 1)
            )
        }
        let cleaned = SplatCloud(splats: splats).cleanedAndNormalized()
        #expect(cleaned.count > 50)
        #expect(cleaned.radius > 0.4)
        #expect(cleaned.radius < 1.6)
        #expect(abs(cleaned.center.x) < 0.2)
        #expect(abs(cleaned.center.y) < 0.2)
        #expect(abs(cleaned.center.z) < 0.2)
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
