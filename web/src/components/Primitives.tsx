import type { ReactNode } from 'react';

/** Animated segmented control — thumb slides on a 200ms state-change curve. */
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
          width: `calc((100% - var(--seg-pad) * 2) / ${n})`,
          transform: `translateX(calc(${i} * 100%))`,
          transition: 'transform var(--t-state) var(--ease-out)',
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

/** SVG progress ring. Determinate progress moves linearly — linear easing is
 *  reserved for time/progress representation. */
export function ProgressRing({
  progress,
  size = 132,
  stroke = 10,
  color = 'var(--accent)',
  track = 'var(--fill-1)',
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
          style={{ transition: 'stroke-dashoffset 260ms linear, stroke var(--t-state) var(--ease-out)' }}
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

/** Accessible switch with a spring-free 200ms thumb slide. */
export function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      className={`switch ${on ? 'on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    >
      <span
        className="knob"
        style={{
          transform: on ? 'translateX(16px)' : 'translateX(0)',
          transition: 'transform var(--t-state) var(--ease-out)',
        }}
      />
    </button>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="t-title3 tnum">{value}</div>
      <div className="t-cap dim" style={{ marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}
