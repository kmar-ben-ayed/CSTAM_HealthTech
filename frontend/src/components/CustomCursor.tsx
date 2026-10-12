import { useEffect, useState } from 'react';
import { motion, useMotionTemplate, useMotionValue, useSpring, useReducedMotion } from 'framer-motion';
import '../styles/cursor.css';

// ── Custom cursor ──────────────────────────────────────────────────────────
// A hollow circle that trails the pointer on a soft spring and a dot that
// follows it closely. It never captures the pointer, it does not render on
// touch devices, and over text fields it steps aside for the native caret.

export interface CustomCursorProps {
  circleSize?: number;
  dotSize?: number;
  circleColor?: string;
  dotColor?: string;
  circleStiffness?: number;
  circleDamping?: number;
  dotStiffness?: number;
  dotDamping?: number;
  circleBorderWidth?: number;
}

const FINE_POINTER = '(hover: hover) and (pointer: fine)';
const TEXT_FIELD = 'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]), textarea, select, [contenteditable=""], [contenteditable="true"]';

function useFinePointer(): boolean {
  const [fine, setFine] = useState(() => window.matchMedia(FINE_POINTER).matches);
  useEffect(() => {
    const media = window.matchMedia(FINE_POINTER);
    const update = () => setFine(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return fine;
}

export default function CustomCursor(props: CustomCursorProps) {
  // Touch devices keep their native behaviour; nothing is mounted.
  return useFinePointer() ? <Cursor {...props} /> : null;
}

function Cursor({
  circleSize = 35,
  dotSize = 9,
  circleColor = 'rgb(34, 211, 238)',
  dotColor = 'rgb(34, 211, 238)',
  circleStiffness = 80,
  circleDamping = 15,
  dotStiffness = 320,
  dotDamping = 31,
  circleBorderWidth = 1,
}: CustomCursorProps) {
  const reduceMotion = useReducedMotion();
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const circleX = useSpring(x, { stiffness: circleStiffness, damping: circleDamping });
  const circleY = useSpring(y, { stiffness: circleStiffness, damping: circleDamping });
  const dotX = useSpring(x, { stiffness: dotStiffness, damping: dotDamping });
  const dotY = useSpring(y, { stiffness: dotStiffness, damping: dotDamping });
  const [visible, setVisible] = useState(false);
  const [overText, setOverText] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add('has-custom-cursor');
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      x.set(event.clientX);
      y.set(event.clientY);
      setVisible(true);
      setOverText(event.target instanceof Element && event.target.closest(TEXT_FIELD) !== null);
    };
    const onLeave = () => setVisible(false);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      document.documentElement.classList.remove('has-custom-cursor');
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, [x, y]);

  const shown = visible && !overText;
  // With reduced motion both parts sit exactly on the pointer, without trailing.
  // A full transform string keeps the movement on the GPU, unlike Motion's x/y shorthands.
  const circleTransform = useMotionTemplate`translate3d(${reduceMotion ? x : circleX}px, ${reduceMotion ? y : circleY}px, 0)`;
  const dotTransform = useMotionTemplate`translate3d(${reduceMotion ? x : dotX}px, ${reduceMotion ? y : dotY}px, 0)`;

  return (
    <div className="custom-cursor" aria-hidden="true" style={{ opacity: shown ? 1 : 0 }}>
      <motion.div
        className="custom-cursor-circle"
        style={{
          transform: circleTransform,
          width: circleSize,
          height: circleSize,
          marginLeft: -circleSize / 2,
          marginTop: -circleSize / 2,
          border: `${circleBorderWidth}px solid ${circleColor}`,
        }}
      />
      <motion.div
        className="custom-cursor-dot"
        style={{
          transform: dotTransform,
          width: dotSize,
          height: dotSize,
          marginLeft: -dotSize / 2,
          marginTop: -dotSize / 2,
          background: dotColor,
        }}
      />
    </div>
  );
}
