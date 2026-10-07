export type SentinelState = 'idle' | 'scanning' | 'pass' | 'fail' | 'uncertain' | 'review';

interface SentinelProps {
  state?: SentinelState;
  size?: number;
  className?: string;
  showLabel?: boolean;
}

/* Every colour is a design token so the mark tracks the active theme — the
   pale hex fills this used to carry disappeared in dark mode. */
const STATE_CONFIG = {
  idle: {
    shieldFill: 'var(--canvas-bg-secondary)',
    shieldStroke: 'var(--border-strong)',
    orbitColor: 'var(--text-tertiary)',
    coreColor: 'var(--text-secondary)',
    glowColor: 'transparent',
    label: 'Idle',
    symbol: null,
    orbitSpeed: '8s',
    pulseAnim: 'sentinel-breathe 3s ease-in-out infinite',
    orbitAnim: 'sentinel-orbit 12s linear infinite',
  },
  scanning: {
    shieldFill: 'var(--status-review-bg)',
    shieldStroke: 'var(--status-review)',
    orbitColor: 'var(--status-review)',
    coreColor: 'var(--accent-ink)',
    glowColor: 'var(--status-review)',
    label: 'Scanning',
    symbol: 'scan',
    orbitSpeed: '2s',
    pulseAnim: 'sentinel-glow-pulse 1.5s ease-in-out infinite',
    orbitAnim: 'sentinel-orbit 2s linear infinite',
  },
  pass: {
    shieldFill: 'var(--status-pass-bg)',
    shieldStroke: 'var(--status-pass)',
    orbitColor: 'var(--status-pass)',
    coreColor: 'var(--status-pass-ink)',
    glowColor: 'var(--status-pass)',
    label: 'Verified',
    symbol: 'check',
    orbitSpeed: '6s',
    pulseAnim: 'sentinel-glow-pulse 2s ease-in-out infinite',
    orbitAnim: 'sentinel-orbit 6s linear infinite',
  },
  fail: {
    shieldFill: 'var(--status-fail-bg)',
    shieldStroke: 'var(--status-fail)',
    orbitColor: 'var(--status-fail)',
    coreColor: 'var(--status-fail-ink)',
    glowColor: 'var(--status-fail)',
    label: 'Issue Detected',
    symbol: 'x',
    orbitSpeed: '3s',
    pulseAnim: 'sentinel-glow-pulse 1s ease-in-out infinite',
    orbitAnim: 'sentinel-orbit 3s linear infinite',
  },
  uncertain: {
    shieldFill: 'var(--status-uta-bg)',
    shieldStroke: 'var(--status-uta)',
    orbitColor: 'var(--status-uta)',
    coreColor: 'var(--status-uta-ink)',
    glowColor: 'var(--status-uta)',
    label: 'Unable to Assess',
    symbol: 'question',
    orbitSpeed: '4s',
    pulseAnim: 'sentinel-glow-pulse 2s ease-in-out infinite',
    orbitAnim: 'sentinel-orbit 4s linear infinite',
  },
  review: {
    shieldFill: 'var(--status-review-bg)',
    shieldStroke: 'var(--status-review)',
    orbitColor: 'var(--status-review)',
    coreColor: 'var(--accent-ink)',
    glowColor: 'var(--status-review)',
    label: 'Human Review',
    symbol: 'person',
    orbitSpeed: '5s',
    pulseAnim: 'sentinel-glow-pulse 2.5s ease-in-out infinite',
    orbitAnim: 'sentinel-orbit 5s linear infinite',
  },
};

function ShieldPath({ fill, stroke, style }: { fill: string; stroke: string; style?: React.CSSProperties }) {
  return (
    <path
      d="M 50 6 C 70 6 86 14 90 28 L 90 52 C 90 70 72 84 50 92 C 28 84 10 70 10 52 L 10 28 C 14 14 30 6 50 6 Z"
      fill={fill}
      stroke={stroke}
      strokeWidth="1.5"
      style={style}
    />
  );
}

