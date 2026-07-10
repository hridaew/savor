import { Suspense, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Capture, Stage } from '../types';
import { Icon, type IconName } from '../components/Icon';
import { ProgressRing } from '../components/Primitives';
import { SplatViewerLazy } from '../splat/SplatViewerLazy';
import { PIPELINE_STAGES, stageColor, elapsed, formatCount } from '../util';

const STAGE_ICON: Record<string, IconName> = {
  extracting: 'film',
  sfm: 'viewfinder',
  training: 'sparkles',
};

function PushHeader({ title, onBack, action }: { title: string; onBack: () => void; action?: React.ReactNode }) {
  return (
    <div className="push-head">
      <button className="push-back" onClick={onBack}>
        <Icon name="back" size={18} weight={2.1} />
        <span>Library</span>
      </button>
      <div
        className="t-headline"
        style={{ flex: 1, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {title}
      </div>
      <div style={{ minWidth: 72, display: 'flex', justifyContent: 'flex-end' }}>{action}</div>
    </div>
  );
}

function Timeline({ cap }: { cap: Capture }) {
  const order: Stage[] = ['extracting', 'sfm', 'training'];
  const ready = cap.status === 'ready';
  const failed = cap.status === 'failed';
  const curIdx = ready ? 3 : order.indexOf(cap.stage);

  return (
    <div className="timeline">
      {PIPELINE_STAGES.map((s, i) => {
        const done = ready || i < curIdx;
        const active = !ready && !failed && i === curIdx;
        const lineFill = done ? 1 : active ? cap.stageProgress : 0;
        return (
          <div key={s.key} style={{ display: 'contents' }}>
            <div className="tl-step">
              <motion.div
                className={`tl-node ${done ? 'done' : ''} ${active ? 'active' : ''}`}
                style={active ? { background: s.color, color: '#fff' } : undefined}
                // Ambient status pulse, kept inside the 0.95–1.05 band.
                animate={active ? { scale: [1, 1.04, 1] } : { scale: 1 }}
                transition={active ? { repeat: Infinity, duration: 1.6, ease: 'easeInOut' } : { duration: 0.2 }}
              >
                {done ? <Icon name="check" size={18} weight={2.4} /> : <Icon name={STAGE_ICON[s.key]} size={18} />}
              </motion.div>
              <div className="tl-label" style={{ color: done || active ? 'var(--ink)' : 'var(--ink-3)' }}>
                {s.short}
              </div>
            </div>
            {i < PIPELINE_STAGES.length - 1 && (
              <div className="tl-line">
                <i style={{ transform: `scaleX(${lineFill})` }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatGrid({ cap }: { cap: Capture }) {
  const cells = [
    { label: 'Frames', value: cap.frameCount ?? '—' },
    { label: 'Cameras solved', value: cap.imagesRegistered ?? '—' },
    { label: 'Sparse points', value: cap.sparsePoints != null ? formatCount(cap.sparsePoints) : '—' },
    {
      label: 'Train steps',
      value: cap.totalSteps ? `${formatCount(cap.steps ?? 0)} / ${formatCount(cap.totalSteps)}` : '—',
    },
  ];
  return (
    <div className="stat-grid">
      {cells.map((c) => (
        <div className="stat-cell" key={c.label}>
          <div className="t-title3 tnum">{c.value}</div>
          <div className="t-cap dim" style={{ marginTop: 2 }}>
            {c.label}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProcessingScreen({
  cap,
  onBack,
  onView,
  onDelete,
  onRetry,
}: {
  cap: Capture;
  onBack: () => void;
  onView: () => void;
  onDelete: () => void;
  onRetry: () => void;
}) {
  const [, tick] = useState(0);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => {
    if (cap.status === 'ready' || cap.status === 'failed') return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [cap.status]);

  // Two-tap delete: first tap arms it, auto-disarms after 3s.
  useEffect(() => {
    if (!confirmDel) return;
    const t = setTimeout(() => setConfirmDel(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDel]);

  const ready = cap.status === 'ready';
  const failed = cap.status === 'failed';
  const color = stageColor(cap.stage);

  return (
    <div className="overlay-page">
      <PushHeader
        title={cap.name}
        onBack={onBack}
        action={
          <motion.button
            layout
            className="push-back"
            style={{
              color: 'var(--red)',
              fontWeight: confirmDel ? 650 : 500,
              background: confirmDel ? 'var(--red-soft)' : 'transparent',
              borderRadius: 999,
              padding: confirmDel ? '0 14px' : '0 8px',
            }}
            transition={{ layout: { type: 'spring', stiffness: 500, damping: 38 } }}
            onClick={() => (confirmDel ? onDelete() : setConfirmDel(true))}
            aria-label={confirmDel ? 'Confirm delete' : 'Delete'}
          >
            {confirmDel ? 'Delete?' : <Icon name="trash" size={18} />}
          </motion.button>
        }
      />

      <div className="proc-wrap">
        <div style={{ marginTop: 'var(--space-5)' }}>
          <ProgressRing
            progress={ready ? 1 : cap.progress}
            size={172}
            stroke={12}
            color={ready ? 'var(--green)' : failed ? 'var(--red)' : color}
            track="var(--fill-1)"
            indeterminate={!ready && !failed && cap.progress < 0.01}
          >
            <div style={{ textAlign: 'center' }}>
              {ready ? (
                // The completion moment gets the single prominent animation.
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                >
                  <Icon name="check" size={56} weight={2.4} style={{ color: 'var(--green)' }} />
                </motion.div>
              ) : failed ? (
                <Icon name="warning" size={44} style={{ color: 'var(--red)' }} />
              ) : (
                <>
                  <div className="tnum" style={{ fontSize: 42, fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em' }}>
                    {Math.round(cap.progress * 100)}
                    <span style={{ fontSize: 19, opacity: 0.5 }}>%</span>
                  </div>
                  <div className="t-cap dim tnum" style={{ marginTop: 4 }}>
                    {elapsed(cap.startedAt, cap.finishedAt)}
                  </div>
                </>
              )}
            </div>
          </ProgressRing>
        </div>

        <div style={{ height: 26, marginTop: 'var(--space-4)', textAlign: 'center' }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={ready ? 'ready' : failed ? 'failed' : cap.message}
              className="t-headline"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              // Halved: mode="wait" plays exit then enter sequentially.
              transition={{ duration: 0.13, ease: 'easeOut' }}
            >
              {ready ? 'Your capture is ready' : failed ? 'Something went wrong' : cap.message}
            </motion.div>
          </AnimatePresence>
        </div>

        {!failed && <Timeline cap={cap} />}

        {!ready && !failed && cap.previewUrl && (
          <motion.div
            className="preview-card"
            style={{ marginTop: 'var(--space-5)' }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.26, ease: [0.215, 0.61, 0.355, 1] }}
          >
            <Suspense fallback={null}>
              <SplatViewerLazy key={cap.previewUrl} url={cap.previewUrl} autoRotate />
            </Suspense>
            <div className="preview-tag tnum">
              <span className="dot" style={{ background: 'var(--amber)' }} />
              Live preview · step {formatCount(cap.steps ?? 0)}
            </div>
          </motion.div>
        )}

        {ready && (
          <motion.button
            className="btn btn-primary full"
            onClick={onView}
            style={{ marginTop: 'var(--space-5)' }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.215, 0.61, 0.355, 1], delay: 0.12 }}
          >
            <Icon name="orbit" size={18} />
            View in 3D
          </motion.button>
        )}

        {failed && (
          <div style={{ width: '100%', marginTop: 'var(--space-5)' }}>
            <div className="card" style={{ padding: 'var(--space-4)' }}>
              <div className="t-subhead" style={{ lineHeight: 1.5 }}>
                {cap.error || 'The pipeline failed.'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onRetry}>
                <Icon name="reset" size={16} />
                Retry
              </button>
              <button className="btn btn-danger-soft" style={{ flex: 1 }} onClick={onDelete}>
                <Icon name="trash" size={16} />
                Delete
              </button>
            </div>
          </div>
        )}

        {!failed && (
          <div style={{ width: '100%', marginTop: 'var(--space-5)' }}>
            <StatGrid cap={cap} />
          </div>
        )}

        {!ready && !failed && (
          <p className="t-foot dim" style={{ textAlign: 'center', marginTop: 'var(--space-5)', lineHeight: 1.45, maxWidth: 320 }}>
            You can leave this screen — it keeps processing and will be waiting in your library.
          </p>
        )}
      </div>
    </div>
  );
}
