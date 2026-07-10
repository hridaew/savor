import { Suspense, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { SplatViewerLazy } from '../splat/SplatViewerLazy';
import { Icon } from '../components/Icon';
import { ProgressRing } from '../components/Primitives';
import { play } from '../lib/sound';

export function ViewerScreen({
  name,
  url,
  orbitRadius,
  orbitHeight,
  kind,
  envCamPos,
  envCamDir,
  onBack,
  onDelete,
}: {
  name: string;
  url: string;
  /** Capture-camera orbit distance (normalized units) — camera hint. */
  orbitRadius?: number;
  /** Capture-camera orbit height (normalized y, negative = above). */
  orbitHeight?: number;
  /** Environment captures view from inside; objects orbit from outside. */
  kind?: 'object' | 'environment';
  envCamPos?: [number, number, number];
  envCamDir?: [number, number, number];
  onBack: () => void;
  onDelete?: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [hint, setHint] = useState(true);
  const [flash, setFlash] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const captureRef = useRef<(() => string) | null>(null);

  // Two-tap delete: first tap arms, auto-disarms after 3s.
  useEffect(() => {
    if (!confirmDel) return;
    const t = setTimeout(() => setConfirmDel(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDel]);

  const activeUrl = url;
  // Always favor visual quality.
  const shDegree = 2;
  const exportExt = (() => {
    const clean = activeUrl.split(/[?#]/, 1)[0] ?? activeUrl;
    const m = clean.match(/\.([a-z0-9]+)$/i);
    return (m?.[1] ?? 'ply').toLowerCase();
  })();

  // Environments are viewed from inside, at the capture position, looking
  // where the video looked. Objects orbit where the capture cameras were —
  // that's where the background was trained to be seen from. Zoom/elevation
  // clamps keep the camera near those bands (drifting into the background
  // shell turns it into smears).
  const isEnv = kind === 'environment' && !!envCamPos;
  const dir = envCamDir ?? [0, 0, -1];
  const sceneDist = orbitRadius && orbitRadius > 1.2 ? Math.min(orbitRadius, 8) : undefined;
  const camProps = isEnv
    ? {
        cameraPosition: envCamPos,
        cameraTarget: [
          envCamPos![0] + 0.6 * dir[0],
          envCamPos![1] + 0.6 * dir[1],
          envCamPos![2] + 0.6 * dir[2],
        ] as [number, number, number],
        lookAround: true,
      }
    : sceneDist
      ? {
          cameraDistance: sceneDist,
          cameraHeight: orbitHeight ?? 0,
          minDistance: 0.45 * sceneDist,
          maxDistance: 1.2 * sceneDist,
        }
      : {};

  useEffect(() => {
    setLoaded(false);
    setPct(0);
    setErr(null);
  }, [activeUrl]);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => setHint(false), 4500);
    return () => clearTimeout(t);
  }, [loaded]);

  const exportPly = () => {
    const a = document.createElement('a');
    a.href = activeUrl;
    a.download = `${name.replace(/[^\w\-]+/g, '_')}.${exportExt}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const snapshot = () => {
    const dataUrl = captureRef.current?.();
    if (!dataUrl) return;
    setFlash(true); // visual equivalent of the shutter sound
    play('shutter');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${name.replace(/[^\w\-]+/g, '_')}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="viewer">
      {!err && (
        <Suspense fallback={null}>
          <SplatViewerLazy
            url={activeUrl}
            autoRotate={autoRotate}
            resetKey={resetKey}
            sphericalHarmonicsDegree={shDegree}
            {...camProps}
            captureRef={captureRef}
            onProgress={(p) => setPct(p)}
            onLoaded={() => setLoaded(true)}
            onError={(m) => setErr(m)}
          />
        </Suspense>
      )}

      <AnimatePresence>
        {flash && (
          <motion.div
            style={{ position: 'absolute', inset: 0, zIndex: 8, background: '#fff', pointerEvents: 'none' }}
            initial={{ opacity: 0.85 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
            onAnimationComplete={() => setFlash(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!loaded && !err && (
          <motion.div
            className="viewer-loading"
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24, ease: 'easeIn' }}
          >
            <div style={{ textAlign: 'center' }}>
              <ProgressRing
                progress={pct / 100}
                size={92}
                stroke={7}
                color="var(--ink)"
                track="var(--fill-1)"
                indeterminate={pct < 1}
              >
                <Icon name="cube" size={28} style={{ color: 'var(--ink-2)' }} />
              </ProgressRing>
              <div className="t-foot dim tnum" style={{ marginTop: 16 }}>
                {pct > 1 ? `Loading splat… ${Math.round(pct)}%` : 'Loading splat…'}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {err && (
        <div className="viewer-loading">
          <div style={{ textAlign: 'center', padding: 30 }}>
            <Icon name="warning" size={38} style={{ color: 'var(--amber)' }} />
            <div className="t-headline" style={{ marginTop: 12 }}>
              Couldn’t render this splat
            </div>
            <div className="t-foot dim" style={{ marginTop: 6, maxWidth: 260 }}>
              {err}
            </div>
          </div>
        </div>
      )}

      <div className="viewer-top">
        <button className="glass-ctl" style={{ padding: 0, width: 42 }} onClick={onBack} aria-label="Back">
          <Icon name="back" size={18} weight={2.2} />
        </button>
        <div className="viewer-title">{name}</div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            className="glass-ctl"
            style={{ padding: 0, width: 42, ...(!loaded ? { opacity: 0.5 } : {}) }}
            onClick={snapshot}
            aria-label="Save photo"
            disabled={!loaded}
          >
            <Icon name="camera" size={17} />
          </button>
          <button
            className="glass-ctl"
            style={{ padding: 0, width: 42 }}
            onClick={exportPly}
            aria-label="Export splat file"
          >
            <Icon name="share" size={17} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {hint && loaded && (
          <motion.div
            className="hint-tag"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6, transition: { duration: 0.16, ease: 'easeIn' } }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <Icon name="hand" size={15} />
            Drag to orbit · scroll to zoom
          </motion.div>
        )}
      </AnimatePresence>

      <div className="viewer-bottom">
        <button className={`glass-ctl ${autoRotate ? 'on' : ''}`} onClick={() => setAutoRotate((v) => !v)}>
          <Icon name="rotate" size={17} />
          {autoRotate ? 'Auto-rotate' : 'Rotate'}
        </button>
        <button className="glass-ctl" onClick={() => setResetKey((k) => k + 1)}>
          <Icon name="viewfinder" size={17} />
          Recenter
        </button>
        {onDelete && (
          <motion.button
            layout
            className="glass-ctl"
            style={{ color: 'var(--red)' }}
            transition={{ layout: { type: 'spring', stiffness: 500, damping: 38 } }}
            onClick={() => (confirmDel ? onDelete() : setConfirmDel(true))}
            aria-label={confirmDel ? 'Confirm delete' : 'Delete'}
          >
            <Icon name="trash" size={16} />
            {confirmDel ? 'Delete?' : null}
          </motion.button>
        )}
      </div>
    </div>
  );
}
