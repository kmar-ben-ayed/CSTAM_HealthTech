# ClaimGuard AI — Complete Self-Contained Frontend Prompt for VS Code Copilot

## INSTRUCTIONS TO COPILOT

You are building the complete frontend of **ClaimGuard AI**, a premium enterprise web application for healthcare claim pre-validation.

This document is the **entire design brief**. Do not assume that a Figma file, screenshot, design system, or previous implementation exists.

Build the frontend from this specification alone.

The result must look like a polished, credible product that could be shown to:

- healthcare technology companies;
- enterprise engineering teams;
- technical judges;
- investors;
- professional claims reviewers.

Do NOT make it look like a student project or a generic admin dashboard.

---

# 1. TECHNICAL STACK

Use:

- Next.js
- TypeScript
- App Router
- Tailwind CSS
- shadcn/ui
- Lucide React
- Framer Motion
- Recharts where charts are needed

Use a component-based architecture.

The frontend must be ready to connect later to a FastAPI backend.

For now, use realistic synthetic mock data behind clean service interfaces.

Do not use another frontend framework.

---

# 2. PRODUCT CONCEPT

## Product

**ClaimGuard AI**

## Tagline

**Validate claims with evidence. Decide with confidence.**

ClaimGuard AI is an **agentic AI healthcare claim pre-validation copilot**.

It combines:

1. deterministic validation rules;
2. evidence-grounded AI explanations;
3. explicit uncertainty handling;
4. human review;
5. correction and re-check;
6. complete auditability.

The core product philosophy is:

```text
Deterministic Rules
        ↓
Validation Findings
        ↓
Evidence
        ↓
Bounded AI Explanation
        ↓
Human Review
        ↓
Decision
        ↓
Audit Trail
```

### CRITICAL PRODUCT PRINCIPLE

The deterministic rule engine is authoritative.

AI does NOT override deterministic rule results.

The UI must communicate this distinction clearly.

AI should appear as an assistant that explains and contextualizes evidence, not as an autonomous authority making hidden decisions.

---

# 3. OVERALL VISUAL IDENTITY

The application should feel like:

> **Premium enterprise AI infrastructure + healthcare technology + modern SaaS.**

Visual references in spirit:

- Linear
- Vercel
- Stripe
- modern observability platforms
- premium enterprise AI products

Do NOT copy any specific company's interface.

The visual personality should be:

- intelligent;
- calm;
- precise;
- trustworthy;
- technical;
- modern;
- spacious;
- sophisticated.

The design should communicate:

**"This system is powerful, but controlled."**

---

# 4. VISUAL STYLE

## Background

Use a warm, almost-white background rather than a harsh pure white.

Suggested:

```text
Page background: #F7F8F7
Primary surface: #FFFFFF
Secondary surface: #F2F4F3
```

The interface should have generous whitespace.

Avoid visual clutter.

---

# 5. COLOR SYSTEM

Use this semantic palette.

## Primary

```text
Deep Navy / Charcoal:
#17212B

Secondary Slate:
#52606D

Muted Slate:
#7B8794

Warm Off-White:
#F7F8F7

White:
#FFFFFF

Border:
#E4E8E7
```

## Brand accent

Use a sophisticated teal/cyan.

```text
Primary Teal:
#159A9C

Light Teal:
#DDF5F3

Dark Teal:
#0C7375
```

## Semantic states

### PASS

```text
Emerald:
#159A6A
Light Emerald:
#E8F7F0
```

### FAIL

Use controlled coral rather than aggressive bright red.

```text
Coral:
#D95C5C
Light Coral:
#FBEAEA
```

### WARNING / UNABLE TO ASSESS

```text
Amber:
#C98A24
Light Amber:
#FFF5DE
```

### Neutral / NOT APPLICABLE

```text
Neutral:
#7B8794
Light Neutral:
#EEF1F2
```

Use semantic colors sparingly.

Do not make entire cards saturated.

Prefer:

- small status indicators;
- badges;
- icons;
- borders;
- subtle glows.

---

# 6. TYPOGRAPHY

Use **Geist** if available.

Otherwise use **Inter**.

Typography must feel modern and editorial.

## Headings

Use strong but not oversized headings.

Landing page:

