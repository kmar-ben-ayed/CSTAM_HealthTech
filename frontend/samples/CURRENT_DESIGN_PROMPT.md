Describe / recreate this web app UI:

**Product:** "ClaimGuard AI", an internal workspace where health-insurance claim reviewers check claims against payer rules (R001–R015). Each rule result is PASS, FAIL, UNABLE_TO_ASSESS, NOT_APPLICABLE or "needs review". The app also has AI-written explanations, a hash-chained audit log and data upload. Stack: React 19 + TypeScript + Vite, React Router, Tailwind 4 plus a large hand-written CSS token file. Light, dark and system themes.

**Overall look:** a modern, polished SaaS dashboard. Soft off-white canvas (#f3f4f6) with dark charcoal text (#0f172a). Cards are translucent white (92% opacity) with glassmorphism (`backdrop-filter: blur(12px)`), thin 8%-opacity borders, layered soft shadows and a faint white highlight line along the top edge. Corners are generously rounded on one scale: 6px chips, 9px buttons and inputs, 13px inner cards, 18px panels, 26px hero surfaces, and pills. The accent is teal/cyan (#0e7490), with a cyan→blue diagonal gradient (#0891b2 → #3b82f6) on hero and brand elements. The landing page uses a brighter #00f2fe → #4facfe gradient.

**Type:** Segoe UI / system sans for everything. Headings are bold with tight negative letter-spacing (−0.035em). Small uppercase labels have wide tracking (0.07em). A monospace font is used for IDs and evidence. "Syne" is requested for a few display titles but never loaded, so it falls back.

**Status colours:** Tailwind-style semantic pairs, each with a vivid hue for dots and bars, a darker "ink" for text, a pale background and a border. Pass = emerald #10b981, Fail = red #ef4444, Unable to assess = amber #f59e0b, N/A = slate #64748b, Review = cyan #0891b2. Statuses appear as rounded pill badges with coloured dots.

**Dark mode:** navy canvas #0b1220, translucent navy cards, accent flips to bright cyan #22d3ee, and status colours become 14%-opacity tints.

**App shell:**
- A fixed 240px dark-navy sidebar (#0f172a) with the logo at the top and three sections: WORKSPACE (Overview, Claims, Review Queue), WORKFLOW (Runs, Audit Trail, Ingest Data) and CONFIGURE (Policy & Rules, System Admin, Analytics). The active item is highlighted in sky-blue (#38bdf8) at 16% opacity.
- A frosted, semi-transparent top bar with breadcrumbs, a global search modal (⌘K style), a notifications popover, a theme toggle and a profile menu.
- On mobile the sidebar becomes a slide-in overlay.

**Mascot:** "Sentinel", an animated SVG shield icon with an orbiting ring and a glowing core. Its state (idle, scanning, pass, fail, uncertain, review) changes the colour, the inner symbol and the pulse/orbit animation speed. It appears next to claims and rules.

**Pages:**
- **Landing:** a marketing page with a frosted nav and a large hero ("FUTURE MEDICINE" watermark, gradient accents, "Open Review Workspace" button). Sections: Principles (Deterministic Rules, Grounded AI, Human Oversight, Auditability), a 4-step workflow (Claim received → Rules evaluated → Evidence inspected → Reviewer decides), rule examples and trust badges.
- **Login:** split screen, with a dark brand panel (43% width) on the left and a frosted login card on the right. Email/password fields, "Remember me", a forgot-password view and a shake animation on error. Demo login only.
- **Dashboard:** a row of 4 KPI cards (Claims processed, Needs review, Unable to assess, Issues detected). Then a "Priority review" table (Claim, Provider, Service date, Findings, Status, Updated, Action), a "Latest evaluation" run-details card and a "Recent activity" feed.
- **Claims:** status filter chips with counts (All, Passed, Failed, Needs Review, Unable to Assess), a search bar and provider select. Below them is a responsive grid of claim cards, each with a Sentinel icon, provider, member, a facts grid (service date, amount, findings, diagnosis…), a progress bar, severity tags and rule-ID chips.
- **Claim Review:** a header with the claim title and action buttons over three panels:
  - a collapsible "Claim context" panel (IDs, dates, amounts, lines, FHIR payload drawer);
  - "Review findings", with rules grouped by status in collapsible groups of rule cards ("Inspect finding →");
  - an inspector panel showing the selected rule's evidence block, the AI explanation with confidence/grounding info, and review actions (confirm issue, dismiss with reason, request information, mark corrected for recheck).
- **Review Queue:** tabs (High Priority, Waiting for Info, Ready for Re-check), sort options and a table (Claim ID, Provider, Priority, Validation, Review Status, Top Finding, Last Action).
- **Ingest Data:** format cards (JSON/JSONL, CSV pack, FHIR) and a drop zone. A 4-step animated progress (Preparing → Normalizing → Applying rules → Creating findings) leads to a result summary (accepted, rejected, require review) with a list of rejected records.
- **Runs:** run history with KPI tiles, a status distribution and a per-rule findings breakdown table with distribution bars.
- **Audit Trail:** filters (claim ID, actor human/system, event type), an event list and a detail panel showing the hash chain (previous hash → event hash, "Verified").
- **Policy & Rules:** a policy matrix (submission window, currency, network, auth required, documents) and a searchable rules catalogue table with a slide-over rule-detail panel.
- **System Admin:** a config-file editor with tabs (Validation Rules, Policies, Diagnoses Codes, Providers, Services), form fields, key/value rows and a save toast.
- **Analytics:** filter bar (Period, Dataset, Policy), KPI cards and charts (volume, outcomes, findings by rule, unable-to-assess trend, missing evidence). The data is hard-coded.

**Motion:** fade-in-up on page load, skeleton shimmer loaders, slide-in panels, popover scale-in, count-up numbers, and the Sentinel's continuous pulse and orbit animations.
