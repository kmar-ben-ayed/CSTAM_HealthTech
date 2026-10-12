import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import HoldButton from '../components/HoldButton';
import ShieldLoader from '../components/ShieldLoader';
import StatusShield, { SHIELD_FOR_STATUS } from '../components/StatusShield';
import FindingInspector, { ACTIONS, RESULT_LABEL, type ActionKey, type Finding, type ReviewChoice } from '../components/FindingInspector';
import { ApiError } from '../api/client';
import { getAuditEvents } from '../api/audit';
import { listRules } from '../api/rules';
import {
  exportFhirPayload,
  getDataset,
  getIngestedClaim,
  postReview,
  reevaluateClaim,
  type BackendClaim,
  type FhirPayload,
  type RuleResult,
} from '../api/claims';
import { cardResult, claimStatus, loadCardContext, type CardContext, type CardRuleResult, type ClaimStatus } from '../api/claimCards';
import '../styles/claim-review.css';

interface ClaimReviewProps {
  claimId: string;
  onNavigate: (page: string) => void;
}

// Findings groups, in the order a reviewer works through them.
const GROUPS: Array<{ result: CardRuleResult; openByDefault: boolean }> = [
  { result: 'FAIL', openByDefault: true },
  { result: 'REVIEW', openByDefault: true },
  { result: 'UNABLE', openByDefault: true },
  { result: 'PASS', openByDefault: false },
  { result: 'NA', openByDefault: false },
];

const STATUS_WORD: Record<ClaimStatus, string> = {
  Failed: 'is-fail',
  'Unable to assess': 'is-unable',
  'Needs review': 'is-review',
  Passed: 'is-pass',
};

type ClaimDecision = 'approved' | 'rejected';

// When a claim opens, the shield scans for one orbit (1.6s) before showing the
// claim's state. It never holds up the page, only the shield.
const SCAN_MS = 1600;

interface Loaded {
  claim: BackendClaim;
  results: RuleResult[];
  context: CardContext;
  ruleTitles: Map<string, string>;
  /** Latest recorded review action per rule, from the audit trail. */
  recorded: Map<string, string>;
}

async function loadReview(claimId: string, signal: AbortSignal): Promise<Loaded> {
  const stored = getIngestedClaim(claimId, signal)
    .then((response) => ({ claim: response.claim, results: response.evaluation }))
    .catch(async (cause: unknown) => {
      if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
      const dataset = await getDataset('development', 500, signal);
      return { claim: dataset.claims.find((item) => item.claim_id === claimId), results: dataset.evaluations[claimId] ?? [] };
    });
  const [{ claim, results }, context, rules, audit] = await Promise.all([
    stored,
    loadCardContext(signal),
    listRules(signal).catch(() => []),
    getAuditEvents(500, signal).catch(() => ({ total_count: 0, events: [] })),
  ]);
  if (!claim) throw new Error('not-found');

  const recorded = new Map<string, string>();
  const latest = new Map<string, number>();
  for (const event of audit.events) {
    if (event.claim_id !== claimId || event.event_type !== 'human_decision') continue;
    const ruleId = typeof event.payload.rule_id === 'string' ? event.payload.rule_id : '';
    const action = ACTIONS.find((item) => item.api === event.payload.action);
    const at = new Date(event.timestamp).getTime();
    if (!ruleId || !action || at < (latest.get(ruleId) ?? 0)) continue;
    latest.set(ruleId, at);
    recorded.set(ruleId, action.recorded);
  }

  return { claim, results, context, ruleTitles: new Map(rules.map((rule) => [rule.rule_id, rule.title])), recorded };
}

function toFinding(result: RuleResult, titles: Map<string, string>): Finding {
  const evidence = Array.isArray(result.evidence)
    ? (result.evidence as Array<{ path?: unknown; value?: unknown }>)
      .filter((item) => typeof item?.path === 'string')
      .map((item) => ({ path: item.path as string, value: item.value }))
    : [];
  return {
    ruleId: result.rule_id,
    title: titles.get(result.rule_id) || `Rule ${result.rule_id}`,
    result: cardResult(result),
    status: result.status,
    summary: typeof result.explanation === 'string' ? result.explanation : '',
    evidence,
    source: typeof result.rule_source === 'string' ? result.rule_source : '',
    correctiveAction: typeof result.corrective_action === 'string' ? result.corrective_action : '',
  };
}

