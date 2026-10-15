import { useEffect, useState, type ReactNode } from 'react';
import type { BackendClaim } from '../api/claims';
import {
  evidenceCache,
  getEvidence,
  type AdvisoryFlag,
  type EvidencePassage,
  type EvidenceResponse,
} from '../api/evidence';
import ShieldLoader from './ShieldLoader';
import '../styles/evidence.css';

// ── Supporting passages ────────────────────────────────────────────────────
// Passages from the claim's own documents that bear on the selected finding,
// with deterministic consistency signals. Everything here is rendered as text
// nodes: document content is untrusted and never interpreted.

const NOTICE = 'Unverified text from attached documents. The rule result is unchanged.';

const ADVISORY_TEXT: Partial<Record<AdvisoryFlag, { text: string; tone: 'pass' | 'fail' | 'unable' }>> = {
  possible_resolution: { text: 'Possible resolution found: check before requesting information.', tone: 'pass' },
  contradicting_evidence: { text: 'Contradicting evidence: a passage names another patient or a denial.', tone: 'fail' },
  injection_suspected: { text: 'A passage contains instruction-like text. It is shown as plain text and has no effect.', tone: 'unable' },
  ocr_low_confidence: { text: 'Some scanned pages could not be read reliably, so evidence may be missing.', tone: 'unable' },
};

function highlighted(passage: EvidencePassage): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const { start, end } of passage.highlights) {
    if (start < cursor || end > passage.text.length) continue;
    if (start > cursor) nodes.push(passage.text.slice(cursor, start));
    nodes.push(<mark key={`${start}-${end}`}>{passage.text.slice(start, end)}</mark>);
    cursor = end;
  }
  if (cursor < passage.text.length) nodes.push(passage.text.slice(cursor));
  return nodes;
}

function location(passage: EvidencePassage): string {
  if (passage.source === 'inline') return 'claim attachment text';
  return passage.page ? `p.${passage.page}` : '';
}

function Chip({ tone, children }: { tone: 'pass' | 'fail' | 'unable' | 'na'; children: ReactNode }) {
  return <span className={`evidence-chip is-${tone}`}>{children}</span>;
}

function SignalChips({ passage }: { passage: EvidencePassage }) {
  const s = passage.signals;
  return (
    <div className="evidence-chips" aria-label="Consistency signals">
      {s.patient_match === 'match' && <Chip tone="pass">Patient match</Chip>}
      {s.patient_match === 'mismatch' && <Chip tone="fail">Patient mismatch</Chip>}
      {s.patient_match === 'unknown' && <Chip tone="na">Patient unknown</Chip>}
      {s.date_relation === 'equal' && <Chip tone="pass">Service date matches</Chip>}
      {s.date_relation === 'different' && <Chip tone="unable">Other date</Chip>}
      {s.identifier_found.map((id) => (
        <Chip key={id} tone="na"><span className="mono">{id}</span> found</Chip>
      ))}
      {s.status_hint && (
        <Chip tone={s.status_hint === 'denied' ? 'fail' : s.status_hint === 'approved' || s.status_hint === 'final' ? 'pass' : 'unable'}>
          Hint: {s.status_hint}
        </Chip>
      )}
    </div>
  );
}

function PassageCard({ passage, onUseAsReason }: { passage: EvidencePassage; onUseAsReason?: (reference: string) => void }) {
  const where = location(passage);
  const reference = `Evidence: ${passage.attachment_id}${passage.page ? ` p.${passage.page}` : ''} (${passage.passage_id})`;
  const header = (
    <span className="evidence-source">
      <span className="evidence-filename">{passage.filename}</span>
      {where && <span className="evidence-where"> · {where}</span>}
    </span>
  );

  if (passage.signals.injection_suspected) {
    return (
      <li className="evidence-card is-suspect">
        <details>
          <summary>
            {header}
            <span className="evidence-warning">Suspected instruction text: shown as plain text, ignored by the system.</span>
          </summary>
          <p className="evidence-text is-plain">{passage.text}</p>
          <SignalChips passage={passage} />
        </details>
      </li>
    );
  }

  return (
    <li className="evidence-card">
      <div className="evidence-card-head">
        {header}
        {onUseAsReason && (
          <button type="button" className="text-link evidence-use" onClick={() => onUseAsReason(reference)}>
            Use as reason
          </button>
        )}
      </div>
      <p className="evidence-text">{highlighted(passage)}</p>
      <SignalChips passage={passage} />
    </li>
  );
}

interface Props {
  claim: BackendClaim;
  ruleId: string;
  /** Bumped by the documents panel so a fresh search runs after uploads. */
  documentsVersion?: number;
  onUseAsReason?: (reference: string) => void;
}

export default function SupportingPassages({ claim, ruleId, documentsVersion = 0, onUseAsReason }: Props) {
  const key = `${claim.claim_id}:${ruleId}`;
  const [result, setResult] = useState<EvidenceResponse | null>(() => evidenceCache.get(key) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    const cached = evidenceCache.get(key);
    setResult(cached ?? null);
    if (cached) return;
    getEvidence(claim, ruleId, controller.signal)
      .then((response) => {
        evidenceCache.set(key, response);
        setResult(response);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [claim, ruleId, key, documentsVersion]);

  const banners = (result?.advisory ?? []).flatMap((flag) => {
    const entry = ADVISORY_TEXT[flag];
    return entry ? [{ flag, ...entry }] : [];
  });

  return (
    <section className="inspector-section evidence-section" aria-live="polite">
      <h3>Supporting passages</h3>
      {failed ? (
        <p className="inspector-muted">Evidence search is unavailable right now. The finding and review actions are unaffected.</p>
      ) : !result ? (
        <ShieldLoader inline label="Searching the attached documents…" />
      ) : (
        <>
          {banners.length > 0 && (
            <ul className="evidence-advisories">
              {banners.map((banner) => (
                <li key={banner.flag} className={`evidence-advisory is-${banner.tone}`}>{banner.text}</li>
              ))}
            </ul>
          )}
          {result.passages.length === 0 ? (
            <p className="inspector-muted">
              No supporting evidence found in the attached documents
              {result.documents_searched > 0 ? ` (${result.documents_searched} searched)` : ''}.
            </p>
          ) : (
            <ol className="evidence-list">
              {result.passages.map((passage) => (
                <PassageCard key={passage.passage_id} passage={passage} onUseAsReason={onUseAsReason} />
              ))}
            </ol>
          )}
          <p className="evidence-notice">{NOTICE}</p>
        </>
      )}
    </section>
  );
}
