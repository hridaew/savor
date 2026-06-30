import type { JSX } from 'react';

export type IconName =
  | 'back' | 'chevron' | 'plus' | 'xmark' | 'check' | 'checkfill'
  | 'cube' | 'orbit' | 'photo' | 'film' | 'share' | 'trash'
  | 'sparkles' | 'wand' | 'bolt' | 'gauge' | 'diamond' | 'play'
  | 'rotate' | 'viewfinder' | 'camera' | 'info' | 'gear' | 'layers'
  | 'arrowup' | 'hand' | 'warning' | 'reset' | 'expand';

const S = ({ children }: { children: JSX.Element | JSX.Element[] }) => <>{children}</>;

const STROKE: Partial<Record<IconName, JSX.Element>> = {
  back: <path d="M15 4.5l-7.5 7.5L15 19.5" />,
  chevron: <path d="M9 4.5l7.5 7.5L9 19.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  xmark: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  check: <path d="M4.5 12.5l4.8 4.8L19.5 7" />,
  cube: (
    <S>
      <path d="M12 2.6l8.2 4.7v9.4L12 21.4l-8.2-4.7V7.3L12 2.6z" />
      <path d="M3.8 7.3L12 12l8.2-4.7M12 12v9.4" />
    </S>
  ),
  orbit: (
    <S>
      <circle cx="12" cy="12" r="4.4" />
      <ellipse cx="12" cy="12" rx="9.4" ry="4.1" transform="rotate(-28 12 12)" />
    </S>
  ),
  photo: (
    <S>
      <rect x="3" y="4.5" width="18" height="15" rx="3.4" />
      <circle cx="8.4" cy="9.6" r="1.7" />
      <path d="M3.6 17l4.6-4.3 3.5 3 3-2.7 5.7 5" />
    </S>
  ),
  film: (
    <S>
      <rect x="3" y="5" width="18" height="14" rx="3.4" />
      <path d="M9 5v14M15 5v14M3 9.5h6M15 9.5h6M3 14.5h6M15 14.5h6" />
    </S>
  ),
  share: (
    <S>
      <path d="M12 3v12.5" />
      <path d="M8 6.5L12 2.7l4 3.8" />
      <path d="M6 11.5H5.2A1.2 1.2 0 004 12.7v6.1A1.2 1.2 0 005.2 20h13.6a1.2 1.2 0 001.2-1.2v-6.1a1.2 1.2 0 00-1.2-1.2H18" />
    </S>
  ),
  trash: (
    <S>
      <path d="M5 6.5h14M9.5 6.5V5a1.5 1.5 0 011.5-1.5h2A1.5 1.5 0 0114.5 5v1.5" />
      <path d="M6.5 6.5l.9 12a2 2 0 002 1.9h5.2a2 2 0 002-1.9l.9-12M10 10.5v6M14 10.5v6" />
    </S>
  ),
  wand: (
    <S>
      <path d="M5 19l9.5-9.5M16 4.2l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9z" />
      <path d="M19.4 11.2l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4.4-1z" />
    </S>
  ),
  bolt: <path d="M13 2.5L5.5 13H11l-1 8.5L18.5 11H13l0-8.5z" />,
  gauge: (
    <S>
      <path d="M4 17a8 8 0 1116 0" />
      <path d="M12 13.5l4-4" />
      <circle cx="12" cy="13.8" r="1.1" fill="currentColor" stroke="none" />
    </S>
  ),
  diamond: <path d="M12 2.8l4.6 5.2L12 21.2 7.4 8z M3.5 8h17" />,
  play: <path d="M7 4.5l12 7.5-12 7.5z" />,
  rotate: (
    <S>
      <path d="M20 7.5A8.3 8.3 0 105.5 18.5" />
      <path d="M20 3.5v4h-4" />
    </S>
  ),
  reset: (
    <S>
      <path d="M4 8.5A8.3 8.3 0 1118 18" />
      <path d="M4 4v4.5h4.5" />
    </S>
  ),
  viewfinder: (
    <S>
      <path d="M4 8.5V6a2 2 0 012-2h2.5M15.5 4H18a2 2 0 012 2v2.5M20 15.5V18a2 2 0 01-2 2h-2.5M8.5 20H6a2 2 0 01-2-2v-2.5" />
      <circle cx="12" cy="12" r="2.2" />
    </S>
  ),
  camera: (
    <S>
      <path d="M3.5 8.5a2 2 0 012-2h1.8l1.1-1.7a1 1 0 01.8-.4h3.6a1 1 0 01.8.4l1.1 1.7h1.8a2 2 0 012 2v8a2 2 0 01-2 2h-13a2 2 0 01-2-2z" />
      <circle cx="12" cy="12.5" r="3.3" />
    </S>
  ),
  info: (
    <S>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.8" r="1.05" fill="currentColor" stroke="none" />
    </S>
  ),
  gear: (
    <S>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v2.4M12 18.6V21M21 12h-2.4M5.4 12H3M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7M18.4 18.4l-1.7-1.7M7.3 7.3L5.6 5.6" />
    </S>
  ),
  layers: <path d="M12 3.5l8.5 4.2L12 12 3.5 7.7 12 3.5zM4 12l8 4 8-4M4 16.2l8 4 8-4" />,
  arrowup: <path d="M12 20V5M6 11l6-6 6 6" />,
  hand: (
    <S>
      <path d="M8 11V6.2a1.5 1.5 0 013 0V11V8a1.5 1.5 0 013 0v3V9.2a1.4 1.4 0 012.8 0V15a5 5 0 01-5 5h-1.2a4 4 0 01-3-1.4L7 16.5c-1.5-1.8.9-3.7 2.3-2.1L11 16" />
    </S>
  ),
  warning: (
    <S>
      <path d="M12 4l8.5 14.5h-17L12 4z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="16.6" r="1" fill="currentColor" stroke="none" />
    </S>
  ),
  expand: <path d="M9 4.5H5.5A1.5 1.5 0 004 6v3.5M14.5 4.5H18A1.5 1.5 0 0119.5 6v3.5M19.5 14.5V18a1.5 1.5 0 01-1.5 1.5h-3.5M4 14.5V18a1.5 1.5 0 001.5 1.5H9" />,
  sparkles: (
    <S>
      <path d="M12 3.2l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5 1.5-4z" />
      <path d="M18.5 14l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7.7-1.9z" />
    </S>
  ),
  checkfill: (
    <S>
      <circle cx="12" cy="12" r="9.2" fill="currentColor" stroke="none" />
      <path d="M7.7 12.3l2.9 2.9 5.7-6" stroke="#000" strokeWidth={2} />
    </S>
  ),
};

export function Icon({
  name,
  size = 24,
  weight = 1.8,
  style,
  className,
}: {
  name: IconName;
  size?: number;
  weight?: number;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
      aria-hidden="true"
    >
      {STROKE[name] ?? null}
    </svg>
  );
}
