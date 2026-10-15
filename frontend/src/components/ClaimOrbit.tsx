import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import StatusShield, { type ShieldState } from './StatusShield';

// ── Claim orbit ────────────────────────────────────────────────────────────
// The review queue drawn around the status shield. Each claim waiting on a
// decision is a dot: the inner ring holds claims with the most failed rules,
// bigger dots fail more rules, hollow dots could only not be assessed. New
// claims fly in from outside; claims that leave the queue fall into the shield.
// Positions are written straight to the DOM each frame, outside React renders.

export interface OrbitClaim {
  id: string;
  fail: number;
  unable: number;
  provider: string;
  serviceDate: string;
  /** Rules this claim did not pass, most severe first. */
  rules: { id: string; title: string }[];
}

interface ClaimOrbitProps {
  claims: OrbitClaim[];
  /** Everything waiting, which can be more than the dots drawn. */
  total: number;
  loading: boolean;
  highlightRule: string | null;
  /** Bump `n` to make the dot for `id` pulse. */
  ping: { id: string; n: number } | null;
  onOpen: (claimId: string) => void;
}

interface Body {
  claim: OrbitClaim;
  ring: number;
  size: number;
  angle: number;
  radius: number;
  scale: number;
  leaving: boolean;
}

const RING_OF = (claim: OrbitClaim) => (claim.fail >= 3 ? 22 : claim.fail > 0 ? 33 : 44);
const SPEED: Record<number, number> = { 22: 0.16, 33: -0.11, 44: 0.075 }; // rad/s; middle ring runs the other way
const SIZE_OF = (claim: OrbitClaim) => 10 + Math.min(claim.fail, 4) * 2.5;
const priority = (claim: OrbitClaim) => claim.fail * 100 + claim.unable;

