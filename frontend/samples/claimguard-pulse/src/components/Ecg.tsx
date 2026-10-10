import { RULES, type Claim, type Status } from '@/data';

const W = 92; // width of one beat (one rule)
const H = 132;
const Y = 78; // isoelectric baseline

/** One heartbeat per rule. The shape encodes the verdict:
 *  PASS  – normal sinus beat
 *  FAIL  – tall QRS with ST elevation (the classic "something is wrong" trace)
 *  UTA   – irregular fibrillation, no clear QRS (the signal is unreadable)
 *  NA    – flatline (lead not connected — rule doesn't apply)
 */
function beat(x: number, s: Status, seed: number): string {
  const p = `L${x + 12},${Y} Q${x + 17},${Y - 7} ${x + 22},${Y}`;
  switch (s) {
    case 'PASS':
      return `M${x},${Y} ${p} L${x + 30},${Y} L${x + 33},${Y + 5} L${x + 38},${Y - 40} L${x + 43},${Y + 13} L${x + 47},${Y} L${x + 58},${Y} Q${x + 67},${Y - 14} ${x + 76},${Y} L${x + W},${Y}`;
    case 'FAIL':
      return `M${x},${Y} ${p} L${x + 30},${Y} L${x + 33},${Y + 8} L${x + 38},${Y - 70} L${x + 44},${Y + 30} L${x + 48},${Y - 16} L${x + 58},${Y - 18} Q${x + 68},${Y - 40} ${x + 78},${Y} L${x + W},${Y}`;
    case 'UTA': {
      let d = `M${x},${Y} ${p}`;
      let r = seed;
      for (let i = 26; i <= 84; i += 4) {
        r = (r * 9301 + 49297) % 233280;
        const amp = ((r / 233280) - 0.5) * 22;
        d += ` L${x + i},${(Y + amp).toFixed(1)}`;
      }
      return d + ` L${x + W},${Y}`;
    }
    default:
      return `M${x},${Y} L${x + W},${Y}`;
  }
}

const STROKE: Record<Status, string> = {
  PASS: 'var(--ink)',
  FAIL: 'var(--alarm)',
  UTA: 'var(--caution)',
  NA: 'var(--ink-4)',
};

export function Ecg({ claim, selected, onSelect }: { claim: Claim; selected: string; onSelect: (id: string) => void }) {
  const width = RULES.length * W;
  return (
    <div className="ecg-paper" role="group" aria-label="Rule results as a heart trace">
      <svg viewBox={`0 0 ${width} ${H}`} preserveAspectRatio="none" className="ecg-svg" key={claim.id}>
        <defs>
          <clipPath id="sweep">
            <rect x="0" y="0" height={H} width={width}>
              <animate attributeName="width" from="0" to={width} dur="1.8s" fill="freeze" calcMode="spline" keySplines="0.3 0 0.4 1" />
            </rect>
          </clipPath>
        </defs>

        {RULES.map((r, i) => {
          const s = claim.findings[r.id].status;
          const on = r.id === selected;
          return (
            <g key={r.id} className="beat" onClick={() => onSelect(r.id)}>
              <title>{`${r.id} · ${r.title} · ${s}`}</title>
              <rect x={i * W} y={0} width={W} height={H} className={on ? 'beat-hit on' : 'beat-hit'} />
            </g>
          );
        })}

        <g clipPath="url(#sweep)" fill="none" strokeLinejoin="round" strokeLinecap="round">
          {RULES.map((r, i) => {
            const s = claim.findings[r.id].status;
            return (
              <path
                key={r.id}
                d={beat(i * W, s, i * 7 + 3)}
                stroke={STROKE[s]}
                strokeWidth={s === 'FAIL' ? 2.4 : 1.7}
                strokeDasharray={s === 'NA' ? '3 5' : undefined}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </g>
      </svg>
      <div className="ecg-labels" style={{ gridTemplateColumns: `repeat(${RULES.length}, 1fr)` }}>
        {RULES.map((r) => {
          const s = claim.findings[r.id].status;
          return (
            <button key={r.id} onClick={() => onSelect(r.id)} className={`ecg-lab s-${s}${r.id === selected ? ' on' : ''}`}>
              {r.id}
            </button>
          );
        })}
      </div>
    </div>
  );
}
