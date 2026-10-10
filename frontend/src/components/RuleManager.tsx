// Rule management for the Admin Panel.
//
// Rules are not edited as raw JSON any more: an admin writes a rule in
// English, the backend drafts an implementation, checks it against an
// independent reading, asks the author about disagreements, and the rule goes
// live only after every check passes (and, if required, the author confirms
// the plain-English readback).

import React, { useCallback, useEffect, useId, useState } from 'react';
import {
  OUTCOMES,
  RUNNING_STATES,
  answerQuestion,
  cancelDraft,
  confirmDraft,
  deactivateRule,
  getDraft,
  getRule,
  listRules,
  submitDraft,
  type CheckReport,
  type Draft,
  type DraftState,
  type Outcome,
  type Question,
  type RuleDetail,
  type RuleSummary,
  type RuleText,
} from '../api/rules';

type Selection =
  | { kind: 'none' }
  | { kind: 'rule'; ruleId: string }
  | { kind: 'new' }
  | { kind: 'revise'; ruleId: string; initial: RuleText }
  | { kind: 'draft'; draftId: string };

const POLL_MS = 2000;

// ------------------------------------------------------------------ styles

const CARD: React.CSSProperties = {
  background: 'var(--card-bg)',
  border: '1px solid var(--card-border)',
  borderRadius: 10,
  padding: '14px 16px',
  marginBottom: 14,
};
const LABEL: React.CSSProperties = {
  display: 'block',
  fontSize: '0.72rem',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: 5,
  textTransform: 'uppercase',
  letterSpacing: '0.055em',
};
const INPUT: React.CSSProperties = {
  width: '100%',
  padding: '9px 13px',
  borderRadius: 8,
  border: '1px solid var(--card-border)',
  background: 'var(--canvas-bg)',
  color: 'var(--text-primary)',
  fontSize: '0.875rem',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};
const BUTTON: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--card-border)',
  borderRadius: 8,
  padding: '7px 14px',
  fontSize: '0.82rem',
  fontWeight: 600,
  color: 'var(--text-primary)',
  cursor: 'pointer',
};
const PRIMARY: React.CSSProperties = { ...BUTTON, background: 'var(--accent)', border: '1px solid var(--accent)', color: 'var(--accent-contrast)' };
const DANGER: React.CSSProperties = { ...BUTTON, background: 'var(--status-fail-bg)', border: '1px solid var(--status-fail-border)', color: 'var(--status-fail-ink)' };
const PRE: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  fontSize: '0.8rem',
  lineHeight: 1.55,
  background: 'var(--canvas-bg)',
  border: '1px solid var(--card-border)',
  borderRadius: 8,
  padding: '10px 12px',
  margin: 0,
  color: 'var(--text-primary)',
};

const OUTCOME_TONE: Record<string, string> = {
  PASS: 'pass',
  FAIL: 'fail',
  UNABLE_TO_ASSESS: 'uta',
  NOT_APPLICABLE: 'na',
};

const STATE_LABEL: Record<DraftState, { text: string; tone: string }> = {
  queued: { text: 'Queued', tone: 'na' },
  drafting: { text: 'Drafting…', tone: 'review' },
  checking: { text: 'Checking…', tone: 'review' },
  awaiting_author: { text: 'Needs your answer', tone: 'uta' },
  awaiting_confirmation: { text: 'Ready: review and confirm', tone: 'review' },
  active: { text: 'Active', tone: 'pass' },
  rejected: { text: 'Rejected', tone: 'fail' },
  cancelled: { text: 'Cancelled', tone: 'na' },
};

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 9px',
      borderRadius: 999,
      fontSize: '0.72rem',
      fontWeight: 700,
      background: `var(--status-${tone}-bg)`,
      color: `var(--status-${tone}-ink)`,
      border: `1px solid var(--status-${tone}-border)`,
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

