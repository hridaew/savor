import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Capture } from '../types';
import { Icon } from '../components/Icon';
import { AnimatedHeight } from '../components/AnimatedHeight';
import { createCapture } from '../api';
import { play } from '../lib/sound';
import { formatBytes } from '../util';

export function CreateSheet({
  onCreated,
  initialFile,
}: {
  onCreated: (cap: Capture) => void;
  /** Pre-selected video (e.g. dropped onto the library). */
  initialFile?: File | null;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Postel's law: take whatever the picker/drop hands us, normalize the name.
  const pick = (f?: File | null) => {
    if (!f) return;
    if (!f.type.startsWith('video/')) {
      setError('Please choose a video file.');
      return;
    }
    setError(null);
    setFile(f);
    setName((n) => n || f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 60));
  };

  useEffect(() => {
    if (initialFile) pick(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const submit = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const cap = await createCapture({
        file,
        name: name.trim() || file.name,
        onProgress: setPct,
      });
      play('confirm'); // upload accepted — paired with the processing screen
      onCreated(cap);
    } catch (e: any) {
      play('error');
      setError(String(e?.message ?? e));
      setBusy(false);
    }
  };

  return (
    // The sheet's height follows its content (file row, error) smoothly.
    <AnimatedHeight>
      <div className="t-title2" style={{ padding: '4px 2px 14px' }}>
        New Capture
      </div>

      {/* file picker / dropzone */}
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        style={{ display: 'none' }}
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <div
        className={`dropzone ${drag ? 'drag' : ''} ${file ? 'has' : ''}`}
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          pick(e.dataTransfer.files?.[0]);
        }}
      >
        {file ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left' }}>
            <div className="thumb-pill">
              <Icon name="film" size={22} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                className="t-callout"
                style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {file.name}
              </div>
              <div className="t-foot dim tnum">{formatBytes(file.size)} · tap to change</div>
            </div>
            <Icon name="check" size={18} weight={2.2} style={{ color: 'var(--green)' }} />
          </div>
        ) : (
          <>
            <div style={{ color: 'var(--ink-2)', marginBottom: 8 }}>
              <Icon name="film" size={30} weight={1.5} />
            </div>
            <div className="t-headline">Choose a video</div>
            <div className="t-foot dim" style={{ marginTop: 4 }}>
              A 20–40s clip slowly circling your subject
            </div>
          </>
        )}
      </div>

      {/* name */}
      <div className="section-head" style={{ paddingTop: 'var(--space-5)' }}>Name</div>
      <input
        className="field"
        value={name}
        placeholder="Untitled capture"
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
      />

      <p className="t-foot dim" style={{ padding: '12px 4px 0', lineHeight: 1.4 }}>
        <Icon name="info" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
        Best results: steady orbit, even lighting, a textured subject that fills the frame. For
        spaces, walk a slow arc while looking around — panning from one spot can’t be
        reconstructed.
      </p>

      <AnimatePresence>
        {error && (
          <motion.div
            className="t-foot"
            style={{
              color: 'var(--red)',
              background: 'var(--red-soft)',
              borderRadius: 10,
              padding: '10px 12px',
              marginTop: 12,
              display: 'flex',
              gap: 8,
              alignItems: 'center',
            }}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4, transition: { duration: 0.14, ease: 'easeIn' } }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <Icon name="warning" size={15} />
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <button
        className="btn btn-primary full"
        style={{ marginTop: 20, position: 'relative', overflow: 'hidden' }}
        disabled={!file || busy}
        onClick={submit}
      >
        {busy ? (
          <>
            <span
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${pct * 100}%`,
                background: 'rgba(255,255,255,0.16)',
                transition: 'width 200ms linear',
              }}
            />
            <span className="tnum" style={{ position: 'relative' }}>
              {pct < 1 ? `Uploading… ${Math.round(pct * 100)}%` : 'Starting…'}
            </span>
          </>
        ) : (
          <>
            <Icon name="wand" size={17} />
            Create splat
          </>
        )}
      </button>
    </AnimatedHeight>
  );
}
