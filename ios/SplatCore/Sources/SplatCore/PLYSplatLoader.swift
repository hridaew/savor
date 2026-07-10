import Foundation
import simd

public enum PLYSplatLoaderError: LocalizedError, Sendable {
    case invalidHeader
    case unsupportedFormat(String)
    case missingProperty(String)
    case truncatedData
    case emptyCloud

    public var errorDescription: String? {
        switch self {
        case .invalidHeader:
            "This file is not a valid PLY."
        case .unsupportedFormat(let detail):
            "Unsupported PLY format: \(detail)"
        case .missingProperty(let name):
            "Missing required PLY property: \(name)"
        case .truncatedData:
            "PLY data ended before all vertices were read."
        case .emptyCloud:
            "No gaussians found in this PLY."
        }
    }
}

/// Streams a binary little-endian 3DGS / Brush `.ply` into a `SplatCloud`.
///
/// Supports the SH0 layout Savor exports after cleanup:
/// `x y z f_dc_0 f_dc_1 f_dc_2 opacity scale_0..2 rot_0…3`
public enum PLYSplatLoader {
    public static func load(url: URL) throws -> SplatCloud {
        let data = try Data(contentsOf: url, options: [.mappedIfSafe])
        return try load(data: data)
    }

    public static func load(data: Data) throws -> SplatCloud {
        let (header, bodyOffset) = try parseHeader(data)
        guard header.format == .binaryLittleEndian else {
            throw PLYSplatLoaderError.unsupportedFormat(header.format.rawValue)
        }
        guard header.vertexCount > 0 else {
            throw PLYSplatLoaderError.emptyCloud
        }

        let stride = header.byteStride
        let needed = bodyOffset + header.vertexCount * stride
        guard data.count >= needed else {
            throw PLYSplatLoaderError.truncatedData
        }

        var splats: [GaussianSplat] = []
        splats.reserveCapacity(header.vertexCount)

        try data.withUnsafeBytes { raw in
            guard let baseAddress = raw.baseAddress else {
                throw PLYSplatLoaderError.truncatedData
            }
            let base = baseAddress.advanced(by: bodyOffset)
            for i in 0..<header.vertexCount {
                let ptr = base.advanced(by: i * stride)
                let splat = try decodeVertex(at: ptr, mapping: header.mapping)
                splats.append(splat)
            }
        }

        return SplatCloud(splats: splats)
    }

    // MARK: - Header

    private enum PLYFormat: String {
        case binaryLittleEndian = "binary_little_endian"
        case binaryBigEndian = "binary_big_endian"
        case ascii = "ascii"
    }

    private struct PropertyMapping {
        var x = -1, y = -1, z = -1
        var dc0 = -1, dc1 = -1, dc2 = -1
        var opacity = -1
        var scale0 = -1, scale1 = -1, scale2 = -1
        var rot0 = -1, rot1 = -1, rot2 = -1, rot3 = -1
        var red = -1, green = -1, blue = -1
        var propertyCount = 0
    }

    private struct Header {
        var format: PLYFormat
        var vertexCount: Int
        var mapping: PropertyMapping
        var byteStride: Int
    }

