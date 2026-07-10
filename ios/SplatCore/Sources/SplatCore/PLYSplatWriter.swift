import Foundation
import simd

/// Writable binary PLY helpers for seed clouds and trained splats.
public enum PLYSplatWriter {
    public static func writeSeedCloud(_ points: [SeedPoint], to url: URL) throws {
        var header = """
        ply
        format binary_little_endian 1.0
        element vertex \(points.count)
        property float x
        property float y
        property float z
        property float nx
        property float ny
        property float nz
        property uchar red
        property uchar green
        property uchar blue
        end_header\n
        """
        var data = Data(header.utf8)
        data.reserveCapacity(header.utf8.count + points.count * 27)
        for p in points {
            var floats: [Float] = [p.position.x, p.position.y, p.position.z, p.normal.x, p.normal.y, p.normal.z]
            floats.withUnsafeBytes { data.append(contentsOf: $0) }
            let r = UInt8(clamping: Int(p.color.x * 255))
            let g = UInt8(clamping: Int(p.color.y * 255))
            let b = UInt8(clamping: Int(p.color.z * 255))
            data.append(contentsOf: [r, g, b])
        }
        try data.write(to: url, options: .atomic)
    }

    public static func writeGaussianCloud(_ cloud: SplatCloud, to url: URL) throws {
        let invC0: Float = 1 / GaussianSplat.shC0
        var header = """
        ply
        format binary_little_endian 1.0
        element vertex \(cloud.count)
        property float x
        property float y
        property float z
        property float f_dc_0
        property float f_dc_1
        property float f_dc_2
        property float opacity
        property float scale_0
        property float scale_1
        property float scale_2
        property float rot_0
        property float rot_1
        property float rot_2
        property float rot_3
        end_header\n
        """
        var data = Data(header.utf8)
        data.reserveCapacity(header.utf8.count + cloud.count * 14 * 4)

        for s in cloud.splats {
            let dc = (s.color - SIMD3(repeating: 0.5)) * invC0
            let opacity = logit(max(1e-4, min(1 - 1e-4, s.opacity)))
            let scale = SIMD3(log(max(s.scale.x, 1e-6)), log(max(s.scale.y, 1e-6)), log(max(s.scale.z, 1e-6)))
            let q = s.rotation.normalized.vector
            var floats: [Float] = [
                s.position.x, s.position.y, s.position.z,
                dc.x, dc.y, dc.z,
                opacity,
                scale.x, scale.y, scale.z,
                q.w, q.x, q.y, q.z, // rot_0 = w
            ]
            floats.withUnsafeBytes { data.append(contentsOf: $0) }
        }
        try data.write(to: url, options: .atomic)
    }

    public static func readSeedCloud(from url: URL) throws -> [SeedPoint] {
        let data = try Data(contentsOf: url, options: [.mappedIfSafe])
        guard data.starts(with: Data("ply".utf8)) else {
            throw PLYSplatLoaderError.invalidHeader
        }

        // Byte-wise header parse — same approach as PLYSplatLoader (never decode binary body as String).
        var offset = 0
        var lines: [String] = []
        var foundEnd = false
        while offset < data.count, offset < 64 * 1024 {
            guard let newline = data[offset...].firstIndex(of: UInt8(ascii: "\n")) else { break }
            var lineData = data[offset..<newline]
            if lineData.last == UInt8(ascii: "\r") { lineData = lineData.dropLast() }
            let line = String(decoding: lineData, as: UTF8.self)
            lines.append(line)
            offset = newline + 1
            if line.trimmingCharacters(in: .whitespaces) == "end_header" {
                foundEnd = true
                break
            }
        }
        guard foundEnd else { throw PLYSplatLoaderError.invalidHeader }
        let bodyOffset = offset

        var count = 0
        var hasNormals = false
        var hasRGB = false
        for line in lines {
            let l = line.trimmingCharacters(in: .whitespaces)
            if l.hasPrefix("element vertex ") {
                count = Int(l.split(separator: " ").last ?? "0") ?? 0
            }
            if l.contains("property float nx") { hasNormals = true }
            if l.contains("property uchar red") { hasRGB = true }
        }

        let floatCount = 3 + (hasNormals ? 3 : 0)
        let stride = floatCount * 4 + (hasRGB ? 3 : 0)
        guard data.count >= bodyOffset + count * stride else {
            throw PLYSplatLoaderError.truncatedData
        }

        var points: [SeedPoint] = []
        points.reserveCapacity(count)
        try data.withUnsafeBytes { raw in
            guard let baseAddress = raw.baseAddress else {
                throw PLYSplatLoaderError.truncatedData
            }
            let base = baseAddress.advanced(by: bodyOffset)
            for i in 0..<count {
                let ptr = base.advanced(by: i * stride)
                let f = ptr.assumingMemoryBound(to: Float.self)
                let position = SIMD3(f[0], f[1], f[2])
                let normal: SIMD3<Float>
                var colorOffset = 3
                if hasNormals {
                    normal = SIMD3(f[3], f[4], f[5])
                    colorOffset = 6
                } else {
                    normal = SIMD3(0, 1, 0)
                }
                var color = SIMD3<Float>(repeating: 0.7)
                if hasRGB {
                    let c = ptr.advanced(by: colorOffset * 4).assumingMemoryBound(to: UInt8.self)
                    color = SIMD3(Float(c[0]), Float(c[1]), Float(c[2])) / 255
                }
                points.append(SeedPoint(position: position, color: color, normal: normal))
            }
        }
        return points
    }

    private static func logit(_ x: Float) -> Float {
        log(x / (1 - x))
    }
}
