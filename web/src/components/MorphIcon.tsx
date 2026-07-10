import { useEffect, useRef } from 'react';
import { motion, useReducedMotion, useSpring, type Transition } from 'framer-motion';

/**
 * Morphing icon system per the userinterface-wiki spec: every icon is exactly
 * three SVG lines in a shared 14×14 viewBox; unused lines collapse to an
 * invisible center point so any icon can morph into any other. Rotational
 * variants share a group + base lines and rotate with spring physics; icons
 * from different groups jump rotation instantly.
 */

interface IconLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  opacity?: number;
}

interface IconDefinition {
  lines: [IconLine, IconLine, IconLine];
  rotation?: number;
  group?: string;
}

const VIEWBOX_SIZE = 14;
const CENTER = 7;
const collapsed: IconLine = { x1: CENTER, y1: CENTER, x2: CENTER, y2: CENTER, opacity: 0 };

const chevronLines: [IconLine, IconLine, IconLine] = [
  { x1: 4.5, y1: 2.5, x2: 9, y2: 7 },
  { x1: 9, y1: 7, x2: 4.5, y2: 11.5 },
  collapsed,
];

export const MORPH_ICONS = {
  plus: {
    lines: [
      { x1: 7, y1: 2, x2: 7, y2: 12 },
      { x1: 2, y1: 7, x2: 12, y2: 7 },
      collapsed,
    ],
  },
  xmark: {
    lines: [
      { x1: 3.2, y1: 3.2, x2: 10.8, y2: 10.8 },
      { x1: 10.8, y1: 3.2, x2: 3.2, y2: 10.8 },
      collapsed,
    ],
  },
  minus: {
    lines: [{ x1: 2.5, y1: 7, x2: 11.5, y2: 7 }, collapsed, collapsed],
  },
  check: {
    lines: [
      { x1: 2, y1: 7.5, x2: 5.5, y2: 11 },
      { x1: 5.5, y1: 11, x2: 12, y2: 3 },
      collapsed,
    ],
  },
  'chevron-right': { lines: chevronLines, rotation: 0, group: 'chevron' },
  'chevron-down': { lines: chevronLines, rotation: 90, group: 'chevron' },
  'chevron-left': { lines: chevronLines, rotation: 180, group: 'chevron' },
  'chevron-up': { lines: chevronLines, rotation: -90, group: 'chevron' },
  /* Volume bars: three ascending lines; muting morphs the tall bar into a slash. */
  'sound-on': {
    lines: [
      { x1: 3, y1: 8.5, x2: 3, y2: 11 },
      { x1: 7, y1: 6, x2: 7, y2: 11 },
      { x1: 11, y1: 3, x2: 11, y2: 11 },
    ],
  },
  'sound-off': {
    lines: [
      { x1: 3, y1: 8.5, x2: 3, y2: 11 },
      { x1: 7, y1: 9.5, x2: 7, y2: 11 },
      { x1: 3.5, y1: 11.5, x2: 11.5, y2: 2.5 },
    ],
  },
} satisfies Record<string, IconDefinition>;

export type MorphIconName = keyof typeof MORPH_ICONS;

const morphTransition: Transition = { ease: [0.19, 1, 0.22, 1], duration: 0.28 };
const rotationSpring = { stiffness: 500, damping: 32 };

export function MorphIcon({
  name,
  size = 16,
  strokeWidth = 1.6,
  className,
  style,
}: {
  name: MorphIconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const definition = MORPH_ICONS[name] as IconDefinition;
  const reducedMotion = useReducedMotion() ?? false;
  const activeTransition = reducedMotion ? { duration: 0 } : morphTransition;

  const rotation = useSpring(definition.rotation ?? 0, rotationSpring);
  const prevGroup = useRef<string | undefined>(definition.group);

  useEffect(() => {
    const sameGroup =
      definition.group !== undefined && definition.group === prevGroup.current;
    // Spring-rotate within a group; jump instantly across groups.
    if (sameGroup && !reducedMotion) {
      rotation.set(definition.rotation ?? 0);
    } else {
      rotation.jump(definition.rotation ?? 0);
    }
    prevGroup.current = definition.group;
  }, [definition, reducedMotion, rotation]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
      fill="none"
      stroke="currentColor"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <motion.g style={{ rotate: rotation, transformOrigin: 'center' }}>
        {definition.lines.map((line, i) => (
          <motion.line
            key={i}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            initial={false}
            animate={{
              x1: line.x1,
              y1: line.y1,
              x2: line.x2,
              y2: line.y2,
              opacity: line.opacity ?? 1,
            }}
            transition={activeTransition}
          />
        ))}
      </motion.g>
    </svg>
  );
}
