# Sahayak Mobile: Architecture and Visual Conventions

Source of truth: [`../docs/DESIGN-SYSTEM.md`](../docs/DESIGN-SYSTEM.md). Summary for agents:

## Stack
Expo SDK 57 / React Native 0.86 / React 19. Versioned docs: `https://docs.expo.dev/versions/v57.0.0/`.
Styling is plain `StyleSheet.create` with tokens from `src/constants/theme.ts`; never hard-code a
colour that has a token.

## Visual language
* **Neutral surfaces, one brand colour.** Teal `#0F766E` for primary actions and active states,
  slate neutrals for everything else, red `#DC2626` only for the emergency control and destructive
  actions. Inter only. Flat cards with a 1px border; two elevations (card, floating).
* **Map as persistent canvas** in the request flow: one `RealMap` under a bottom sheet whose content
  changes with the request (details, searching, matched, done). A single floating 48dp back button;
  no bulky headers on map screens.
* **Pins:** the owner pin is the brand teal location marker; the route/radar use brand teal.
* **No promotional chrome.** No banners, carousels, coupons, wallet, tips or invented ETAs. If the
  backend does not provide a value, the UI does not show one.
* **Copy:** calm, specific, say what happens next. No exclamation marks in emergencies.

## Reusable pieces
`Button` (primary / outline / ghost / danger / emergency), `Card`, `kit.tsx` (`StatusChip`,
`SectionHeader`, `ListRow`, `Chip`, `EmptyState`, `ErrorState`, `Skeleton`), `TabBar`,
`SafetyActions` (call 112, share location), `LogoMark`.
