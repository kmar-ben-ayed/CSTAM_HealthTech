# Prompt for Claude Design: ClaimGuard redesign (evolution, not revolution)

Before sending, attach screenshots of the current app (Dashboard, Claims, Claim Review, Login) and, if possible, `CURRENT_DESIGN_PROMPT.md`.

---

## Who you are
You are a senior graphic designer with an editorial and information-design background: you've designed printed lab reports, transit maps and hospital wayfinding before you ever designed software. You care about typography, grids and the small details. This is a project you'd put in your portfolio. You have opinions and you defend them. You don't reach for the templates every AI tool produces.

## The product
**ClaimGuard** is an internal workspace for health-insurance claim reviewers. Claims are uploaded (JSONL, CSV, FHIR), checked against 15 payer rules (R001–R015), and every rule returns **PASS, FAIL, UNABLE TO ASSESS or NOT APPLICABLE**. An AI writes grounded explanations, a human reviewer makes the final decision (confirm, dismiss with reason, request information, mark corrected), and every action is written to a hash-chained audit log. The users are trained professionals who review many claims a day and must be able to defend each decision.

## The brief: blend, don't replace
I want the **current design and a passionate, crafted designer's version mixed together**. The team already knows the current app, so keep its bones and give it a soul.

### Keep from the current design (non-negotiable)
- **Information architecture:** left sidebar with three sections: WORKSPACE (Overview, Claims, Review Queue), WORKFLOW (Runs, Audit Trail, Ingest Data), CONFIGURE (Policy & Rules, System Admin, Analytics). Top bar with breadcrumbs, search (⌘K), notifications, theme switch and profile.
- **All pages and their features:**
  - Landing and Login.
  - Dashboard with priority review and recent activity.
  - Claims list with status filters and search.
  - Claim Review in three panes: claim context, findings grouped by status, and an inspector with evidence, AI explanation and review actions.
  - Review Queue, Ingest, Runs, Audit Trail with hash chain, Policy & Rules, System Admin config editor, Analytics.
- **Teal as the brand colour.** Keep it, but deepen and refine it (around #0e7490 today). It should feel clinical and confident, not "tech startup cyan".
- **The status system's logic:** each status has a vivid hue for marks and a darker ink for text, so small labels stay readable. Keep WCAG AA contrast everywhere.
- **Light, dark and system themes.**
- **Calm, trustworthy, professional** overall tone. This is healthcare and money.

### Remove from the current design (this is what makes it look AI-generated)
- The cyan→blue gradient (#0891b2→#3b82f6 and #00f2fe→#4facfe) everywhere: buttons, logo, hero.
- Glassmorphism: translucent cards, `backdrop-filter: blur`, frosted top bar.
- Big rounded corners on everything (13 / 18 / 26px) and soft stacked shadows on every card.
- The "Sentinel" mascot: the animated glowing shield with orbiting rings.
- Segoe UI / system font as the whole typographic identity, and the unloaded "Syne".
- The stock Tailwind status colours (emerald / red-500 / amber) as-is.
- KPI-tile rows as the default page opener, card grids where a table would be clearer, count-up numbers and fade-in-up on every page load.
- The marketing-style landing page ("FUTURE MEDICINE" watermark, gradient hero).

### Add the designer's soul
Give the product a **point of view drawn from healthcare's own visual culture**, not from SaaS templates. Pick a primary metaphor and commit to it. Use these as starting points and choose, combine or improve on them:
- **Lab report:** results tables with reference ranges, a flag column, and abnormal results set in **bold** (a real lab convention).
- **ECG / rhythm strip:** one "beat" per rule. A normal beat for pass, a spike for fail, an irregular trace for unable to assess, a flat line for not applicable. It could be a signature element on the claim header or in the claims list as a micro-rhythm.
- **Triage colours (ESI 1–5):** a priority language for the Review Queue that clinicians already understand.
- **Specimen label / wristband:** the claim's identity block (ID, member, provider, policy, dates) with a barcode-like mark.
- **Prescription pad:** the reviewer's decision area. A signed order, with the reviewer's name, a timestamp and the audit hash.

Bring craft to it:
- **Typography with character.** Pair a distinctive text face (for example a grotesk with width axes such as Archivo, or IBM Plex Sans, Söhne-like or Public Sans) with a monospace for IDs, codes, dates and money. Use a condensed or heavier display cut for headlines. Use tabular figures and right-aligned amounts. Set a clear type scale.
- **A real grid** with deliberate asymmetry. Thin rules instead of shadows; radii of 0–4px. Use print-design devices where they make sense: running heads, eyebrow labels, hairline dividers, generous margins on reading surfaces and density where people scan.
- **One signature detail per key screen** that a person would remember: a rhythm strip, a perforated specimen-label edge, a handwritten-style signature on a signed decision, a "chief complaint" sentence summarising what's wrong with a claim in plain language.
- **A restrained palette:** warm off-white paper and near-black ink, refined teal for actions and brand, and status colours tuned to sit together (an oxblood or clinical red for fail, ochre for unable to assess, deep green for pass, warm grey for N/A). No gradients.
- **Honest AI.** Present AI explanations like a clinician's note: labelled, citing the exact fields they rely on, and never with a fake confidence %.
- **Purposeful motion only:** state changes and selection, under 200ms, respecting reduced motion. At most one memorable moment, such as the rhythm strip drawing in once when a claim opens.

## What to design (in priority order)
1. **Design system:** colour tokens (light and dark), type scale, spacing, radius, status styles, buttons, inputs, table row, tag/flag, sidebar item. Include a short rationale for each choice.
2. **Claim Review:** the hero screen. Use this data: claim `CG-2D966B65D1A1`, provider EDU-PROV-02, policy EDU-BASIC, total SAR 570.00, lines MRI 380.00 (no authorization), Consultation 190.00 and Lab 40.00.
   - **Findings:** R008 *Required authorization reference* FAIL; R012 *Claim total equals line amounts* FAIL (610.00 ≠ 570.00); R010 *Required supporting document* UNABLE TO ASSESS (CSV source carries no attachments); R009 NOT APPLICABLE; 11 rules PASS.
3. **Review Queue / Claims list** with priority and status at a glance.
4. **Dashboard:** what needs attention now, not vanity KPIs.
5. **Login:** quiet and confident, without a marketing hero.
6. One **dark-mode** version of Claim Review.

## Constraints
- Desktop first at 1440×900, and it must still work at 768px and 375px.
- Use only the realistic data above (or clearly labelled sample data). No invented "+23% this week" metrics.
- Every status must be readable in greyscale: word or glyph first, colour second.
- Everything must be buildable in React and CSS; avoid effects that only work in a mock-up.

## Before you finalise, check yourself
- Would someone who knows the current app still recognise it (navigation, pages, teal)? It **must** be yes.
- If you covered the logo, could a stranger tell it's a *healthcare claims* tool rather than a generic SaaS dashboard? It **must** be yes.
- Search your own output for gradients, blur, radii above 4px, Inter, emoji icons and mascots. Remove any you find.
- Can each colour, typeface and signature detail be justified in one sentence? Cut anything you can't justify.

Show me the system first, then the screens, and briefly explain your design decisions as a designer would in a portfolio case study.