const OutcomePill = ({ outcome }: { outcome: string | null }) =>
  outcome ? <Pill tone={OUTCOME_TONE[outcome] ?? 'na'}>{outcome}</Pill> : <Pill tone="na">no answer</Pill>;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={CARD}>
      <div style={{ ...LABEL, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

// ------------------------------------------------------------- main panel

export default function RuleManager() {
  const [rules, setRules] = useState<RuleSummary[]>([]);
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listRules().then(setRules).catch(e => setError(e.message));
  }, []);

  useEffect(refresh, [refresh]);

  const selectedRuleId = selection.kind === 'rule' || selection.kind === 'revise' ? selection.ruleId : null;

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ width: 260, borderRight: '1px solid var(--card-border)', display: 'flex', flexDirection: 'column', background: 'var(--canvas-bg)' }}>
        <div style={{ padding: '13px 15px', borderBottom: '1px solid var(--card-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Rules ({rules.length})</span>
          <button style={PRIMARY} onClick={() => setSelection({ kind: 'new' })}>+ New rule</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
          {rules.map(rule => (
            <button
              key={rule.rule_id}
              onClick={() => setSelection({ kind: 'rule', ruleId: rule.rule_id })}
              style={{
                width: '100%', textAlign: 'left', padding: '9px 11px', borderRadius: 7, marginBottom: 3, cursor: 'pointer',
                fontFamily: 'inherit', fontSize: '0.83rem',
                background: selectedRuleId === rule.rule_id ? 'var(--accent-subtle)' : 'transparent',
                border: `1px solid ${selectedRuleId === rule.rule_id ? 'var(--accent)' : 'transparent'}`,
                color: 'var(--text-primary)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                <strong>{rule.rule_id}</strong>
                <Pill tone={rule.status === 'active' ? 'pass' : 'na'}>{rule.status}</Pill>
              </div>
              <div style={{ color: 'var(--text-secondary)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rule.title}</div>
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', minWidth: 0 }}>
        {error && <div style={{ ...CARD, borderColor: 'var(--status-fail-border)', color: 'var(--status-fail-ink)' }}>{error}</div>}
        {selection.kind === 'none' && (
          <p style={{ color: 'var(--text-tertiary)' }}>Select a rule, or write a new one in plain English.</p>
        )}
        {selection.kind === 'rule' && (
          <RuleView
            key={selection.ruleId}
            ruleId={selection.ruleId}
            openDraftId={rules.find(rule => rule.rule_id === selection.ruleId)?.open_draft_id ?? null}
            onRevise={initial => setSelection({ kind: 'revise', ruleId: selection.ruleId, initial })}
            onOpenDraft={draftId => setSelection({ kind: 'draft', draftId })}
            onChanged={refresh}
          />
        )}
        {(selection.kind === 'new' || selection.kind === 'revise') && (
          <RuleForm
            key={selection.kind === 'revise' ? selection.ruleId : 'new'}
            ruleId={selection.kind === 'revise' ? selection.ruleId : undefined}
            initial={selection.kind === 'revise' ? selection.initial : undefined}
            onSubmitted={draft => { refresh(); setSelection({ kind: 'draft', draftId: draft.draft_id }); }}
          />
        )}
        {selection.kind === 'draft' && <DraftView key={selection.draftId} draftId={selection.draftId} onChanged={refresh} />}
      </div>
    </div>
  );
}

// -------------------------------------------------------------- rule view

function RuleView({ ruleId, openDraftId, onRevise, onOpenDraft, onChanged }: {
  ruleId: string;
  openDraftId: string | null;
  onRevise: (initial: RuleText) => void;
  onOpenDraft: (draftId: string) => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<RuleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getRule(ruleId).then(setDetail).catch(e => setError(e.message));
  }, [ruleId]);
  useEffect(load, [load]);

  const deactivate = () => {
    if (!window.confirm(`Stop running ${ruleId} immediately? Its history is kept and it can be drafted again.`)) return;
    deactivateRule(ruleId).then(() => { load(); onChanged(); }).catch(e => setError(e.message));
  };

  if (error) return <div style={{ color: 'var(--status-fail-ink)' }}>{error}</div>;
  if (!detail) return <div style={{ color: 'var(--text-tertiary)' }}>Loading…</div>;
  const { rule, active } = detail;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{rule.rule_id} · {rule.title}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 3 }}>
            version {rule.version} · severity {rule.severity} · {active ? `revision ${active.revision} (${active.origin})` : 'not active'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {openDraftId
            ? <button style={BUTTON} onClick={() => onOpenDraft(openDraftId)}>Open draft in progress</button>
            : <button style={BUTTON} onClick={() => onRevise({ title: rule.title, severity: rule.severity as RuleText['severity'], logic: rule.logic, corrective_action: rule.corrective_action })}>Revise</button>}
          {active && <button style={DANGER} onClick={deactivate}>Deactivate</button>}
        </div>
      </div>
      <Section title="Rule text"><p style={{ margin: 0, fontSize: '0.875rem' }}>{rule.logic}</p></Section>
      {active
        ? <Section title="What the active implementation does"><pre style={PRE}>{active.readback}</pre></Section>
        : (
          <Section title="Status">
            <p style={{ margin: 0, fontSize: '0.875rem' }}>
              This rule is not running{detail.inactive_reason ? ` (${detail.inactive_reason})` : ''}. Use Revise to draft and check an implementation.
            </p>
          </Section>
        )}
      {detail.history.length > 0 && (
        <Section title="Activation history">
          {detail.history.map(entry => (
            <div key={entry.revision} style={{ fontSize: '0.8rem', marginBottom: 4 }}>
              r{entry.revision} · {entry.origin} · {new Date(entry.activated_at).toLocaleString()} · by {entry.activated_by}
            </div>
          ))}
        </Section>
      )}
    </>
  );
}

// -------------------------------------------------------------- rule form

const EMPTY_RULE: RuleText = { title: '', severity: 'medium', logic: '', corrective_action: '' };

function RuleForm({ ruleId, initial, onSubmitted }: { ruleId?: string; initial?: RuleText; onSubmitted: (draft: Draft) => void }) {
  const [rule, setRule] = useState<RuleText>(initial ?? EMPTY_RULE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const set = (field: keyof RuleText) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setRule({ ...rule, [field]: event.target.value });

  const submit = () => {
    setBusy(true);
    setError(null);
    submitDraft(rule, ruleId).then(onSubmitted).catch(e => setError(e.message)).finally(() => setBusy(false));
  };

  return (
    <>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 6 }}>{ruleId ? `Revise ${ruleId}` : 'New rule'}</div>
      <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginTop: 0 }}>
        Write the rule in plain English. Say what makes a claim fail, which claims it applies to, and what happens when
        information is missing. The rule id is assigned by the server.
      </p>
      <div style={{ marginBottom: 12 }}>
        <label style={LABEL} htmlFor={`${id}-title`}>Title</label>
        <input id={`${id}-title`} style={INPUT} value={rule.title} onChange={set('title')} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={LABEL} htmlFor={`${id}-severity`}>Severity</label>
        <select id={`${id}-severity`} style={INPUT} value={rule.severity} onChange={set('severity')}>
          <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
        </select>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={LABEL} htmlFor={`${id}-logic`}>Rule</label>
        <textarea id={`${id}-logic`} style={{ ...INPUT, minHeight: 120 }} value={rule.logic} onChange={set('logic')} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={LABEL} htmlFor={`${id}-action`}>Corrective action</label>
        <textarea id={`${id}-action`} style={{ ...INPUT, minHeight: 60 }} value={rule.corrective_action} onChange={set('corrective_action')} />
      </div>
      {error && <div style={{ color: 'var(--status-fail-ink)', marginBottom: 10, fontSize: '0.85rem' }}>{error}</div>}
      <button style={PRIMARY} disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Draft and check'}</button>
    </>
  );
}

// ------------------------------------------------------------- draft view

function DraftView({ draftId, onChanged }: { draftId: string; onChanged: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getDraft(draftId).then(setDraft).catch(e => setError(e.message));
  }, [draftId]);
  useEffect(load, [load]);

  const running = draft !== null && RUNNING_STATES.includes(draft.state);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, load]);

  const act = (action: Promise<Draft>) =>
    action.then(updated => { setDraft(updated); onChanged(); }).catch(e => setError(e.message));

  if (error) return <div style={{ color: 'var(--status-fail-ink)' }}>{error}</div>;
  if (!draft) return <div style={{ color: 'var(--text-tertiary)' }}>Loading…</div>;
  const label = STATE_LABEL[draft.state];
  const open = draft.questions.filter(question => question.answer === null);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{draft.rule_id} · {draft.rule.title}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 3 }}>
            {draft.kind === 'new' ? 'New rule' : 'Revision'} drafted for {draft.author} · round {draft.rounds}
          </div>
        </div>
        <Pill tone={label.tone}>{label.text}</Pill>
      </div>

      <Section title="Rule text"><p style={{ margin: 0, fontSize: '0.875rem' }}>{draft.rule.logic}</p></Section>

      {draft.state === 'rejected' && (
        <Section title="Why it was rejected"><p style={{ margin: 0, fontSize: '0.875rem' }}>{draft.outcome_reason} Nothing was activated.</p></Section>
      )}

      {open.map(question => (
        <QuestionCard key={question.question_id} question={question}
          onAnswer={answer => act(answerQuestion(draft.draft_id, question.question_id, answer))} />
      ))}

      {draft.proposal && (
        <Section title="How the drafter understood the rule">
          <p style={{ margin: '0 0 6px', fontSize: '0.875rem' }}>{draft.proposal.intent || '—'}</p>
          {draft.proposal.assumptions.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.84rem' }}>
              {draft.proposal.assumptions.map(assumption => <li key={assumption}>{assumption}</li>)}
            </ul>
          )}
        </Section>
      )}

      {draft.report && <ReportView report={draft.report} />}

      {draft.examples.length > 0 && (
        <Section title="Outcomes you confirmed (kept as permanent tests)">
          {draft.examples.map(example => (
            <div key={example.description} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.82rem', marginBottom: 4 }}>
              <OutcomePill outcome={example.expected_status} /> {example.description}
            </div>
          ))}
        </Section>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        {draft.state === 'awaiting_confirmation' && (
          <button style={PRIMARY} onClick={() => act(confirmDraft(draft.draft_id))}>I confirm the readback: activate</button>
        )}
        {!['active', 'rejected', 'cancelled'].includes(draft.state) && (
          <button style={BUTTON} onClick={() => act(cancelDraft(draft.draft_id))}>Cancel draft</button>
        )}
      </div>
    </>
  );
}

