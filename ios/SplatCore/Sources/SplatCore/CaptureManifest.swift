import Foundation
import simd

/// One keyframe captured during an ARKit orbit.
public struct CaptureFrame: Codable, Sendable, Identifiable {
    public var id: Int
    public var imageFile: String
    public var timestamp: TimeInterval
    /// Camera-to-world 4×4, column-major, matching ARKit `transform`.
    public var transform: [Float]
    public var intrinsics: [Float] // 3×3 column-major
    public var imageWidth: Int
    public var imageHeight: Int

    public init(
        id: Int,
        imageFile: String,
        timestamp: TimeInterval,
        transform: simd_float4x4,
        intrinsics: simd_float3x3,
        imageWidth: Int,
        imageHeight: Int
    ) {
        self.id = id
        self.imageFile = imageFile
        self.timestamp = timestamp
        self.transform = Self.pack4x4(transform)
        self.intrinsics = Self.pack3x3(intrinsics)
        self.imageWidth = imageWidth
        self.imageHeight = imageHeight
    }

    public var transformMatrix: simd_float4x4 { Self.unpack4x4(transform) }
    public var intrinsicsMatrix: simd_float3x3 { Self.unpack3x3(intrinsics) }

    public static func pack4x4(_ m: simd_float4x4) -> [Float] {
        [
            m.columns.0.x, m.columns.0.y, m.columns.0.z, m.columns.0.w,
            m.columns.1.x, m.columns.1.y, m.columns.1.z, m.columns.1.w,
            m.columns.2.x, m.columns.2.y, m.columns.2.z, m.columns.2.w,
            m.columns.3.x, m.columns.3.y, m.columns.3.z, m.columns.3.w,
        ]
    }

    public static func unpack4x4(_ v: [Float]) -> simd_float4x4 {
        guard v.count == 16 else { return matrix_identity_float4x4 }
        return simd_float4x4(columns: (
            SIMD4(v[0], v[1], v[2], v[3]),
            SIMD4(v[4], v[5], v[6], v[7]),
            SIMD4(v[8], v[9], v[10], v[11]),
            SIMD4(v[12], v[13], v[14], v[15])
        ))
    }

    public static func pack3x3(_ m: simd_float3x3) -> [Float] {
        [
            m.columns.0.x, m.columns.0.y, m.columns.0.z,
            m.columns.1.x, m.columns.1.y, m.columns.1.z,
            m.columns.2.x, m.columns.2.y, m.columns.2.z,
        ]
    }

    public static func unpack3x3(_ v: [Float]) -> simd_float3x3 {
        guard v.count == 9 else { return matrix_identity_float3x3 }
        return simd_float3x3(columns: (
            SIMD3(v[0], v[1], v[2]),
            SIMD3(v[3], v[4], v[5]),
            SIMD3(v[6], v[7], v[8])
        ))
    }
}

/// On-disk capture session written by ARKit (replaces COLMAP output).
public struct CaptureManifest: Codable, Sendable {
    public var id: String
    public var name: String
    public var createdAt: Date
    public var frames: [CaptureFrame]
    public var pointCloudFile: String?
    public var pointCount: Int
    public var hasSceneDepth: Bool
    public var deviceModel: String

    public init(
        id: String,
        name: String,
        frames: [CaptureFrame] = [],
        pointCloudFile: String? = nil,
        pointCount: Int = 0,
        hasSceneDepth: Bool = false,
        deviceModel: String = "iPhone"
    ) {
        self.id = id
        self.name = name
        self.createdAt = .now
        self.frames = frames
        self.pointCloudFile = pointCloudFile
        self.pointCount = pointCount
        self.hasSceneDepth = hasSceneDepth
        self.deviceModel = deviceModel
    }

    public func save(to directory: URL) throws {
        let url = directory.appendingPathComponent("manifest.json")
        let data = try JSONEncoder().encode(self)
        try data.write(to: url, options: .atomic)
    }

    public static func load(from directory: URL) throws -> CaptureManifest {
        let url = directory.appendingPathComponent("manifest.json")
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode(CaptureManifest.self, from: data)
    }
}

/// Sparse/dense point used to seed gaussians (from LiDAR scene depth).
public struct SeedPoint: Sendable {
    public var position: SIMD3<Float>
    public var color: SIMD3<Float>
    public var normal: SIMD3<Float>

    public init(position: SIMD3<Float>, color: SIMD3<Float>, normal: SIMD3<Float> = SIMD3(0, 1, 0)) {
        self.position = position
        self.color = color
        self.normal = normal
    }
}
