import { RULES, CLAIMS, triage, ESI_LABEL, fmt, type Claim } from '@/data';

function Rhythm({ c }: { c: Claim }) {
  return (
    <span className="mini" aria-label="rule rhythm">
      {RULES.map((r) => (
        <i key={r.id} className={`m-${c.findings[r.id].status}`} title={`${r.id} ${c.findings[r.id].status}`} />
      ))}
    </span>
  );
}

export function Triage({ onOpen, current }: { onOpen: (id: string) => void; current: string }) {
  const rows = [...CLAIMS].sort((a, b) => triage(a) - triage(b) || b.daysWaiting - a.daysWaiting);
  const census = [1, 2, 3, 4, 5].map((l) => rows.filter((c) => triage(c) === l).length);

  return (
    <div className="triage">
      <header className="triage-hd">
        <div>
          <div className="eyebrow">Claims department · day shift</div>
          <h1>Triage board</h1>
        </div>
        <div className="census">
          <div className="census-bar">
            {census.map((n, i) => n > 0 && (
              <span key={i} className={`esi-fill-${i + 1}`} style={{ flexGrow: n }} title={`ESI ${i + 1}: ${n}`}>{n}</span>
            ))}
          </div>
          <div className="census-key">
            {[1, 2, 3, 4, 5].map((l) => (
              <span key={l}><i className={`esi-fill-${l}`} />{l} {ESI_LABEL[l]}</span>
            ))}
          </div>
        </div>
      </header>

      <table className="board">
        <thead>
          <tr>
            <th>ESI</th><th>Claim</th><th>Chief complaint</th><th>Rhythm</th><th>Provider</th><th className="n">SAR</th><th className="n">Waiting</th><th>Src</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const l = triage(c);
            return (
              <tr key={c.id} onClick={() => onOpen(c.id)} className={c.id === current ? 'cur' : ''}>
                <td><span className={`esi esi-${l}`}>{l}</span></td>
                <td className="mono strong">{c.id}</td>
                <td className="cc">{c.complaint}</td>
                <td><Rhythm c={c} /></td>
                <td className="mono">{c.provider}</td>
                <td className="n mono">{fmt(c.amount)}</td>
                <td className={`n mono ${c.daysWaiting >= 5 ? 'late' : ''}`}>{c.daysWaiting ? `${c.daysWaiting}d` : 'new'}</td>
                <td className="mono dim">{c.source}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
