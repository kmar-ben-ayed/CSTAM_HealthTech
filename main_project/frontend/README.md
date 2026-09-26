# ClaimGuard AI — Web Application UI/UX

A modern, responsive, client-side pre-validation copilot for healthcare claims review officers based on the **CSTAM-VELODOC** benchmark.

## ✨ Features

- 📊 **Executive KPI Dashboard:** Real-time pass rates, defect frequencies across all 15 rules, and total value at risk (SAR).
- 📋 **Claims Review Queue:** Multi-criteria filtering (Ready/Pass, Requires Review/Fail, Uncertain/Missing Info), instant search, and claim inspection trigger.
- 🔍 **Deep Claim Inspector Workspace (Split View):**
  - **Left Panel:** Invoice details, patient/coverage summary, submitted service lines table, attached clinical documents with **Prompt Injection Shield**.
  - **Right Panel:** Interactive 15-Rule Validation Checklist with exact JSON pointer evidence paths (`/lines/0/net_amount`), severity badges, and corrective action advice.
- 🤖 **Bounded AI Copilot Synthesis:** Plain-language executive summary of findings strictly citing deterministic rule evidence without hallucinating.
- ✍️ **Human Review Action Studio:** Confirm Defect, Dismiss False Alarm, Request Info from Clinic (with email draft generator), and **Live Edit & Recheck** (inline JSON editor with real-time 15-rule re-evaluation).
- 🛡️ **Cryptographic SHA-256 Audit Blockchain:** Tamper-evident hash chain of all runs and reviewer actions with a 1-click **Integrity Verification** scanner.
- 📥 **Flexible File Ingestion:** Drop & drop JSONL (`claims.jsonl`), CSV, or FHIR R4 JSON bundles.

## 🚀 Quick Launch

### Option 1: Using Python (Recommended)
From the `CSTAM_HealthTech/frontend` directory:
```bash
python -m http.server 3000
```
Then open [http://localhost:3000](http://localhost:3000) in your browser.

### Option 2: Direct Browser Launch
Simply open [index.html](file:///c:/Users/USER/Desktop/CS/ClaimGuardAI_Student_Starter_Pack/CSTAM_HealthTech/frontend/index.html) in Chrome, Edge, Safari, or Firefox.
