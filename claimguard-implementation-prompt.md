# ClaimGuard AI: implement the approved design

You are working in my existing project. I designed a clickable prototype of an internal health-insurance claim-review workspace ("ClaimGuard AI"). Your job is to rebuild the **approved parts** of that design as real components in this codebase, without breaking existing behaviour.

Do not start coding straight away. First inspect the repo (framework, router, styling setup, component folders, data layer) and send me a short plan. Then work one component at a time.

---

## 0. How to work

- Inspect first. I expect React + TypeScript + Tailwind (I use React Bits components), but confirm from `package.json` and the existing code. Follow the conventions already in the repo (folder layout, naming, state management, test setup). If something differs from what I describe, tell me before adapting.
- Work in small steps, in the order of section 4. After each step, run the type check, the linter and the existing tests, then show me what changed.
- Do not add a dependency without telling me why. Expected additions: `framer-motion` (cursor), Hugeicons (icons, or inline the SVG paths I list), Google Fonts for the three typefaces.
- Do not delete or rewrite pages I have not asked you to redesign (see section 3). Keep their data and logic working.
- If the prototype data is fake (patient IDs, findings, reviewers, timings), replace it with real data from our API or store. Never ship the placeholders.
- Ask me when a decision changes the design. Do not guess.

The prototype files are the visual reference. I will put them in `docs/design-reference/` (or tell you where). Names: `Artboard-3stz.dc.html` (the claim cards board), `Claims.dc.html`, `ClaimReview.dc.html`, `Dock.dc.html`, plus `CustomCursor.tsx` and `ClaimGuardCursor.tsx`. They are HTML with inline CSS and a small script. Read them for exact spacing, sizes and behaviour. Do not copy their template syntax.

---

## 1. Design rules (read twice)

I rejected many earlier versions because they looked "vibecoded". Follow these.

**Do**
- Treat every screen like a case file or a printed form: hairline rules, tabular alignment, plain text, clear labels.
- Always show **Claim ID, Patient ID and Provider** clearly and labeled wherever a claim appears.
- Show the **number of failed rules** plainly where a claim is summarised.
- Use the three typefaces below exactly as described.
- Keep motion short and purposeful (see section 5).

**Do not**
- No emojis anywhere (UI, labels, comments in UI strings).
- No decorative dots or coloured status dots, no pill badges for status. Status is coloured text, or a coloured edge strip on the claim card.
- No shield or mascot, no spinning rings, no gradient or glow fills, no neon glow on cards.
- No bar charts, skylines, progress bars, confidence bars or invented statistics on claim cards or the review page.
- The money amount is not the priority. Do not make it the biggest element. It may appear as a small detail.
- No boxed "stat tiles", no icon-in-a-circle decoration, no generic card-with-big-radius-and-shadow-everywhere look.
- Do not put arrow glyphs on links as decoration. Use underline and colour changes.

---

## 2. Foundations

### Typefaces (Google Fonts)
- **IBM Plex Sans** (400, 500, 600, 700): all UI text.
- **IBM Plex Mono** (400, 500, 600): IDs, codes, rule numbers, dates, code/evidence blocks.
- **Newsreader** (500, plus italic 400): large headings only (provider name on the claim card and claim sheet, section sub-heads, the "Rules failed" total). Never for body text.

### Colour tokens (CSS variables; support light, dark and "system")

Light:
```
--canvas:#f3f4f6   --ink:#0f172a   --muted:#475569   --faint:#64748b
--surface:#ffffff  --row:rgba(15,23,42,.04)
--border:rgba(15,23,42,.09)   --border2:rgba(15,23,42,.16)
--accent:#0e7490   --on-accent:#ffffff   --accent-soft:rgba(14,116,144,.08)
--shadow:0 1px 2px rgba(15,23,42,.04),0 18px 40px -20px rgba(15,23,42,.18)
--code:#0f172a
pass #10b981 (text #047857)   fail #ef4444 (text #b91c1c)
unable-to-assess #f59e0b (text #b45309)   needs-review #0891b2 (text #0e7490)
not-applicable #cbd5e1 (text #64748b)
```
Dark:
```
--canvas:#0b1220   --ink:#e2e8f0   --muted:#a3b1c6   --faint:#8b9bb2
--surface:#0f1729  --solid:#111b30  --row:rgba(148,163,184,.06)
--border:rgba(148,163,184,.12)   --border2:rgba(148,163,184,.24)
--accent:#22d3ee   --on-accent:#06202a   --accent-soft:rgba(34,211,238,.1)
--shadow:0 24px 48px -24px rgba(0,0,0,.7)
--code:#060b16
status text: pass #34d399, fail #f87171, unable #fbbf24, needs-review #22d3ee, n/a #94a3b8
```
Teal is the brand colour. Keep contrast at WCAG AA or better in both themes.

