# ClaimGuard Pulse — UI sample

A standalone design sample that is **not wired to the backend**. It uses synthetic data shaped like the API
responses and the real rule IDs from `backend/rules/rules.json`.

Open **`bundle.html`** in a browser. It's a single file with no server needed.
(The fonts load from Google Fonts. Offline, it falls back to system fonts.)

## Idea
Hospitals already have a mature visual language for "is something wrong here, and who decided what".
This sample borrows that language instead of the generic SaaS dashboard look:

| Hospital artefact | Becomes |
|---|---|
| **ESI triage levels** (red → blue) | Queue priority. 2+ high-severity fails = ESI 1, … clean = ESI 5 |
| **Chief complaint** | One plain sentence describing what's wrong with the claim |
| **Specimen label + barcode** | The claim's identity card |
| **ECG rhythm strip** | One heartbeat per rule. Normal beat = pass, ST-elevated spike = fail, fibrillation = unable to assess, flatline = n/a |
| **Lab report** (abnormal results in bold, flag column, reference ranges) | The rule results table |
| **Prescription pad** (℞, ruled paper, signature) | Reviewer decisions, signed into the audit chain |
| **"Discharge"** | Finishing a claim, only possible once every abnormal result has an order |
| **Bedside monitor** | Batch/ingestion run health: live traces, numbers, alarms |

Design rules: one action colour (surgical-scrub green), and red only for abnormal results.
Square corners, hairlines instead of shadows. Fonts are Archivo (variable width; condensed for headings),
JetBrains Mono for IDs and money, and Caveat only for the signature.

## Develop
```bash
npm i -g pnpm   # or use: npx pnpm@10.8.1 …
pnpm install
pnpm dev
```
Rebuild the single file: `pnpm exec vite build`, then inline `dist/` into one HTML file
(the skill's Parcel bundler couldn't load its native compiler in this sandbox, so Vite was used instead).

## Files
- `src/data.ts`: synthetic claims, rules, triage scoring
- `src/components/Ecg.tsx`: rule-rhythm strip (SVG, sweep-in animation)
- `src/components/Barcode.tsx`: decorative specimen barcode
- `src/views/Chart.tsx`: claim review (label, strip, lab panel, order pad)
- `src/views/Triage.tsx`: queue as an ER triage board
- `src/views/Monitor.tsx`: batch monitor (canvas traces, alarms)
- `src/index.css`: all design tokens and styles