    /// Parse only the ASCII header bytes. Never decode the binary body as a String —
    /// binary splat data contains non-ASCII bytes and that used to make loading fail
    /// with "not a valid PLY" for every real Brush export.
    private static func parseHeader(_ data: Data) throws -> (Header, Int) {
        guard data.count >= 4, data.starts(with: Data("ply".utf8)) else {
            throw PLYSplatLoaderError.invalidHeader
        }

        var lines: [String] = []
        var offset = 0
        var foundEnd = false

        while offset < data.count, offset < 256 * 1024 {
            guard let newline = data[offset...].firstIndex(of: UInt8(ascii: "\n")) else {
                break
            }
            var lineData = data[offset..<newline]
            if lineData.last == UInt8(ascii: "\r") {
                lineData = lineData.dropLast()
            }
            let line = String(decoding: lineData, as: UTF8.self)
            lines.append(line)
            offset = newline + 1
            if line.trimmingCharacters(in: .whitespaces) == "end_header" {
                foundEnd = true
                break
            }
        }

        guard foundEnd else {
            throw PLYSplatLoaderError.invalidHeader
        }

        let bodyOffset = offset
        var format: PLYFormat?
        var vertexCount = 0
        var inVertex = false
        var mapping = PropertyMapping()
        var floatIndex = 0

        for rawLine in lines {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("format ") {
                let token = line.split(separator: " ").dropFirst().first.map(String.init) ?? ""
                format = PLYFormat(rawValue: token)
            } else if line.hasPrefix("element vertex ") {
                inVertex = true
                vertexCount = Int(line.split(separator: " ").last ?? "0") ?? 0
            } else if line.hasPrefix("element ") {
                inVertex = false
            } else if inVertex, line.hasPrefix("property float ") || line.hasPrefix("property float32 ") {
                let name = line.split(separator: " ").last.map(String.init) ?? ""
                assign(name, index: floatIndex, into: &mapping)
                floatIndex += 1
            }
        }

        mapping.propertyCount = floatIndex
        guard let format else {
            throw PLYSplatLoaderError.invalidHeader
        }
        guard mapping.x >= 0, mapping.y >= 0, mapping.z >= 0 else {
            throw PLYSplatLoaderError.missingProperty("x/y/z")
        }
        guard mapping.opacity >= 0 else {
            throw PLYSplatLoaderError.missingProperty("opacity")
        }
        guard mapping.scale0 >= 0, mapping.rot0 >= 0 else {
            throw PLYSplatLoaderError.missingProperty("scale/rotation")
        }

        let header = Header(
            format: format,
            vertexCount: vertexCount,
            mapping: mapping,
            byteStride: floatIndex * MemoryLayout<Float>.size
        )
        return (header, bodyOffset)
    }

    private static func assign(_ name: String, index: Int, into mapping: inout PropertyMapping) {
        switch name {
        case "x": mapping.x = index
        case "y": mapping.y = index
        case "z": mapping.z = index
        case "f_dc_0": mapping.dc0 = index
        case "f_dc_1": mapping.dc1 = index
        case "f_dc_2": mapping.dc2 = index
        case "opacity": mapping.opacity = index
        case "scale_0": mapping.scale0 = index
        case "scale_1": mapping.scale1 = index
        case "scale_2": mapping.scale2 = index
        case "rot_0": mapping.rot0 = index
        case "rot_1": mapping.rot1 = index
        case "rot_2": mapping.rot2 = index
        case "rot_3": mapping.rot3 = index
        case "red": mapping.red = index
        case "green": mapping.green = index
        case "blue": mapping.blue = index
        default: break
        }
    }

    private static func decodeVertex(at ptr: UnsafeRawPointer, mapping: PropertyMapping) throws -> GaussianSplat {
        let floats = ptr.assumingMemoryBound(to: Float.self)
        func f(_ i: Int) -> Float { floats[i] }

        let position = SIMD3(f(mapping.x), f(mapping.y), f(mapping.z))

        let color: SIMD3<Float>
        if mapping.dc0 >= 0 {
            color = GaussianSplat.colorFromSH0(SIMD3(f(mapping.dc0), f(mapping.dc1), f(mapping.dc2)))
        } else if mapping.red >= 0 {
            color = SIMD3(f(mapping.red), f(mapping.green), f(mapping.blue)) / 255
        } else {
            color = SIMD3(repeating: 0.7)
        }

        let opacity = GaussianSplat.sigmoid(f(mapping.opacity))
        let scale = SIMD3(
            exp(f(mapping.scale0)),
            exp(f(mapping.scale1)),
            exp(f(mapping.scale2))
        )
        // PLY stores (w, x, y, z) as rot_0…3
        let rotation = simd_quatf(
            ix: f(mapping.rot1),
            iy: f(mapping.rot2),
            iz: f(mapping.rot3),
            r: f(mapping.rot0)
        ).normalized

        return GaussianSplat(
            position: position,
            color: color,
            opacity: opacity,
            scale: scale,
            rotation: rotation
        )
    }
}
