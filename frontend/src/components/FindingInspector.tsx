import { forwardRef, useEffect, useRef, useState } from 'react';
import { getExplanation, type BackendClaim, type ExplanationResponse, type ReviewAction } from '../api/claims';
import type { CardRuleResult } from '../api/claimCards';
import SupportingPassages from './SupportingPassages';

// ── Finding inspector ──────────────────────────────────────────────────────
// The right-hand column of the claim review: the selected rule's evidence,
// the AI explanation of it, and the reviewer's action on it.

export interface Finding {
  ruleId: string;
  title: string;
  result: CardRuleResult;
  status: string;
  summary: string;
  evidence: Array<{ path: string; value: unknown }>;
  source: string;
  correctiveAction: string;
}

export type ActionKey = 'confirm' | 'dismiss' | 'request' | 'corrected';

export interface ReviewChoice {
  action: ActionKey;
  /** Saving to the audit trail, or saved. */
  state: 'saving' | 'saved';
}

export const ACTIONS: Array<{ key: ActionKey; label: string; description: string; api: ReviewAction; recorded: string }> = [
  { key: 'confirm', label: 'Confirm issue', description: 'The finding stands and the claim stays failed.', api: 'confirm_issue', recorded: 'Confirmed' },
  { key: 'dismiss', label: 'Dismiss', description: 'The rule does not apply here. A reason is required.', api: 'dismiss_with_reason', recorded: 'Dismissed' },
  { key: 'request', label: 'Request information', description: 'Ask the provider for what is missing.', api: 'request_information', recorded: 'Information requested' },
  { key: 'corrected', label: 'Mark corrected', description: 'The provider fixed it. Queue a re-check.', api: 'mark_corrected_for_recheck', recorded: 'Corrected' },
];

const DISMISS_REASONS = [
  'Evidence found outside claim payload',
  'Policy exception applies',
  'Rule not applicable to this plan',
  'Data entry error, corrected upstream',
];

export const RESULT_LABEL: Record<CardRuleResult, string> = {
  FAIL: 'Fail',
  REVIEW: 'Needs review',
  UNABLE: 'Unable to assess',
  PASS: 'Pass',
  NA: 'Not applicable',
};

// Explanations already drafted this session, per claim and rule, so reselecting
// a finding doesn't ask the language model again.
const explanationCache = new Map<string, ExplanationResponse>();

