# UI redesign — brainstorm

Three throwaway HTML mockups of the screen that matters most: **one claim under review**.
Open `index.html` (or any file) straight in a browser. There's no build step.
The data is a synthetic claim that uses the real rule IDs from `backend/rules/rules.json`.

## Why the current UI reads as "AI slop"

| Tell | Where it shows up today |
|---|---|
| Cyan→blue gradient accent | `--accent-gradient` in `src/index.css` |
| Glassmorphism (translucent cards + `backdrop-filter: blur`) | `--card-bg`, `--card-blur` |
| Soft rounded cards everywhere, at 13/18/26px radii | `--r-md` / `--r-lg` / `--r-xl` |
| Animated mascot (glowing, orbiting shield) | `components/Sentinel.tsx` |
| Default Tailwind palette for status (emerald / red-500 / amber) | `--status-*` |
| Navy sidebar + frosted top bar + KPI tiles | the generic SaaS template |
| Made-up numbers on Analytics and in parts of the Dashboard | hard-coded constants |
| A marketing landing page in front of an internal tool | `pages/Landing.tsx` |

Each tell on its own is fine. Together they look like a template rather than a tool that knows its job.

## Principles for every direction

1. **The claim is the hero, not the chrome.** Lose the KPI tiles and decoration on the review screen.
2. **Status is a word in a fixed position, not a coloured pill.** Colour backs up the word but never replaces it.
3. **Point to the evidence.** Every finding shows the exact field and value it's based on (`/lines/0/authorization_id = null`).
4. **Be honest about the AI.** Label explanations "grounded in N fields, not a probability", which matches the backend's `confidence_kind`.
5. **Show "unable to assess" as its own state, not a softer fail.** Say *why* the system couldn't tell.
6. **Use one font family plus a monospace for IDs and money.** Line up numbers with tabular figures.
7. **Use hairlines instead of shadows, and small radii (0–3px).**

## The three directions

### A · Ledger: the claim as an audited document
Paper and ink, a serif for headings, findings as margin notes beside the line they concern.
Feels like a careful auditor's desk. **Best for:** accuracy, demos, judges who aren't technical.
**Risk:** not very dense; slower for people who review all day.

### B · Console: built for reviewer speed
Dark graphite, three dense panes (queue · claim · finding), every action on a key
(`j`/`k` to move through the queue, `Tab` for the next rule, `c`/`d`/`i` to decide). Status is a glyph plus a word.
**Best for:** high volume and expert users. **Risk:** feels cold; there's a learning curve.

### C · Casework: guided, one decision at a time
A sentence summarises what was billed, then findings appear as numbered steps. You can't sign
until every finding has a decision and a reason. **Best for:** new reviewers, defensible audit trails,
mobile and tablet. **Risk:** slower for experts; needs a "skip to the end" route.

## Suggested next step
Choose one direction, or a mix (C's guided flow + A's typography is a strong combination).
Then replace the tokens in `src/index.css`, delete `Sentinel` and the gradient/blur tokens,
and rebuild `ClaimReview.tsx` first. Every other page follows the same table and rule-list patterns.
