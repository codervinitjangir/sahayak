# Sahayak Mobile — Architecture & Visual Design Conventions

## 1. Expo & Tech Stack
- Expo SDK 57 / React Native 0.86 / React 19.
- Use versioned docs at `https://docs.expo.dev/versions/v57.0.0/`.
- Styling: Pure `StyleSheet.create` with `theme.ts` tokens.
- Map: `react-native-maps` with custom pins and polylines.
- Animation: `react-native-reanimated` and React Native `Animated`.

---

## 2. Core Visual Language (Uber/Ola/Rapido Breakdown Paradigm)

### A. Map as Persistent Canvas
- `ServiceSelectScreen`, `PickupLocationScreen`, `FindingPartnerScreen`, and `PartnerMatchedScreen` must all render over **one continuous full-bleed map background**.
- The map is never covered by full-page opaque cards or separate plain screens; instead, content slides smoothly on top via bottom sheets.

### B. Dynamic Bottom Sheet Hierarchy
- Bottom sheets change height per state:
  - **Service Selection**: ~48% height (half), keeping map visible above.
  - **Pickup Confirmation**: ~28% height (peek), map dominant for location adjustment.
  - **Finding Partner**: Peek height, map dominant with radar rings.
  - **Partner Matched / Active**: Peek/compact height (~38%), map dominant showing pins and live route line.

### C. Minimal Floating Chrome
- No traditional bulky headers or navigation bars on map screens.
- Single floating 44px circular back button at top-left (`backgroundColor: surfaceWhite`, 44px touch target) floating directly over the map canvas.

### D. Custom Pins & Route Styling
- **User Pin**: Distinct circular badge with `brand-700` (`#0F766E`) accent ring, white surface, and location marker.
- **Partner Pin**: Distinct dark navy/slate badge (`#1E293B`) with mechanic/wrench icon.
- **Route Line**: High-contrast connecting route in `brand-700` (`#0F766E`, 4px width).

### E. Neutral Greyscale Chrome (Color Reserved for Accents)
- Surfaces, borders, cards, and text use neutral greyscale (`#FFFFFF`, `#F8FAFC`, `#E2E8F0`, `#0F172A`, `#64748B`).
- Color is strictly reserved for:
  1. The route line (`brand-700` / `#0F766E`).
  2. The primary CTA buttons (`brand-700` / `#0F766E`).
  3. The OTP 4-digit start code.
  4. Status indicators (always paired with descriptive text/icons, never color alone).

### F. Compact Icon-Row Actions on Partner Card
- Call and Message buttons must render as compact circular icon buttons (38-42px) side by side in the identity block, never bulky full-width text buttons.

### G. Visually Distinct Vehicle Container
- The vehicle information (model, type, registration plate) must be rendered in its own bordered/elevated sub-card, visually separated from the mechanic's identity block.

### H. Prominent OTP Start Code
- The 4-digit job start code must be rendered with high visual dominance (fontSize 32+, letterSpacing 8-10px, high contrast container).

---

## 3. Uber Figma Prototype Reference Architecture (File Key: RqNA9mD3MaPC38i4EJSwDi)

The mobile owner experience is structured as a **single continuous fluid flow** over the persistent map canvas without separate bottom tab bars (`OwnerTabs` eliminated):

1. **State Machine (`FlowStep`)**:
   - `idle` (~38% sheet): Floating header (profile avatar, address chip, ⚡ SOS button) + Uber search bar ("Where do you need help?") + 4 suggestion cards (Towing, Flat Tyre, Battery, Fuel) + Vehicle selector strip.
   - `service_select` (~54% sheet, Figma Frame 4): "Choose Roadside Service" ride list items with vehicle icon, ETA, promo pill, upfront fixed pricing, payment selector pill, and full-width dark CTA button.
   - `pickup_location` (~28% sheet, Figma Frame 5): Upfront rate guarantee chip, street address, and "Confirm Pickup Spot" button.
   - `finding_partner` (~28% sheet, Figma Frame 6): Expanding animated concentric radar waves on the map canvas, searching progress bar, and "Cancel Request" button.
   - `partner_matched` (~44% sheet, Figma Frame 8): Live ETA banner ("Arriving in 4 min"), dominant 4-digit OTP start code card ("4821"), technician identity & rating chip, vehicle license plate badge, and compact circular action row (Call + Message).
   - `completed` (~54% sheet): Success banner, transparent fare receipt breakdown, interactive 5-star rating, and return to map button.

2. **Slide-over Modals**:
   - **Profile & Vehicle Modal**: Triggered via top-left 44px avatar; allows switching between registered vehicles, checking account status, and quick-switching roles to test the Partner flow.
   - **Emergency SOS Modal**: Triggered via top-right ⚡ SOS button; provides direct dial to 112, 103 Traffic Police, and broadcast of live GPS coordinates.