function formatValue(value: unknown): string {
  if (value === undefined) return 'missing';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

interface InspectorProps {
  claim: BackendClaim;
  finding: Finding;
  choice: ReviewChoice | undefined;
  /** Previously recorded decision for this rule, from the audit trail. */
  recorded: string | undefined;
  error: string | null;
  onChoose: (action: ActionKey, reason: string) => void;
  onUndo: () => void;
  /** Narrow screens: return to the findings list. */
  onBack: () => void;
  /** Changes when the claim's documents change, so evidence is searched again. */
  documentsVersion?: number;
}

const FindingInspector = forwardRef<HTMLElement, InspectorProps>(function FindingInspector(
  { claim, finding, choice, recorded, error, onChoose, onUndo, onBack, documentsVersion = 0 },
  ref,
) {
  const [explanation, setExplanation] = useState<ExplanationResponse | null>(null);
  const [explanationError, setExplanationError] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [dismissReason, setDismissReason] = useState(DISMISS_REASONS[0]);
  // A passage reference offered as a dismiss reason. The reviewer still decides.
  const [evidenceReason, setEvidenceReason] = useState<string | null>(null);
  const reasons = evidenceReason ? [evidenceReason, ...DISMISS_REASONS] : DISMISS_REASONS;
  const actionable = finding.result !== 'PASS' && finding.result !== 'NA';

  useEffect(() => {
    const controller = new AbortController();
    const key = `${claim.claim_id}:${finding.ruleId}`;
    setExplanationError(false);
    setDismissing(false);
    setEvidenceReason(null);
    setDismissReason(DISMISS_REASONS[0]);
    const cachedExplanation = explanationCache.get(key);
    setExplanation(cachedExplanation ?? null);
    if (cachedExplanation) return;
    getExplanation(claim, finding.ruleId, 'openai', controller.signal)
      .then((response) => {
        explanationCache.set(key, response);
        setExplanation(response);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setExplanationError(true);
      });
    return () => controller.abort();
  }, [claim, finding.ruleId]);

  const choose = (action: ActionKey) => {
    if (choice || !actionable) return;
    if (action === 'dismiss') {
      setDismissing(true);
      return;
    }
    onChoose(action, ACTIONS.find((item) => item.key === action)!.description);
  };

  // Keys 1 to 4 trigger the actions anywhere on the page, except while typing.
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))) return;
      const index = Number(event.key) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= ACTIONS.length) return;
      event.preventDefault();
      chooseRef.current(ACTIONS[index].key);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <aside ref={ref} tabIndex={-1} className="inspector" aria-label={`Inspecting finding ${finding.ruleId}`}>
      <button type="button" className="text-link inspector-back" onClick={onBack}>Back to findings</button>
      <h2 className="inspector-title">
        <span className="mono">{finding.ruleId}</span> {finding.title}
      </h2>
      <p className="inspector-meta">
        <span className={`result-word is-${finding.result.toLowerCase()}`}>{RESULT_LABEL[finding.result]}</span>
        {finding.source && <> · <span className="mono">{finding.source}</span></>}
      </p>

      <section className="inspector-section">
        <h3>Evidence</h3>
        <pre className="inspector-evidence">
          {finding.evidence.length === 0
            ? 'No fields were read for this result.'
            : finding.evidence.map((item) => `${item.path}: ${formatValue(item.value)}`).join('\n')}
          {`\nresult: ${finding.status}`}
        </pre>
      </section>

      <section className="inspector-section">
        <h3>Explanation</h3>
        <div className="inspector-explanation">
          {explanation ? (
            <p>{explanation.explanation}</p>
          ) : explanationError ? (
            <p>The explanation service is unavailable. The engine reported: {finding.summary || 'no message'}.</p>
          ) : (
            <p className="inspector-muted" role="status">Drafting an explanation…</p>
          )}
        </div>
        {explanation && (
          <div className="inspector-grounding">
            {explanation.fallback_used && <p>The language model was unavailable; this text comes from the engine.</p>}
            {explanation.cited_evidence_paths.length > 0 && (
              <p>
                Grounded in{' '}
                {explanation.cited_evidence_paths.map((path) => <span key={path} className="inspector-ref mono">{path}</span>)}
              </p>
            )}
            <p>Drafted by AI. It explains the finding; the rule result is deterministic.</p>
          </div>
        )}
      </section>

      {actionable && (
        <SupportingPassages
          claim={claim}
          ruleId={finding.ruleId}
          documentsVersion={documentsVersion}
          onUseAsReason={choice ? undefined : (reference) => {
            setEvidenceReason(reference);
            setDismissReason(reference);
            setDismissing(true);
          }}
        />
      )}

      <section className="inspector-section inspector-actions">
        <div className="inspector-actions-heading">
          <h3>Review action</h3>
          {choice?.state === 'saved' && (
            <button type="button" className="text-link" onClick={onUndo}>Undo</button>
          )}
        </div>

        {!actionable ? (
          <p className="inspector-muted">No reviewer action needed for this result.</p>
        ) : (
          <>
            {recorded && !choice && <p className="inspector-muted">Last recorded decision: {recorded}.</p>}
            {!choice && (
              <p className="inspector-shortcuts">
                Shortcut: press <kbd>1</kbd>–<kbd>4</kbd>
              </p>
            )}
            <ol className="review-actions">
              {ACTIONS.map((action, index) => {
                const chosen = choice?.action === action.key;
                return (
                  <li key={action.key}>
                    <button
                      type="button"
                      className={`review-action${chosen ? ' is-chosen' : ''}${choice && !chosen ? ' is-dimmed' : ''}`}
                      disabled={Boolean(choice)}
                      aria-pressed={chosen}
                      onClick={() => choose(action.key)}
                    >
                      <span className="review-keycap" aria-hidden="true">{chosen ? 'Chosen' : index + 1}</span>
                      <span>
                        <span className={`review-action-name${action.key === 'confirm' ? ' is-fail' : ''}`}>{action.label}</span>
                        <span className="review-action-description">
                          {chosen && choice?.state === 'saving' ? 'Saving to the audit trail…' : action.description}
                        </span>
                      </span>
                    </button>
                    {action.key === 'dismiss' && dismissing && !choice && (
                      <div className="dismiss-form">
                        <label>
                          <span className="visually-hidden">Reason for dismissing</span>
                          <select value={dismissReason} onChange={(event) => setDismissReason(event.target.value)}>
                            {reasons.map((reason) => <option key={reason}>{reason}</option>)}
                          </select>
                        </label>
                        <button type="button" className="button-secondary" onClick={() => setDismissing(false)}>Cancel</button>
                        <button
                          type="button"
                          className="button-primary"
                          onClick={() => {
                            setDismissing(false);
                            onChoose('dismiss', dismissReason);
                          }}
                        >
                          Dismiss finding
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            {choice?.state === 'saved' && (
              <p className="inspector-muted">Recorded in the audit trail. Undo lets you choose again; the earlier entry stays in the log.</p>
            )}
            {error && <p className="inspector-error" role="alert">{error}</p>}
          </>
        )}
      </section>
    </aside>
  );
});

export default FindingInspector;
