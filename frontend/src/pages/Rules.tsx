import { useEffect, useMemo, useState } from 'react';
import { getConfig, type ConfigPolicy, type ConfigRule } from '../api/config';

interface RulesProps {
  onNavigate?: (page: string) => void;
}

type RuleSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

interface Rule {
  id: string;
  name: string;
  severity: RuleSeverity;
  version: string;
  policyScope: string[];
  reviewerAction: string;
  source: string;
}

interface Policy {
  id: string;
  name: string;
  version: string;
  submissionWindow: string;
  currency: string;
  network: string[];
  authRequired: string[];
  docsRequired: { svc: string; doc: string }[];
  activeRules: number;
  color: string;
}

const COLORS = ['var(--accent-ink)', 'var(--status-review-ink)', 'var(--status-pass-ink)'];
const SEVERITIES = ['All severities', 'HIGH', 'MEDIUM', 'LOW'];

const SEV_STYLE: Record<RuleSeverity, { bg: string; text: string; border: string }> = {
  HIGH: { bg: 'var(--status-fail-bg)', text: 'var(--status-fail-ink)', border: 'var(--status-fail-border)' },
  MEDIUM: { bg: 'var(--status-uta-bg)', text: 'var(--status-uta-ink)', border: 'var(--status-uta-border)' },
  LOW: { bg: 'var(--status-pass-bg)', text: 'var(--status-pass-ink)', border: 'var(--status-pass-border)' },
};

function toRule(rule: ConfigRule, policyIds: string[]): Rule {
  return {
    id: rule.rule_id,
    name: rule.title,
    severity: rule.severity.toUpperCase() as RuleSeverity,
    version: `v${rule.version}`,
    policyScope: policyIds,
    reviewerAction: rule.corrective_action,
    source: rule.source || 'Configured rule catalog',
  };
}

function toPolicy(policy: ConfigPolicy, index: number, ruleCount: number): Policy {
  return {
    id: policy.policy_id,
    name: policy.policy_id.replace(/^EDU-/, 'Education '),
    version: `v${policy.version}`,
    submissionWindow: `${policy.submission_window_days} days`,
    currency: policy.currency,
    network: policy.allowed_providers,
    authRequired: policy.auth_required_services,
    docsRequired: Object.entries(policy.required_documents).map(([svc, doc]) => ({ svc, doc })),
    activeRules: ruleCount,
    color: COLORS[index % COLORS.length],
  };
}

function Drawer({ rule, onClose, onNavigate }: { rule: Rule; onClose: () => void; onNavigate?: (page: string) => void }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const severity = SEV_STYLE[rule.severity];
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.18)', zIndex: 40 }} />
      <aside style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 440, maxWidth: '100vw', background: 'var(--card-bg)', borderLeft: '1px solid var(--border)', zIndex: 50, display: 'flex', flexDirection: 'column', boxShadow: '-12px 0 40px rgba(0,0,0,0.08)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <strong style={{ color: 'var(--accent)' }}>{rule.id}</strong>
              <span style={{ borderRadius: 4, padding: '2px 8px', fontSize: '0.6875rem', fontWeight: 700, border: `1px solid ${severity.border}`, background: severity.bg, color: severity.text }}>{rule.severity}</span>
            </div>
            <h2 style={{ fontSize: '1.0625rem', color: 'var(--text-primary)' }}>{rule.name}</h2>
          </div>
          <button onClick={onClose} aria-label="Close rule details" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: '1.25rem' }}>×</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <section><Label>Configuration</Label><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
            <Value label="Version" value={rule.version} /><Value label="Policies" value={rule.policyScope.join(' · ')} /><Value label="Source" value={rule.source} />
          </div></section>
          <section><Label>Reviewer action</Label><p style={{ background: 'var(--status-uta-bg)', border: '1px solid var(--status-uta-border)', borderRadius: 6, padding: '10px 12px', lineHeight: 1.6 }}>{rule.reviewerAction}</p></section>
        </div>
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
          <button onClick={() => onNavigate?.('claims')} style={{ flex: 1, padding: '8px 14px' }}>View affected claims</button>
          <button onClick={onClose} style={{ flex: 1, padding: '8px 14px' }}>Close</button>
        </div>
      </aside>
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{children}</div>;
}

function Value({ label, value }: { label: string; value: string }) {
  return <div><Label>{label}</Label><div style={{ fontSize: '0.8125rem' }}>{value}</div></div>;
}

