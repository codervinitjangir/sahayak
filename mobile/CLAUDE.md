# Sahayak: Mobile Frontend Context (mobile/)

Read this before any mobile task. The design rules live in
[`../docs/DESIGN-SYSTEM.md`](../docs/DESIGN-SYSTEM.md); this file is the map.

## What this app is
React Native + Expo app for two roles:
1. **Vehicle owners**: tabs Home, Services, Activity, Account, plus a full-screen map-and-sheet request flow.
2. **Service partners**: tabs Home (shift, offers, active job), Earnings, Account, plus offer / active job / done screens.

## Stack
Expo SDK 57, React Native 0.86, React 19, TypeScript, React Navigation 7 (native stack),
TanStack Query (owner server state), Zustand (`authStore`, `jobStore`), Axios,
`react-native-maps` (native) / Leaflet + OpenStreetMap tiles (web preview), Inter via
`@expo-google-fonts/inter`, `StyleSheet` with tokens from `src/constants/theme.ts`.

## Layout (`src/`)
```
components/  brand/LogoMark · map/RealMap(.web) + useRoute · splash/AppLaunchSequence
             ui/ Button Card kit(StatusChip, ListRow, Chip, Skeleton, Empty/ErrorState) TabBar SafetyActions
constants/   theme.ts (single token source)   index.ts (API base URL)
features/    home/HomeTab · services/screens/ServicesTab · activity/screens/ActivityTab
             account/screens/AccountTab + AddVehicleModal · shared/ownerData (query hooks), NotificationsModal
             jobs/screens/HomeScreen (owner tab shell) + OwnerHelpFlowScreen (request → track → rate)
             partner/screens/PartnerHomeScreen, IncomingOffer, ActiveJob, PartnerJobDone
             auth/screens/LoginScreen (phone → OTP → new-owner name)
navigation/  RootNavigator (Auth / Owner / Partner stacks)
services/    api/* (axios, one file per resource) · identity.ts · supabase.ts
store/       authStore · jobStore
```

## Rules
1. **All data comes from the backend.** No mock data, no invented numbers, prices, coupons,
   ratings or partner counts. `npm run check:rule-a` and `tests/brand-hygiene.test.ts` enforce it.
2. **Failure is a state.** Use `fetchMyJobs` / `fetchVehicles` (they throw) for lists so an
   empty list and a failed request look different. Show `ErrorState` with a retry.
3. **Location is never defaulted.** The map may look at Bengaluru before a GPS fix, but a request
   is only sendable with a real pin (GPS or a dragged marker).
4. **Job vs. assignment.** The owner tracks a *job*; the partner responds to an *assignment*
   (`POST /job-assignments/{id}/respond`). Offers have no countdown: show relative age.
5. **Contact release follows assignment** (ADR-017). The call button appears only when the
   backend returns `partner_phone`.
6. **Accessibility.** 48dp touch targets, `accessibilityRole`/`Label` on every pressable, status
   = icon + word + colour, body text ≥ 15, respect reduced motion.
7. **Secrets.** `GOOGLE_MAPS_API_KEY` is injected by `app.config.js` from the build
   environment. Never commit it to `app.json`. Routing uses `EXPO_PUBLIC_ROUTING_URL` if set,
   otherwise a straight connector; never the public OSRM demo instance.

## Authoritative references
* Design system and feature decisions: `../docs/DESIGN-SYSTEM.md`
* Redesign changelog and launch checklist: `../docs/REDESIGN-2026-11-13.md`
* API contract: `../HANDOFF-frontend-contract.md`
* Screen inventory and edge cases: `../docs/FRONTEND-GUIDE.md`
