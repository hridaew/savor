import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Capture, Stage } from '../types';
import { Icon, type IconName } from '../components/Icon';
import { ProgressRing } from '../components/Primitives';
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
        <Icon name="back" size={22} weight={2.1} />
        <span>Library</span>
      </button>
      <div
        className="t-headline"
        style={{ flex: 1, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {title}
      </div>
      <div style={{ minWidth: 64, display: 'flex', justifyContent: 'flex-end' }}>{action}</div>
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
                animate={active ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                transition={active ? { repeat: Infinity, duration: 1.6 } : {}}
              >
                {done ? <Icon name="check" size={20} weight={2.4} /> : <Icon name={STAGE_ICON[s.key]} size={19} />}
              </motion.div>
              <div className="tl-label" style={{ color: done || active ? 'var(--label)' : 'var(--label-3)' }}>
                {s.short}
              </div>
            </div>
            {i < PIPELINE_STAGES.length - 1 && (
              <div className="tl-line">
                <motion.i animate={{ scaleX: lineFill }} transition={{ ease: 'easeOut', duration: 0.5 }} style={{ scaleX: lineFill }} />
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
          <div className="t-title3 tnum" style={{ fontFamily: 'var(--font-rounded)' }}>
            {c.value}
          </div>
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
  useEffect(() => {
    if (cap.status === 'ready' || cap.status === 'failed') return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [cap.status]);

  const ready = cap.status === 'ready';
  const failed = cap.status === 'failed';
  const color = stageColor(cap.stage);

  return (
    <div className="overlay-page">
      <PushHeader
        title={cap.name}
        onBack={onBack}
        action={
          <button className="push-back" style={{ color: 'var(--red)' }} onClick={onDelete} aria-label="Delete">
            <Icon name="trash" size={20} />
          </button>
        }
      />

      <div className="proc-wrap">
        <div style={{ marginTop: 22 }}>
          <ProgressRing
            progress={ready ? 1 : cap.progress}
            size={172}
            stroke={12}
            color={ready ? 'var(--green)' : failed ? 'var(--red)' : color}
            track="rgba(60,60,67,0.1)"
            indeterminate={!ready && !failed && cap.progress < 0.01}
          >
            <div style={{ textAlign: 'center' }}>
              {ready ? (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }}>
                  <Icon name="check" size={56} weight={2.4} style={{ color: 'var(--green)' }} />
                </motion.div>
              ) : failed ? (
                <Icon name="warning" size={46} style={{ color: 'var(--red)' }} />
              ) : (
                <>
                  <div
                    className="tnum"
                    style={{ fontFamily: 'var(--font-rounded)', fontSize: 44, fontWeight: 700, lineHeight: 1 }}
                  >
                    {Math.round(cap.progress * 100)}
                    <span style={{ fontSize: 20, opacity: 0.5 }}>%</span>
                  </div>
                  <div className="t-cap dim" style={{ marginTop: 4 }}>
                    {elapsed(cap.startedAt, cap.finishedAt)}
                  </div>
                </>
              )}
            </div>
          </ProgressRing>
        </div>

        <div style={{ height: 26, marginTop: 18, textAlign: 'center' }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={ready ? 'ready' : failed ? 'failed' : cap.message}
              className="t-headline"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
            >
              {ready ? 'Your capture is ready' : failed ? 'Something went wrong' : cap.message}
            </motion.div>
          </AnimatePresence>
        </div>

        {!failed && <Timeline cap={cap} />}

        {ready && (
          <motion.button
            className="btn btn-primary full"
            onClick={onView}
            style={{ marginTop: 26 }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            whileTap={{ scale: 0.98 }}
          >
            <Icon name="orbit" size={20} />
            View in 3D
          </motion.button>
        )}

        {failed && (
          <div style={{ width: '100%', marginTop: 22 }}>
            <div className="card" style={{ padding: 16 }}>
              <div className="t-subhead" style={{ lineHeight: 1.5 }}>
                {cap.error || 'The pipeline failed.'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button className="btn btn-gray" style={{ flex: 1 }} onClick={onRetry}>
                <Icon name="reset" size={18} />
                Retry
              </button>
              <button className="btn btn-gray" style={{ flex: 1, color: 'var(--red)' }} onClick={onDelete}>
                <Icon name="trash" size={18} />
                Delete
              </button>
            </div>
          </div>
        )}

        {!failed && (
          <div style={{ width: '100%', marginTop: 22 }}>
            <StatGrid cap={cap} />
          </div>
        )}

        {!ready && !failed && (
          <p className="t-foot dim" style={{ textAlign: 'center', marginTop: 20, lineHeight: 1.4, maxWidth: 320 }}>
            You can leave this screen — it keeps processing and will be waiting in your library.
          </p>
        )}
      </div>
    </div>
  );
}
