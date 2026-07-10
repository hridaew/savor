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

    public var isFinite: Bool {
        position.x.isFinite && position.y.isFinite && position.z.isFinite
            && color.x.isFinite && color.y.isFinite && color.z.isFinite
            && opacity.isFinite
            && scale.x.isFinite && scale.y.isFinite && scale.z.isFinite
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

    /// Drop NaNs / spikes, recenter on the median, and normalize to ~unit radius
    /// (same framing contract as desktop `splatClean`).
    public func cleanedAndNormalized(framePercentile: Float = 0.92) -> SplatCloud {
        let finite = splats.filter { splat in
            guard splat.isFinite else { return false }
            let maxScale = max(splat.scale.x, max(splat.scale.y, splat.scale.z))
            return maxScale.isFinite && maxScale > 1e-6 && maxScale < 5 && splat.opacity > 0.01
        }
        guard !finite.isEmpty else { return SplatCloud(splats: []) }

        let xs = finite.map(\.position.x).sorted()
        let ys = finite.map(\.position.y).sorted()
        let zs = finite.map(\.position.z).sorted()
        let c = SIMD3(median(xs), median(ys), median(zs))

        var distances = finite.map { length($0.position - c) }.sorted()
        // Drop extreme outliers before measuring radius.
        let keepCount = max(1, Int(Float(distances.count) * 0.98))
        distances = Array(distances.prefix(keepCount))
        let radius = max(percentile(distances, framePercentile), 1e-3)
        let norm = 1 / radius
        let logNorm = log(norm)

        // Also drop floaters far from the subject core.
        let maxDist = radius * 4
        var cleaned: [GaussianSplat] = []
        cleaned.reserveCapacity(finite.count)
        for s in finite {
            let d = length(s.position - c)
            guard d <= maxDist else { continue }
            var next = s
            next.position = (s.position - c) * norm
            next.scale = SIMD3(
                exp(log(max(s.scale.x, 1e-6)) + logNorm),
                exp(log(max(s.scale.y, 1e-6)) + logNorm),
                exp(log(max(s.scale.z, 1e-6)) + logNorm)
            )
            next.color = simd_clamp(s.color, .zero, .one)
            next.opacity = min(max(s.opacity, 0), 1)
            next.rotation = s.rotation.normalized
            cleaned.append(next)
        }
        return SplatCloud(splats: cleaned)
    }
}

private func median(_ sorted: [Float]) -> Float {
    guard !sorted.isEmpty else { return 0 }
    let m = sorted.count / 2
    if sorted.count % 2 == 0 {
        return (sorted[m - 1] + sorted[m]) * 0.5
    }
    return sorted[m]
}

private func percentile(_ sorted: [Float], _ p: Float) -> Float {
    guard !sorted.isEmpty else { return 0 }
    let idx = min(sorted.count - 1, max(0, Int(Float(sorted.count - 1) * p)))
    return sorted[idx]
}
