import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import type { Capture } from '../types';
import { Icon } from './Icon';
import { ProgressRing } from './Primitives';
import { prefetchViewer, useForesight } from '../lib/foresight';
import { formatCount, stageColor, statusLabel, timeAgo } from '../util';

/** forwardRef so AnimatePresence mode="popLayout" can measure the card and
 *  hold its position while it exits. */
export const CaptureCard = forwardRef<
  HTMLButtonElement,
  { cap: Capture; index: number; onOpen: () => void }
>(function CaptureCard({ cap, index, onOpen }, forwardedRef) {
  const ready = cap.status === 'ready';
  const failed = cap.status === 'failed';
  const busy = !ready && !failed;
  // Prefer the rendered splat poster; fall back to the video thumbnail.
  const art = cap.posterUrl ?? cap.thumbUrl;

  // Warm the viewer chunk when the cursor's trajectory heads for a ready card.
  const foresightRef = useForesight<HTMLButtonElement>(prefetchViewer, {
    hitSlop: 20,
    enabled: ready,
  });
  const setRefs = (node: HTMLButtonElement | null) => {
    foresightRef(node);
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };

  return (
    <motion.button
      ref={setRefs}
      layout
      className="cap-card"
      onClick={onOpen}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10, transition: { duration: 0.16, ease: 'easeIn' } }}
      transition={{
        duration: 0.24,
        ease: [0.215, 0.61, 0.355, 1],
        // Stagger capped at 30ms/item and 8 items so late cards never lag.
        delay: Math.min(index, 8) * 0.03,
        layout: { type: 'spring', stiffness: 500, damping: 40 },
      }}
    >
      <div
        className={`cap-thumb ${art ? '' : 'placeholder'}`}
        style={art ? { backgroundImage: `url(${art})` } : undefined}
      >
        {!art && <Icon name="cube" size={34} weight={1.5} />}
        {ready && (
          <div className="cap-badge">
            <Icon name="orbit" size={17} />
          </div>
        )}
        {busy && (
          <div className="cap-veil">
            <ProgressRing
              progress={cap.progress}
              size={72}
              stroke={6}
              color={stageColor(cap.stage)}
              track="rgba(18,20,26,0.1)"
              indeterminate={cap.progress < 0.01}
            >
              <div className="tnum" style={{ fontWeight: 650, fontSize: 16 }}>
                {Math.round(cap.progress * 100)}
                <span style={{ fontSize: 10, opacity: 0.55 }}>%</span>
              </div>
            </ProgressRing>
          </div>
        )}
        {failed && (
          <div className="cap-veil" style={{ background: 'rgba(253,240,239,0.6)' }}>
            <Icon name="warning" size={32} style={{ color: 'var(--red)' }} />
          </div>
        )}
      </div>

      <div className="cap-foot">
        <div
          className="t-headline"
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {cap.name}
        </div>
        <div className="cap-chips">
          <span className="chip">
            <span className="dot" style={{ background: stageColor(cap.stage) }} />
            {statusLabel(cap.stage)}
          </span>
          {ready && cap.gaussians != null && (
            <span className="chip tnum">{formatCount(cap.gaussians)} splats</span>
          )}
          <span className="t-cap dim3 tnum" style={{ marginLeft: 'auto' }}>
            {timeAgo(cap.createdAt)}
          </span>
        </div>
      </div>
    </motion.button>
  );
});