### Status vocabulary
Claim status: **Passed, Failed, Needs review, Unable to assess.**
Rule result: **Pass, Fail, Needs review, Unable to assess, Not applicable.**
Severity rank when sorting findings: Fail > Unable to assess > Needs review > Pass > N/A.

---

## 3. Scope

**Redesign (approved):** global dock navigation, custom cursor, claim card, Claims page, Claim review page (including the hold-to-approve/reject buttons and the review actions).

**Do not redesign yet (keep working as they are, only add the dock and cursor):** Dashboard, Review queue, Ingest data, Audit trail, Login, Landing. I tried a new Review queue and rejected it. Keep the existing table.

---

## 4. Components, in this order

### 4.1 Theme and fonts
Add the tokens, fonts and a theme switcher (light / dark / system). Persist the choice.

### 4.2 Dock navigation (left)
Based on the React Bits `Dock`, left position, used on every app screen. The old sidebar goes away; page content gets about 120px of left padding.

- Panel: fixed, vertically centred, 83px wide, dark glass (`rgba(15,23,42,.94)`, blur 16px), 30px radius.
- Items (top to bottom): Overview, Claims, Review Queue (badge **14**), separator, Runs, Audit Trail, Ingest Data, separator, Policy & Rules, System Admin, Analytics. Logo (the shield mark) at the top links home.
- Item size 56px, magnified to 100px on hover, gap 8px, padding 10px.
- **Only the hovered item scales.** Neighbours move at most about 12% of the scale. No background fill appears on hover. The active item keeps a subtle fill and a small marker.
- Labels appear beside the hovered item, positioned by the scaled size.
- Bottom area, larger than the nav items: account avatar (initials, online indicator), a **light/dark toggle** under it, and a **Log out** button.
- Right-click on Overview opens a small context menu (Open in new window, Options with a submenu, Sign out).
- Icons are Hugeicons stroke-rounded (1.5 stroke, rendered at 1.8): home, file, task, play, shield, cloud, book, gear, chart. Map them in the order of the items above.
- Keyboard accessible, `aria-current` on the active route, reduced-motion safe.

### 4.3 Custom cursor
Use the existing `CustomCursor.tsx` (Framer Motion, Tailwind) and the `ClaimGuardCursor.tsx` wrapper with the final configuration:
```tsx
<CustomCursor
  circleSize={35} dotSize={9}
  circleColor="rgb(34, 211, 238)" dotColor="rgb(34, 211, 238)"
  circleStiffness={80} circleDamping={15}
  dotStiffness={320} dotDamping={31}
  circleBorderWidth={1}
/>
```
No target/element-snapping behaviour. Mount it once at the app root. The cursor must not appear on touch devices, must respect `prefers-reduced-motion`, and the native cursor must stay on real text fields. The cyan has low contrast on light backgrounds; keep it (I chose it) but make sure it never hides important UI.

### 4.4 ClaimCard component
Used on the Claims page (and anywhere a claim is summarised). Reference: `Artboard-3stz.dc.html`.

Props (replace with real types):
```ts
type RuleResult = 'FAIL' | 'UNABLE' | 'REVIEW' | 'PASS' | 'NA';
interface ClaimCardData {
  claimId: string;        // CLM-2026-004812
  patientId: string;      // PT-104471
  patientName: string;    // A. Haddad
  providerName: string;   // Riverside Imaging Center
  service: string;        // MRI lumbar
  cpt: string;            // 72148
  serviceDate: string;    // 2026-08-14
  status: 'Passed' | 'Failed' | 'Needs review' | 'Unable to assess';
  reviewer: string;       // Marwen R.
  updatedAt: string;
  findings: { ruleId: string; text: string; result: RuleResult }[];
  failedCount: number;
}
```
Layout (a horizontal sheet, about 482 x 487px in the prototype, 8px radius):
1. **Left status strip**, 38px wide, full height, solid status colour (red failed, amber unable to assess, cyan needs review, green passed). The status word runs vertically (uppercase, bold, wide letter-spacing, rotated 180deg). Text is white on red, near-black (`#0b1220`) on the others.
2. **Header**: small uppercase label "Provider", then the **provider name in Newsreader 29px**, then the service and CPT in muted text.
3. **Detail list** with dotted leaders (label, dotted line, value): Claim ID (mono), Patient ID (mono) followed by the patient name, Service date (mono), Reviewer. A hairline closes the list.
4. **Findings**: italic Newsreader sub-head "Findings", then up to **3** rows sorted by severity: rule number (mono, faint), finding text, result as coloured text (Fail / Unable / Review). If there are no findings: "Every applicable rule passed" with "Pass".
5. **Total**: a heavy 1.5px rule, label "Rules failed" (Newsreader 19px) on the left, the **number in Newsreader 38px** on the right (red if above 0).
6. **Footer**: "Updated X ago" left, a dotted leader line, then "Open claim file" in italic Newsreader 18px with a small chevron drawn in CSS. On card hover, the leader turns solid teal, the label turns teal and the chevron moves 4px right.

