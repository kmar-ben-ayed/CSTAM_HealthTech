import { useEffect, useRef } from 'react';
import { RULES } from '@/data';

// Synthetic figures for one ingestion run (400 records, like backend/data/development).
const RUN = { id: 'RUN-2026-10-09-0914', source: 'CSV pack', total: 400, accepted: 391, rejected: 9 };
const FAILS: Record<string, number> = {
  R001: 11, R002: 6, R003: 14, R004: 9, R005: 21, R006: 17, R007: 12, R008: 38,
  R009: 7, R010: 26, R011: 10, R012: 31, R013: 19, R014: 23, R015: 4,
};
const UTA: Record<string, number> = { R002: 5, R003: 8, R004: 4, R009: 6, R010: 22 };

type Wave = 'ecg' | 'pleth' | 'resp';

function shape(kind: Wave, t: number): number {
  const p = t % 1;
  if (kind === 'ecg') {
    if (p < 0.1) return Math.sin(p * 10 * Math.PI) * 0.12;
    if (p > 0.18 && p < 0.2) return -0.15;
    if (p >= 0.2 && p < 0.23) return 1;
    if (p >= 0.23 && p < 0.26) return -0.35;
    if (p > 0.38 && p < 0.55) return Math.sin(((p - 0.38) / 0.17) * Math.PI) * 0.25;
    return 0;
  }
  if (kind === 'pleth') return Math.pow(Math.sin(p * Math.PI), 3) * 0.9 - (p > 0.45 && p < 0.6 ? Math.sin(((p - 0.45) / 0.15) * Math.PI) * 0.12 : 0);
  return Math.sin(p * Math.PI * 2) * 0.6;
}

/** Sweeping monitor trace with an erase gap, like a real bedside display. */
function Trace({ kind, color, rate }: { kind: Wave; color: string; rate: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    let w = 0, h = 0;
    const size = () => {
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = w * dpr; cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(cv);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let x = 0, prevY = h / 2, t = 0, raf = 0;
    const speed = 1.6;
    const step = () => {
      for (let i = 0; i < 2; i++) {
        t += (rate / 60) * (speed / 120);
        const y = h / 2 - shape(kind, t) * h * 0.4;
        ctx.clearRect(x + 1, 0, 14, h);
        ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(x, prevY); ctx.lineTo(x + speed, y); ctx.stroke();
        x += speed; prevY = y;
        if (x > w) { x = 0; }
      }
      raf = requestAnimationFrame(step);
    };
    if (reduce) {
      ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.beginPath();
      for (let i = 0; i < w; i++) { const y = h / 2 - shape(kind, i / 120) * h * 0.4; i ? ctx.lineTo(i, y) : ctx.moveTo(i, y); }
      ctx.stroke();
    } else raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [kind, color, rate]);
  return <canvas ref={ref} className="trace" />;
}

export function Monitor() {
  const max = Math.max(...Object.values(FAILS));
  const failClaims = 142;
  const utaClaims = 37;
  return (
    <div className="monitor">
      <div className="mon-top">
        <span className="mon-bed">BED · {RUN.id}</span>
        <span>{RUN.source} · {RUN.total} records</span>
        <span className="mon-ok">● audit chain verified</span>
        <span className="mon-clock">09:14:22</span>
      </div>

      <div className="mon-grid">
        <div className="mon-row c-green">
          <div className="mon-wave"><span className="mon-lbl">II · ACCEPTED</span><Trace kind="ecg" color="#3ee08f" rate={72} /></div>
          <div className="mon-num"><span className="mon-lbl">ACC</span><b>{RUN.accepted}</b><small>/ {RUN.total}</small></div>
        </div>
        <div className="mon-row c-cyan">
          <div className="mon-wave"><span className="mon-lbl">PLETH · REVIEWED</span><Trace kind="pleth" color="#47d4ff" rate={64} /></div>
          <div className="mon-num"><span className="mon-lbl">REV %</span><b>61</b><small>238 signed</small></div>
        </div>
        <div className="mon-row c-yellow">
          <div className="mon-wave"><span className="mon-lbl">RESP · UNREADABLE</span><Trace kind="resp" color="#f5d04c" rate={18} /></div>
          <div className="mon-num"><span className="mon-lbl">UTA</span><b>{utaClaims}</b><small>{((utaClaims / RUN.accepted) * 100).toFixed(1)}%</small></div>
        </div>

        <div className="mon-split">
          <div className="mon-tile c-red">
            <span className="mon-lbl">ABNORMAL CLAIMS</span>
            <b>{failClaims}</b>
            <small>{((failClaims / RUN.accepted) * 100).toFixed(1)}% · alarm &gt; 30%</small>
          </div>
          <div className="mon-tile c-white">
            <span className="mon-lbl">REJECTED AT INTAKE</span>
            <b>{RUN.rejected}</b>
            <small>schema / FHIR errors</small>
          </div>
          <div className="mon-tile c-cyan">
            <span className="mon-lbl">MEDIAN DECISION</span>
            <b>41<span className="unit">s</span></b>
            <small>per finding</small>
          </div>
        </div>

        <div className="mon-bars">
          <span className="mon-lbl">FINDINGS BY RULE · fail <i className="kr" /> unreadable <i className="ky" /></span>
          <div className="bars">
            {RULES.map((r) => (
              <div key={r.id} className="bar-col" title={`${r.id} ${r.title}: ${FAILS[r.id]} fail, ${UTA[r.id] ?? 0} unreadable`}>
                <div className="bar-stack">
                  <i className="by" style={{ height: `${((UTA[r.id] ?? 0) / max) * 100}%` }} />
                  <i className="br" style={{ height: `${(FAILS[r.id] / max) * 100}%` }} />
                </div>
                <span>{r.id.slice(1)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mon-alarms">
          <span className="mon-lbl">ALARMS</span>
          <ul>
            <li className="a-hi"><b>▲▲▲</b> R008 auth missing — 38 claims, 2.4× last run</li>
            <li className="a-hi"><b>▲▲▲</b> Abnormal rate 36.3% above 30% limit</li>
            <li className="a-md"><b>▲▲</b> R010 unreadable on 22 CSV claims — source has no attachments</li>
            <li className="a-lo"><b>▲</b> 9 records rejected at intake (FHIR profile)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
