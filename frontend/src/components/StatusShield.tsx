import { useReducedMotion } from 'framer-motion';
import type { ClaimStatus } from '../api/claimCards';
import '../styles/status-shield.css';

// ── Status shield ──────────────────────────────────────────────────────────
// The Sentinel mark from the design (ClaimGuard AI.pdf, "Six states, one
// shield"): colour, inner symbol, and the speed of the orbit and core pulse
// change with state. Scanning is fastest; idle is slowest.

export type ShieldState = 'idle' | 'scanning' | 'pass' | 'fail' | 'uncertain' | 'review';

const STATES: Record<ShieldState, { label: string; orbit: string; pulse: string }> = {
  idle: { label: 'Idle', orbit: '8s', pulse: '3.2s' },
  scanning: { label: 'Scanning', orbit: '1.6s', pulse: '0.9s' },
  pass: { label: 'Passed', orbit: '6s', pulse: '2.6s' },
  fail: { label: 'Failed', orbit: '3s', pulse: '1.2s' },
  uncertain: { label: 'Unable to assess', orbit: '4s', pulse: '1.8s' },
  review: { label: 'Needs review', orbit: '5s', pulse: '2.2s' },
};

export const SHIELD_FOR_STATUS: Record<ClaimStatus, ShieldState> = {
  Failed: 'fail',
  'Unable to assess': 'uncertain',
  'Needs review': 'review',
  Passed: 'pass',
};

// The orbit: a flat ellipse crossing the shield, which the dot travels along.
const ORBIT = 'M8 58 a52 13 0 1 0 104 0 a52 13 0 1 0 -104 0';

function ShieldSymbol({ state }: { state: ShieldState }) {
  switch (state) {
    case 'idle':
      return (
        <>
          <circle cx="60" cy="58" r="8" />
          <circle cx="60" cy="58" r="2.5" className="shield-symbol-fill" />
        </>
      );
    case 'scanning':
      return <path d="M48 58h24" />;
    case 'pass':
      return <path d="M48.5 58.5l8 8 15-16" />;
    case 'fail':
      return <path d="M51 49l18 18M69 49L51 67" />;
    case 'uncertain':
      return (
        <>
          <path d="M53 51.5a7.5 7.5 0 1 1 10.5 6.8c-2.2 1-3.5 2.6-3.5 5" />
          <circle cx="60" cy="70" r="2.6" className="shield-symbol-fill" />
        </>
      );
    case 'review':
      return (
        <>
          <path d="M45 58c4.5-7.5 25.5-7.5 30 0-4.5 7.5-25.5 7.5-30 0z" />
          <circle cx="60" cy="58" r="4" className="shield-symbol-fill" />
        </>
      );
  }
}

interface StatusShieldProps {
  state: ShieldState;
  size?: number;
  /** Orbit and pulse. Off for small marks in lists; always off with reduced motion. */
  animated?: boolean;
  /** Accessible name; without one the shield is decorative. */
  label?: string;
  className?: string;
}

export default function StatusShield({ state, size = 64, animated = true, label, className = '' }: StatusShieldProps) {
  const reduceMotion = useReducedMotion();
  // Small marks (in tables) are just the shield and its symbol, as in the design.
  const compact = size < 44;
  const moving = animated && !reduceMotion && !compact;
  const config = STATES[state];

  return (
    <svg
      className={`status-shield is-${state}${moving ? ' is-moving' : ''} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ '--shield-pulse': config.pulse } as React.CSSProperties}
    >
      <path className="shield-body" d="M60 12c12 0 24 4 34 10v34c0 24-15 42-34 50-19-8-34-26-34-50V22c10-6 22-10 34-10z" />
      {!compact && <circle className="shield-core" cx="60" cy="58" r="21" />}
      {!compact && <path className="shield-orbit" d={ORBIT} />}
      {/* Keyed by state so a new symbol settles in when the state changes. */}
      <g className="shield-symbol" key={state}>
        <ShieldSymbol state={state} />
      </g>
      {!compact && (
        <circle className="shield-satellite" r="4" cx={moving ? 0 : 14} cy={moving ? 0 : 52}>
          {moving && <animateMotion dur={config.orbit} repeatCount="indefinite" path={ORBIT} />}
        </circle>
      )}
    </svg>
  );
}
