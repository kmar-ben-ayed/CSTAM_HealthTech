import { useMemo, useState } from 'react';
import { RULES, counts, fmt, triage, ESI_LABEL, type Claim, type Status } from '@/data';
import { Ecg } from '@/components/Ecg';
import { Barcode } from '@/components/Barcode';

type Order = 'confirm' | 'request' | 'dismiss' | 'recheck';
interface Signed { order: Order; reason: string; at: string; hash: string }

const ORDERS: { k: Order; label: string; hint: string }[] = [
  { k: 'confirm', label: 'Confirm finding', hint: 'Hold the claim for this reason' },
  { k: 'request', label: 'Request information', hint: 'Ask the provider for the record' },
  { k: 'dismiss', label: 'Dismiss', hint: 'Reason required' },
  { k: 'recheck', label: 'Corrected — recheck', hint: 'Re-run rules after a fix' },
];

const FLAG: Record<Status, string> = { PASS: '', FAIL: 'ABN', UTA: '??', NA: 'n/a' };

function pseudoHash(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function Chart({ claim, reviewer, onDischarge }: { claim: Claim; reviewer: string; onDischarge: () => void }) {
  const abnormal = RULES.filter((r) => ['FAIL', 'UTA'].includes(claim.findings[r.id].status));
  const [sel, setSel] = useState(abnormal[0]?.id ?? 'R001');
  const [signed, setSigned] = useState<Record<string, Signed>>({});
  const [order, setOrder] = useState<Order | null>(null);
  const [reason, setReason] = useState('');
  const c = counts(claim);
  const esi = triage(claim);
  const rule = RULES.find((r) => r.id === sel)!;
  const f = claim.findings[sel];
  const done = signed[sel];
  const outstanding = abnormal.filter((r) => !signed[r.id]).length;
  const linesTotal = useMemo(() => claim.lines.reduce((a, l) => a + l.net, 0), [claim]);

  const pick = (id: string) => { setSel(id); setOrder(null); setReason(''); };
  const sign = () => {
    if (!order || (order === 'dismiss' && !reason.trim())) return;
    const at = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    setSigned((s) => ({ ...s, [sel]: { order, reason, at, hash: pseudoHash(claim.id + sel + order + reason + at) } }));
    const next = abnormal.find((r) => r.id !== sel && !signed[r.id]);
    if (next) pick(next.id);
  };

  return (
    <div className="chart">
      {/* ── Specimen label + summary ─────────────────────────── */}
      <section className="chart-head">
        <div className="specimen">
          <div className="specimen-top">
            <span className={`esi esi-${esi}`}>{esi}</span>
            <span className="specimen-esi">ESI {esi} · {ESI_LABEL[esi]}</span>
            <span className="specimen-src">{claim.source}</span>
          </div>
          <div className="specimen-id">{claim.id}</div>
          <div className="specimen-grid">
            <span>Member</span><b>{claim.member}</b>
            <span>Provider</span><b>{claim.provider}</b>
            <span>Policy</span><b>{claim.policy}</b>
            <span>Dx</span><b>{claim.dx}</b>
            <span>DOS</span><b>{claim.lines[0].date}</b>
            <span>Rec’d</span><b>{claim.submitted}</b>
          </div>
          <div className="specimen-bar"><Barcode value={claim.id} /></div>
        </div>

        <div className="complaint">
          <div className="eyebrow">Chief complaint</div>
          <h1>{claim.complaint}</h1>
          <div className="tally">
            <span><b className="t-fail">{c.fail}</b> abnormal</span>
            <span><b className="t-uta">{c.uta}</b> unreadable</span>
            <span><b>{c.pass}</b> normal</span>
            <span><b className="t-na">{c.na}</b> not applicable</span>
            <span className="tally-amt">SAR <b>{fmt(claim.amount)}</b></span>
          </div>
        </div>
      </section>

      {/* ── Rhythm strip ─────────────────────────────────────── */}
      <section className="strip">
        <div className="strip-hd">
          <span>Lead II · rule rhythm</span>
          <span className="strip-legend">
            <i className="lg lg-pass" /> normal <i className="lg lg-fail" /> abnormal <i className="lg lg-uta" /> unreadable <i className="lg lg-na" /> no lead
          </span>
          <span className="strip-speed">15 rules · v1.0.0 · 25 mm/s</span>
        </div>
        <Ecg claim={claim} selected={sel} onSelect={pick} />
      </section>

      {/* ── Panel + order pad ────────────────────────────────── */}
      <section className="chart-body">
        <div className="panel">
          <div className="panel-hd">
            <h2>Claim panel</h2>
            <span>Abnormal results printed in bold, as on a lab report</span>
          </div>
          <table className="lab">
            <thead>
              <tr><th>Test</th><th>Result</th><th>Reference</th><th className="c">Flag</th><th>Sev</th></tr>
            </thead>
            <tbody>
              {RULES.map((r) => {
                const x = claim.findings[r.id];
                const ab = x.status === 'FAIL' || x.status === 'UTA';
                return (
                  <tr
                    key={r.id}
                    onClick={() => pick(r.id)}
                    className={`${ab ? 'abn' : ''} ${x.status === 'NA' ? 'na' : ''} ${r.id === sel ? 'sel' : ''}`}
                  >
                    <td><span className="rid">{r.id}</span>{r.title}</td>
                    <td className="mono">{x.result}</td>
                    <td className="ref">{r.short}</td>
                    <td className={`c flag f-${x.status}`}>{signed[r.id] ? '✓' : FLAG[x.status]}</td>
                    <td className="sev">{r.severity === 'high' ? 'H' : 'M'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="panel-hd" style={{ marginTop: 28 }}>
            <h2>Itemised services</h2>
            <span>{claim.lines.length} lines</span>
          </div>
          <table className="lab lines">
            <thead><tr><th>Line</th><th>Service</th><th>Auth</th><th className="n">Qty</th><th className="n">Unit</th><th className="n">Net</th></tr></thead>
            <tbody>
              {claim.lines.map((l) => {
                const hit = f.lines?.includes(l.id);
                return (
                  <tr key={l.id} className={hit ? 'hit' : ''}>
                    <td className="mono">{l.id}</td>
                    <td>{l.label} <span className="code">{l.code}</span></td>
                    <td className="mono">{l.auth ?? '—'}</td>
                    <td className="n mono">{l.qty}</td>
                    <td className="n mono">{fmt(l.unit)}</td>
                    <td className="n mono">{fmt(l.net)}</td>
                  </tr>
                );
              })}
              <tr className="tot">
                <td colSpan={5}>Lines total / claimed</td>
                <td className="n mono">
                  {fmt(linesTotal)} / <span className={linesTotal !== claim.amount ? 't-fail' : ''}>{fmt(claim.amount)}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Order pad */}
        <aside className="pad">
          <div className="pad-hd">
            <span className="rx">℞</span>
            <div>
              <div className="pad-title">Reviewer orders</div>
              <div className="pad-sub">{rule.id} · {rule.severity} severity</div>
            </div>
            <span className={`pad-status f-${f.status}`}>
              {f.status === 'FAIL' ? 'Abnormal' : f.status === 'UTA' ? 'Unreadable' : f.status === 'NA' ? 'No lead' : 'Normal'}
            </span>
          </div>

          <h3 className="pad-rule">{rule.title}</h3>

          {f.evidence ? (
            <dl className="evid">
              {f.evidence.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
            </dl>
          ) : (
            <p className="pad-quiet">Result <b>{f.result}</b> — within reference. No order needed.</p>
          )}

          {f.note && (
            <blockquote className="note">
              {f.note}
              <footer>{f.grounding}</footer>
            </blockquote>
          )}

          {(f.status === 'FAIL' || f.status === 'UTA') && !done && (
            <div className="orders">
              {ORDERS.map((o) => (
                <label key={o.k} className={order === o.k ? 'on' : ''}>
                  <input type="radio" name="order" checked={order === o.k} onChange={() => setOrder(o.k)} />
                  <span className="box" aria-hidden="true">{order === o.k ? '✕' : ''}</span>
                  <span>{o.label}<small>{o.hint}</small></span>
                </label>
              ))}
              <textarea
                className="ruled"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason — written to the audit chain"
              />
              <button className="btn-primary" disabled={!order || (order === 'dismiss' && !reason.trim())} onClick={sign}>
                Sign order
              </button>
            </div>
          )}

          {done && (
            <div className="signed">
              <div className="sig-order">{ORDERS.find((o) => o.k === done.order)!.label}</div>
              {done.reason && <p>“{done.reason}”</p>}
              <div className="sig-line">
                <span className="sig">{reviewer}</span>
                <span className="sig-meta">{done.at} · chain #{done.hash}</span>
              </div>
            </div>
          )}

          <div className="discharge">
            <span>{outstanding ? `${outstanding} abnormal result${outstanding > 1 ? 's' : ''} without an order` : 'All abnormal results have orders.'}</span>
            <button className="btn-outline" disabled={outstanding > 0} onClick={onDischarge}>Discharge claim →</button>
          </div>
        </aside>
      </section>
    </div>
  );
}
