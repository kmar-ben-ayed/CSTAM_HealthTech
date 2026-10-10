# Anti-slop design prompt

Paste this before any UI request to an AI (Claude, v0, Lovable, Cursor…). Replace the `[brackets]`.

---

You are designing the UI for **ClaimGuard**, an internal tool where health-insurance claim reviewers check claims against payer rules. Each rule result is PASS, FAIL, UNABLE_TO_ASSESS or NOT_APPLICABLE. The users are trained reviewers who process many claims a day and must justify every decision for an audit.

Your default instincts produce generic "AI-generated" interfaces. Don't use them. Design from this product's domain and users, not from what a typical SaaS dashboard looks like.

## 1. Banned defaults
Do not use any of the following unless I explicitly ask for it:
- Purple, violet, indigo or cyan→blue gradients. No gradients on buttons, text, borders or backgrounds at all.
- Glassmorphism: `backdrop-filter: blur`, translucent cards, frosted top bars.
- Glow effects, neon shadows, "aurora" or mesh-gradient backgrounds, floating blurred blobs.
- Large uniform border radii (12px+) on everything, pill-shaped everything, cards nested in cards.
- Soft multi-layer drop shadows on every surface.
- Inter, Poppins, Plus Jakarta Sans, Syne, Space Grotesk or Segoe UI as the only font.
- The stock Tailwind status palette (emerald-500 / red-500 / amber-500 / slate) used as-is.
- A row of 4 KPI cards at the top of every page; "Welcome back 👋" headers; sparkle ✨ icons for AI.
- Mascots, animated shields, orbiting rings, pulsing dots, or gradient logos.
- Centered hero layouts, "Trusted by" logo rows or marketing sections inside an internal tool.
- Emoji as icons, and icons placed decoratively next to every label.
- Decorative animation: count-up numbers, staggered fade-in-up on load, shimmer used anywhere except real loading states.
- Placeholder or invented numbers presented as real data. Use the provided data, or label it clearly as SAMPLE.
- Copy like "Unlock", "Supercharge", "Seamless", "AI-powered insights", "Next-gen".

## 2. Where the design must come from
Before writing any code, answer these in 5–10 lines:
1. **Domain metaphor.** Which real-world artefact from healthcare or auditing does this screen resemble (lab report, ECG strip, triage board, specimen label, prescription pad, ledger, case file)? Borrow its conventions; don't invent decoration.
2. **Primary task.** What single decision does the user make on this screen? It must be completable without scrolling on a 1440×900 screen.
3. **Information priority.** List the 3 things the eye must hit first, in order. Everything else is visually quieter.
4. **References.** Name 2–3 real, specific non-AI products or printed documents you're drawing from (e.g. "a Quest Diagnostics lab report", "Linear's issue list", "Bloomberg terminal density") and say what you're taking from each.

If your answers sound like they could apply to any SaaS product, start again.

## 3. Hard rules
- **Colour:** neutral base plus **one** action colour. Red appears only where something has actually failed. Status is conveyed by a **word or glyph in a fixed position**; colour reinforces it but is never the only signal. Every text colour must meet WCAG AA (4.5:1). List your palette as tokens with hex values.
- **Type:** at most 2 families: one text face plus one monospace for IDs, codes, dates and money. Use `font-variant-numeric: tabular-nums` and right-align numbers. Choose a distinctive face with a reason (e.g. a condensed grotesk for dense labels, a serif for document-like screens).
- **Shape:** radius 0–4px. Use hairline borders (1px) to separate things, not shadows. At most one shadow style in the whole app, if any.
- **Density:** this is a professional tool. Prefer tables and lists to card grids. Rows 28–40px tall. Keep padding no larger than the content needs.
- **Evidence first:** every finding shows the exact field path and value it's based on (e.g. `lines[L1].authorization_id = null`) and the rule ID.
- **Honest AI:** AI text is labelled as such, shows what it cites, and never shows a fake confidence %. "Unable to assess" has its own visual state and always says *why*.
- **Motion:** only to show a change of state (selection, saved, error), and under 200ms. Respect `prefers-reduced-motion`.
- **Copy:** plain, specific, short. Say "Total is 40.00 less than the line items", not "Discrepancy detected in financial data".
- **Layout:** left-aligned, grid-based and asymmetric where it helps. Nothing centered except empty states.

## 4. Self-check before you answer
At the end, go through this list and fix anything that fails. Report the result as a checklist:
- [ ] No banned default from section 1 is present (search your own CSS for `gradient`, `blur`, `rounded-xl`, `shadow-lg`, `Inter`).
- [ ] If I removed the logo, could someone tell this is a *healthcare claims* tool rather than a generic dashboard? Say why.
- [ ] Each colour in the palette has a stated job; nothing is decorative.
- [ ] The primary decision on each screen is reachable without scrolling.
- [ ] All numbers line up and use tabular figures; all IDs use the monospace font.
- [ ] Every status is readable in greyscale.
- [ ] No invented metrics.

## 5. Output
1. The answers to section 2 (short).
2. Design tokens (colour, type, spacing, radius) as CSS variables.
3. The code.
4. The section 4 checklist with ✓/✗ and fixes applied.

Task: [describe the screen or component you want, e.g. "Redesign the Claim Review page using the data shape in src/api/claims.ts"]
