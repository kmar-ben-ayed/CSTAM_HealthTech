import StatusShield, { type ShieldState } from './StatusShield';

// The Sentinel mascot. Older pages use this name; it now draws the same
// shield as everywhere else (StatusShield), so every state and every loading
// moment in the app looks and moves the same way.

export type SentinelState = ShieldState;

const LABELS: Record<SentinelState, string> = {
  idle: 'Idle',
  scanning: 'Scanning',
  pass: 'Passed',
  fail: 'Failed',
  uncertain: 'Unable to assess',
  review: 'Needs review',
};

interface SentinelProps {
  state?: SentinelState;
  size?: number;
  className?: string;
  showLabel?: boolean;
}

export default function Sentinel({ state = 'idle', size = 100, className = '', showLabel = false }: SentinelProps) {
  return (
    <span className={`sentinel ${className}`}>
      <StatusShield state={state} size={size} />
      {showLabel && <span className={`sentinel-label is-${state}`}>{LABELS[state]}</span>}
    </span>
  );
}
