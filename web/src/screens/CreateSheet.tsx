import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { Capture } from '../types';
import { Icon } from '../components/Icon';
import { createCapture } from '../api';
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

  const pick = (f?: File | null) => {
    if (!f) return;
    if (!f.type.startsWith('video/')) {
      setError('Please choose a video file.');
      return;
    }
    setError(null);
    setFile(f);
    setName((n) => n || f.name.replace(/\.[^.]+$/, '').slice(0, 60));
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
      onCreated(cap);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="t-title2" style={{ padding: '4px 2px 16px' }}>
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
            <div
              className="thumb-pill"
              style={{ display: 'grid', placeItems: 'center', color: 'var(--label-2)' }}
            >
              <Icon name="film" size={24} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="t-callout" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {file.name}
              </div>
              <div className="t-foot dim">{formatBytes(file.size)} · tap to change</div>
            </div>
            <Icon name="check" size={20} style={{ color: 'var(--green)' }} />
          </div>
        ) : (
          <>
            <div style={{ color: 'var(--blue)', marginBottom: 8 }}>
              <Icon name="film" size={34} weight={1.6} />
            </div>
            <div className="t-headline">Choose a video</div>
            <div className="t-foot dim" style={{ marginTop: 4 }}>
              A 20–40s clip slowly circling your subject
            </div>
          </>
        )}
      </div>

      {/* name */}
      <div className="section-head">Name</div>
      <input
        className="field"
        value={name}
        placeholder="Untitled capture"
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
      />

      <p className="t-foot dim" style={{ padding: '12px 4px 0', lineHeight: 1.4 }}>
        <Icon name="info" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
        Best results: steady orbit, even lighting, a textured subject that fills the frame.
      </p>

      {error && (
        <div
          className="t-foot"
          style={{ color: 'var(--red)', padding: '14px 4px 0', display: 'flex', gap: 6 }}
        >
          <Icon name="warning" size={15} />
          {error}
        </div>
      )}

      <motion.button
        className="btn btn-primary full"
        style={{ marginTop: 20, position: 'relative', overflow: 'hidden' }}
        disabled={!file || busy}
        onClick={submit}
        whileTap={{ scale: 0.98 }}
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
                background: 'rgba(255,255,255,0.18)',
                transition: 'width .2s',
              }}
            />
            <span style={{ position: 'relative' }}>
              {pct < 1 ? `Uploading… ${Math.round(pct * 100)}%` : 'Starting…'}
            </span>
          </>
        ) : (
          <>
            <Icon name="wand" size={19} />
            Create splat
          </>
        )}
      </motion.button>
    </div>
  );
}