export default function ClaimOrbit({ claims, total, loading, highlightRule, ping, onOpen }: ClaimOrbitProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const boxRef = useRef<HTMLDivElement>(null);
  const shieldRef = useRef<HTMLDivElement>(null);
  const bodies = useRef(new Map<string, Body>());
  const dotEls = useRef(new Map<string, HTMLButtonElement>());
  const hoverPause = useRef(false);
  const seeded = useRef(false);
  const [rendered, setRendered] = useState<string[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [tip, setTip] = useState<{ id: string; pinned: boolean } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(false);
  pinnedRef.current = !!tip?.pinned;

  // Sync bodies with the queue: new claims fly in, missing ones fall into the shield.
  useEffect(() => {
    const map = bodies.current;
    const incoming = new Set(claims.map((claim) => claim.id));
    const firstLoad = !seeded.current;
    const perRing = new Map<number, number>();
    claims.forEach((claim, index) => {
      const existing = map.get(claim.id);
      if (existing) {
        existing.claim = claim;
        existing.leaving = false;
        return;
      }
      const ring = RING_OF(claim);
      const slot = perRing.get(ring) ?? 0;
      perRing.set(ring, slot + 1);
      map.set(claim.id, {
        claim,
        ring,
        size: SIZE_OF(claim),
        // Spread the first load evenly around each ring; later arrivals land anywhere.
        angle: firstLoad ? slot * 2.39996 + ring : Math.random() * Math.PI * 2,
        radius: reduceMotion ? ring : 72 + (firstLoad ? index * 1.5 : 0),
        scale: reduceMotion ? 1 : 0.2,
        leaving: false,
      });
    });
    for (const [id, body] of map) if (!incoming.has(id)) body.leaving = true;
    if (claims.length || !loading) seeded.current = true;
    setRendered([...map.keys()]);
  }, [claims, loading, reduceMotion]);

  // Animation loop. Skips work while the orbit is off-screen or the tab is hidden.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let visible = true;
    const observer = new IntersectionObserver((entries) => (visible = entries[0].isIntersecting));
    observer.observe(box);
    let frame = 0;
    let last = 0;
    const tick = (time: number) => {
      const dt = last ? Math.min(0.05, (time - last) / 1000) : 0;
      last = time;
      if (visible && !document.hidden) {
        const width = box.clientWidth;
        const paused = hoverPause.current || pinnedRef.current;
        let removed = false;
        for (const [id, body] of bodies.current) {
          if (!paused && !reduceMotion) body.angle += SPEED[body.ring] * dt * (body.leaving ? 4 : 1);
          const target = body.leaving ? 0 : body.ring;
          const settle = reduceMotion ? 1 : Math.min(1, dt * (body.leaving ? 3.2 : 2.6));
          body.radius += (target - body.radius) * settle;
          body.scale += ((body.leaving ? 0 : 1) - body.scale) * (reduceMotion ? 1 : Math.min(1, dt * (body.leaving ? 2.5 : 4)));
          const el = dotEls.current.get(id);
          if (el) {
            const x = ((50 + body.radius * Math.cos(body.angle)) / 100) * width - body.size / 2;
            const y = ((50 + body.radius * Math.sin(body.angle)) / 100) * width - body.size / 2;
            el.style.transform = `translate(${x}px, ${y}px) scale(${body.scale.toFixed(3)})`;
          }
          if (body.leaving && (body.radius < 6 || reduceMotion)) {
            bodies.current.delete(id);
            removed = true;
            const shield = shieldRef.current;
            if (shield && !reduceMotion) {
              shield.classList.remove('is-gulping');
              void shield.offsetWidth;
              shield.classList.add('is-gulping');
            }
          }
        }
        if (removed) setRendered([...bodies.current.keys()]);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [reduceMotion]);

  // Pulse a dot when the activity feed points at it.
  useEffect(() => {
    if (!ping || reduceMotion) return;
    const el = dotEls.current.get(ping.id);
    if (!el) return;
    el.classList.remove('is-pinging');
    void el.offsetWidth;
    el.classList.add('is-pinging');
  }, [ping, reduceMotion]);

  // Keep the preview next to its dot (the orbit is paused while it shows).
  useLayoutEffect(() => {
    const box = boxRef.current;
    const card = tipRef.current;
    const body = tip && bodies.current.get(tip.id);
    if (!box || !card || !body) return;
    const width = box.clientWidth;
    const x = ((50 + body.radius * Math.cos(body.angle)) / 100) * width;
    const y = ((50 + body.radius * Math.sin(body.angle)) / 100) * width;
    let left = x + 18;
    let top = y + 18;
    if (left > width - card.offsetWidth - 8) left = x - card.offsetWidth - 18;
    if (top > width - card.offsetHeight - 8) top = y - card.offsetHeight - 18;
    card.style.left = `${Math.max(0, left)}px`;
    card.style.top = `${Math.max(0, top)}px`;
  }, [tip]);

  // A pinned preview closes on Escape or a click elsewhere.
  useEffect(() => {
    if (!tip?.pinned) return;
    const pinnedId = tip.id;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return;
        dotEls.current.get(pinnedId)?.focus();
      } else if (tipRef.current?.contains(event.target as Node) || dotEls.current.get(pinnedId)?.contains(event.target as Node)) {
        return;
      }
      hoverPause.current = false;
      setTip(null);
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    tipRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    };
  }, [tip?.pinned, tip?.id]);

  // One tab stop for the whole orbit; arrow keys walk the queue in priority order.
  const ordered = rendered
    .map((id) => bodies.current.get(id))
    .filter((body): body is Body => !!body && !body.leaving)
    .sort((a, b) => priority(b.claim) - priority(a.claim));
  const tabTarget = ordered.some((body) => body.claim.id === focusId) ? focusId : ordered[0]?.claim.id;

  const onKeyDown = (event: React.KeyboardEvent) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key) || !ordered.length) return;
    event.preventDefault();
    const index = ordered.findIndex((body) => body.claim.id === tabTarget);
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const next =
      event.key === 'Home' ? 0 : event.key === 'End' ? ordered.length - 1 : (index + (forward ? 1 : -1) + ordered.length) % ordered.length;
    const id = ordered[next].claim.id;
    setFocusId(id);
    dotEls.current.get(id)?.focus();
  };

  const count = total;
  const state: ShieldState = loading ? 'scanning' : count === 0 ? 'pass' : 'review';
  const tempo = 0.6 + (Math.min(count, 20) / 14) * 1.4;
  const tipBody = tip ? bodies.current.get(tip.id) : undefined;

  return (
    <div className="ov-orbit-wrap">
      <p className="visually-hidden" id="ov-orbit-help">
        Claims waiting for a decision, most urgent first. Use the arrow keys to move between claims and Enter to see one.
      </p>
      <div className="ov-orbit" ref={boxRef} role="group" aria-label="Claims waiting for a decision" aria-describedby="ov-orbit-help" onKeyDown={onKeyDown}>
        <svg className="ov-rings" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="22" />
          <circle cx="50" cy="50" r="33" />
          <circle cx="50" cy="50" r="44" />
        </svg>

        <div className="ov-orbit-center">
          <div ref={shieldRef} className={`ov-orbit-shield${count > 12 ? ' is-busy' : ''}`}>
            <StatusShield state={state} size={104} tempo={tempo} label={loading ? 'Loading claims' : `${count} claims waiting`} />
          </div>
          <span key={count} className="ov-orbit-count">{loading ? '…' : count.toLocaleString('en')}</span>
          <span className="ov-orbit-caption">{count === 0 && !loading ? 'all clear' : 'waiting for you'}</span>
        </div>

        {rendered.map((id) => {
          const body = bodies.current.get(id);
          if (!body) return null;
          const { claim } = body;
          const matches = !!highlightRule && claim.rules.some((rule) => rule.id === highlightRule);
          return (
            <button
              key={id}
              ref={(el) => {
                if (!el) {
                  dotEls.current.delete(id);
                  return;
                }
                // Place a new dot before its first frame so it never flashes at the corner.
                if (!dotEls.current.has(id) && boxRef.current) {
                  const width = boxRef.current.clientWidth;
                  const x = ((50 + body.radius * Math.cos(body.angle)) / 100) * width - body.size / 2;
                  const y = ((50 + body.radius * Math.sin(body.angle)) / 100) * width - body.size / 2;
                  el.style.transform = `translate(${x}px, ${y}px) scale(${body.scale})`;
                }
                dotEls.current.set(id, el);
              }}
              type="button"
              className={[
                'ov-dot',
                claim.fail ? '' : 'is-hollow',
                highlightRule ? (matches ? 'is-match' : 'is-faded') : '',
                tip?.id === id && tip.pinned ? 'is-active' : '',
              ].join(' ')}
              style={{ '--s': `${body.size}px`, '--c': claim.fail ? 'var(--ov-fail)' : 'var(--ov-unable)' } as React.CSSProperties}
              tabIndex={id === tabTarget ? 0 : -1}
              disabled={body.leaving}
              aria-label={`${claim.id}: ${claim.fail} failed, ${claim.unable} unable to assess${claim.rules[0] ? `. Top issue ${claim.rules[0].title}` : ''}.`}
              aria-expanded={tip?.id === id && tip.pinned}
              onPointerDown={() => (hoverPause.current = true)}
              onMouseEnter={() => {
                if (pinnedRef.current) return;
                hoverPause.current = true;
                setTip({ id, pinned: false });
              }}
              onMouseLeave={() => {
                if (pinnedRef.current) return;
                hoverPause.current = false;
                setTip(null);
              }}
              onFocus={() => {
                setFocusId(id);
                if (pinnedRef.current) return;
                hoverPause.current = true;
                setTip({ id, pinned: false });
              }}
              onBlur={() => {
                if (pinnedRef.current) return;
                hoverPause.current = false;
                setTip((current) => (current?.pinned ? current : null));
              }}
              onClick={() => {
                hoverPause.current = true;
                setTip({ id, pinned: true });
              }}
            >
              <span className="ov-dot-in" />
            </button>
          );
        })}

        <div
          ref={tipRef}
          className={`ov-tip${tipBody ? ' is-shown' : ''}${tip?.pinned ? ' is-pinned' : ''}`}
          role={tip?.pinned ? 'dialog' : 'tooltip'}
          aria-label={tipBody ? `Claim ${tipBody.claim.id}` : undefined}
          aria-hidden={!tipBody}
        >
          {tipBody && (
            <>
              <div className="ov-tip-head">
                <span className="mono ov-tip-id">{tipBody.claim.id}</span>
                {!tip?.pinned && <span className="ov-tip-hint">click for actions</span>}
              </div>
              <div className="ov-tip-meta">
                {tipBody.claim.provider} · <span className="mono">{tipBody.claim.serviceDate}</span>
              </div>
              <div className="ov-tip-chips">
                {tipBody.claim.fail > 0 && <span className="ov-chip is-fail">{tipBody.claim.fail} failed</span>}
                {tipBody.claim.unable > 0 && <span className="ov-chip is-unable">{tipBody.claim.unable} unable</span>}
              </div>
              {tipBody.claim.rules[0] && (
                <div className="ov-tip-rule">
                  <span className="mono">{tipBody.claim.rules[0].id}</span> {tipBody.claim.rules[0].title}
                </div>
              )}
              {tip?.pinned && (
                <div className="ov-tip-actions">
                  <button type="button" className="ov-btn is-small" onClick={() => onOpen(tipBody.claim.id)}>
                    Open review
                  </button>
                  <button
                    type="button"
                    className="ov-btn is-small is-ghost"
                    onClick={() => {
                      hoverPause.current = false;
                      setTip(null);
                      dotEls.current.get(tipBody.claim.id)?.focus();
                    }}
                  >
                    Close
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
