import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { SplatViewer } from '../splat/SplatViewer';
import { Icon } from '../components/Icon';
import { ProgressRing } from '../components/Primitives';

export function ViewerScreen({
  name,
  url,
  sceneUrl,
  onBack,
}: {
  name: string;
  url: string;
  sceneUrl?: string;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<'subject' | 'scene'>('subject');
  const [loaded, setLoaded] = useState(false);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [hint, setHint] = useState(true);

  const activeUrl = mode === 'scene' && sceneUrl ? sceneUrl : url;

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
    a.download = `${name.replace(/[^\w\-]+/g, '_')}${mode === 'scene' ? '_scene' : ''}.ply`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="viewer">
      {!err && (
        <SplatViewer
          url={activeUrl}
          autoRotate={autoRotate}
          resetKey={resetKey}
          onProgress={(p) => setPct(p)}
          onLoaded={() => setLoaded(true)}
          onError={(m) => setErr(m)}
        />
      )}

      <AnimatePresence>
        {!loaded && !err && (
          <motion.div className="viewer-loading" exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
            <div style={{ textAlign: 'center' }}>
              <ProgressRing progress={pct / 100} size={92} stroke={7} color="var(--blue)" track="rgba(60,60,67,0.12)" indeterminate={pct < 1}>
                <Icon name="cube" size={28} style={{ color: 'var(--label-2)' }} />
              </ProgressRing>
              <div className="t-foot dim" style={{ marginTop: 16 }}>
                {pct > 1 ? `Loading splat… ${Math.round(pct)}%` : 'Loading splat…'}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {err && (
        <div className="viewer-loading">
          <div style={{ textAlign: 'center', padding: 30 }}>
            <Icon name="warning" size={40} style={{ color: 'var(--orange)' }} />
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
        <motion.button className="glass-ctl" onClick={onBack} whileTap={{ scale: 0.92 }} aria-label="Back">
          <Icon name="back" size={20} weight={2.2} />
        </motion.button>
        <div className="viewer-title">{name}</div>
        <motion.button className="glass-ctl" onClick={exportPly} whileTap={{ scale: 0.92 }} aria-label="Export">
          <Icon name="share" size={18} />
        </motion.button>
      </div>

      {sceneUrl && (
        <div className="viewer-seg">
          <button className={mode === 'subject' ? 'on' : ''} onClick={() => setMode('subject')}>
            Subject
          </button>
          <button className={mode === 'scene' ? 'on' : ''} onClick={() => setMode('scene')}>
            Scene
          </button>
        </div>
      )}

      <AnimatePresence>
        {hint && loaded && (
          <motion.div
            className="hint-tag"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <Icon name="hand" size={15} />
            Drag to orbit · scroll to zoom
          </motion.div>
        )}
      </AnimatePresence>

      <div className="viewer-bottom">
        <motion.button
          className={`glass-ctl ${autoRotate ? 'on' : ''}`}
          onClick={() => setAutoRotate((v) => !v)}
          whileTap={{ scale: 0.95 }}
        >
          <Icon name="rotate" size={18} />
          {autoRotate ? 'Auto-rotate' : 'Rotate'}
        </motion.button>
        <motion.button className="glass-ctl" onClick={() => setResetKey((k) => k + 1)} whileTap={{ scale: 0.95 }}>
          <Icon name="viewfinder" size={18} />
          Recenter
        </motion.button>
      </div>
    </div>
  );
}
