import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { CardRuleResult, ClaimCardData, ClaimStatus } from '../api/claimCards';
import '../styles/claim-card.css';

// ── ClaimCard ──────────────────────────────────────────────────────────────
// A claim summarised as a case-file sheet: a status strip, the provider, the
// identifiers, the top three findings and the number of failed rules. The
// whole card is one link.

const STATUS_CLASS: Record<ClaimStatus, string> = {
  Failed: 'is-failed',
  'Unable to assess': 'is-unable',
  'Needs review': 'is-review',
  Passed: 'is-passed',
};

const RESULT_WORD: Record<CardRuleResult, string> = {
  FAIL: 'Fail',
  UNABLE: 'Unable',
  REVIEW: 'Review',
  PASS: 'Pass',
  NA: 'N/A',
};

const MAX_FINDINGS = 3;

function Leader({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="cg-card-leader">
      <dt>{label}</dt>
      <span className="cg-card-dots" aria-hidden="true" />
      <dd>{children}</dd>
    </div>
  );
}

export default function ClaimCard({ claim, to }: { claim: ClaimCardData; to: string }) {
  const shown = claim.findings.slice(0, MAX_FINDINGS);
  const hidden = claim.findings.length - shown.length;

  return (
    <article className={`cg-card ${STATUS_CLASS[claim.status]}`} data-cg-card>
      {/* Pointer light. An empty layer, so updating it every frame re-styles nothing else. */}
      <div className="cg-card-light" aria-hidden="true" />
      <div className="cg-card-strip" aria-hidden="true">
        <span>{claim.status}</span>
      </div>

      <div className="cg-card-body">
        <header>
          <h2 className="cg-card-provider">{claim.providerName}</h2>
          <p className="cg-card-service">
            {claim.service}, <span className="mono">{claim.serviceCode}</span>
          </p>
        </header>

        <dl className="cg-card-details">
          <Leader label="Claim ID"><span className="mono">{claim.claimId}</span></Leader>
          <Leader label="Patient ID"><span className="mono">{claim.patientId}</span></Leader>
          <Leader label="Service date"><span className="mono">{claim.serviceDate}</span></Leader>
          <Leader label="Reviewer">{claim.reviewer ?? 'Unassigned'}</Leader>
        </dl>

        <section className="cg-card-findings" aria-label="Findings">
          <h3>Findings</h3>
          <ul>
            {shown.length === 0 ? (
              <li>
                <span className="cg-card-rule mono">All</span>
                <span className="cg-card-text">Every applicable rule passed</span>
                <span className="cg-card-result is-pass">Pass</span>
              </li>
            ) : (
              shown.map((finding) => (
                <li key={finding.ruleId}>
                  <span className="cg-card-rule mono">{finding.ruleId}</span>
                  <span className="cg-card-text" title={finding.text}>{finding.text || 'See the claim file'}</span>
                  <span className={`cg-card-result is-${finding.result.toLowerCase()}`}>{RESULT_WORD[finding.result]}</span>
                </li>
              ))
            )}
          </ul>
          {hidden > 0 && <p className="cg-card-more">{hidden} more in the claim file</p>}
        </section>

        <div className="cg-card-total">
          <span className="cg-card-total-label">Rules failed</span>
          <span className={`cg-card-total-count${claim.failedCount > 0 ? ' has-failures' : ''}`}>{claim.failedCount}</span>
        </div>

        <footer className="cg-card-footer">
          <span>{claim.updatedLabel}</span>
          <span className="cg-card-footer-line" aria-hidden="true" />
          <span className="cg-card-open" aria-hidden="true">Open claim file<span className="cg-card-chevron" /></span>
        </footer>
      </div>

      {/* One link over the whole card; its label carries what a screen reader needs. */}
      <Link
        to={to}
        className="cg-card-link"
        aria-label={`Open claim file ${claim.claimId}, ${claim.providerName}. ${claim.status}, ${claim.failedCount} rule${claim.failedCount === 1 ? '' : 's'} failed.`}
      />
    </article>
  );
}

// ── Grid with a shared pointer light ───────────────────────────────────────
// One pointer position for the whole grid. Each card nearby gets the pointer
// position inside it and a proximity: 1 inside, fading to 0 within 80px
// outside (squared). Only the card's 1px edge and a faint wash are lit.

const REACH = 80;

export function ClaimCardGrid({ children, className = '' }: { children: ReactNode; className?: string }) {
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const grid = gridRef.current;
    const query = window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
    if (!grid || !query.matches) return;

    // Only cards on screen are measured. Each card's light layer is what gets updated.
    const visible = new Map<HTMLElement, HTMLElement>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const card = entry.target as HTMLElement;
        const light = card.querySelector<HTMLElement>('.cg-card-light');
        if (!light) continue;
        if (entry.isIntersecting) visible.set(card, light);
        else {
          visible.delete(card);
          light.style.setProperty('--proximity', '0');
        }
      }
    });
    const observeCards = () => grid.querySelectorAll<HTMLElement>('[data-cg-card]').forEach((card) => observer.observe(card));
    observeCards();
    const mutations = new MutationObserver(observeCards);
    mutations.observe(grid, { childList: true });

    let frame = 0;
    let pointer: { x: number; y: number } | null = null;
    const paint = () => {
      frame = 0;
      for (const [card, light] of visible) {
        if (!pointer) {
          light.style.setProperty('--proximity', '0');
          continue;
        }
        const rect = card.getBoundingClientRect();
        const dx = Math.max(rect.left - pointer.x, 0, pointer.x - rect.right);
        const dy = Math.max(rect.top - pointer.y, 0, pointer.y - rect.bottom);
        const outside = Math.hypot(dx, dy);
        const proximity = outside === 0 ? 1 : Math.max(0, 1 - outside / REACH) ** 2;
        light.style.setProperty('--pointer-x', `${pointer.x - rect.left}px`);
        light.style.setProperty('--pointer-y', `${pointer.y - rect.top}px`);
        light.style.setProperty('--proximity', proximity.toFixed(3));
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const onMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      schedule();
    };
    const onLeave = () => {
      pointer = null;
      schedule();
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', schedule, { capture: true });
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <div ref={gridRef} className={`cg-card-grid ${className}`}>
      {children}
    </div>
  );
}
