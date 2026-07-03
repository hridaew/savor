import { motion } from 'framer-motion';
import type { Capture } from '../types';
import { Icon } from './Icon';
import { ProgressRing } from './Primitives';
import { formatCount, stageColor, statusLabel, timeAgo } from '../util';

export function CaptureCard({ cap, onOpen }: { cap: Capture; onOpen: () => void }) {
  const ready = cap.status === 'ready';
  const failed = cap.status === 'failed';
  const busy = !ready && !failed;

  return (
    <motion.button
      layout
      className="cap-card"
      onClick={onOpen}
      initial={{ opacity: 0, y: 12, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
    >
      <div
        className={`cap-thumb ${cap.thumbUrl ? '' : 'placeholder'}`}
        style={cap.thumbUrl ? { backgroundImage: `url(${cap.thumbUrl})` } : undefined}
      >
        {ready && (
          <div className="cap-badge">
            <Icon name="orbit" size={18} />
          </div>
        )}
        {busy && (
          <div className="cap-veil">
            <ProgressRing
              progress={cap.progress}
              size={72}
              stroke={6}
              color={stageColor(cap.stage)}
              track="rgba(60,60,67,0.12)"
              indeterminate={cap.progress < 0.01}
            >
              <div
                className="tnum"
                style={{ fontWeight: 700, fontSize: 17, fontFamily: 'var(--font-rounded)' }}
              >
                {Math.round(cap.progress * 100)}
                <span style={{ fontSize: 10, opacity: 0.55 }}>%</span>
              </div>
            </ProgressRing>
          </div>
        )}
        {failed && (
          <div className="cap-veil" style={{ background: 'rgba(255,235,234,0.55)' }}>
            <Icon name="warning" size={34} style={{ color: 'var(--red)' }} />
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
          {ready && cap.gaussians != null && <span className="chip">{formatCount(cap.gaussians)} splats</span>}
          <span className="t-cap dim3" style={{ marginLeft: 'auto' }}>
            {timeAgo(cap.createdAt)}
          </span>
        </div>
      </div>
    </motion.button>
  );
}