- large, elegant hero headline;
- compact supporting text.

Application:

- clear page titles;
- medium-weight section titles.

## Body

Highly readable.

Avoid tiny text.

## Technical values

Use a monospace font only for:

- rule IDs;
- claim IDs;
- run IDs;
- hashes;
- technical metadata;
- evidence paths.

---

# 7. BORDER RADIUS

Use moderate modern radii.

Do not make everything extremely rounded.

Suggested:

```text
Cards: 14px
Buttons: 9px
Inputs: 9px
Badges: 999px
Dialogs: 16px
Large panels: 18px
```

The design should feel polished rather than playful.

---

# 8. SHADOWS

Use extremely subtle shadows.

Most separation should come from:

- whitespace;
- borders;
- surface contrast.

Avoid heavy floating-card shadows.

---

# 9. THE CLAIMGUARD SENTINEL

Create one signature visual component:

**ClaimGuard Sentinel**

It should appear across the product in different contexts.

## Concept

The Sentinel is an abstract:

**shield + orbit + central point**

It represents:

- protection;
- validation;
- evidence;
- controlled intelligence.

It is NOT a humanoid robot.

It must look sophisticated and technical.

---

# 10. SENTINEL VISUAL

The Sentinel consists of:

### Outer shield

A minimal geometric shield outline.

### Orbit

One thin elliptical orbit around the shield.

### Central point

A small glowing point representing the claim evaluation process.

### Optional scan line

During validation, a thin line sweeps through the system.

---

# 11. SENTINEL STATES

## Idle

Slow subtle orbit.

The central point gently pulses.

Animation should almost be imperceptible.

---

## Scanning

When validation is running:

- orbit becomes faster;
- scan line moves across the shield;
- central point pulses;
- small particles may move along the orbit.

Do not make it flashy.

---

## PASS

The Sentinel transitions smoothly to emerald.

Use:

- emerald glow;
- small confirmation pulse;
- stable orbit.

---

## FAIL

The Sentinel transitions to coral.

Use:

- controlled coral pulse;
- slightly stronger visual emphasis;
- no aggressive flashing.

---

## UNABLE TO ASSESS

Use amber.

The orbit slows.

Show a subtle question/uncertainty visual.

---

## HUMAN REVIEW

When a reviewer takes control:

- orbit slows or pauses;
- human-review indicator appears;
- visual emphasis shifts from AI/system activity to human action.

This is important because the product explicitly has a human-in-the-loop philosophy.

---

# 12. SENTINEL INTERACTION

The Sentinel should react to user interaction.

Examples:

### Hover

- orbit slightly accelerates;
- central point responds;
- subtle glow.

### Scroll

On important landing-page sections:

- Sentinel changes state as the user reaches different sections.

Example:

```text
Hero → IDLE

Validation section → SCANNING

Evidence section → EVIDENCE / teal

Review section → HUMAN REVIEW

Audit section → VERIFIED
```

### Click

Clicking the Sentinel can open a small explanatory panel:

```text
ClaimGuard Sentinel

Deterministic validation
Evidence grounding
Human oversight
Auditability
```

Use Framer Motion.

Respect `prefers-reduced-motion`.

---

# 13. LANDING PAGE

Route:

```text
/
```

The landing page should feel like the homepage of a real enterprise AI product.

---

## 13.1 Navbar

Left:

**ClaimGuard AI**

with a minimal shield mark.

Center/right navigation:

- Product
- How it works
- Validation
- Auditability

Right:

- Documentation
- Open dashboard

Keep it minimal.

---

# 14. HERO SECTION

Hero composition:

Left side:

### Small eyebrow

```text
AI-ASSISTED HEALTHCARE CLAIM VALIDATION
```

### Main headline

```text
Validate claims with evidence.
Decide with confidence.
```

Use a large but elegant heading.

### Supporting paragraph

Explain:

> ClaimGuard combines deterministic validation, evidence-grounded AI explanations, and human review to make healthcare claim pre-validation traceable and actionable.

### Buttons

Primary:

```text
Open ClaimGuard
```

Secondary:

```text
Explore how it works
```

Right side:

Large animated ClaimGuard Sentinel.

Around it, show subtle system labels:

