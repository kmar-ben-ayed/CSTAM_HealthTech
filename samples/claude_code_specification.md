# Project Specification: SmartCare Solutions Landing Page

Create a modern, high-tech, and futuristic healthcare web landing page inspired by the provided design specification.

---

## 1. Visual & Aesthetic Style Guide

* **Theme/Vibe:** Futuristic, high-tech AI healthcare, clean, modern, sleek, glassmorphic accents.
* **Background:** 
  * Soft off-white / light gray base (`#F3F4F6` or `#EBECEE`).
  * Giant watermark background text with low opacity: `FUTURE MEDICINE` spanning horizontally across the middle.
  * Vibrant 3D fluid ribbon element (flowing cyan, teal, blue abstract 3D wave running diagonally from bottom-left to top-right).
* **Card Style / Container:**
  * Rounded outer viewport/frame with a subtle white border and light outer/inner shadows.
  * Floating white glassmorphism cards (`background: rgba(255, 255, 255, 0.85)`, `backdrop-filter: blur(12px)`), rounded corners (`border-radius: 16px` to `24px`).
* **Typography:**
  * **Headings:** High-contrast, bold, modern geometric sans-serif (e.g., *Plus Jakarta Sans*, *Syne*, or *Inter* with extended tracking). Uppercase bold for main titles.
  * **Body/Subtitles:** Clean, highly legible sans-serif (e.g., *Inter*, *Outfit*).
* **Color Palette:**
  * **Primary Text:** Dark Charcoal / Almost Black (`#0F172A`)
  * **Accent Blue/Teal:** Cyan/Electric Blue gradients (`#00F2FE` to `#4FACFE`)
  * **Pill Badges & Buttons:** Crisp White (`#FFFFFF`) with dark icons/text or full dark pills (`#0F172A`).
  * **Secondary Text:** Muted Gray (`#64748B`).

---

## 2. Layout Breakdown & Components

### A. Navigation Bar (Top Header)
* **Logo (Left):** 
  * Icon: Modern geometric block logo (4 rounded squares pattern).
  * Text: `SmartCare Solutions` (Bold, stacked or inline).
* **Nav Links (Center Floating Pills):**
  * Light white rounded pill container containing inline navigation items:
    1. `[Icon] Home`
    2. `[Icon] Articles`
    3. `[Icon] Predictive Analytics`
    4. `[Icon] Image analysis`
* **CTA Button (Right):**
  * Capsule pill with dark circle on left containing `->` arrow.
  * Text: `Start now` followed by chevron indicators `> > >`.

---

### B. Main Hero Section

#### 1. Pre-Header Tag
* Small bullet text: `• Personalized treatment plans •`

#### 2. Main Headline
* **Text Structure:**
  `AI-POWERED MEDICINE:`
  `([Avatar Group Pill]) REDEFINING`
  `HEALTHCARE`
* **In-text Pill Element:** 
  * Capsule shape embedded directly inside the title between `(` and `)`.
  * Contains overlapping circular user avatars + a DNA double helix icon badge on the right.

#### 3. Side & Secondary Headlines / Micro-copy
* **Left Text Block:** 
  `With AI-powered diagnostics, we aim to enhance the accuracy and efficiency of disease detection`
* **Left Circular Badge:**
  * Rotating text in a circle: `Functional • Dynamic • Responsive •`
  * Center element: Diagonal arrow icon `↖`.
* **Right Sub-CTA:**
  * Small inline tag: `(→) The future is now — unlock the potential of ai`

---

### C. Floating UI Cards & Overlay Components

#### 1. Bottom-Left Card (Doctor Profile & Feature Grid)
* **Header:**
  * Circular avatar photo of `Dr. Sarah Johnson`.
  * Title: `Dr. Sarah Johnson`
  * Subtitle: `Chief Medical Officer`
  * Search glass icon button `(🔍)` on top right.
* **Grid Items (2 Columns):**
  * **Column 1:** `[Icon] Research` -> *Deeper insights into diseases and risk factors*
  * **Column 2:** `[Icon] Analysis` -> *Analyzing MRI scans, X-rays, pathology slides*

#### 2. Middle-Right List Section (Stacked Navigation)
* Vertical list with clean line dividers:
  1. `Resources / 01` `[•••]` `[→]`
  2. `Community / 02` `[●●•]` `[→]` *(Highlighted / Active)*
  3. `Articles / 03` `[•••]` `[→]`

#### 3. Bottom-Right Floating Feature Cards
* **Card 1: Personalized Treatment**
  * Left Icon: `[Pill / Medicine Icon]`
  * Title: `Personalized Treatment`
  * Body: `AI empowers healthcare providers to deliver personalized treatment plans`
  * Tag Badges: `⚙ Healthcare` `💡 Effectiveness`
* **Card 2: Predictive Analytics**
  * Left Icon: `[Analytics/Heartbeat Icon]`
  * Title: `Predictive Analytics`
  * Body: `AI can analyze patient data in real-time, allowing for early identification of potential health risks`
  * Tag Badge: `♡ Individual characteristics`

#### 4. Bottom Center Scroll Indicator
* Text: `Discover more`
* Mouse / Scroll down animation icon `( 🖱 / ∨ )`.

#### 5. Bottom-Left Social Links
* Floating pill buttons for social icons: `[Twitter / X]`, `[Facebook]`, `[Instagram]`.

---

## 3. Technical Requirements

* **Framework:** React / Next.js (or Vite + Tailwind CSS).
* **Styling:** Tailwind CSS or Styled Components.
* **Icons:** Lucide React or React Icons.
* **Animations:** Framer Motion for subtle hover effects, floating card animations, and smooth transitions.
* **3D Visual / Canvas:** Use a high-resolution transparent PNG/SVG overlay or Three.js spline object for the dynamic ribbon background effect.

---

## 4. Implementation Steps for Claude Code

1. Set up the project layout with Tailwind CSS.
2. Build the main background frame with rounded borders, low-opacity background watermark text (`FUTURE MEDICINE`), and gradient ribbon graphic.
3. Build the responsive top navbar with glassmorphic pills.
4. Implement the hero typography layout, ensuring the inline capsule badge with overlapping avatars fits seamlessly inside the text line.
5. Construct the interactive glassmorphism cards on the bottom-left, middle-right, and bottom-right with Framer Motion hover states.
6. Add interactive elements (toggle buttons, hover states for social links and navigation pills).
```

eof

I have generated the `prompt.md` file tailored for Claude Code. You can pass this file directly into Claude Code (e.g., `claude "build the website defined in prompt.md"`), and it will have all the design system details, typography specs, layout positioning, and component structures required to replicate the UI!