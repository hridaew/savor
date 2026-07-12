import { AnimatePresence, motion } from 'framer-motion';
import type { Capture, Health } from '../types';
import { NavScreen } from '../components/NavScreen';
import { CaptureCard } from '../components/CaptureCard';
import { SetupCard } from '../components/SetupCard';
import { Icon } from '../components/Icon';
import { prefetchViewer, useForesight } from '../lib/foresight';

function EmptyState({ onCreate, onSample }: { onCreate: () => void; onSample: () => void }) {
  const sampleRef = useForesight<HTMLButtonElement>(prefetchViewer, { hitSlop: 24 });
  return (
    <motion.div
      className="empty-hero"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: [0.215, 0.61, 0.355, 1] }}
    >
      <div className="empty-mark">
        <Icon name="cube" size={34} weight={1.5} />
      </div>
      <div className="t-title2">Capture in 3D</div>
      <p
        className="t-subhead dim"
        style={{ margin: '10px auto 24px', maxWidth: 300, lineHeight: 1.5 }}
      >
        Slowly film an object from every side. Savor turns that clip into a gaussian splat you can
        orbit, relight, and revisit.
      </p>
      <button className="btn btn-primary full" onClick={onCreate}>
        <Icon name="plus" size={18} weight={2.2} />
        New Capture
      </button>
      <button ref={sampleRef} className="btn btn-plain" style={{ marginTop: 12 }} onClick={onSample}>
        Explore the sample sculpture →
      </button>
    </motion.div>
  );
}

export function LibraryScreen({
  captures,
  health,
  onOpen,
  onCreate,
  onSample,
}: {
  captures: Capture[];
  health: Health | null;
  onOpen: (c: Capture) => void;
  onCreate: () => void;
  onSample: () => void;
}) {
  const subtitle = captures.length
    ? `${captures.length} capture${captures.length > 1 ? 's' : ''}`
    : 'Turn a video into 3D';

  return (
    <NavScreen title="Library" subtitle={subtitle}>
      <SetupCard health={health} />
      {captures.length === 0 ? (
        <EmptyState onCreate={onCreate} onSample={onSample} />
      ) : (
        <div className="lib-grid">
          {/* popLayout lets removed cards exit in place while the rest of the
              grid springs into the gap. */}
          <AnimatePresence mode="popLayout">
            {captures.map((c, i) => (
              <CaptureCard key={c.id} cap={c} index={i} onOpen={() => onOpen(c)} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </NavScreen>
  );
}
