// Rule management for the Admin Panel.
//
// Rules are not edited as raw JSON any more: an admin writes a rule in
// English, the backend drafts an implementation and checks it in code, and the
// admin then checks the rule's outcome on generated test claims. Any outcome
// the admin corrects becomes a permanent test and the rule is drafted again;
// it goes live only when the admin confirms.

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import ShieldLoader from './ShieldLoader';
import {
  OUTCOMES,
  RUNNING_STATES,
  answerQuestion,
  cancelDraft,
  confirmDraft,
  correctDraft,
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

/** What each outcome means, in words an admin can decide on. */
const OUTCOME_INFO: Record<string, { label: string; hint: string; tone: string }> = {
  PASS: { label: 'Pass', hint: 'The claim meets this rule.', tone: 'pass' },
  FAIL: { label: 'Fail', hint: 'The claim breaks this rule.', tone: 'fail' },
  UNABLE_TO_ASSESS: { label: 'Unable to assess', hint: 'Information the rule needs is missing.', tone: 'unable' },
  NOT_APPLICABLE: { label: 'Not applicable', hint: "The rule doesn't apply to this claim.", tone: 'na' },
};
const outcomeLabel = (outcome: string | null | undefined) => (outcome ? OUTCOME_INFO[outcome]?.label ?? outcome : 'No answer');

function Outcome({ outcome }: { outcome: string | null | undefined }) {
  const tone = outcome ? OUTCOME_INFO[outcome]?.tone ?? 'na' : 'na';
  return <span className={`ad-outcome is-${tone}`}>{outcomeLabel(outcome)}</span>;
}

const STEPS = ['Drafting', 'Your answers', 'Check outcomes', 'Active'];
function stepOf(state: DraftState): number {
  if (state === 'awaiting_author') return 1;
  if (state === 'awaiting_confirmation') return 2;
  if (state === 'active') return 3;
  return 0;
}

const STATE_TEXT: Record<DraftState, string> = {
  queued: 'Queued',
  drafting: 'Drafting',
  checking: 'Checking',
  awaiting_author: 'Needs your answer',
  awaiting_confirmation: 'Ready for your check',
  active: 'Active',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

// ------------------------------------------------------------- main panel

export default function RuleManager() {
  const [rules, setRules] = useState<RuleSummary[] | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    listRules().then(setRules).catch(e => setError(e.message));
  }, []);
  useEffect(refresh, [refresh]);

  // A new selection starts at the top of the editor, not wherever the last one was scrolled to.
  const select = (next: Selection) => {
    setSelection(next);
    editorRef.current?.scrollTo({ top: 0 });
  };

  const selectedRuleId = selection.kind === 'rule' || selection.kind === 'revise' ? selection.ruleId : null;
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (rules ?? []).filter(rule => !needle || rule.rule_id.toLowerCase().includes(needle) || rule.title.toLowerCase().includes(needle));
  }, [rules, query]);

  return (
    <div className="ad-workspace">
      <aside className="ad-list" aria-label="Rules">
        <div className="ad-list-head">
          <span>Rules {rules ? `(${rules.length})` : ''}</span>
          <button type="button" className="ad-btn is-primary is-small" onClick={() => select({ kind: 'new' })}>New rule</button>
        </div>
        <label className="ad-search">
          <span className="visually-hidden">Find a rule</span>
          <input type="search" placeholder="Find by ID or title" value={query} onChange={event => setQuery(event.target.value)} />
        </label>
        <div className="ad-list-body">
          {!rules ? (
            <p className="ad-muted">Loading rules…</p>
          ) : shown.length === 0 ? (
            <p className="ad-muted">{query ? 'No rule matches.' : 'No rules yet.'}</p>
          ) : shown.map(rule => (
            <button
              key={rule.rule_id}
              type="button"
              className="ad-item"
              aria-current={selectedRuleId === rule.rule_id || undefined}
              onClick={() => select({ kind: 'rule', ruleId: rule.rule_id })}
            >
              <span className="ad-item-top">
                <span className="ad-mono">{rule.rule_id}</span>
                <span className={`ad-state is-${rule.status === 'active' ? 'pass' : 'na'}`}>{rule.status === 'active' ? 'Active' : 'Inactive'}</span>
              </span>
              <span className="ad-item-sub">{rule.title}</span>
              {rule.open_draft_id && <span className="ad-item-flag">Draft in progress</span>}
            </button>
          ))}
        </div>
      </aside>

      <div className="ad-editor" ref={editorRef}>
        {error && <p className="ad-error" role="alert">{error}</p>}
        {selection.kind === 'none' && (
          <div className="ad-blank">
            <p>Select a rule to see what it does, or write a new one in plain English.</p>
            <button type="button" className="ad-btn is-primary" onClick={() => select({ kind: 'new' })}>New rule</button>
          </div>
        )}
        {selection.kind === 'rule' && (
          <RuleView
            key={selection.ruleId}
            ruleId={selection.ruleId}
            openDraftId={rules?.find(rule => rule.rule_id === selection.ruleId)?.open_draft_id ?? null}
            onRevise={initial => select({ kind: 'revise', ruleId: selection.ruleId, initial })}
            onOpenDraft={draftId => select({ kind: 'draft', draftId })}
            onChanged={refresh}
          />
        )}
        {(selection.kind === 'new' || selection.kind === 'revise') && (
          <RuleForm
            key={selection.kind === 'revise' ? selection.ruleId : 'new'}
            ruleId={selection.kind === 'revise' ? selection.ruleId : undefined}
            initial={selection.kind === 'revise' ? selection.initial : undefined}
            onSubmitted={draft => { refresh(); select({ kind: 'draft', draftId: draft.draft_id }); }}
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

  if (error) return <p className="ad-error" role="alert">{error}</p>;
  if (!detail) return <ShieldLoader label="Loading the rule…" inline />;
  const { rule, active } = detail;

  return (
    <>
      <header className="ad-editor-head">
        <div>
          <h2><span className="ad-mono">{rule.rule_id}</span> {rule.title}</h2>
          <p className="ad-meta">
            Severity {rule.severity} · version {rule.version} · {active ? `running revision ${active.revision} (${active.origin})` : 'not running'}
          </p>
        </div>
        <div className="ad-actions">
          {openDraftId
            ? <button type="button" className="ad-btn is-primary" onClick={() => onOpenDraft(openDraftId)}>Open draft in progress</button>
            : <button type="button" className="ad-btn" onClick={() => onRevise({ title: rule.title, severity: rule.severity as RuleText['severity'], logic: rule.logic, corrective_action: rule.corrective_action })}>Revise</button>}
          {active && <button type="button" className="ad-btn is-danger" onClick={deactivate}>Deactivate</button>}
        </div>
      </header>

      <section className="ad-section">
        <h3>Rule</h3>
        <p className="ad-prose">{rule.logic}</p>
        {rule.corrective_action && <p className="ad-prose ad-muted">Corrective action: {rule.corrective_action}</p>}
      </section>
      {active ? (
        <section className="ad-section">
          <h3>What the running implementation does</h3>
          <pre className="ad-pre">{active.readback}</pre>
        </section>
      ) : (
        <section className="ad-section">
          <h3>Status</h3>
          <p className="ad-prose">
            This rule is not running{detail.inactive_reason ? ` (${detail.inactive_reason})` : ''}. Use Revise to draft and check an implementation.
          </p>
        </section>
      )}
      {detail.history.length > 0 && (
        <details className="ad-fold">
          <summary>Activation history ({detail.history.length})</summary>
          <ul className="ad-history">
            {detail.history.map(entry => (
              <li key={entry.revision}>
                <span className="ad-mono">r{entry.revision}</span> {entry.origin} · {new Date(entry.activated_at).toLocaleString('en-GB')} · by {entry.activated_by}
              </li>
            ))}
          </ul>
        </details>
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
  // The server requires all three; a corrective action shorter than 3 characters is rejected.
  const ready = rule.title.trim() && rule.logic.trim() && rule.corrective_action.trim().length >= 3;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    submitDraft(rule, ruleId).then(onSubmitted).catch(e => setError(e.message)).finally(() => setBusy(false));
  };

  return (
    <form onSubmit={submit}>
      <header className="ad-editor-head">
        <div>
          <h2>{ruleId ? <>Revise <span className="ad-mono">{ruleId}</span></> : 'New rule'}</h2>
          <p className="ad-meta">
            Write the rule in plain English: what makes a claim fail, which claims it applies to, and what happens when
            information is missing. The server assigns the rule ID.
          </p>
        </div>
      </header>
      <div className="ad-form-grid">
        <label className="ad-field">
          <span>Title</span>
          <input id={`${id}-title`} value={rule.title} onChange={set('title')} required autoFocus={!ruleId} />
        </label>
        <label className="ad-field">
          <span>Severity</span>
          <select id={`${id}-severity`} value={rule.severity} onChange={set('severity')}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </select>
        </label>
      </div>
      <label className="ad-field">
        <span>Rule</span>
        <textarea id={`${id}-logic`} rows={6} value={rule.logic} onChange={set('logic')} required
          placeholder="Example: For services listed as needing authorization, the claim fails when no authorization reference is given. If the service list is missing, the rule cannot be assessed." />
      </label>
      <label className="ad-field">
        <span>Corrective action</span>
        <textarea id={`${id}-action`} rows={3} value={rule.corrective_action} onChange={set('corrective_action')} required minLength={3}
          aria-describedby={`${id}-action-hint`}
          placeholder="Example: Add the authorization reference for the imaging line and resubmit the claim." />
        <em id={`${id}-action-hint`}>What the provider must do to fix a claim that fails this rule. Shown to reviewers with every failure.</em>
      </label>
      {error && <p className="ad-error" role="alert">{error}</p>}
      <div className="ad-bar">
        <span className="ad-muted">The drafter will ask you about anything unclear before the rule can run.</span>
        <button type="submit" className="ad-btn is-primary" disabled={busy || !ready}>{busy ? 'Submitting…' : 'Draft and check'}</button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------- draft view

function DraftView({ draftId, onChanged }: { draftId: string; onChanged: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const act = (action: () => Promise<Draft>) => {
    setBusy(true);
    setError(null);
    return action()
      .then(updated => { setDraft(updated); onChanged(); })
      .catch(e => setError(e.message))
      .finally(() => setBusy(false));
  };

  if (!draft) return error ? <p className="ad-error" role="alert">{error}</p> : <ShieldLoader label="Loading the draft…" inline />;
  const open = draft.questions.filter(question => question.answer === null);
  const step = stepOf(draft.state);
  const ended = draft.state === 'rejected' || draft.state === 'cancelled';

  return (
    <>
      <header className="ad-editor-head">
        <div>
          <h2><span className="ad-mono">{draft.rule_id}</span> {draft.rule.title}</h2>
          <p className="ad-meta">
            {draft.kind === 'new' ? 'New rule' : 'Revision'} by {draft.author} · round {draft.rounds} · <strong>{STATE_TEXT[draft.state]}</strong>
          </p>
        </div>
      </header>

      {!ended && (
        <ol className="ad-steps" aria-label="Progress">
          {STEPS.map((label, index) => (
            <li key={label} className={index < step || draft.state === 'active' ? 'is-done' : index === step ? 'is-current' : ''} aria-current={index === step ? 'step' : undefined}>
              <span className="ad-step-n">{index + 1}</span>{label}
            </li>
          ))}
        </ol>
      )}

      {error && <p className="ad-error" role="alert">{error}</p>}

      {running && (
        <div className="ad-callout">
          <ShieldLoader label={draft.state === 'checking' ? 'Checking the drafted rule against test claims…' : 'Drafting an implementation of the rule…'} inline />
          <p className="ad-muted">This page updates by itself. It can take a minute.</p>
        </div>
      )}

      {draft.state === 'rejected' && (
        <section className="ad-callout is-fail">
          <h3>Rejected</h3>
          <p className="ad-prose">{draft.outcome_reason} Nothing was activated.</p>
        </section>
      )}
      {draft.state === 'cancelled' && <p className="ad-callout ad-muted">This draft was cancelled. Nothing was activated.</p>}
      {draft.state === 'active' && <p className="ad-callout is-pass">This rule is now running on new claims.</p>}

      {open.length > 0 && <QuestionFlow questions={open} busy={busy} onAnswer={(questionId, answer) => act(() => answerQuestion(draft.draft_id, questionId, answer))} />}

      <section className="ad-section">
        <h3>Rule</h3>
        <p className="ad-prose">{draft.rule.logic}</p>
      </section>

      {draft.author_answers.length > 0 && (
        <details className="ad-fold">
          <summary>Your earlier answers ({draft.author_answers.length})</summary>
          <dl className="ad-answers">
            {draft.author_answers.map((entry, index) => (
              <div key={index}><dt>{entry.question}</dt><dd>{entry.answer}</dd></div>
            ))}
          </dl>
        </details>
      )}

      {draft.proposal && (
        <details className="ad-fold" open={draft.state === 'awaiting_confirmation'}>
          <summary>How the drafter understood the rule</summary>
          <p className="ad-prose">{draft.proposal.intent || '—'}</p>
          {draft.proposal.assumptions.length > 0 && (
            <ul className="ad-list-plain">{draft.proposal.assumptions.map(assumption => <li key={assumption}>{assumption}</li>)}</ul>
          )}
        </details>
      )}

      {draft.report && (
        <ReportView
          report={draft.report}
          onCorrect={draft.state === 'awaiting_confirmation' ? corrections => act(() => correctDraft(draft.draft_id, corrections)) : undefined}
          busy={busy}
        />
      )}

      {draft.examples.length > 0 && (
        <details className="ad-fold">
          <summary>Outcomes you set, kept as permanent tests ({draft.examples.length})</summary>
          <ul className="ad-cases">
            {draft.examples.map(example => (
              <li key={example.description}><span>{example.description}</span><Outcome outcome={example.expected_status} /></li>
            ))}
          </ul>
        </details>
      )}

      {!['active', 'rejected', 'cancelled'].includes(draft.state) && (
        <div className="ad-bar is-sticky">
          <button type="button" className="ad-btn" disabled={busy} onClick={() => {
            if (window.confirm('Cancel this draft? Nothing will be activated.')) act(() => cancelDraft(draft.draft_id));
          }}>Cancel draft</button>
          {draft.state === 'awaiting_confirmation' && (
            <button type="button" className="ad-btn is-primary" disabled={busy} onClick={() => act(() => confirmDraft(draft.draft_id))}>
              {busy ? 'Activating…' : 'Outcomes checked: activate the rule'}
            </button>
          )}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------- questions

/** Open questions one at a time, so the admin always knows how many are left. */
function QuestionFlow({ questions, busy, onAnswer }: {
  questions: Question[];
  busy: boolean;
  onAnswer: (questionId: string, answer: string) => Promise<void>;
}) {
  const [index, setIndex] = useState(0);
  const current = questions[Math.min(index, questions.length - 1)];
  // Answering removes the question from the list; stay on the same position.
  useEffect(() => { if (index > questions.length - 1) setIndex(Math.max(0, questions.length - 1)); }, [questions.length, index]);

  return (
    <section className="ad-question" aria-labelledby="ad-question-title">
      <div className="ad-question-head">
        <h3 id="ad-question-title">The drafter needs your answer</h3>
        <span className="ad-question-count">
          Question {Math.min(index, questions.length - 1) + 1} of {questions.length}
        </span>
      </div>
      <QuestionCard key={current.question_id} question={current} busy={busy} onAnswer={answer => onAnswer(current.question_id, answer)} />
      {questions.length > 1 && (
        <div className="ad-question-nav">
          <button type="button" className="ad-link" disabled={index === 0} onClick={() => setIndex(index - 1)}>Previous question</button>
          <button type="button" className="ad-link" disabled={index >= questions.length - 1} onClick={() => setIndex(index + 1)}>Skip for now</button>
        </div>
      )}
    </section>
  );
}

function OutcomeChoices({ options, busy, highlight, onPick }: {
  options: string[];
  busy: boolean;
  /** Outcome -> who chose it, shown under that option. */
  highlight?: Record<string, string>;
  onPick: (outcome: string) => void;
}) {
  // Keys 1-4 pick an outcome, unless the admin is typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (busy || event.altKey || event.ctrlKey || event.metaKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const pick = options[Number(event.key) - 1];
      if (pick) { event.preventDefault(); onPick(pick); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [options, busy, onPick]);

  return (
    <div className="ad-choices" role="group" aria-label="Choose the right outcome">
      {options.map((outcome, index) => {
        const info = OUTCOME_INFO[outcome];
        return (
          <button key={outcome} type="button" className={`ad-choice is-${info?.tone ?? 'na'}`} disabled={busy} onClick={() => onPick(outcome)}>
            <span className="ad-choice-key" aria-hidden="true">{index + 1}</span>
            <span className="ad-choice-text">
              <strong>{info?.label ?? outcome}</strong>
              <span>{info?.hint}</span>
              {highlight?.[outcome] && <em>{highlight[outcome]}</em>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function QuestionCard({ question, busy, onAnswer }: { question: Question; busy: boolean; onAnswer: (answer: string) => void }) {
  const [text, setText] = useState('');
  const options = question.options ?? [];
  const ownWords = (
    <form className="ad-own" onSubmit={event => { event.preventDefault(); if (text.trim()) onAnswer(text.trim()); }}>
      <label className="ad-field">
        <span>{options.length ? 'Or answer in your own words' : 'Your answer'}</span>
        <textarea rows={2} value={text} onChange={event => setText(event.target.value)} />
      </label>
      <button type="submit" className={`ad-btn${options.length ? '' : ' is-primary'}`} disabled={busy || !text.trim()}>
        {busy ? 'Sending…' : 'Send answer'}
      </button>
    </form>
  );

  // A test claim where two readings of the rule disagree: the admin picks the right outcome.
  if (question.case) {
    const testCase = question.case;
    const highlight: Record<string, string> = {};
    if (testCase.drafts_say) {
      for (const [outcome, n] of Object.entries(testCase.drafts_say)) highlight[outcome] = `${n} draft${n === 1 ? '' : 's'} chose this`;
    } else {
      if (testCase.drafted_rule_says) highlight[testCase.drafted_rule_says] = 'The drafted rule says this';
      if (testCase.independent_reading_says) {
        highlight[testCase.independent_reading_says] = highlight[testCase.independent_reading_says]
          ? 'Both readings say this'
          : 'The second reading says this';
      }
    }
    const options = testCase.options?.length ? testCase.options : OUTCOMES;
    return (
      <>
        <p className="ad-prose"><strong>{question.text || 'What should the rule decide for this claim?'}</strong></p>
        <p className="ad-prose">{testCase.description}</p>
        {testCase.independent_reading_reason && (
          <p className="ad-muted">Second reading's reason: {testCase.independent_reading_reason}</p>
        )}
        <ClaimSummary claim={testCase.claim} />
        <OutcomeChoices options={options} busy={busy} highlight={highlight} onPick={onAnswer} />
        <p className="ad-hint">Press 1–{options.length} to choose. Your answer becomes a permanent test for the rule.</p>
      </>
    );
  }

  // One answer for a whole situation (e.g. a field is missing) covering several test claims.
  if (question.kind === 'situation' && question.situation) {
    return (
      <>
        <p className="ad-prose"><strong>{question.text}</strong></p>
        <p className="ad-prose">{question.situation.text}</p>
        <details className="ad-fold is-inner">
          <summary>Test claims this covers ({question.situation.cases.length})</summary>
          <ul className="ad-cases">
            {question.situation.cases.map(item => (
              <li key={item.description}><span>{item.description}</span><span className="ad-muted">Draft says <Outcome outcome={item.drafted_rule_says} /></span></li>
            ))}
          </ul>
        </details>
        <div className="ad-options">
          {options.map(option => (
            <button key={option} type="button" className="ad-option" disabled={busy} onClick={() => onAnswer(option)}>{option}</button>
          ))}
        </div>
        {ownWords}
      </>
    );
  }

  // Drafting stopped: use a draft that passed every check, keep drafting, or cancel.
  if (question.kind === 'choice') {
    const ACTION_HINT: Record<string, string> = {
      use: 'Use this draft. It passed every check.',
      more: 'Keep drafting with another round.',
      examples: 'Add example outcomes, then draft again.',
      cancel: 'Stop here. Nothing is activated.',
    };
    return (
      <>
        <p className="ad-prose"><strong>{question.text}</strong></p>
        <div className="ad-options">
          {options.map((option, index) => {
            const action = question.choice?.[index]?.action;
            return (
              <button key={option} type="button" className={`ad-option${action === 'cancel' ? ' is-danger' : ''}`} disabled={busy} onClick={() => onAnswer(option)}>
                <strong>{option}</strong>
                {action && <span>{ACTION_HINT[action]}</span>}
              </button>
            );
          })}
        </div>
      </>
    );
  }

  // A clarification in words, with suggested answers.
  return (
    <>
      <p className="ad-prose"><strong>{question.text}</strong></p>
      {options.length > 0 && (
        <div className="ad-options">
          {options.map(option => (
            <button key={option} type="button" className="ad-option" disabled={busy} onClick={() => onAnswer(option)}>{option}</button>
          ))}
        </div>
      )}
      {ownWords}
    </>
  );
}

/** "service_code" -> "Service code", "claim_id" -> "Claim ID". */
const fieldName = (key: string) =>
  key.split('_').map((word, index) => (word === 'id' ? 'ID' : index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(' ');

/** A test claim as a reviewer reads it: the key fields and the service lines, raw JSON on request. */
function ClaimSummary({ claim }: { claim: Record<string, unknown> }) {
  const [raw, setRaw] = useState(false);
  const scalars = Object.entries(claim).filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value));
  const lines = Array.isArray(claim.lines) ? (claim.lines as Record<string, unknown>[]) : [];
  const lineKeys = [...new Set(lines.flatMap(line => Object.keys(line)))];
  const others = Object.entries(claim).filter(([key, value]) => key !== 'lines' && value !== null && typeof value === 'object');
  const show = (value: unknown) => (value === null || value === undefined || value === '' ? <span className="ad-missing">missing</span> : String(value));

  return (
    <div className="ad-claim">
      <div className="ad-claim-head">
        <h4>Test claim</h4>
        <button type="button" className="ad-link" onClick={() => setRaw(!raw)}>{raw ? 'Show summary' : 'Show raw JSON'}</button>
      </div>
      {raw ? (
        <pre className="ad-pre is-scroll">{JSON.stringify(claim, null, 2)}</pre>
      ) : (
        <>
          <dl className="ad-claim-fields">
            {scalars.map(([key, value]) => <div key={key}><dt>{fieldName(key)}</dt><dd>{show(value)}</dd></div>)}
          </dl>
          {lines.length > 0 && (
            <div className="ad-scroll-x">
              <table className="ad-claim-lines">
                <thead><tr>{lineKeys.map(key => <th key={key} scope="col">{fieldName(key)}</th>)}</tr></thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={index}>{lineKeys.map(key => <td key={key}>{typeof line[key] === 'object' && line[key] !== null ? JSON.stringify(line[key]) : show(line[key])}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {others.map(([key, value]) => (
            <details key={key} className="ad-fold is-inner">
              <summary>{fieldName(key)} {Array.isArray(value) ? `(${value.length})` : ''}</summary>
              <pre className="ad-pre">{JSON.stringify(value, null, 2)}</pre>
            </details>
          ))}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- report

// The independent reading is a second model's opinion: shown as advice, never a failure.
const ADVISORY_CHECK = 'independent_reading';

type Verdict = { case_id: string; expected_status: Outcome };

function ReportView({ report, onCorrect, busy }: { report: CheckReport; onCorrect?: (corrections: Verdict[]) => void; busy: boolean }) {
  const statuses = report.impact.statuses ?? {};
  const failed = report.checks.filter(check => !check.passed && check.name !== ADVISORY_CHECK);
  const advice = report.checks.filter(check => !check.passed && check.name === ADVISORY_CHECK);
  const secondReading = report.cases.some(testCase => testCase.oracle_used !== false);

  return (
    <>
      <details className="ad-fold" open={failed.length > 0}>
        <summary>
          Code checks:{' '}
          <span className={failed.length ? 'ad-text-fail' : 'ad-text-pass'}>
            {report.checks.length - failed.length - advice.length} of {report.checks.length} passed
          </span>
          {advice.length > 0 && <span className="ad-muted"> · {advice.length} advice</span>}
        </summary>
        <ul className="ad-checks">
          {report.checks.map(check => {
            const advisory = check.name === ADVISORY_CHECK && !check.passed;
            return (
              <li key={check.name}>
                <span className={check.passed ? 'ad-text-pass' : advisory ? 'ad-text-review' : 'ad-text-fail'}>
                  {check.passed ? 'Passed' : advisory ? 'Advice' : 'Failed'}
                </span>
                <strong>{check.name.replace(/_/g, ' ')}</strong>
                <span className="ad-muted">{check.detail}</span>
              </li>
            );
          })}
        </ul>
      </details>

      {report.notes && report.notes.length > 0 && (
        <section className="ad-callout is-review">
          <h3>Worth a look: part of the rule may be missing</h3>
          <ul className="ad-list-plain">{report.notes.map(note => <li key={note}>{note}</li>)}</ul>
        </section>
      )}

      {report.disagreements.length > 0 && (
        <details className="ad-fold" open>
          <summary>{report.disagreements.length} test claim{report.disagreements.length === 1 ? '' : 's'} read differently by a second model</summary>
          <p className="ad-muted">The second model is often wrong. If the drafted rule is right, keep its outcome; if not, correct it below or reword the rule.</p>
          <ul className="ad-cases">
            {report.disagreements.map(testCase => (
              <li key={testCase.case_id}>
                <span>
                  {testCase.description}
                  {testCase.oracle_reason && <span className="ad-muted ad-block">Second reading: {testCase.oracle_reason}</span>}
                </span>
                <span className="ad-pair"><Outcome outcome={testCase.spec_status} /><span className="ad-muted">vs</span><Outcome outcome={testCase.oracle_status} /></span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {report.readback && (
        <details className="ad-fold">
          <summary>What the rule will do (generated from the implementation)</summary>
          <pre className="ad-pre">{report.readback}</pre>
        </details>
      )}

      {report.impact.claims ? (
        <section className="ad-section">
          <h3>Impact on {report.impact.claims} development claims</h3>
          <p className="ad-impact">
            {Object.entries(statuses).map(([status, n]) => <span key={status}><Outcome outcome={status} /> {n}</span>)}
          </p>
        </section>
      ) : null}

      {report.cases.length > 0 && (onCorrect
        ? <CaseCheck key={report.readback} cases={report.cases} onCorrect={onCorrect} busy={busy} />
        : (
          <details className="ad-fold">
            <summary>Generated test claims ({report.cases.length})</summary>
            <ul className="ad-cases">
              {report.cases.map(testCase => (
                <li key={testCase.case_id}>
                  <span>{testCase.description}</span>
                  <span className="ad-pair"><Outcome outcome={testCase.spec_status} />{secondReading && <><span className="ad-muted">vs</span><Outcome outcome={testCase.oracle_status} /></>}</span>
                </li>
              ))}
            </ul>
          </details>
        ))}
    </>
  );
}

// The author checks what the drafted rule decides on each generated test claim
// and corrects any outcome. Corrections become permanent tests for the rule and
// send it back to the drafter; the rule must then reproduce every one of them.
function CaseCheck({ cases, onCorrect, busy }: { cases: CheckReport['cases']; onCorrect: (corrections: Verdict[]) => void; busy: boolean }) {
  const [verdicts, setVerdicts] = useState<Record<string, Outcome>>({});
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const changed = cases.filter(testCase => verdicts[testCase.case_id] && verdicts[testCase.case_id] !== testCase.spec_status);
  const isFlagged = (testCase: CheckReport['cases'][number]) =>
    testCase.oracle_used !== false && !!testCase.oracle_status && testCase.oracle_status !== testCase.spec_status;
  const flaggedCount = cases.filter(isFlagged).length;
  const shown = onlyFlagged ? cases.filter(isFlagged) : cases;

  return (
    <section className="ad-section">
      <div className="ad-section-head">
        <h3>Check the outcomes ({cases.length} test claims)</h3>
        {flaggedCount > 0 && (
          <label className="ad-toggle">
            <input type="checkbox" checked={onlyFlagged} onChange={event => setOnlyFlagged(event.target.checked)} />
            Only the {flaggedCount} worth a look
          </label>
        )}
      </div>
      <p className="ad-muted">
        This is what the drafted rule decides. Change any outcome that is wrong: your answer becomes a permanent test and
        the rule is drafted again until it matches.
      </p>
      <ul className="ad-cases is-check">
        {shown.map(testCase => {
          const verdict = verdicts[testCase.case_id] ?? (testCase.spec_status as Outcome);
          const isChanged = verdict !== testCase.spec_status;
          return (
            <li key={testCase.case_id} className={isChanged ? 'is-changed' : undefined}>
              <span>
                {testCase.description}
                {isFlagged(testCase) && <span className="ad-muted ad-block">Second reading says {outcomeLabel(testCase.oracle_status)}: worth a look</span>}
                {isChanged && <span className="ad-block ad-text-review">Was {outcomeLabel(testCase.spec_status)}</span>}
              </span>
              <select
                aria-label={`Outcome for: ${testCase.description}`}
                value={verdict}
                onChange={event => setVerdicts(current => ({ ...current, [testCase.case_id]: event.target.value as Outcome }))}
              >
                {OUTCOMES.map((outcome: Outcome) => <option key={outcome} value={outcome}>{outcomeLabel(outcome)}</option>)}
              </select>
            </li>
          );
        })}
      </ul>
      {changed.length > 0 && (
        <div className="ad-bar">
          <button type="button" className="ad-btn" onClick={() => setVerdicts({})}>Undo changes</button>
          <button
            type="button"
            className="ad-btn is-primary"
            disabled={busy}
            onClick={() => onCorrect(changed.map(testCase => ({ case_id: testCase.case_id, expected_status: verdicts[testCase.case_id] })))}
          >
            {busy ? 'Sending…' : `Send ${changed.length} correction${changed.length === 1 ? '' : 's'} and redraft`}
          </button>
        </div>
      )}
    </section>
  );
}