```text
RULE ENGINE
EVIDENCE
AI ASSIST
HUMAN REVIEW
AUDIT
```

These should appear like a sophisticated system visualization.

---

# 15. HERO VISUAL ANIMATION

The hero should not be a static illustration.

Create a subtle animated system:

```text
Claim
 ↓
Rules
 ↓
Evidence
 ↓
AI
 ↓
Review
```

Elements can orbit around the Sentinel.

Use restrained motion.

The page should feel alive without looking like a gaming website.

---

# 16. TRUST / PRODUCT PRINCIPLES

Immediately after the hero, create a section with four or five principles.

Cards:

### Deterministic first

Rules provide the authoritative validation result.

### Evidence grounded

AI explanations reference available evidence.

### Explicit uncertainty

The system can say:

**UNABLE TO ASSESS**

instead of inventing an answer.

### Human in the loop

Reviewers can confirm, dismiss, request information, and re-check.

### Fully traceable

Important actions are recorded in the audit trail.

Use small icons and elegant cards.

---

# 17. PRODUCT FLOW SECTION

Create a visual horizontal workflow.

```text
01
CLAIM RECEIVED

↓

02
VALIDATION

↓

03
FINDINGS

↓

04
EVIDENCE

↓

05
AI EXPLANATION

↓

06
HUMAN REVIEW

↓

07
DECISION

↓

08
AUDIT
```

On hover:

- step expands;
- Sentinel reacts;
- short explanation appears.

---

# 18. VALIDATION SECTION

Show an example claim being evaluated.

Create a large premium UI mockup inside the landing page.

Example:

```text
Claim #CLM-2026-00421

Validation status
NEEDS REVIEW

12 rules passed
1 failed
2 unable to assess
```

Show small rule cards underneath.

---

# 19. EVIDENCE + AI SECTION

Split the section into two visual panels.

Left:

**Evidence**

Show:

```text
Authorization
→ claim.authorization.reference

Source
→ Claim document v2

Availability
→ Missing
```

Right:

**AI Explanation**

Show:

> The rule engine could not verify the authorization because the required reference is unavailable in the supplied claim data.

Clearly label:

```text
AI-GENERATED EXPLANATION
```

The AI explanation must never visually replace the deterministic finding.

---

# 20. HUMAN REVIEW SECTION

Show a reviewer interface.

Example:

```text
Finding R008
Authorization reference missing

FAIL

[ Confirm ]
[ Dismiss ]
[ Request information ]
```

Explain that the reviewer remains in control.

---

# 21. AUDIT SECTION

Show a beautiful audit timeline.

Example:

```text
09:41:02  Claim received
09:41:03  Validation started
09:41:05  R008 finding created
09:41:06  AI explanation generated
09:44:21  Reviewer confirmed finding
09:47:02  Claim re-checked
```

Show:

```text
✓ Audit chain verified
```

---

# 22. FINAL LANDING CTA

End with a premium dark section.

Text:

```text
Validate with evidence.
Review with confidence.
Trace every decision.
```

CTA:

```text
Open ClaimGuard
```

Place the Sentinel in the background.

---

# 23. APPLICATION SHELL

Routes:

```text
/dashboard
/claims
/claims/[claimId]
/review
/runs
/audit
/rules
/analytics
/settings
```

After entering the application, use a persistent shell.

---

# 24. SIDEBAR

Width around 240–260px on desktop.

Top:

```text
[shield icon]
ClaimGuard AI
```

Navigation:

```text
Overview
Claims
Review Queue
Runs
Audit Trail
Rules
Analytics
Settings
```

Each navigation item has:

- Lucide icon;
- label;
- hover state;
- active state.

Active state:

- subtle teal background;
- teal icon;
- dark text.

Do not use huge colored blocks.

Bottom:

```text
Environment
Demo / Development
```

and user profile.

---

# 25. TOP BAR

Top bar includes:

Left:

```text
Breadcrumbs
```

Center/right:

- search;
- notifications;
- help;
- user avatar.

Keep it around 64px high.

---

# 26. DASHBOARD

Route:

```text
/dashboard
```

Header:

```text
Good morning

Claim validation overview
```

Subtext:

```text
Monitor validation activity, findings, review workload and system integrity.
```

