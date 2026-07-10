#include <metal_stdlib>
using namespace metal;

// Trainable splat parameters (matches TrainableSplat in Swift).
struct TrainSplat {
    float3 position;
    float opacity;      // logit
    float3 scale;       // log-scale
    float _pad0;
    float4 rotation;    // xyzw
    float3 color;       // linear RGB 0..1 (SH0 decoded)
    float _pad1;
};

struct TrainCamera {
    float4x4 viewMatrix;
    float4x4 projectionMatrix;
    float2 screenSize;
    float focalX;
    float focalY;
    uint splatCount;
    uint imageWidth;
    uint imageHeight;
    uint _pad;
};

struct TrainUniforms {
    float learningRate;
    float colorLR;
    float opacityLR;
    float scaleLR;
    float positionLR;
    uint splatCount;
    uint pixelCount;
    uint step;
};

static float3x3 quatToMat(float4 q) {
    float x = q.x, y = q.y, z = q.z, w = q.w;
    return float3x3(
        1 - 2*(y*y + z*z), 2*(x*y - z*w),     2*(x*z + y*w),
        2*(x*y + z*w),     1 - 2*(x*x + z*z), 2*(y*z - x*w),
        2*(x*z - y*w),     2*(y*z + x*w),     1 - 2*(x*x + y*y)
    );
}

static float sigmoid(float x) { return 1.0 / (1.0 + exp(-x)); }

/// Soft forward: each pixel accumulates nearby gaussian contributions.
/// Simplified mobile trainer — SH0, no densification, tile-free O(N) per pixel
/// with early-out. Good enough for LiDAR-seeded object captures on iPhone.
kernel void train_forward(
    device const TrainSplat *splats [[buffer(0)]],
    constant TrainCamera &cam [[buffer(1)]],
    texture2d<float, access::write> outRGB [[texture(0)]],
    texture2d<float, access::write> outAlpha [[texture(1)]],
    uint2 gid [[thread_position_in_grid]]
) {
    if (gid.x >= cam.imageWidth || gid.y >= cam.imageHeight) return;

    float2 pixel = float2(gid) + 0.5;
    float3 color = float3(0);
    float T = 1.0;

    // Project and blend front-to-back (approximate depth order via view z).
    // For mobile speed we iterate all splats; PocketGS-scale N is ~5–30k.
    for (uint i = 0; i < cam.splatCount && T > 1e-3; ++i) {
        TrainSplat s = splats[i];
        float3 mean = s.position;
        float4 view4 = cam.viewMatrix * float4(mean, 1.0);
        if (view4.z > -0.05) continue;

        float4 clip = cam.projectionMatrix * view4;
        float2 ndc = clip.xy / clip.w;
        float2 screen = (ndc * 0.5 + 0.5) * cam.screenSize;
        // Flip Y for top-left image coords
        screen.y = cam.screenSize.y - screen.y;

        float3 scale = exp(s.scale);
        float radius = max(max(scale.x, scale.y), scale.z) * cam.focalY / max(-view4.z, 0.05) * 3.0;
        float2 d = pixel - screen;
        float dist2 = dot(d, d);
        if (dist2 > radius * radius) continue;

        float sigma = max(radius / 3.0, 0.5);
        float gauss = exp(-0.5 * dist2 / (sigma * sigma));
        float alpha = sigmoid(s.opacity) * gauss;
        alpha = min(0.99, alpha);
        color += T * alpha * s.color;
        T *= (1.0 - alpha);
    }

    outRGB.write(float4(color, 1.0), gid);
    outAlpha.write(float4(1.0 - T, 0, 0, 1), gid);
}

