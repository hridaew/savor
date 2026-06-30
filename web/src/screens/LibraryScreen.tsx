import { motion } from 'framer-motion';
import type { Capture } from '../types';
import { NavScreen } from '../components/NavScreen';
import { CaptureCard } from '../components/CaptureCard';
import { Icon } from '../components/Icon';

function EmptyState({ onCreate, onSample }: { onCreate: () => void; onSample: () => void }) {
  return (
    <motion.div
      className="empty-hero"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      <motion.div
        className="empty-orb"
        animate={{ y: [0, -6, 0] }}
        transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
      >
        <Icon name="cube" size={42} weight={1.6} />
      </motion.div>
      <div className="t-title2">Capture in 3D</div>
      <p className="t-subhead dim" style={{ margin: '8px auto 20px', maxWidth: 300, lineHeight: 1.45 }}>
        Slowly film an object from every side. Savor turns that clip into a gaussian splat you can
        orbit, relight, and revisit.
      </p>
      <button className="btn btn-primary full" onClick={onCreate}>
        <Icon name="plus" size={20} weight={2.2} />
        New Capture
      </button>
      <button className="btn btn-plain" style={{ marginTop: 10 }} onClick={onSample}>
        Explore the sample sculpture →
      </button>
    </motion.div>
  );
}

export function LibraryScreen({
  captures,
  onOpen,
  onCreate,
  onSample,
}: {
  captures: Capture[];
  onOpen: (c: Capture) => void;
  onCreate: () => void;
  onSample: () => void;
}) {
  const subtitle = captures.length
    ? `${captures.length} capture${captures.length > 1 ? 's' : ''}`
    : 'Turn a video into 3D';

  return (
    <NavScreen title="Library" subtitle={subtitle}>
      {captures.length === 0 ? (
        <EmptyState onCreate={onCreate} onSample={onSample} />
      ) : (
        <motion.div className="lib-grid" layout>
          {captures.map((c) => (
            <CaptureCard key={c.id} cap={c} onOpen={() => onOpen(c)} />
          ))}
        </motion.div>
      )}
    </NavScreen>
  );
}
