import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import HoldButton from '../components/HoldButton';
import ShieldLoader from '../components/ShieldLoader';
import StatusShield, { SHIELD_FOR_STATUS } from '../components/StatusShield';
import DocumentsPanel from '../components/DocumentsPanel';
import FindingInspector, { ACTIONS, RESULT_LABEL, type ActionKey, type Finding, type ReviewChoice } from '../components/FindingInspector';
import { ApiError } from '../api/client';
import { getAuditEvents } from '../api/audit';
import { listRules } from '../api/rules';
import { loadReviewQueue, onlyActive } from '../api/reviewQueue';
import {
  exportFhirPayload,
  getDataset,
  getIngestedClaim,
  postClaimDecision,
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
const DECISION_API = { approved: 'approve', rejected: 'reject' } as const;
// Review actions that settle a failed rule, so it no longer blocks approval.
const SETTLING: ActionKey[] = ['dismiss', 'corrected'];

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
  /** Active rule IDs; results from other rules are left out. */
  active: Set<string>;
  /** The claim's recorded decision, from the audit trail (a reopen clears it). */
  decision: ClaimDecision | null;
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

  const active = new Set(rules.filter((rule) => rule.status === 'active').map((rule) => rule.rule_id));
  const recorded = new Map<string, string>();
  const latest = new Map<string, number>();
  let decision: ClaimDecision | null = null;
  let decidedAt = 0;
  for (const event of audit.events) {
    if (event.claim_id === claimId && event.event_type === 'claim_decision') {
      const at = new Date(event.timestamp).getTime();
      if (at >= decidedAt) {
        decidedAt = at;
        decision = event.payload.decision === 'approve' ? 'approved' : event.payload.decision === 'reject' ? 'rejected' : null;
      }
      continue;
    }
    if (event.claim_id !== claimId || event.event_type !== 'human_decision') continue;
    const ruleId = typeof event.payload.rule_id === 'string' ? event.payload.rule_id : '';
    const action = ACTIONS.find((item) => item.api === event.payload.action);
    const at = new Date(event.timestamp).getTime();
    if (!ruleId || !action || at < (latest.get(ruleId) ?? 0)) continue;
    latest.set(ruleId, at);
    recorded.set(ruleId, action.recorded);
  }

  return {
    claim,
    results: onlyActive(results, active),
    context,
    ruleTitles: new Map(rules.map((rule) => [rule.rule_id, rule.title])),
    recorded,
    active,
    decision,
  };
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
  const navigate = useNavigate();
  const location = useLocation();
  const inspectorRef = useRef<HTMLElement>(null);
  const [queue, setQueue] = useState<string[] | null>(null);
  const [decisionState, setDecisionState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [fhirStatus, setFhirStatus] = useState('');
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
  // Bumped when the claim's documents change, so open evidence is searched again.
  const [documentsVersion, setDocumentsVersion] = useState(0);

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
        setDecision(review.decision);
        setDecisionState(review.decision ? 'saved' : 'idle');
        setDecisionError(null);
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

  // The review queue, for previous / next.
  useEffect(() => {
    const controller = new AbortController();
    loadReviewQueue(controller.signal).then(setQueue).catch(() => setQueue(null));
    return () => controller.abort();
  }, [claimId]);

  useEffect(() => {
    if (!fhirOpen || !loaded) return;
    const controller = new AbortController();
    setFhir({ state: 'loading' });
    exportFhirPayload(loaded.claim, controller.signal)
      .then((payload) => {
        setFhir({ state: 'ready', payload });
        setFhirStatus('FHIR payload ready.');
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setFhir({ state: 'error' });
        setFhirStatus('The FHIR payload could not be built.');
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

  // Narrow screens stack the inspector under the sheet: once the newly selected
  // finding's inspector has rendered, bring it into view and move focus to it.
  const revealInspector = useRef(false);
  useEffect(() => {
    if (!revealInspector.current) return;
    revealInspector.current = false;
    const inspector = inspectorRef.current;
    if (!inspector || inspector.getBoundingClientRect().top < window.innerHeight * 0.6) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    inspector.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    inspector.focus({ preventScroll: true });
  }, [selectedId]);

  // Back to wherever the reviewer came from; direct links fall back to the claims list.
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/app/claims'));

  if (loadError) {
    return (
      <div className="review-page">
        <button type="button" className="text-link" onClick={goBack}>Back</button>
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
  // A failed rule blocks approval until it is dismissed or marked corrected.
  const settled = (finding: Finding) => {
    const choice = choices[finding.ruleId];
    if (choice) return choice.state === 'saved' && SETTLING.includes(choice.action);
    const label = loaded.recorded.get(finding.ruleId);
    return ACTIONS.some((action) => SETTLING.includes(action.key) && action.recorded === label);
  };
  const openFailures = findings.filter((finding) => finding.result === 'FAIL' && !settled(finding)).length;
  const approveBlocked = openFailures > 0;

  const position = queue ? queue.indexOf(claim.claim_id) : -1;
  const previousId = queue && position > 0 ? queue[position - 1] : null;
  const nextId = queue ? ((position >= 0 ? queue[position + 1] : queue.find((id) => id !== claim.claim_id)) ?? null) : null;
  const openClaim = (id: string) => navigate(`/app/claims/${encodeURIComponent(id)}`);

  const selectFinding = (ruleId: string) => {
    revealInspector.current = true;
    setSelectedId(ruleId);
    setActionError(null);
  };
  const backToFindings = () => {
    const row = document.querySelector<HTMLElement>('.finding-row.is-selected');
    row?.scrollIntoView({ block: 'start' });
    row?.focus({ preventScroll: true });
  };

  const decide = async (value: ClaimDecision) => {
    setDecision(value);
    setDecisionState('saving');
    setDecisionError(null);
    const reason = value === 'approved'
      ? `Approved after review; ${actionable.length} finding${actionable.length === 1 ? '' : 's'} on the claim.`
      : `Rejected with ${openFailures} open failed rule${openFailures === 1 ? '' : 's'}.`;
    try {
      await postClaimDecision(claim.claim_id, DECISION_API[value], reason);
      setDecisionState('saved');
    } catch {
      setDecision(null);
      setDecisionState('idle');
      setDecisionRound((round) => round + 1);
      setDecisionError('The decision could not be recorded. Nothing was written to the audit trail.');
    }
  };

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
      setLoaded({ ...loaded, results: onlyActive(results, loaded.active) });
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

  // Reopening is recorded too: the audit trail keeps the earlier decision.
  const reopen = async () => {
    setDecisionState('saving');
    setDecisionError(null);
    try {
      await postClaimDecision(claim.claim_id, 'reopen', 'Decision withdrawn by the reviewer.');
      setDecision(null);
      setDecisionState('idle');
      setDecisionRound((round) => round + 1); // remounts both hold buttons
    } catch {
      setDecisionState('saved');
      setDecisionError('The claim could not be reopened.');
    }
  };

  return (
    <div className="review-page">
      <div className="review-bar">
        <div className="review-bar-nav">
          <button type="button" className="text-link" onClick={goBack}>Back</button>
          {queue && queue.length > 0 && (
            <>
              <span className="review-queue-pos">
                {position >= 0 ? `${position + 1} of ${queue.length} in the queue` : `${queue.length} in the queue`}
              </span>
              <button type="button" className="button-secondary" disabled={!previousId} onClick={() => previousId && openClaim(previousId)}>
                Previous
              </button>
              <button type="button" className="button-secondary" disabled={!nextId} onClick={() => nextId && openClaim(nextId)}>
                Next claim
              </button>
            </>
          )}
        </div>
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

            <button
              type="button"
              className="text-link"
              aria-expanded={fhirOpen}
              onClick={() => {
                setFhirStatus(fhirOpen ? '' : 'Building the FHIR payload…');
                setFhirOpen((open) => !open);
              }}
            >
              {fhirOpen ? 'Hide FHIR payload' : 'View FHIR payload'}
            </button>
            {/* Announce the state only; reading the whole payload aloud helps nobody. */}
            <span className="visually-hidden" role="status">{fhirStatus}</span>
            {fhirOpen && (
              <pre className="sheet-code">
                {fhir.state === 'loading' ? 'Building the FHIR payload…'
                  : fhir.state === 'error' ? 'The FHIR payload could not be built.'
                    : JSON.stringify(fhir.payload, null, 2)}
              </pre>
            )}

            <DocumentsPanel claim={claim} onChanged={() => setDocumentsVersion((version) => version + 1)} />

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
                              onClick={() => selectFinding(finding.ruleId)}
                            >
                              <span className="mono finding-id">{finding.ruleId}</span>
                              <span className="finding-main">
                                <span className="finding-name">{finding.title}</span>
                                <span className="finding-summary">{finding.summary}</span>
                              </span>
                              {decisionText && (
                                <span className="finding-decision" data-state={choice?.state === 'saving' ? 'saving' : (choice?.action ?? ACTIONS.find((item) => item.recorded === loaded.recorded.get(finding.ruleId))?.key ?? 'open')}>
                                  {decisionText}
                                </span>
                              )}
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
              {decision && decisionState === 'saved' ? (
                <div className="claim-decided">
                  <span>
                    <strong className={`is-${decision}`}>Claim {decision}.</strong> Recorded in the audit trail.
                  </span>
                  <span className="claim-decided-actions">
                    <button type="button" className="text-link" onClick={reopen}>Reopen</button>
                    {nextId && (
                      <button type="button" className="button-primary" onClick={() => openClaim(nextId)}>Next claim</button>
                    )}
                  </span>
                </div>
              ) : (
                <div className="claim-decision-buttons" key={decisionRound}>
                  <HoldButton
                    doneLabel="Claim rejected"
                    backgroundColor="var(--surface)"
                    textColor="var(--ink)"
                    fillColor="var(--reject-fill)"
                    fillTextColor="#ffffff"
                    size="lg"
                    radius={8}
                    fillDirection="right"
                    holdTime={1200}
                    releaseTime={200}
                    pressScale={0.985}
                    resetAfter={0}
                    disabled={decision === 'approved' || decisionState === 'saving'}
                    aria-describedby="claim-decision-hint"
                    onHold={() => decide('rejected')}
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
                    radius={8}
                    fillDirection="right"
                    holdTime={1200}
                    releaseTime={200}
                    pressScale={0.985}
                    resetAfter={0}
                    disabled={approveBlocked || decision === 'rejected' || decisionState === 'saving'}
                    aria-describedby="claim-decision-hint"
                    onHold={() => decide('approved')}
                  >
                    Hold to approve claim
                  </HoldButton>
                </div>
              )}
              <p id="claim-decision-hint" className="claim-decision-hint" aria-live="polite">
                {decisionError ? (
                  <span className="inspector-error" role="alert">{decisionError}</span>
                ) : decisionState === 'saving' ? (
                  'Recording the decision…'
                ) : decision ? (
                  ''
                ) : approveBlocked ? (
                  `Approval is unavailable while ${openFailures} failed rule${openFailures === 1 ? ' is' : 's are'} open. Dismiss or mark them corrected above, or reject the claim.`
                ) : (
                  'Press and hold to confirm.'
                )}
              </p>
            </section>
          </div>
        </article>

        <FindingInspector
          ref={inspectorRef}
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
          onBack={backToFindings}
          documentsVersion={documentsVersion}
        />
      </div>
    </div>
  );
}