function QuestionCard({ question, onAnswer }: { question: Question; onAnswer: (answer: string) => void }) {
  const [text, setText] = useState('');
  const [showClaim, setShowClaim] = useState(false);

  if (question.kind === 'clarification' || !question.case) {
    return (
      <Section title="The drafter asks">
        <p style={{ margin: '0 0 10px', fontSize: '0.875rem' }}>{question.text}</p>
        <textarea aria-label="Your answer" style={{ ...INPUT, minHeight: 60, marginBottom: 8 }} value={text} onChange={event => setText(event.target.value)} />
        <button style={PRIMARY} disabled={!text.trim()} onClick={() => onAnswer(text)}>Send answer</button>
      </Section>
    );
  }

  const testCase = question.case;
  return (
    <Section title="Two readings disagree: what is the right outcome?">
      <p style={{ margin: '0 0 8px', fontSize: '0.875rem' }}>{testCase.description}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 10px', fontSize: '0.82rem', marginBottom: 10 }}>
        <span>Drafted rule says</span><span><OutcomePill outcome={testCase.drafted_rule_says} /></span>
        <span>Independent reading says</span>
        <span><OutcomePill outcome={testCase.independent_reading_says} /> <span style={{ color: 'var(--text-secondary)' }}>{testCase.independent_reading_reason}</span></span>
      </div>
      <button style={{ ...BUTTON, marginBottom: 10 }} onClick={() => setShowClaim(!showClaim)}>{showClaim ? 'Hide' : 'Show'} the test claim</button>
      {showClaim && <pre style={{ ...PRE, maxHeight: 260, overflow: 'auto', marginBottom: 10 }}>{JSON.stringify(testCase.claim, null, 2)}</pre>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {OUTCOMES.map((outcome: Outcome) => (
          <button key={outcome} style={BUTTON} onClick={() => onAnswer(outcome)}>{outcome}</button>
        ))}
      </div>
    </Section>
  );
}

function ReportView({ report }: { report: CheckReport }) {
  const statuses = report.impact.statuses ?? {};
  return (
    <>
      <Section title={report.passed ? 'Checks: all passed' : 'Checks'}>
        {report.checks.map(check => (
          <div key={check.name} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: '0.82rem', marginBottom: 5 }}>
            <Pill tone={check.passed ? 'pass' : 'fail'}>{check.passed ? 'passed' : 'failed'}</Pill>
            <strong>{check.name.replace(/_/g, ' ')}</strong>
            <span style={{ color: 'var(--text-secondary)' }}>{check.detail}</span>
          </div>
        ))}
      </Section>
      {report.readback && <Section title="What the rule will do (generated from the implementation)"><pre style={PRE}>{report.readback}</pre></Section>}
      {report.impact.claims ? (
        <Section title={`Impact on ${report.impact.claims} development claims`}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(statuses).map(([status, count]) => (
              <span key={status} style={{ fontSize: '0.82rem' }}><OutcomePill outcome={status} /> {count}</span>
            ))}
          </div>
        </Section>
      ) : null}
      {report.cases.length > 0 && (
        <Section title={`Generated test claims (${report.cases.length})`}>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {report.cases.map(testCase => (
              <div key={testCase.case_id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, fontSize: '0.78rem', padding: '4px 0', borderBottom: '1px solid var(--card-border)' }}>
                <span>{testCase.description}</span>
                <OutcomePill outcome={testCase.spec_status} />
                <OutcomePill outcome={testCase.oracle_status} />
              </div>
            ))}
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)', marginTop: 6 }}>Columns: drafted rule, independent reading.</div>
        </Section>
      )}
    </>
  );
}
