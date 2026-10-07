# Project Specification: ClyHealth / SmartCare AI Health Platform

Create a modern, high-tech, and interactive AI healthcare web application inspired by the design system, including a full landing page and a detailed health analytics dashboard ("Digital Twin & Epigenetic Risk Profile").

---

## 1. Visual & Aesthetic Style Guide

* **Theme/Vibe:** Futuristic, medical AI, sleek, clean, high-contrast data visualization, soft glassmorphism accents.
* **Background:** 
  * Soft off-white / cool slate-gray base (`#EBF0F5` to `#F3F6F9`) with dynamic ambient light-blue and cyan gradients.
  * Subtle 3D background shapes or watermark grid accents.
* **Containers & Cards:**
  * Floating white glassmorphism cards (`background: rgba(255, 255, 255, 0.88)`, `backdrop-filter: blur(16px)`).
  * Rounded corners (`border-radius: 16px` to `24px`) with soft borders (`border: 1px solid rgba(255, 255, 255, 0.6)`).
* **Typography:**
  * Clean, geometric sans-serif (e.g., *Plus Jakarta Sans*, *Inter*, or *Outfit*).
  * Bold numerical stats with small unit indicators (e.g., `47` `yrs`, `97.5` `kg`).
* **Color Palette:**
  * **Primary Text:** Dark Slate / Charcoal (`#0F172A`)
  * **Status Colors:**
    * **Optimal / Low Risk:** Green/Teal (`#10B981`)
    * **Suboptimal / Moderate Risk:** Amber/Orange (`#F59E0B`)
    * **Critical / High Risk:** Coral Red (`#EF4444`)
  * **Accents:** Electric Blue (`#2563EB`) and Cyan/Teal (`#06B6D4`)

---

## 2. Page & Layout Structure

The app contains two primary views/tabs:
1. **Landing Page View** (SmartCare AI Landing Page)
2. **Health Analytics Dashboard View** (ClyHealth Digital Twin Dashboard)

---

### Page 2: Dashboard Layout Breakdown ("ClyHealth Dashboard")

#### A. Top Header & Vitals Bar
* **Logo (Left):** `ClyHealth` with a colorful multi-dot/ribbon icon badge.
* **Breadcrumb Navigation:** `🏠 / System Reports / Methylation risk score`
* **Vitals Bar (Top Right Overlay):**
  * **Biological age:** `47 yrs` (Blue indicator)
  * **Chronological age:** `42 yrs`
  * **Sex:** `Male ♂`
  * **Weight:** `97.5 kg` (`▲ +1.5 kg`)
  * **Insight Banner Pill:** Highlighted card: *"Your body is aging **5 years** faster than your chronological age."* (Red text accent).

---

#### B. Left Column - Upper Grid

##### 1. Methylation Risk Score Card
* **Header:** `Methylation Risk Score`
* **Score Indicator:** `0.76 % / 45` `Actual age` with a status pill `● Moderate Risk`.
* **Gradient Risk Meter:** Horizontal bar moving from green (Low) -> yellow (Medium) -> red (High) with a vertical position marker at `0.76%`.
* **Risk Breakdown:**
  * Title: `Risk Score`
  * Micro-copy: *"You have an 18.4% risk of a cardiovascular event in 10 years, placing you in the moderate risk category for your age and gen..."*
* **Areas of Concern Badges:**
  * Filter pills: `[● Atrial Fibrillation]` `[● Pulmonary Embolism]` `[● Hypertension]` color-coded by risk level.

##### 2. "Why The Risk?" Card
* **Header:** `Why The Risk?` + `[View all data]` button.
* **Primary Factors Stack:**
  1. **Elevated LDL Cholesterol:** `145 mg/dL` -> *"Increases plaque buildup in arteries"*
  2. **High Blood Pressure:** `130/85 mmHg` -> *"Puts extra strain on the heart and blood vessels"*
  3. **Sedentary Lifestyle:** *"Increases cholesterol & BP"*
  4. **Heart disease in family:** *"Increases baseline risk"*

---

#### C. Left Column - Lower Grid: Epigenetic Disease Risk Profile
* **Section Title:** `Epigenetic Disease Risk Profile`
* **Risk Cards Row (3 Columns):**
  
  1. **T2 Diabetes** (Badge: `Suboptimal` - Orange)
     * Polygenic risk score: `44th percentile`
     * Genetic markers: `[TCF7L2]` `[PPARG]`
     * Action Plan snippet: `Exercise: Do ≥150 min moderate...`
  
  2. **Alzheimer's** (Badge: `Optimal` - Green)
     * Polygenic risk score: `12th percentile`
     * Genetic markers: `[APOE]` `[PSEN1]`
     * Action Plan snippet: `Omega-3 Fatty Acids: Focus on a heart-healthy diet...`
  
  3. **Cardiovascular** (Badge: `Critical` - Red)
     * Polygenic risk score: `91st percentile`
     * Genetic markers: `[TCF7L2]` `[cg18064256]`
     * Action Plan snippet: `Monitor your blood pressure... Your BP is slightly high...`

---

#### D. Right Column: Digital Twin 3D / Body Overview
* **Header Area:**
  * Title: `Your Digital Twin Overview`
  * Subtitle: *"A personalized model uses your medical history, imaging, and real-time data to simulate and predict heart function."*
  * Button: `[View all data]`
* **Body Model Canvas:**
  * 3D or high-resolution rendered male anatomical model showing internal organs and circulatory system with glowing heart spotlight (`72%` risk marker) and liver/lung area indicator (`15%` risk marker).
* **Interactive Floating Controls:**
  * Zoom Controls: `[+]` `[-]` `[⤢ Expand]`
  * Floating AI Assist / Sparkle Action Button `(✨)` in bottom right corner.

---

## 3. Technical Implementation Details

* **Framework:** React / Next.js or Vite with Tailwind CSS.
* **Icons:** `lucide-react` for UI icons.
* **Interactivity Requirements:**
  * Tab or router switcher to toggle between the **Landing Page** and **Dashboard View**.
  * Interactive tooltips or hover cards on the 3D body markers (`72%`, `15%`).
  * Dynamic filter tags for "Areas of Concern" and "Genetic Markers".
  * Smooth animations for progress bars and gradient risk score gauges using Framer Motion or CSS transitions.

---

## 4. Prompt Instructions for Claude Code

Execute the project setup:
1. Create a modern responsive layout using **Tailwind CSS**.
2. Implement glassmorphism styles (`backdrop-blur-md`, semi-transparent white backgrounds, soft borders).
3. Build the **Dashboard View** matching the layout, colors, typography, risk meters, and anatomical digital twin structure specified above.
4. Ensure all widgets, risk scores, status badges, and vitals cards render cleanly with responsive flex and grid layouts.