---

# 27. DASHBOARD KPI CARDS

Four cards:

### Claims processed

Example:

```text
1,284
```

### Needs review

Example:

```text
42
```

### Unable to assess

Example:

```text
17
```

### Issues detected

Example:

```text
86
```

Each card contains:

- label;
- large number;
- tiny contextual metadata;
- semantic icon.

Use subtle visual differences.

---

# 28. DASHBOARD MAIN AREA

Below KPIs:

Left large panel:

**Review Queue**

Right smaller panel:

**Recent Activity**

---

# 29. REVIEW QUEUE TABLE

Columns:

```text
Claim
Provider
Status
Findings
Last run
Reviewer
Action
```

Example:

```text
CLM-2026-00421
Clinique Atlas
NEEDS REVIEW
3
2 min ago
Unassigned
Review
```

Rows should have hover states.

Clicking opens the claim workspace.

---

# 30. RECENT ACTIVITY

Vertical timeline.

Examples:

```text
Claim #00421 validated
2 min ago

R008 finding created
3 min ago

Reviewer confirmed R005
8 min ago

Run #RUN-183 completed
11 min ago
```

---

# 31. CLAIMS PAGE

Route:

```text
/claims
```

Header:

```text
Claims

Review and inspect healthcare claims processed by ClaimGuard.
```

Controls:

- search;
- status filter;
- provider filter;
- date filter.

Tabs:

```text
All
Needs Review
Pass
Fail
Unable to Assess
```

---

# 32. CLAIMS TABLE

Columns:

```text
Claim ID
Status
Provider
Service
Amount
Findings
Last Run
Reviewer
```

Use:

- compact row height;
- subtle separators;
- hover;
- clear statuses.

No giant cards for every claim.

This is an enterprise data table.

---

# 33. CLAIM DETAIL / REVIEW WORKSPACE

Route:

```text
/claims/[claimId]
```

This is the most important screen in the entire application.

The user should immediately understand:

1. what claim is being evaluated;
2. what rules found;
3. why they found it;
4. what evidence exists;
5. what AI says;
6. what the human reviewer can do.

---

# 34. REVIEW WORKSPACE LAYOUT

Desktop:

```text
┌─────────────────────────────────────────────────────────────┐
│ Claim header + status + Sentinel + actions                  │
├────────────────┬───────────────────────┬────────────────────┤
│ CLAIM          │ VALIDATION FINDINGS   │ EVIDENCE           │
│ INFORMATION    │                       │ + AI EXPLANATION   │
│                │                       │                    │
│ provider       │ R001 PASS             │ Evidence source    │
│ service        │ R002 PASS             │                    │
│ amount         │ R008 FAIL             │ Evidence path      │
│ dates          │ R009 UNABLE           │                    │
│ metadata       │                       │ AI explanation     │
│                │                       │                    │
├────────────────┴───────────────────────┴────────────────────┤
│ Reviewer actions                                            │
└─────────────────────────────────────────────────────────────┘
```

Use approximately:

```text
Left: 25%
Center: 40%
Right: 35%
```

---

# 35. CLAIM HEADER

At the top:

```text
Claim #CLM-2026-00421
```

Status:

```text
NEEDS REVIEW
```

Show:

- Sentinel;
- provider;
- service;
- amount;
- latest run;
- timestamp.

Buttons:

```text
Re-check
```

and optionally:

```text
More
```

---

# 36. CLAIM INFORMATION PANEL

Display:

```text
Claim information

Provider
Clinique Atlas

Service
Outpatient consultation

Amount
TND 240.00

Submission date
18 Sep 2026

Claim type
Outpatient
```

Use synthetic values.

---

# 37. FINDINGS PANEL

Header:

```text
Validation findings
```

Show summary:

```text
12 passed
1 failed
2 unable to assess
```

Then findings.

---

# 38. FINDING CARD

Every finding contains:

```text
R008
Authorization reference

FAIL
```

Then:

```text
Expected
Authorization reference must be present.

Observed
Authorization reference is missing.
```

Then:

```text
Rule version
v1.3
```

Use a small expand/collapse interaction.

---

# 39. FINDING EXAMPLE: FAIL

Use:

