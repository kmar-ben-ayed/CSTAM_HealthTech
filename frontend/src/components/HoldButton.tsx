import { useEffect, useRef, useState, type ReactNode } from 'react';
import '../styles/hold-button.css';

// ── HoldButton ─────────────────────────────────────────────────────────────
// A button that only fires after being held: a fill sweeps across while the
// pointer, Space or Enter is held down, and drains back if released early.
// Escape cancels. With reduced motion the fill fades in instead of sweeping.

export interface HoldButtonProps {
  children: ReactNode;
  doneLabel: ReactNode;
  onHold: () => void;
  disabled?: boolean;
  backgroundColor?: string;
  textColor?: string;
  fillColor: string;
  fillTextColor?: string;
  size?: 'md' | 'lg';
  radius?: number;
  fillDirection?: 'right' | 'left';
  /** Milliseconds the button must be held. */
  holdTime?: number;
  /** Milliseconds a full fill takes to drain after an early release. */
  releaseTime?: number;
  pressScale?: number;
  wave?: boolean;
  waveAmplitude?: number;
  glow?: boolean;
  /** Milliseconds before the button resets after firing; 0 keeps it done. */
  resetAfter?: number;
  'aria-describedby'?: string;
}

export default function HoldButton({
  children,
  doneLabel,
  onHold,
  disabled = false,
  backgroundColor = 'var(--surface)',
  textColor = 'var(--ink)',
  fillColor,
  fillTextColor = '#ffffff',
  size = 'lg',
  radius = 7,
  fillDirection = 'right',
  holdTime = 1200,
  releaseTime = 200,
  pressScale = 0.985,
  wave = false,
  waveAmplitude = 6,
  glow = false,
  resetAfter = 0,
  'aria-describedby': describedBy,
}: HoldButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const progress = useRef(0);
  const frame = useRef(0);
  const [pressed, setPressed] = useState(false);
  const [done, setDone] = useState(false);
  const onHoldRef = useRef(onHold);
  onHoldRef.current = onHold;

  const paint = (value: number) => {
    progress.current = value;
    buttonRef.current?.style.setProperty('--hold-progress', value.toFixed(4));
  };

  // Moves the fill from where it is to `target`, over `duration` for a full sweep.
  // Holding fills linearly (the user is deciding); release eases out (the system responds).
  const animate = (target: number, duration: number, onEnd?: () => void, ease: (t: number) => number = (t) => t) => {
    cancelAnimationFrame(frame.current);
    const from = progress.current;
    const span = Math.abs(target - from) * duration;
    const started = performance.now();
    const step = (now: number) => {
      const t = span === 0 ? 1 : Math.min(1, (now - started) / span);
      paint(from + (target - from) * ease(t));
      if (t < 1) frame.current = requestAnimationFrame(step);
      else onEnd?.();
    };
    frame.current = requestAnimationFrame(step);
  };

  const start = () => {
    if (disabled || done) return;
    setPressed(true);
    animate(1, holdTime, () => {
      setPressed(false);
      setDone(true);
      onHoldRef.current();
    });
  };

  const release = () => {
    if (done) return;
    setPressed(false);
    if (progress.current > 0) animate(0, releaseTime, undefined, (t) => 1 - (1 - t) ** 3);
  };

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  useEffect(() => {
    if (!done || resetAfter <= 0) return;
    const timer = window.setTimeout(() => {
      setDone(false);
      paint(0);
    }, resetAfter);
    return () => window.clearTimeout(timer);
  }, [done, resetAfter]);

  const style = {
    '--hold-bg': backgroundColor,
    '--hold-text': textColor,
    '--hold-fill': fillColor,
    '--hold-fill-text': fillTextColor,
    '--hold-radius': `${radius}px`,
    '--hold-wave': `${waveAmplitude}px`,
    transform: pressed ? `scale(${pressScale})` : undefined,
  } as React.CSSProperties;

  const label = done ? doneLabel : children;

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`hold-button is-${size} fill-${fillDirection}${glow && pressed ? ' is-glowing' : ''}${done ? ' is-done' : ''}`}
      style={style}
      disabled={disabled}
      aria-disabled={done || undefined}
      aria-describedby={describedBy}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        start();
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          release();
          return;
        }
        if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
          event.preventDefault();
          start();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === ' ' || event.key === 'Enter') release();
      }}
      onBlur={release}
    >
      <span className="hold-button-label">{label}</span>
      {wave && <span className="hold-button-wave" aria-hidden="true" />}
      <span className="hold-button-fill" aria-hidden="true">
        <span className="hold-button-label">{label}</span>
      </span>
      <span className="visually-hidden" aria-live="polite">{done ? doneLabel : ''}</span>
    </button>
  );
}
