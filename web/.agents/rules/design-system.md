# Rule: Design System & Accessibility (WCAG 2.1 AA)

## Design Tokens

The Sahayak design system is calibrated for high urgency, outdoor mobile visibility, and trust.

### Color Tokens
- **Primary / Brand Action**: `#0F766E` (Trustworthy Deep Teal)
  - Hover: `#115E59`
  - Active: `#134E4A`
  - Subtle / Light tint: `#F0FDFA`
- **Emergency / Danger**: `#B91C1C` (Emergency alerts, SOS, cancellation)
  - Hover: `#991B1B`
  - Subtle / Light tint: `#FEF2F2`
- **Success / Verified**: `#15803D` (Completed jobs, approved partners, verified equipment)
  - Subtle / Light tint: `#F0FDF4`
- **Warning / Matching**: `#B45309` (Active matching, pending offers, waiting states)
  - Subtle / Light tint: `#FFFBEB`
- **Surfaces & Layout**:
  - Background: `#F8FAFC` (Slate 50)
  - Surface Card / Modal: `#FFFFFF`
  - Border: `#E2E8F0` (Slate 200)
  - Muted Text: `#64748B` (Slate 500)
  - Body Text: `#1E293B` (Slate 800)
  - Heading Text: `#0F172A` (Slate 900)

### Spacing Scale (4px Base)
- `4px` (`space-1`), `8px` (`space-2`), `12px` (`space-3`), `16px` (`space-4`), `24px` (`space-6`), `32px` (`space-8`), `48px` (`space-12`).

### Typography
- Font Family: `'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`.
- Mobile Body: Minimum `16px` (`text-base`) to avoid accidental auto-zoom on mobile safari/chrome.
- Headings: Bold or Extrabold with tight letter spacing.

## Accessibility Rules (WCAG 2.1 AA)
1. **Never Convey Status by Color Alone**:
   - Every `StatusBadge` or notification must include both an explanatory icon and explicit textual status.
2. **Contrast Ratios**:
   - Maintain at least 4.5:1 contrast for normal text and 3:1 for large headings against background surfaces.
3. **Touch Targets**:
   - All interactive elements (buttons, service cards, vehicle selectors) must have a touch target of at least 44x44px.
4. **Keyboard & Focus States**:
   - Provide clear visible focus rings (`focus:ring-2 focus:ring-teal-600 focus:outline-none`).
5. **Screen Readers**:
   - Use semantic HTML tags (`<main>`, `<nav>`, `<header>`, `<article>`, `<button>`).
   - Use `aria-label`, `aria-live` for dynamic matching status updates and countdown timers.