```text
R008 — Authorization Reference

FAIL

Expected
Authorization reference must be present.

Observed
Authorization reference missing.
```

Use coral only as a restrained status indicator.

---

# 40. FINDING EXAMPLE: UNABLE TO ASSESS

Use:

```text
R009 — Authorization Validity

UNABLE TO ASSESS

Required authorization validity information is unavailable.

The system does not infer a result when required evidence is missing.
```

This is a major product principle.

Make **UNABLE TO ASSESS** visually distinct from FAIL.

---

# 41. EVIDENCE PANEL

Right side.

Header:

```text
Evidence
```

For each finding:

```text
Source
Claim document v2

Path
claim.authorization.reference

Value
Not available
```

Use monospace for technical paths.

Add:

```text
View source
```

if appropriate.

---

# 42. AI EXPLANATION PANEL

Below evidence.

Use a slightly different background.

Header:

```text
AI explanation
```

Small badge:

```text
GROUNDED IN AVAILABLE EVIDENCE
```

Example:

> The rule engine could not verify the authorization because the required authorization reference is not present in the supplied claim information.

At the bottom:

```text
This explanation does not modify the deterministic rule result.
```

This sentence reinforces the architecture.

---

# 43. REVIEW ACTIONS

Sticky bottom action bar.

Actions:

Primary:

```text
Confirm finding
```

Secondary:

```text
Request information
```

Secondary:

```text
Dismiss
```

Tertiary:

```text
Add note
```

And:

```text
Re-check
```

Dangerous/destructive actions require confirmation.

---

# 44. REVIEW QUEUE

Route:

```text
/review
```

Header:

```text
Review Queue
```

Subtext:

```text
Claims requiring human attention.
```

Filters:

- status;
- severity;
- rule;
- reviewer;
- date.

Use an enterprise table/list.

Each item should show:

```text
Claim
Highest-priority finding
Number of findings
Reviewer
Updated
Review
```

---

# 45. RUNS PAGE

Route:

```text
/runs
```

Header:

```text
Validation Runs
```

Display runs in a table.

Columns:

```text
Run ID
Claim
Status
Ruleset
Source Version
Started
Completed
Findings
```

---

# 46. RUN DETAIL

Show:

### Run metadata

```text
Run ID
Timestamp
Claim ID
Source version
Ruleset version
Application version
Model version
Prompt version
```

### Summary

Show:

```text
Rules evaluated
Passed
Failed
Unable to assess
```

### Timeline

```text
Run started
Rules evaluated
Findings generated
AI explanations generated
Run completed
```

---

# 47. ANALYTICS

Route:

```text
/analytics
```

Create a clean analytics page.

Possible charts:

- claims processed over time;
- validation outcomes;
- findings by rule;
- review workload;
- unable-to-assess rate;
- evaluation metrics.

Use Recharts.

Charts should be:

- minimal;
- readable;
- lightly labeled;
- not decorative.

---

# 48. AUDIT TRAIL

Route:

```text
/audit
```

This is a core feature.

Header:

```text
Audit Trail
```

Subtext:

```text
Trace important system and reviewer actions across claims and validation runs.
```

---

# 49. AUDIT INTEGRITY HEADER

At the top show:

```text
✓ Audit chain verified
```

with a button:

```text
Verify chain
```

Use a calm emerald indicator.

Do not claim:

> "Impossible to modify."

Instead communicate:

> "Integrity verified."

---

# 50. AUDIT TIMELINE

Events:

```text
Claim received

Validation started

Rule evaluated

Finding created

AI explanation generated

Reviewer action

Claim re-checked
```

Each event includes:

- timestamp;
- event type;
- actor;
- claim;
- run;
- rule if applicable.

---

# 51. AUDIT EVENT DETAIL

Clicking an event opens a drawer.

Show:

```text
Event ID
Timestamp
Event type
Actor type
Actor ID
Claim ID
Run ID
Rule ID
Rule version
Outcome
Previous hash
Event hash
```

Hash values use monospace.

Keep sensitive claim content out of the audit record UI.

---

# 52. RULES PAGE

Route:

```text
/rules
```

Show a rules catalog.

Table:

```text
Rule ID
Rule
Category
Status
Version
Last updated
```