Behaviour:
- The whole card is one link (an overlay link covers it; keep a visible focus ring).
- Hover: lift by 2px (`translateY(-2px)`), 180ms ease-out.
- **Pointer light**: one shared pointer position per grid. For every card compute the pointer position inside it and a proximity value (full when inside, fading to 0 within 80px outside, squared falloff). It only lights the card **border** (a radial gradient masked to a 1px ring) in the status colour, plus a very faint interior wash. Opacity is `proximity * 0.7` for the edge and `proximity * 0.1` for the interior. Disable when `prefers-reduced-motion` or on touch.
- No selection checkbox. No bulk actions.

### 4.5 Claims page
Reference: `Claims.dc.html`.
- Breadcrumb header (Workspace / Claims), a search button, a notifications button, and the page title **Claims** with "N of M claims from RUN-0419" and an "Ingest claims" primary button.
- Status filter chips: All, Passed, Failed, Needs review, Unable to assess, each with a count.
- Search input (claim ID, member/patient, diagnosis, provider) and a provider dropdown.
- Grid of `ClaimCard`s: `repeat(auto-fill, minmax(400px, 1fr))`, 20px gap. Empty state: "No claims match these filters."
- The page scrolls normally. Do not truncate or paginate unless the existing page already does.

### 4.6 Claim review page
Reference: `ClaimReview.dc.html`. Two columns: claim sheet (about 1.6fr) and a sticky inspector (about 1fr). Below 1180px wide, stack them.

**Back and actions bar**: a plain "Back to claims" link; "Re-run rules" and "Export" buttons. (There is no "Submit review" button. The final decision is the hold buttons below.)

**Claim sheet (left)** inside a bordered sheet with the same status strip as the card (red, "Failed"):
- Label "Provider", then the provider name as an `h1` in Newsreader 42px, then the service line (e.g. "MRI lumbar spine without contrast, CPT 72148").
- Two-column list with dotted leaders: Claim ID, Patient ID, Patient, Provider ID, Payer plan, Service date, Submitted, Diagnosis.
- A service-line row (code, description, amount) between hairlines, and a link "View FHIR payload" that expands a monospace code block.
- **Findings** (Newsreader italic 24px) with "Ruleset v2026.3 · N of M reviewed". Collapsible groups in this order: Fail, Needs review, Unable to assess, Pass, Not applicable. Fail, review and unable are open by default, pass and n/a collapsed. A group header shows the label in its status colour and the count. Rows: rule ID (mono), rule name, one-line summary, and the decision on the right ("Open", or the recorded decision). The selected row has a teal left bar and a tinted background. Clicking a row selects it and updates the inspector.
- **Rules failed** total (heavy rule, Newsreader).
- **Decision on this claim** (see 4.7).

**Inspector (right, sticky, top offset about 76px)**:
- Kicker "Inspecting finding", rule ID (mono) and rule name as the title, status in its colour, and the policy reference.
- **Evidence**: monospace block on a dark background (`--code`), showing the facts the rule used and the result.
- **Explanation**: AI-generated plain-language text with a teal left rule. Under it, small text: "Confidence 94%", "Grounded in" followed by the evidence references (mono, bordered), and the line "Drafted by AI. It explains the finding; the rule result is deterministic." The AI never decides; the rule result comes from the deterministic engine.
- **Review action**: a numbered list under a heavy rule. Each row has a keycap (1 to 4), the action name in bold and a one-line description. Rows: 1 Confirm issue (name in red): "The finding stands and the claim stays failed." 2 Dismiss: "The rule does not apply here. A reason is required." (opens an inline reason dropdown: Evidence found outside claim payload / Policy exception applies / Rule not applicable to this plan / Data entry error, corrected upstream, with Cancel and "Dismiss finding".) 3 Request information: "Ask the provider for what is missing." 4 Mark corrected: "The provider fixed it. Queue a re-check." Pressing 1 to 4 while focus is inside the inspector triggers the row. After a choice, that row's keycap turns dark with the label "Chosen", the others dim, and an **Undo** link appears beside the "Review action" heading. Pass and N/A results show "No reviewer action needed for this result." Every action is written to the audit trail.

