import Foundation
import simd

/// A single 3D Gaussian as stored after decoding a Brush / 3DGS `.ply`.
public struct GaussianSplat: Sendable, Equatable {
    public var position: SIMD3<Float>
    /// Linear RGB in 0…1 (decoded from SH0 / DC).
    public var color: SIMD3<Float>
    /// Linear opacity in 0…1 (sigmoid of logit).
    public var opacity: Float
    /// Linear scale (exp of log-scale).
    public var scale: SIMD3<Float>
    /// Unit quaternion matching PLY `rot_0…3` (w, x, y, z).
    public var rotation: simd_quatf

    public init(
        position: SIMD3<Float>,
        color: SIMD3<Float>,
        opacity: Float,
        scale: SIMD3<Float>,
        rotation: simd_quatf
    ) {
        self.position = position
        self.color = color
        self.opacity = opacity
        self.scale = scale
        self.rotation = rotation
    }

    public static let shC0: Float = 0.28209479177387814

    public static func colorFromSH0(_ dc: SIMD3<Float>) -> SIMD3<Float> {
        simd_clamp(0.5 + shC0 * dc, .zero, .one)
    }

    public static func sigmoid(_ x: Float) -> Float {
        1 / (1 + exp(-x))
    }
}

/// GPU-friendly packed splat — layout must match `SplatGPU` in `SplatShaders.metal`.
/// Uses float4 slots so Metal's float3 alignment does not diverge from Swift.
public struct PackedSplat: Sendable {
    public var positionOpacity: SIMD4<Float> // xyz + opacity
    public var scalePad: SIMD4<Float>        // xyz + pad
    public var rotation: SIMD4<Float>        // xyzw quaternion
    public var colorPad: SIMD4<Float>        // rgb + pad

    public init(_ splat: GaussianSplat) {
        positionOpacity = SIMD4(splat.position, splat.opacity)
        scalePad = SIMD4(splat.scale, 0)
        let q = splat.rotation.vector
        rotation = SIMD4(q.x, q.y, q.z, q.w)
        colorPad = SIMD4(splat.color, 0)
    }

    public var position: SIMD3<Float> {
        SIMD3(positionOpacity.x, positionOpacity.y, positionOpacity.z)
    }
}

/// In-memory splat cloud ready for Metal / RealityKit upload.
public struct SplatCloud: Sendable {
    public var splats: [GaussianSplat]
    public var boundsMin: SIMD3<Float>
    public var boundsMax: SIMD3<Float>

    public init(splats: [GaussianSplat]) {
        self.splats = splats
        if splats.isEmpty {
            boundsMin = .zero
            boundsMax = .zero
        } else {
            var mn = SIMD3<Float>(repeating: .greatestFiniteMagnitude)
            var mx = SIMD3<Float>(repeating: -.greatestFiniteMagnitude)
            for s in splats {
                mn = min(mn, s.position)
                mx = max(mx, s.position)
            }
            boundsMin = mn
            boundsMax = mx
        }
    }

    public var count: Int { splats.count }
    public var center: SIMD3<Float> { (boundsMin + boundsMax) * 0.5 }
    public var radius: Float {
        let extent = boundsMax - boundsMin
        return max(extent.x, max(extent.y, extent.z)) * 0.5
    }

    public func packed() -> [PackedSplat] {
        splats.map(PackedSplat.init)
    }
}