Example:

```text
R001
Required claim fields
Active
v1.2

R008
Authorization reference
Active
v1.3

R009
Authorization validity
Active
v1.1
```

---

# 53. RULE DETAIL

Clicking a rule opens a detail page/drawer.

Show:

```text
R008

Authorization Reference

Description

Expected

Observed

Evidence

Version

Last updated
```

Make the rule itself feel authoritative and technical.

---

# 54. SETTINGS

Route:

```text
/settings
```

Sections:

```text
Profile
Review preferences
Ruleset configuration
AI configuration
System information
```

Use standard enterprise settings patterns.

---

# 55. EMPTY STATES

Never show an empty white page.

Example:

```text
No claims found

No claims match the current filters.

[Clear filters]
```

Use subtle Sentinel illustration when useful.

---

# 56. LOADING STATES

Use skeleton loading.

Maintain the page structure while loading.

Do not show giant spinners.

---

# 57. ERROR STATES

Example:

```text
We couldn't load this claim.

Something went wrong while retrieving the claim data.

[Try again]
```

Never show raw stack traces.

---

# 58. TOASTS

Use subtle toast notifications.

Examples:

```text
Finding confirmed.
```

```text
Re-check started.
```

```text
Audit chain verified.
```

```text
Reviewer note added.
```

---

# 59. MODALS / DRAWERS

Use dialogs for:

- destructive confirmations;
- reviewer actions;
- adding notes;
- requesting information.

Use drawers for:

- audit event details;
- technical metadata;
- secondary information.

Do not use giant modal windows.

---

# 60. RESPONSIVE DESIGN

Desktop is the main target.

Tablet:

- collapse sidebar;
- preserve data hierarchy.

Mobile:

- sidebar becomes drawer;
- three-column claim workspace becomes stacked;
- tables become horizontally scrollable;
- actions remain accessible;
- cards retain hierarchy.

Never allow important content to become unreadably compressed.

---

# 61. ACCESSIBILITY

Implement:

- semantic HTML;
- keyboard navigation;
- focus states;
- aria labels;
- sufficient contrast;
- reduced motion;
- visible text labels.

Never communicate a state through color alone.

Example:

PASS must contain:

```text
✓ PASS
```

not just a green dot.

FAIL:

```text
× FAIL
```

UNABLE:

```text
! UNABLE TO ASSESS
```

---

# 62. MOTION DESIGN

Use Framer Motion.

Motion should be subtle.

Use it for:

- page entry;
- panel expansion;
- drawer opening;
- status transitions;
- Sentinel;
- hover interactions;
- validation progress.

Do not animate everything.

Recommended micro-interaction duration:

```text
150–250ms
```

Longer transitions should be rare.

---

# 63. MOCK DATA

Create realistic synthetic data.

At minimum:

### Claims

10+ claims.

Statuses should include:

- PASS;
- FAIL;
- NEEDS REVIEW;
- UNABLE TO ASSESS.

### Findings

Include:

- passed rules;
- failed rules;
- unable-to-assess rules;
- not-applicable rules.

### Runs

At least several runs with different timestamps and outcomes.

### Audit events

At least 20 realistic events.

Use fictional healthcare organizations.

Do not use real patient information.

---

# 64. IMPORTANT MOCK CLAIM

Create one main demonstration claim:

```text
Claim ID:
CLM-2026-00421

Provider:
Clinique Atlas

Service:
Outpatient consultation

Amount:
TND 240.00

Status:
NEEDS REVIEW
```

Findings:

```text
12 PASS
1 FAIL
2 UNABLE TO ASSESS
```

Important rule:

```text
R008 — Authorization Reference
FAIL
```

Second important rule:

```text
R009 — Authorization Validity
UNABLE TO ASSESS
```

This claim should be the main demo path through the application.

---

# 65. DEMO USER FLOW

The frontend must make this journey easy:

```text
Landing
   ↓
Dashboard
   ↓
Claims
   ↓
Open CLM-2026-00421
   ↓
Review validation findings
   ↓
Open R008
   ↓
Inspect evidence
   ↓
Read AI explanation
   ↓
Confirm finding
   ↓
Re-check claim
   ↓
Open new run
   ↓
Open Audit Trail
   ↓
Verify audit chain
```