export default function Rules({ onNavigate }: RulesProps) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('All severities');
  const [policy, setPolicy] = useState('All policies');
  const [selectedRule, setSelectedRule] = useState<Rule | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getConfig<ConfigRule[]>('rules.json', controller.signal),
      getConfig<Record<string, ConfigPolicy>>('policies.json', controller.signal),
    ]).then(([configuredRules, configuredPolicies]) => {
      const policyIds = Object.keys(configuredPolicies);
      setRules(configuredRules.map(rule => toRule(rule, policyIds)));
      setPolicies(Object.values(configuredPolicies).map((item, index) => toPolicy(item, index, configuredRules.length)));
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load policy configuration.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);

  const filtered = useMemo(() => rules.filter(rule => {
    const query = search.toLowerCase();
    return (!query || `${rule.id} ${rule.name} ${rule.reviewerAction}`.toLowerCase().includes(query))
      && (severity === 'All severities' || rule.severity === severity)
      && (policy === 'All policies' || rule.policyScope.includes(policy));
  }), [policy, rules, search, severity]);

  const differingWindow = compareMode && policies.length > 1 && new Set(policies.map(item => item.submissionWindow)).size > 1;

  if (loading) return <div className="page-shell"><p>Loading policy configuration…</p></div>;
  if (error) return <div className="page-shell"><p style={{ color: 'var(--status-fail-ink)' }}>Unable to load policy configuration: {error}</p></div>;

  return (
    <div className="page-shell rules-page">
      <div className="rules-page-header" style={{ marginBottom: 28, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20 }}><div><span className="sc-eyebrow">Policy library</span><h1 style={{ fontSize: '1.5rem', margin: '12px 0 4px' }}>Policy &amp; Rules</h1><p>Review the policies, validation rules, versions, and evidence requirements used by ClaimGuard.</p></div><div className="rules-header-meta"><div><span>Ruleset version</span><strong>{policies[0]?.version || '—'}</strong></div><div><span>Configured rules</span><strong>{rules.length}</strong></div></div></div>
      <div className="rules-panel" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 24 }}>
        <div className="rules-panel-heading" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><h2>Policy Matrix</h2><p>Policy-specific constraints applied during claim validation.</p></div><button onClick={() => setCompareMode(value => !value)}>{compareMode ? 'Show all fields' : 'Compare policies'}</button></div>
        {compareMode && <div className="rules-compare-banner">{differingWindow ? 'Differences between policies are highlighted below.' : 'Policies are identical on the compared fields.'}</div>}
        {policies.length === 0 ? <p style={{ padding: 20 }}>No policies configured.</p> : <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {policies.map(item => <div className="rules-policy-card" key={item.id} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <div className="rules-policy-heading" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}><div><strong style={{ color: item.color }}>{item.id}</strong><div>{item.name} · {item.version}</div></div><span>{item.activeRules} rules</span></div>
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className={differingWindow ? 'rules-diff-field' : ''}><Label>Submission window</Label><strong>{item.submissionWindow}</strong></div>
              <div><Label>Currency</Label><strong>{item.currency}</strong></div>
              <div><Label>Network</Label><div>{item.network.join(' · ') || 'None configured'}</div></div>
              <div><Label>Authorization required</Label><div>{item.authRequired.join(' · ') || 'None configured'}</div></div>
              <div><Label>Documentation required</Label>{item.docsRequired.length ? item.docsRequired.map(entry => <div key={entry.svc}>{entry.svc} → {entry.doc}</div>) : <div>None configured</div>}</div>
            </div>
          </div>)}
        </div>}
      </div>
      <div className="rules-panel" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <div className="rules-panel-heading rules-catalog-heading" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}><div><h2>Validation Rules</h2><p>Configured deterministic checks. Showing {filtered.length} of {rules.length} rules.</p></div><span className="rules-active-count">{rules.length} configured</span></div><div className="rules-filters"><input placeholder="Search rules…" value={search} onChange={event => setSearch(event.target.value)} /><select value={severity} onChange={event => setSeverity(event.target.value)}>{SEVERITIES.map(item => <option key={item}>{item}</option>)}</select><select value={policy} onChange={event => setPolicy(event.target.value)}><option>All policies</option>{policies.map(item => <option key={item.id}>{item.id}</option>)}</select></div></div>
        <div style={{ overflowX: 'auto' }}><table className="data-table rules-table" style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th>ID</th><th>Rule</th><th>Severity</th><th>Version</th><th>Policies</th></tr></thead><tbody>{filtered.map(rule => <tr key={rule.id} onClick={() => setSelectedRule(rule)} style={{ cursor: 'pointer' }}><td>{rule.id}</td><td><strong>{rule.name}</strong></td><td><span className="rules-severity" style={{ color: SEV_STYLE[rule.severity].text }}>{rule.severity}</span></td><td>{rule.version}</td><td>{rule.policyScope.join(' · ')}</td></tr>)}</tbody></table></div>
      </div>
      {selectedRule && <Drawer rule={selectedRule} onClose={() => setSelectedRule(null)} onNavigate={onNavigate} />}
    </div>
  );
}
