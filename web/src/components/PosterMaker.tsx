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
      // Let progressive refinement settle for a beat before the shot.
      await new Promise((r) => setTimeout(r, 800));
      const dataUrl = captureRef.current?.();
      if (!dataUrl) return finish();
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = dataUrl;
      });
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
  const dist = job.orbitRadius && job.orbitRadius > 1.2 ? Math.min(job.orbitRadius, 8) : undefined;
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
          captureRef={captureRef}
          onLoaded={snap}
          onError={finish}
        />
      </Suspense>
    </div>
  );
}