This is the primary demo story.

---

# 66. COMPONENT ARCHITECTURE

Use reusable components.

Suggested structure:

```text
app/
  page.tsx
  dashboard/
  claims/
  review/
  runs/
  audit/
  rules/
  analytics/
  settings/

components/
  layout/
    Sidebar.tsx
    TopBar.tsx

  sentinel/
    ClaimGuardSentinel.tsx

  dashboard/
    MetricCard.tsx
    ReviewQueue.tsx
    ActivityTimeline.tsx

  claims/
    ClaimTable.tsx
    ClaimHeader.tsx
    ClaimInformation.tsx
    ClaimStatus.tsx

  findings/
    FindingCard.tsx
    FindingSummary.tsx
    FindingStatus.tsx

  evidence/
    EvidencePanel.tsx

  ai/
    AIExplanation.tsx

  review/
    ReviewWorkspace.tsx
    ReviewActions.tsx
    RecheckDialog.tsx
    ReviewerNoteDialog.tsx

  audit/
    AuditTimeline.tsx
    AuditEvent.tsx
    AuditEventDrawer.tsx
    AuditIntegrity.tsx

  runs/
    RunTable.tsx
    RunSummary.tsx
    RunMetadata.tsx

  rules/
    RulesTable.tsx
    RuleDetail.tsx

  ui/
    ...
```

Adapt this structure if necessary.

---

# 67. TYPESCRIPT TYPES

Use explicit types.

Example:

```ts
type ValidationStatus =
  | "PASS"
  | "FAIL"
  | "UNABLE_TO_ASSESS"
  | "NOT_APPLICABLE";

type ClaimStatus =
  | "PASS"
  | "FAIL"
  | "NEEDS_REVIEW"
  | "UNABLE_TO_ASSESS";

interface Claim {
  id: string;
  provider: string;
  service: string;
  amount: number;
  status: ClaimStatus;
  submittedAt: string;
  lastRunId?: string;
}

interface Finding {
  id: string;
  ruleId: string;
  ruleVersion: string;
  title: string;
  status: ValidationStatus;
  expected?: string;
  observed?: string;
  explanation?: string;
}

interface AuditEvent {
  eventId: string;
  timestamp: string;
  eventType: string;
  actorType: string;
  actorId?: string;
  claimId?: string;
  runId?: string;
  ruleId?: string;
  ruleVersion?: string;
  outcome?: string;
  previousHash?: string;
  eventHash?: string;
}
```

Use the actual backend contract later when available.

---

# 68. API ARCHITECTURE

Prepare the frontend for FastAPI.

Conceptual endpoints:

```text
GET /claims
GET /claims/{id}
GET /claims/{id}/findings

GET /runs
GET /runs/{id}

GET /audit
POST /audit/verify

POST /review-actions
POST /claims/{id}/recheck
```

Create service abstractions.

Example:

```text
lib/api/claims.ts
lib/api/runs.ts
lib/api/audit.ts
lib/api/review.ts
```

Mock implementations should follow the same interfaces as the future API.

Do not scatter mock data directly throughout components.

---

# 69. CODE QUALITY

The frontend must be maintainable.

Do:

- reusable components;
- explicit types;
- semantic naming;
- clean state management;
- small focused components;
- centralized mock data;
- centralized API functions;
- accessible UI;
- consistent spacing.

Do not:

- duplicate entire pages;
- put giant components in one file;
- hard-code the same values everywhere;
- mix API logic into presentation components;
- use arbitrary CSS everywhere when Tailwind/design tokens can handle it.

---

# 70. DO NOT INVENT FEATURES

Do not add:

- fake patient diagnosis;
- treatment recommendations;
- medical decision-making;
- unsupported AI autonomy;
- fabricated confidence scores;
- fake backend metrics presented as real;
- unsupported healthcare capabilities.

ClaimGuard is a **claim pre-validation and review support system**.

Keep the scope precise.

---

# 71. DO NOT MAKE THE AI LOOK OMNIPOTENT

The interface must visually communicate:

```text
RULE ENGINE
    ↓
AUTHORITATIVE RESULT

AI
    ↓
GROUNDED EXPLANATION

HUMAN
    ↓
REVIEW / DECISION
```