### 4.7 Hold-to-confirm decision buttons
In the claim sheet, below the total, under the heading "Decision on this claim": two buttons side by side, **Hold to reject claim** and **Hold to approve claim**. Use the React Bits `HoldButton` (TypeScript + Tailwind; I will paste its source, or fetch it from https://reactbits.dev/llms.txt). Props to use:

```tsx
<HoldButton
  doneLabel="Claim rejected"
  backgroundColor="var(--surface)" textColor="var(--ink)"
  fillColor="#b91c1c"   // dark theme: #dc2626
  fillTextColor="#ffffff"
  size="lg" radius={7} fillDirection="right"
  holdTime={1200} releaseTime={200} pressScale={0.985}
  wave waveAmplitude={6} glow resetAfter={0}
  onHold={rejectClaim}
>Hold to reject claim</HoldButton>
```
The approve button is identical with `fillColor` `#047857` (dark: `#059669`), `doneLabel="Claim approved"`, `onHold={approveClaim}`.

Rules:
- **Approve is disabled while any rule on the claim has failed** (derive from the real rule results). Show the hint "Approval is unavailable while a rule has failed. Reject, or request information above." Otherwise the hint is "Press and hold to confirm. Written to the audit trail."
- After a hold completes, the other button is disabled, a status line reads "Claim approved/rejected. Logged to the audit trail." with an **Undo** link that resets both buttons.
- The decision must be persisted (API call) and written to the hash-chained audit log with user, timestamp, claim ID and decision. Use an optimistic UI that rolls back on error.
- Keyboard: hold Space/Enter, Escape cancels. Respect reduced motion (the component already falls back to a fade).

---

## 5. Motion and accessibility

- Transitions 100 to 250ms, never above 300ms, ease-out for entering and hover. Never `transition: all`; list the properties.
- Buttons press down with `scale(.97)`.
- Gate hover effects with `@media (hover: hover) and (pointer: fine)`.
- Respect `prefers-reduced-motion` everywhere (cursor, dock magnification, card lift, hold button, fades).
- Visible focus rings (2px teal, 2 to 3px offset), minimum 40px hit targets for buttons, all interactive elements reachable by keyboard.
- Status is never conveyed by colour alone: always include the word.

---

## 6. Domain reference

Claim review runs a ruleset against a claim. Prototype rules R001 to R015 (names only; use the real rule engine in the repo):
R001 Submission window, R002 Member eligibility on service date, R003 Provider in network, R004 Prior authorization required, R005 Diagnosis and procedure compatibility, R006 Duplicate claim check, R007 Currency matches policy, R008 Billed amount within fee schedule, R009 Required documents attached, R010 Units within daily limit, R011 Age and gender appropriateness, R012 Modifier validity, R013 Referring provider present, R014 Coordination of benefits, R015 Service date not in the future.

The ruleset will grow to hundreds or thousands of rules. Cards and lists must stay readable: show only the top findings, sort by severity, and never render every rule on a card.

Other surfaces (unchanged for now): hash-chained audit log, data ingest, AI explanations, review queue.

---

## 7. Acceptance checklist

- [ ] Fonts, tokens and light/dark/system themes work; no hard-coded colours outside tokens.
- [ ] Dock appears on all app screens, only the hovered item scales, account + theme toggle + logout work.
- [ ] Cursor renders on desktop only, honours reduced motion, native cursor on text inputs.
- [ ] ClaimCard shows Claim ID, Patient ID, provider, failed-rule count, up to 3 findings; pointer light only touches the border; whole card is a link.
- [ ] Claims page filters, search and provider dropdown work with real data.
- [ ] Claim review: findings groups, selection, inspector, review actions with Undo, FHIR toggle.
- [ ] Hold buttons: approve disabled when any rule failed; decisions persisted and audited; Undo works.
- [ ] No emojis, status dots, pill badges, bars or invented statistics anywhere in the new screens.
- [ ] Type check, lint and tests pass. Accessibility check (keyboard and screen reader labels) done.

When you finish each step, summarise the files you changed and anything you had to decide. If you are unsure about a detail of the design, look at the reference files first, then ask me.
