import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { Capture, Quality } from '../types';
import { Icon, type IconName } from '../components/Icon';
import { createCapture } from '../api';
import { formatBytes, QUALITY_INFO } from '../util';

const QUALS: { q: Quality; icon: IconName; color: string }[] = [
  { q: 'fast', icon: 'bolt', color: 'var(--orange)' },
  { q: 'balanced', icon: 'gauge', color: 'var(--blue)' },
  { q: 'high', icon: 'diamond', color: 'var(--teal)' },
];

export function CreateSheet({
  onCreated,
}: {
  onCreated: (cap: Capture) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [quality, setQuality] = useState<Quality>('balanced');
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
    if (!name) setName(f.name.replace(/\.[^.]+$/, '').slice(0, 60));
  };

  const submit = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const cap = await createCapture({
        file,
        name: name.trim() || file.name,
        quality,
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

      {/* quality */}
      <div className="section-head">Quality</div>
      <div className="qual-row">
        {QUALS.map(({ q, icon, color }) => (
          <button key={q} className={`qual-card ${quality === q ? 'sel' : ''}`} onClick={() => setQuality(q)}>
            <div className="qual-ic" style={{ background: color }}>
              <Icon name={icon} size={18} />
            </div>
            <div className="t-subhead" style={{ fontWeight: 600 }}>
              {QUALITY_INFO[q].title}
            </div>
            <div className="t-cap dim" style={{ marginTop: 2 }}>
              {QUALITY_INFO[q].time}
            </div>
          </button>
        ))}
      </div>
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