Never create a giant chatbot interface as the center of the product.

AI is a component of ClaimGuard, not the entire product.

---

# 72. DO NOT OVERDESIGN

Avoid:

- excessive glassmorphism;
- neon gradients;
- glowing everything;
- huge 3D illustrations;
- cartoon robots;
- generic AI brain imagery;
- excessive rounded containers;
- excessive animations;
- dark cyberpunk dashboards.

Premium means **controlled**, not overloaded.

---

# 73. FINAL VISUAL QUALITY BAR

The final result should feel like a product that could plausibly be launched as an enterprise SaaS.

It should have:

- strong visual hierarchy;
- excellent whitespace;
- consistent components;
- precise status semantics;
- beautiful but restrained motion;
- polished tables;
- professional charts;
- excellent claim-review UX;
- clear evidence/AI separation;
- credible auditability;
- responsive behavior.

The most visually important screen is:

**Claim Review Workspace**

The most distinctive visual element is:

**ClaimGuard Sentinel**

The most important architectural visual distinction is:

**Deterministic result vs Evidence vs AI explanation vs Human decision**

---

# 74. IMPLEMENTATION ORDER

Implement in this order:

### Phase 1 — Foundation

1. Next.js setup
2. Tailwind
3. shadcn/ui
4. fonts
5. design tokens
6. global layout
7. Sidebar
8. TopBar
9. Sentinel

### Phase 2 — Core application

10. Dashboard
11. Claims table
12. Claim detail
13. Findings
14. Evidence panel
15. AI explanation
16. Reviewer actions

### Phase 3 — Operations

17. Review Queue
18. Runs
19. Audit Trail
20. Rules
21. Analytics
22. Settings

### Phase 4 — Polish

23. Responsive behavior
24. Loading states
25. Empty states
26. Error states
27. Accessibility
28. Motion
29. Toasts
30. Final visual consistency

---

# 75. COPILOT EXECUTION RULES

Before coding:

1. Inspect the repository.
2. Reuse existing configuration when possible.
3. Do not delete working project functionality.
4. Establish the design tokens first.
5. Build reusable components.
6. Build the shell.
7. Build the main demo flow.
8. Keep mock data centralized.
9. Keep API boundaries clean.
10. Run type checks.
11. Run lint.
12. Fix errors.
13. Check responsive layouts.
14. Check keyboard accessibility.
15. Check reduced-motion behavior.

Do not stop after generating one attractive page.

The objective is the **complete product experience**.

---

# 76. DEFINITION OF DONE

The frontend is complete when:

- [ ] Landing page is polished.
- [ ] Dashboard works.
- [ ] Claims page works.
- [ ] Claim detail works.
- [ ] Review workspace works.
- [ ] Findings work.
- [ ] Evidence panel works.
- [ ] AI explanation works.
- [ ] Reviewer actions work.
- [ ] Re-check workflow works.
- [ ] Review Queue works.
- [ ] Runs works.
- [ ] Audit Trail works.
- [ ] Audit verification UI works.
- [ ] Rules page works.
- [ ] Analytics works.
- [ ] Settings works.
- [ ] Sentinel works.
- [ ] Loading states exist.
- [ ] Empty states exist.
- [ ] Error states exist.
- [ ] Responsive design works.
- [ ] Accessibility basics work.
- [ ] Reduced motion works.
- [ ] TypeScript is clean.
- [ ] No obvious console errors.
- [ ] Mock API layer is replaceable by FastAPI.

---

# 77. FINAL DIRECTIVE

Build **ClaimGuard AI** as a premium, production-quality enterprise application.

The interface must make the following story immediately understandable:

> A healthcare claim enters the system.
>
> Deterministic rules evaluate it.
>
> Findings are produced.
>
> Evidence explains why.
>
> AI helps summarize and ground the explanation.
>
> If the system cannot establish a result, it explicitly says so.
>
> A human reviewer can confirm, dismiss, request information, or trigger a re-check.
>
> Every important action can be traced through the audit trail.

The result should feel:

**precise, trustworthy, intelligent, modern, calm, technical, and premium.**

Do not build a generic dashboard.

Build **ClaimGuard AI**.