function Leader({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sheet-leader">
      <dt>{label}</dt>
      <span className="sheet-dots" aria-hidden="true" />
      <dd>{children}</dd>
    </div>
  );
}

function money(amount: unknown, currency: unknown): string {
  if (typeof amount !== 'number') return '—';
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: typeof currency === 'string' && currency ? currency : 'SAR' }).format(amount);
  } catch {
    return String(amount);
  }
}

export default function ClaimReview({ claimId }: ClaimReviewProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    () => Object.fromEntries(GROUPS.map((group) => [group.result, group.openByDefault])),
  );
  const [choices, setChoices] = useState<Record<string, ReviewChoice>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [fhirOpen, setFhirOpen] = useState(false);
  const [fhir, setFhir] = useState<{ state: 'loading' | 'ready' | 'error'; payload?: FhirPayload }>({ state: 'loading' });
  const [decision, setDecision] = useState<ClaimDecision | null>(null);
  const [decisionRound, setDecisionRound] = useState(0);
  const [scanning, setScanning] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const openedAt = performance.now();
    const scanFor = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : SCAN_MS;
    let timer = 0;
    setLoaded(null);
    setLoadError(null);
    setScanning(true);
    loadReview(claimId, controller.signal)
      .then((review) => {
        setLoaded(review);
        timer = window.setTimeout(() => setScanning(false), Math.max(0, scanFor - (performance.now() - openedAt)));
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setScanning(false);
        setLoadError(cause instanceof Error && cause.message === 'not-found'
          ? 'This claim was not found in the latest ingested batch or the development dataset.'
          : 'The claim could not be loaded.');
      });
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [claimId]);

  useEffect(() => {
    if (!fhirOpen || !loaded) return;
    const controller = new AbortController();
    setFhir({ state: 'loading' });
    exportFhirPayload(loaded.claim, controller.signal)
      .then((payload) => setFhir({ state: 'ready', payload }))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setFhir({ state: 'error' });
      });
    return () => controller.abort();
  }, [fhirOpen, loaded]);

  const findings = useMemo(
    () => (loaded ? loaded.results.map((result) => toFinding(result, loaded.ruleTitles)) : []),
    [loaded],
  );
  const selected = findings.find((finding) => finding.ruleId === selectedId)
    ?? findings.find((finding) => finding.result === 'FAIL')
    ?? findings.find((finding) => finding.result !== 'PASS' && finding.result !== 'NA')
    ?? findings[0];

  if (loadError) {
    return (
      <div className="review-page">
        <Link to="/app/claims" className="text-link">Back to claims</Link>
        <p className="review-message" role="alert">{loadError}</p>
      </div>
    );
  }
  if (!loaded || !selected) {
    return (
      <div className="review-page">
        <ShieldLoader label="Checking the claim…" />
      </div>
    );
  }

  const { claim, context } = loaded;
  const status = claimStatus(loaded.results);
  const lines = Array.isArray(claim.lines) ? claim.lines : [];
  const firstCode = lines[0]?.service_code || '';
  const failedCount = loaded.results.filter((result) => result.status === 'FAIL').length;
  const unableCount = loaded.results.filter((result) => result.status === 'UNABLE_TO_ASSESS').length;
  const actionable = findings.filter((finding) => finding.result !== 'PASS' && finding.result !== 'NA');
  const reviewedCount = actionable.filter((finding) => choices[finding.ruleId]?.state === 'saved' || (!choices[finding.ruleId] && loaded.recorded.has(finding.ruleId))).length;
  const approveBlocked = failedCount > 0;

  const recordAction = async (finding: Finding, action: ActionKey, reason: string) => {
    const api = ACTIONS.find((item) => item.key === action)!.api;
    const original = finding.status === 'NOT_IMPLEMENTED' ? 'UNABLE_TO_ASSESS' : finding.status;
    setActionError(null);
    setChoices((current) => ({ ...current, [finding.ruleId]: { action, state: 'saving' } }));
    try {
      await postReview(claim.claim_id, finding.ruleId, api, reason, original as 'PASS' | 'FAIL' | 'UNABLE_TO_ASSESS' | 'NOT_APPLICABLE');
      setChoices((current) => ({ ...current, [finding.ruleId]: { action, state: 'saved' } }));
    } catch {
      // Roll back: nothing was recorded.
      setChoices((current) => {
        const next = { ...current };
        delete next[finding.ruleId];
        return next;
      });
      setActionError('The action could not be recorded. Nothing was written to the audit trail.');
    }
  };

  const rerun = async () => {
    setRerunning(true);
    setRerunError(null);
    try {
      const results = await reevaluateClaim(claim);
      setLoaded({ ...loaded, results });
    } catch {
      setRerunError('The rules could not be re-run.');
    } finally {
      setRerunning(false);
    }
  };

  const exportClaim = () => {
    const body = JSON.stringify({ claim, results: loaded.results }, null, 2);
    const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${claim.claim_id}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const undoDecision = () => {
    setDecision(null);
    setDecisionRound((round) => round + 1); // remounts both hold buttons
  };

  return (
    <div className="review-page">
      <div className="review-bar">
        <Link to="/app/claims" className="text-link">Back to claims</Link>
        <div className="review-bar-actions">
          {rerunError && <span className="inspector-error" role="alert">{rerunError}</span>}
          <button type="button" className="button-secondary" onClick={rerun} disabled={rerunning}>
            {rerunning ? 'Re-running…' : 'Re-run rules'}
          </button>
          <button type="button" className="button-secondary" onClick={exportClaim}>Export</button>
        </div>
      </div>

      <div className="review-layout">
        <article className="review-sheet">
          <div className="review-sheet-body">
            <header className="sheet-header">
              <div className="sheet-heading">
                <h1 className="sheet-provider">{context.providerNames.get(claim.provider_id || '') || claim.provider_id || 'Unknown provider'}</h1>
                <p className="sheet-service">
                  {context.serviceNames.get(firstCode) || 'Service not on file'}, <span className="mono">{firstCode || '—'}</span>
                </p>
              </div>
              {/* The claim's state, as the Sentinel shield. */}
              <div className="sheet-state">
                {scanning || rerunning ? (
                  <>
                    <StatusShield state="scanning" size={88} label="Checking the rules" />
                    <span className="result-word sheet-state-checking">Checking rules…</span>
                  </>
                ) : (
                  <>
                    <StatusShield state={SHIELD_FOR_STATUS[status]} size={88} label={`Claim status: ${status}`} />
                    <span className={`result-word ${STATUS_WORD[status]}`}>{status}</span>
                    <span className="sheet-state-detail">{failedCount} failed · {unableCount} unable</span>
                  </>
                )}
              </div>
            </header>

            <dl className="sheet-details">
              <Leader label="Claim ID"><span className="mono">{claim.claim_id}</span></Leader>
              <Leader label="Patient ID"><span className="mono">{claim.patient_id || '—'}</span></Leader>
              <Leader label="Member ID"><span className="mono">{claim.member_id || '—'}</span></Leader>
              <Leader label="Provider ID"><span className="mono">{claim.provider_id || '—'}</span></Leader>
              <Leader label="Payer plan"><span className="mono">{[claim.payer_id, claim.policy_id].filter(Boolean).join(' · ') || '—'}</span></Leader>
              <Leader label="Service date"><span className="mono">{lines[0]?.service_date || '—'}</span></Leader>
              <Leader label="Submitted"><span className="mono">{claim.submission_date || '—'}</span></Leader>
              <Leader label="Diagnosis"><span className="mono">{claim.diagnosis_code || '—'}</span></Leader>
            </dl>

            <table className="sheet-lines">
              <caption className="visually-hidden">Service lines</caption>
              <thead>
                <tr><th scope="col">Code</th><th scope="col">Description</th><th scope="col">Amount</th></tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.line_id || index}>
                    <td className="mono">{line.service_code || '—'}</td>
                    <td>{context.serviceNames.get(line.service_code || '') || 'Service not on file'}</td>
                    <td className="mono">{money(line.net_amount, claim.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <button type="button" className="text-link" aria-expanded={fhirOpen} onClick={() => setFhirOpen((open) => !open)}>
              {fhirOpen ? 'Hide FHIR payload' : 'View FHIR payload'}
            </button>
            {fhirOpen && (
              <pre className="sheet-code" aria-live="polite">
                {fhir.state === 'loading' ? 'Building the FHIR payload…'
                  : fhir.state === 'error' ? 'The FHIR payload could not be built.'
                    : JSON.stringify(fhir.payload, null, 2)}
              </pre>
            )}

            <div className="findings-heading">
              <h2>Findings</h2>
              <span>{reviewedCount} of {actionable.length} reviewed</span>
            </div>

            {GROUPS.map(({ result }) => {
              const members = findings.filter((finding) => finding.result === result);
              if (members.length === 0) return null;
              const open = openGroups[result];
              return (
                <section key={result} className="findings-group">
                  <button
                    type="button"
                    className="findings-group-header"
                    aria-expanded={open}
                    onClick={() => setOpenGroups((current) => ({ ...current, [result]: !current[result] }))}
                  >
                    <span className={`result-word is-${result.toLowerCase()}`}>{RESULT_LABEL[result]}</span>
                    <span className="mono">{members.length}</span>
                    <span className={`findings-caret${open ? ' is-open' : ''}`} aria-hidden="true" />
                  </button>
                  {open && (
                    <ul className="findings-rows">
                      {members.map((finding) => {
                        const choice = choices[finding.ruleId];
                        const decisionText = finding.result === 'PASS' || finding.result === 'NA'
                          ? ''
                          : choice
                            ? choice.state === 'saving' ? 'Saving…' : ACTIONS.find((item) => item.key === choice.action)!.recorded
                            : loaded.recorded.get(finding.ruleId) || 'Open';
                        return (
                          <li key={finding.ruleId}>
                            <button
                              type="button"
                              className={`finding-row${finding.ruleId === selected.ruleId ? ' is-selected' : ''}`}
                              aria-current={finding.ruleId === selected.ruleId || undefined}
                              onClick={() => {
                                setSelectedId(finding.ruleId);
                                setActionError(null);
                              }}
                            >
                              <span className="mono finding-id">{finding.ruleId}</span>
                              <span className="finding-main">
                                <span className="finding-name">{finding.title}</span>
                                <span className="finding-summary">{finding.summary}</span>
                              </span>
                              <span className="finding-decision">{decisionText}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}

            <div className="sheet-total">
              <span>Rules failed</span>
              <span className={`sheet-total-count${failedCount > 0 ? ' has-failures' : ''}`}>{failedCount}</span>
            </div>

            <section className="claim-decision" aria-labelledby="claim-decision-heading">
              <h2 id="claim-decision-heading">Decision on this claim</h2>
              <div className="claim-decision-buttons" key={decisionRound}>
                <HoldButton
                  doneLabel="Claim rejected"
                  backgroundColor="var(--surface)"
                  textColor="var(--ink)"
                  fillColor="var(--reject-fill)"
                  fillTextColor="#ffffff"
                  size="lg"
                  radius={7}
                  fillDirection="right"
                  holdTime={1200}
                  releaseTime={200}
                  pressScale={0.985}
                  resetAfter={0}
                  disabled={decision === 'approved'}
                  aria-describedby="claim-decision-hint"
                  onHold={() => setDecision('rejected')}
                >
                  Hold to reject claim
                </HoldButton>
                <HoldButton
                  doneLabel="Claim approved"
                  backgroundColor="var(--surface)"
                  textColor="var(--ink)"
                  fillColor="var(--approve-fill)"
                  fillTextColor="#ffffff"
                  size="lg"
                  radius={7}
                  fillDirection="right"
                  holdTime={1200}
                  releaseTime={200}
                  pressScale={0.985}
                  resetAfter={0}
                  disabled={approveBlocked || decision === 'rejected'}
                  aria-describedby="claim-decision-hint"
                  onHold={() => setDecision('approved')}
                >
                  Hold to approve claim
                </HoldButton>
              </div>
              <p id="claim-decision-hint" className="claim-decision-hint" aria-live="polite">
                {decision ? (
                  <>
                    Claim {decision}. Not saved yet: claim decisions are not connected to the server.{' '}
                    <button type="button" className="text-link" onClick={undoDecision}>Undo</button>
                  </>
                ) : approveBlocked
                  ? 'Approval is unavailable while a rule has failed. Reject, or request information above.'
                  : 'Press and hold to confirm.'}
              </p>
            </section>
          </div>
        </article>

        <FindingInspector
          key={selected.ruleId}
          claim={claim}
          finding={selected}
          choice={choices[selected.ruleId]}
          recorded={loaded.recorded.get(selected.ruleId)}
          error={actionError}
          onChoose={(action, reason) => recordAction(selected, action, reason)}
          onUndo={() => setChoices((current) => {
            const next = { ...current };
            delete next[selected.ruleId];
            return next;
          })}
        />
      </div>
    </div>
  );
}
