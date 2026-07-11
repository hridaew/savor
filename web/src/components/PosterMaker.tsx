import { Suspense, useEffect, useRef, useState } from 'react';
import type { Capture } from '../types';
import { SplatViewerLazy } from '../splat/SplatViewerLazy';

/** Fast (SH-stripped) scene file — cheap to load offscreen. */
function fastUrl(c: Capture): string | undefined {
  return c.fullSplatUrl ?? c.splatUrl;
}

/**
 * Background poster factory: one at a time, quietly loads a finished splat in
 * a hidden viewer, snapshots it, and posts the JPEG to the server. The WS
 * update then flips every client's card from video thumb to splat poster.
 */
export function PosterMaker({ captures }: { captures: Capture[] }) {
  const attempted = useRef(new Set<string>());
  const [job, setJob] = useState<Capture | null>(null);
  const captureRef = useRef<(() => string) | null>(null);

  useEffect(() => {
    if (job) return;
    const next = captures.find(
      (c) => c.status === 'ready' && !c.posterUrl && fastUrl(c) && !attempted.current.has(c.id),
    );
    if (next) setJob(next);
  }, [captures, job]);

  const finish = () => {
    if (job) attempted.current.add(job.id);
    captureRef.current = null;
    setJob(null);
  };

  const snap = async () => {
    if (!job) return;
    try {
      // The splat uploads/sorts asynchronously after onLoad, so a fixed delay
      // races it (and loses in throttled/background tabs). Poll: each capture
      // forces a render — which also drives the engine forward — and we keep
      // the first frame that actually has content in it.
      let img: HTMLImageElement | null = null;
      for (let tries = 0; tries < 40 && !img; tries++) {
        await new Promise((r) => setTimeout(r, 350));
        const dataUrl = captureRef.current?.();
        if (!dataUrl || dataUrl.length < 256) continue;
        const probe = new Image();
        await new Promise((res, rej) => {
          probe.onload = res;
          probe.onerror = rej;
          probe.src = dataUrl;
        });
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 48;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(probe, 0, 0, 64, 48);
        const px = ctx.getImageData(0, 0, 64, 48).data;
        let min = 255;
        let max = 0;
        for (let i = 0; i < px.length; i += 4) {
          const v = (px[i] + px[i + 1] + px[i + 2]) / 3;
          if (v < min) min = v;
          if (v > max) max = v;
        }
        if (max - min > 24) img = probe; // not a blank/background-only frame
      }
      if (!img) return finish();
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, 640, 480);
      const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
      if (blob) {
        await fetch(`/api/captures/${job.id}/poster`, {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg' },
          body: blob,
        });
      }
    } catch {
      /* posters are best-effort */
    }
    finish();
  };

  if (!job) return null;
  const isEnv = job.kind === 'environment' && !!job.envCamPos;
  const dir = job.envCamDir ?? [0, 0, -1];
  const envProps = isEnv
    ? {
        cameraPosition: job.envCamPos,
        cameraTarget: [
          job.envCamPos![0] + 0.6 * dir[0],
          job.envCamPos![1] + 0.6 * dir[1],
          job.envCamPos![2] + 0.6 * dir[2],
        ] as [number, number, number],
        lookAround: true,
      }
    : {};
  const dist =
    !isEnv && job.orbitRadius && job.orbitRadius > 1.2 ? Math.min(job.orbitRadius, 8) : undefined;
  return (
    <div
      style={{
        position: 'fixed',
        left: -10000,
        top: 0,
        width: 480,
        height: 360,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
      aria-hidden
    >
      <Suspense fallback={null}>
        <SplatViewerLazy
          url={fastUrl(job)!}
          autoRotate={false}
          sphericalHarmonicsDegree={0}
          cameraDistance={dist}
          cameraHeight={dist ? job.orbitHeight ?? 0 : undefined}
          {...envProps}
          captureRef={captureRef}
          onLoaded={snap}
          onError={finish}
        />
      </Suspense>
    </div>
  );
}
