import { useState, type ReactNode } from 'react';
import { CLAIMS, triage } from '@/data';
import { Chart } from '@/views/Chart';
import { Triage } from '@/views/Triage';
import { Monitor } from '@/views/Monitor';

type View = 'triage' | 'chart' | 'monitor';
const REVIEWER = 'M. Agrebi';

const NAV: { k: View; label: string; glyph: ReactNode }[] = [
  {
    k: 'triage', label: 'Triage',
    glyph: <svg viewBox="0 0 24 24"><path d="M4 5h16M4 10h16M4 15h10M4 20h6" /></svg>,
  },
  {
    k: 'chart', label: 'Chart',
    glyph: <svg viewBox="0 0 24 24"><path d="M2 13h5l2-6 3 12 2.5-9 1.5 3h6" /></svg>,
  },
  {
    k: 'monitor', label: 'Monitor',
    glyph: <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" /><path d="M8 21h8M12 17v4M6 11h3l1.5-3 2 6 1.5-3H18" /></svg>,
  },
];

export default function App() {
  const [view, setView] = useState<View>('chart');
  const [current, setCurrent] = useState(CLAIMS[0].id);
  const [discharged, setDischarged] = useState<string[]>([]);
  const claim = CLAIMS.find((c) => c.id === current)!;

  const open = (id: string) => { setCurrent(id); setView('chart'); };
  const discharge = () => {
    setDischarged((d) => [...d, current]);
    const order = [...CLAIMS].sort((a, b) => triage(a) - triage(b));
    const next = order.find((c) => c.id !== current && !discharged.includes(c.id));
    if (next) setCurrent(next.id);
  };

  return (
    <div className="shell">
      <aside className="rail">
        <div className="mark" aria-label="ClaimGuard">
          <svg viewBox="0 0 32 32"><path d="M2 18h7l3-9 4 16 3-11 2 4h9" /></svg>
        </div>
        <nav>
          {NAV.map((n) => (
            <button key={n.k} className={view === n.k ? 'on' : ''} onClick={() => setView(n.k)} aria-current={view === n.k}>
              {n.glyph}
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="rail-foot">
          <span className="badge-id">MA</span>
        </div>
      </aside>

      <div className="stage">
        <header className="topline">
          <span className="word">ClaimGuard<em>Pulse</em></span>
          <span className="crumb">
            {view === 'chart' ? <>Ward EDU-PAYER / <b>{claim.id}</b></> : view === 'triage' ? <>Ward EDU-PAYER / <b>Triage</b></> : <>Ward EDU-PAYER / <b>Batch monitor</b></>}
          </span>
          <span className="shift">
            {discharged.length > 0 && <span className="dc">{discharged.length} discharged this shift</span>}
            On duty · {REVIEWER}
          </span>
        </header>

        <main key={view} className={view === 'monitor' ? 'dark-stage' : ''}>
          {view === 'triage' && <Triage onOpen={open} current={current} />}
          {view === 'chart' && <Chart key={claim.id} claim={claim} reviewer={REVIEWER} onDischarge={discharge} />}
          {view === 'monitor' && <Monitor />}
        </main>
      </div>
    </div>
  );
}