function SymbolIcon({ symbol, color, size, state }: { symbol: string | null; color: string; size: number; state: SentinelState }) {
  const s = size * 0.28;
  const cx = 50;
  const cy = 52;

  if (!symbol) return null;

  if (symbol === 'check') {
    return (
      <g stroke={color} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <polyline points={`${cx - s * 0.6},${cy} ${cx - s * 0.1},${cy + s * 0.6} ${cx + s * 0.7},${cy - s * 0.5}`} />
      </g>
    );
  }

  if (symbol === 'x') {
    return (
      <g stroke={color} strokeWidth="3.5" strokeLinecap="round" fill="none">
        <line x1={cx - s * 0.5} y1={cy - s * 0.5} x2={cx + s * 0.5} y2={cy + s * 0.5} />
        <line x1={cx + s * 0.5} y1={cy - s * 0.5} x2={cx - s * 0.5} y2={cy + s * 0.5} />
      </g>
    );
  }

  if (symbol === 'question') {
    return (
      <g fill={color}>
        <text x={cx} y={cy + s * 0.4} textAnchor="middle" fontSize={s * 1.6} fontFamily="'Plus Jakarta Sans', system-ui, sans-serif" fontWeight="700">?</text>
      </g>
    );
  }

  if (symbol === 'scan') {
    return (
      <g stroke={color} strokeWidth="1.5" fill="none" opacity="0.7">
        <line x1={cx - s * 0.6} y1={cy} x2={cx + s * 0.6} y2={cy} strokeDasharray="3,2" />
        <line x1={cx - s * 0.6} y1={cy - s * 0.35} x2={cx + s * 0.6} y2={cy - s * 0.35} strokeDasharray="2,3" />
        <line x1={cx - s * 0.6} y1={cy + s * 0.35} x2={cx + s * 0.6} y2={cy + s * 0.35} strokeDasharray="2,3" />
      </g>
    );
  }

  if (symbol === 'person') {
    return (
      <g stroke={color} strokeWidth="2" fill="none" strokeLinecap="round">
        <circle cx={cx} cy={cy - s * 0.45} r={s * 0.28} />
        <path d={`M ${cx - s * 0.5} ${cy + s * 0.6} C ${cx - s * 0.5} ${cy} ${cx + s * 0.5} ${cy} ${cx + s * 0.5} ${cy + s * 0.6}`} />
      </g>
    );
  }

  return null;
}

export default function Sentinel({ state = 'idle', size = 100, className = '', showLabel = false }: SentinelProps) {
  const config = STATE_CONFIG[state];
  const viewBox = "0 0 100 100";

  const r1 = 46;
  const r2 = 42;
  const cx = 50, cy = 50;
  const circumference1 = 2 * Math.PI * r1;
  const circumference2 = 2 * Math.PI * r2;

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox={viewBox}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ overflow: 'visible' }}
        aria-hidden="true"
      >
        <ShieldPath
          fill={config.shieldFill}
          stroke={config.shieldStroke}
        />

        {/* Shield inner highlight */}
        <path
          d="M 50 12 C 66 12 80 19 83 30 L 83 50 C 83 65 68 77 50 84 C 32 77 17 65 17 50 L 17 30 C 20 19 34 12 50 12 Z"
          fill="none"
          stroke={config.shieldStroke}
          strokeWidth="0.5"
          opacity="0.4"
        />

        {/* Core signal element */}
        <circle
          cx={cx}
          cy={cy - 2}
          r={state === 'scanning' ? 5 : 3.5}
          fill={config.coreColor}
          opacity={state === 'idle' ? 0.5 : 0.85}
          style={state === 'scanning' ? { animation: 'sentinel-pulse 1.5s ease-in-out infinite' } : undefined}
        />

        {/* Symbol */}
        <SymbolIcon symbol={config.symbol} color={config.coreColor} size={size} state={state} />
      </svg>

      {showLabel && (
        <span style={{
          fontSize: '0.6875rem',
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: state === 'idle' ? 'var(--text-secondary)' : config.orbitColor,
        }}>
          {config.label}
        </span>
      )}
    </div>
  );
}
