#include <metal_stdlib>
using namespace metal;

// Must match `PackedSplat` in GaussianSplat.swift (4 × float4 = 64 bytes).
struct SplatGPU {
    float4 positionOpacity; // xyz + opacity
    float4 scalePad;        // xyz + pad
    float4 rotation;        // xyzw
    float4 colorPad;        // rgb + pad
};

struct Uniforms {
    float4x4 viewMatrix;
    float4x4 projectionMatrix;
    float2 screenSize;
    float focalX;
    float focalY;
    uint splatCount;
    uint _padA;
    uint _padB;
    uint _padC;
};

struct VertexOut {
    float4 position [[position]];
    float2 local;
    float4 color;
};

static float3x3 quatToMatrix(float4 q) {
    float x = q.x, y = q.y, z = q.z, w = q.w;
    float n2 = x*x + y*y + z*z + w*w;
    if (n2 < 1e-8) {
        return float3x3(float3(1,0,0), float3(0,1,0), float3(0,0,1));
    }
    float inv = rsqrt(n2);
    x *= inv; y *= inv; z *= inv; w *= inv;
    return float3x3(
        1 - 2*(y*y + z*z), 2*(x*y - z*w),     2*(x*z + y*w),
        2*(x*y + z*w),     1 - 2*(x*x + z*z), 2*(y*z - x*w),
        2*(x*z - y*w),     2*(y*z + x*w),     1 - 2*(x*x + y*y)
    );
}

static constant float2 kCorners[4] = {
    float2(-1, -1),
    float2( 1, -1),
    float2(-1,  1),
    float2( 1,  1)
};

vertex VertexOut splat_vertex(
    uint vertexID [[vertex_id]],
    uint instanceID [[instance_id]],
    constant SplatGPU *splats [[buffer(0)]],
    constant uint *order [[buffer(1)]],
    constant Uniforms &uniforms [[buffer(2)]]
) {
    VertexOut out;
    out.position = float4(1, 1, 0, 1);
    out.local = float2(0);
    out.color = float4(0);

    if (instanceID >= uniforms.splatCount) {
        return out;
    }

    uint splatIndex = order[instanceID];
    SplatGPU s = splats[splatIndex];

    float3 position = s.positionOpacity.xyz;
    float opacity = clamp(s.positionOpacity.w, 0.0, 1.0);
    float3 scale = max(s.scalePad.xyz, float3(1e-6));
    float3 color = clamp(s.colorPad.xyz, 0.0, 1.0);

    if (!all(isfinite(position)) || !all(isfinite(scale)) || !isfinite(opacity)) {
        return out;
    }

    float3x3 R = quatToMatrix(s.rotation);
    float3x3 S = float3x3(
        float3(scale.x, 0, 0),
        float3(0, scale.y, 0),
        float3(0, 0, scale.z)
    );
    float3x3 M = R * S;
    float3x3 cov3D = M * transpose(M);

    float4 viewPos4 = uniforms.viewMatrix * float4(position, 1.0);
    float3 viewPos = viewPos4.xyz;
    if (viewPos.z > -0.05 || !isfinite(viewPos.z)) {
        return out;
    }

    float3 t = viewPos;
    float invZ = 1.0 / t.z;
    float invZ2 = invZ * invZ;

    float3x3 J = float3x3(
        float3(uniforms.focalX * invZ, 0, 0),
        float3(0, uniforms.focalY * invZ, 0),
        float3(-uniforms.focalX * t.x * invZ2, -uniforms.focalY * t.y * invZ2, 0)
    );

    float3x3 W = float3x3(
        uniforms.viewMatrix[0].xyz,
        uniforms.viewMatrix[1].xyz,
        uniforms.viewMatrix[2].xyz
    );
    float3x3 T = J * W;
    float3x3 cov2D = T * cov3D * transpose(T);

    cov2D[0][0] += 0.3;
    cov2D[1][1] += 0.3;

    float a = cov2D[0][0];
    float b = cov2D[0][1];
    float c = cov2D[1][1];
    float det = max(a * c - b * b, 1e-8);
    float mid = 0.5 * (a + c);
    float lambda1 = mid + sqrt(max(0.0, mid * mid - det));
    float lambda2 = mid - sqrt(max(0.0, mid * mid - det));
    float2 axis1 = normalize(abs(b) < 1e-8
        ? (a > c ? float2(1, 0) : float2(0, 1))
        : float2(b, lambda1 - a));
    float2 axis2 = float2(-axis1.y, axis1.x);
    // Cap screen extent so corrupt scales can't cover the whole framebuffer.
    float2 extent = 3.0 * sqrt(max(float2(lambda1, lambda2), float2(0.1)));
    float maxExtent = min(uniforms.screenSize.x, uniforms.screenSize.y) * 0.35;
    extent = min(extent, float2(maxExtent));

    float4 clip = uniforms.projectionMatrix * viewPos4;
    if (abs(clip.w) < 1e-6 || !isfinite(clip.w)) {
        return out;
    }
    float2 center = clip.xy / clip.w;
    float2 pixel = kCorners[vertexID % 4] * extent;
    float2 offset = (axis1 * pixel.x + axis2 * pixel.y) * (2.0 / uniforms.screenSize);

    out.position = float4(center + offset, clip.z / clip.w, 1.0) * clip.w;
    out.local = kCorners[vertexID % 4] * 3.0;
    // Unpremultiplied RGB + opacity — fragment applies Gaussian falloff to both.
    out.color = float4(color, opacity);
    return out;
}

fragment float4 splat_fragment(VertexOut in [[stage_in]]) {
    float A = dot(in.local, in.local);
    float gauss = exp(-0.5 * A);
    float alpha = gauss * in.color.a;
    if (alpha < 1.0 / 255.0) {
        discard_fragment();
    }
    // Premultiplied output for One / OneMinusSourceAlpha blending.
    return float4(in.color.rgb * alpha, alpha);
}
