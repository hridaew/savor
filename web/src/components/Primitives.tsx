import type { ReactNode } from 'react';

/** Animated iOS segmented control. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const n = options.length;
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className="segmented">
      <div
        className="seg-thumb"
        style={{
          width: `calc((100% - 4px) / ${n})`,
          transform: `translateX(calc(${i} * 100%))`,
          transition: 'transform .3s cubic-bezier(.22,1,.36,1)',
        }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          className={`seg ${o.value === value ? '' : 'off'}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** SVG progress ring with optional center content. */
export function ProgressRing({
  progress,
  size = 132,
  stroke = 10,
  color = 'var(--blue)',
  track = 'var(--fill-3)',
  indeterminate = false,
  children,
}: {
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  indeterminate?: boolean;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} className={indeterminate ? 'spin' : ''} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={indeterminate ? c * 0.7 : c * (1 - p)}
          style={{ transition: 'stroke-dashoffset .5s cubic-bezier(.22,1,.36,1), stroke .4s' }}
        />
      </svg>
      {children && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="t-title3 tnum" style={{ fontFamily: 'var(--font-rounded)' }}>
        {value}
      </div>
      <div className="t-cap dim" style={{ marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}