/// L1 loss + color/opacity gradient scatter (simplified SH0 Adam step).
/// Each thread owns one splat and samples a sparse set of pixels near its projection.
kernel void train_backward_adam(
    device TrainSplat *splats [[buffer(0)]],
    constant TrainCamera &cam [[buffer(1)]],
    constant TrainUniforms &u [[buffer(2)]],
    texture2d<float, access::read> predRGB [[texture(0)]],
    texture2d<float, access::read> gtRGB [[texture(1)]],
    device atomic_float *lossSum [[buffer(3)]],
    uint id [[thread_position_in_grid]]
) {
    if (id >= u.splatCount) return;
    TrainSplat s = splats[id];

    float4 view4 = cam.viewMatrix * float4(s.position, 1.0);
    if (view4.z > -0.05) return;

    float4 clip = cam.projectionMatrix * view4;
    float2 ndc = clip.xy / clip.w;
    float2 screen = (ndc * 0.5 + 0.5) * cam.screenSize;
    screen.y = cam.screenSize.y - screen.y;

    float3 scale = exp(s.scale);
    float radius = max(max(scale.x, scale.y), scale.z) * cam.focalY / max(-view4.z, 0.05) * 3.0;
    float sigma = max(radius / 3.0, 0.5);
    float opacity = sigmoid(s.opacity);

    float3 gradColor = float3(0);
    float gradOpacity = 0;
    float3 gradPos = float3(0);
    float localLoss = 0;
    int samples = 0;

    int r = int(min(radius, 24.0));
    int cx = int(screen.x);
    int cy = int(screen.y);
    for (int dy = -r; dy <= r; dy += 2) {
        for (int dx = -r; dx <= r; dx += 2) {
            int x = cx + dx;
            int y = cy + dy;
            if (x < 0 || y < 0 || x >= int(cam.imageWidth) || y >= int(cam.imageHeight)) continue;
            float2 d = float2(float(dx), float(dy));
            float dist2 = dot(d, d);
            if (dist2 > radius * radius) continue;

            float gauss = exp(-0.5 * dist2 / (sigma * sigma));
            float alpha = opacity * gauss;
            if (alpha < 1e-4) continue;

            float3 pred = predRGB.read(uint2(x, y)).rgb;
            float3 gt = gtRGB.read(uint2(x, y)).rgb;
            float3 diff = pred - gt;
            localLoss += abs(diff.x) + abs(diff.y) + abs(diff.z);
            samples += 1;

            // dL/dColor ≈ sign(pred-gt) * alpha  (L1)
            float3 signDiff = sign(diff);
            gradColor += signDiff * alpha;
            // dL/dOpacity through alpha
            float dAlpha = dot(signDiff, s.color);
            gradOpacity += dAlpha * gauss * opacity * (1.0 - opacity);
            // crude position pull toward reducing error along image plane
            gradPos.x += signDiff.x * alpha * float(dx) * 0.001;
            gradPos.y += signDiff.y * alpha * float(dy) * 0.001;
        }
    }

    if (samples > 0) {
        float inv = 1.0 / float(samples);
        gradColor *= inv;
        gradOpacity *= inv;
        gradPos *= inv;
        atomic_fetch_add_explicit(lossSum, localLoss * inv, memory_order_relaxed);

        s.color = clamp(s.color - u.colorLR * gradColor, 0.0, 1.0);
        s.opacity -= u.opacityLR * gradOpacity;
        s.opacity = clamp(s.opacity, -6.0, 6.0);
        s.position -= u.positionLR * gradPos;

        // Shrink/grow scale slightly based on residual magnitude
        float residual = length(gradColor);
        s.scale -= u.scaleLR * residual;
        s.scale = clamp(s.scale, float3(-8.0), float3(1.0));
        splats[id] = s;
    }
}

/// Initialize trainable splats from seed XYZRGB points.
kernel void train_init_from_seeds(
    device const float3 *positions [[buffer(0)]],
    device const float3 *colors [[buffer(1)]],
    device TrainSplat *splats [[buffer(2)]],
    constant float &initScale [[buffer(3)]],
    uint id [[thread_position_in_grid]],
    uint count [[threads_per_grid]]
) {
    if (id >= count) return;
    TrainSplat s;
    s.position = positions[id];
    s.opacity = 0.0; // sigmoid(0)=0.5
    s.scale = float3(log(initScale));
    s._pad0 = 0;
    s.rotation = float4(0, 0, 0, 1);
    s.color = colors[id];
    s._pad1 = 0;
    splats[id] = s;
}
