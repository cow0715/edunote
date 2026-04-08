web application/stitch/projects/16022937282743889505/screens/eea11569e2bb47b2af73f8bc2457c302
# Design Specification: Toss-Style Student English Grade Dashboard (Dual Mode)

## 1. Visual Identity & Core Concept
- **Concept:** "The Ethereal Analyst" - A minimalist, high-end editorial finance aesthetic applied to educational data.
- **Goal:** Transform complex academic metrics into intuitive, clean, and professional visual insights.
- **Adaptive Strategy:** Use a consistent spatial system while swapping color tokens for Light and Dark modes to maintain the "Toss" feel in any environment.

## 2. Color Palette & Theming

### A. Light Mode (The Pristine Canvas)
- **Primary Background:** Linear gradient from `#EBF3FF` (top) to `#FFFFFF` (bottom).
- **Card Background:** Pure white (`#FFFFFF`) with a very subtle outer glow.
- **Shadow:** `0px 10px 40px rgba(0, 75, 198, 0.03)`
- **Headlines:** Deep Charcoal (`#1A1C1E`)
- **Subtext:** Slate Gray (`#8B95A1`)

### B. Dark Mode (The Deep Space)
- **Primary Background:** Linear gradient from `#0F172A` (top) to `#020617` (bottom).
- **Card Background:** Surface-level Navy (`#1E293B`) or Deep Slate (`#0F172A`).
- **Shadow:** `0px 10px 40px rgba(0, 0, 0, 0.4)`
- **Headlines:** Pure White (`#F8FAFC`)
- **Subtext:** Cool Gray (`#94A3B8`)

### C. Shared Brand Colors
- **Primary Action (Blue):** `#2463EB` (vivid blue) / Dark mode: `#3B82F6` (slightly brighter for contrast).
- **Positive Indicator:** `#2463EB` (Blue).
- **Negative/Alert:** `#FF4D4D` (Soft Red) or `#F59E0B` (Amber).

## 3. Typography (Plus Jakarta Sans)
- **Hierarchy is Critical:** 
    - Hero Stats (e.g., GPA 4.2): Extra Bold, 48px - 56px.
    - Section Headers: Bold, 20px - 24px.
    - Card Labels: Medium, 14px.
- **Font Rendering:** Ensure `-webkit-font-smoothing: antialiased` is used for high-end text rendering.

## 4. Component Specifications (Responsive to Theme)

### A. The "Hero" Header
- **Light:** Bold Blue text on faint blue gradient.
- **Dark:** Glowing Blue text on deep navy gradient.
- **Progress Bar:** 
    - Track: `#F1F5F9` (Light) / `#334155` (Dark).
    - Indicator: `#2463EB` (Light) / `#3B82F6` (Dark).

### B. Minimalist Data Cards
- **Structure:** No borders. 24px corner radius.
- **Elevation:** In Dark Mode, use a very thin 1px border (`rgba(255, 255, 255, 0.05)`) instead of heavy shadows to define card edges.

### C. Toss-Style Charts
- **Line Charts:** Smooth splines with a subtle glow. 
    - Line: `#2463EB`. 
    - Area Fill: Linear gradient from `rgba(36, 99, 235, 0.1)` to transparent.
- **Radar Charts:** 
    - Light: Blue fill at 15% opacity.
    - Dark: Blue fill at 25% opacity with higher stroke contrast.

### D. Floating Primary Button
- **Style:** Fixed at bottom, pill-shaped.
- **Color:** Brand Blue (`#2463EB`).
- **Interaction:** `active:scale-95` transition.

## 5. Implementation Instructions (Tailwind & Lucide)
"Implement using Tailwind CSS and Lucide React. Support `dark:` variants for every element. The background should transition smoothly between themes. Cards should feel like they are floating. Remove all unnecessary borders. Use 'Plus Jakarta Sans' as the primary font."