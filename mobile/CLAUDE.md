# Sahayak — Mobile Frontend Context (mobile/)

This file documents the conventions, architecture, and tech stack for the mobile application (`mobile/`). Read this fully before starting any mobile task.

---

## 1. What this app is
The consumer and technician mobile app for Sahayak, built with React Native and Expo. It delivers a fast, location-centric experience for:
1. **Vehicle Owners**: 4-tab interface (Home, Categories, Orders, Account) + full map-based Uber/Blinkit-style bottom sheet breakdown dispatch flow (`OwnerHelpFlowScreen.tsx`).
2. **Service Partners**: Shift toggle, incoming job offer cards with relative time, active navigation and OTP start verification, and job completion.

---

## 2. Tech Stack & Tooling

* **Framework**: React Native 0.76 (Expo SDK 52, Managed Workflow, New Architecture enabled)
* **Language**: TypeScript
* **Navigation**: React Navigation v7 (`@react-navigation/native-stack`)
* **State Management**: Zustand v5 (`authStore.ts`, `jobStore.ts`)
* **HTTP Client**: Axios 1.7 (`src/services/api/client.ts`)
* **Styling**: React Native `StyleSheet` with shared design tokens from `src/constants/theme.ts`
* **Icons**: `@expo/vector-icons` (`Ionicons`)
* **Maps**: Custom vector canvas wrapper (`SharedMapCanvas.tsx` / `react-native-maps`)

---

## 3. Actual Directory Structure (`mobile/src`)

```
mobile/src/
├── components/
│   ├── map/
│   │   └── SharedMapCanvas.tsx     # Reusable vector map with animated route polyline
│   ├── sheet/
│   │   └── SlidingBottomSheet.tsx  # Dynamic height bottom sheet wrapper
│   └── ui/
│       ├── BlinkitBottomNavBar.tsx # 4-tab bottom navigation (Home, Categories, Orders, Account)
│       ├── BlinkitTopHeader.tsx    # Location, delivery ETA, search bar
│       ├── MotionBanner.tsx        # Animated promotional hero carousel
│       ├── Button.tsx, Card.tsx, Badge.tsx, Avatar.tsx, Input.tsx
├── constants/
│   ├── index.ts                    # API_BASE_URL (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1')
│   └── theme.ts                    # Colors (Blinkit Yellow #F8CB46, Brand Green #0C831F, Dark #1C1C1C),
│                                   # Typography (Inter/system fonts), Spacing, Radius, ServiceConfig
├── features/
│   ├── account/screens/
│   │   └── AccountView.tsx         # Account tab: Profile, vehicles, payment methods, settings
│   ├── activity/screens/
│   │   └── ActivityView.tsx        # Orders tab: Live tracking card, cancellation flow, rating tags, dispute modal, tax invoices
│   ├── auth/screens/
│   │   └── LoginScreen.tsx         # Phone OTP login and owner/partner role toggle
│   ├── jobs/screens/
│   │   ├── HomeScreen.tsx          # Main bottom-tab container screen
│   │   ├── OwnerHelpFlowScreen.tsx # 5-step map booking flow (service -> pickup -> matching -> matched -> complete)
│   │   └── JobCompleteScreen.tsx   # Post-service star rating and tip screen
│   ├── partner/screens/
│   │   ├── PartnerHomeScreen.tsx   # Partner on-shift toggle, earnings cards, recent rescues
│   │   ├── IncomingOfferScreen.tsx # Partner dispatch offer card
│   │   ├── ActiveJobScreen.tsx     # Map route, navigation, 4-digit start OTP verification
│   │   └── PartnerJobDoneScreen.tsx# Partner payment & job summary
│   └── services/screens/
│       └── ServicesView.tsx        # Categories tab: "What happened?" symptom chips, grouped services, coupons, vehicle filtering
├── navigation/
│   └── RootNavigator.tsx           # RootStack, OwnerStack, PartnerStack definitions
├── services/
│   ├── api/
│   │   ├── client.ts               # Axios instance with envelope unwrapper
│   │   └── jobs.ts                 # jobsApi definition (6 route methods; currently unimported by screens)
│   └── api.ts                      # Mock fixtures (MOCK_VEHICLES, MOCK_PARTNER, MOCK_JOBS, MOCK_INCOMING_OFFER)
├── store/
│   ├── authStore.ts                # user, role, token, login(), logout()
│   └── jobStore.ts                 # activeJob, startCode, draftService, draftPickupLocation, isOnline
└── types/
    └── index.ts                    # ServiceType, Job, Partner, Vehicle, User, Navigation ParamLists
```

---

## 4. API Layer & Current State

### 4.1 Response Envelope Unwrapping
The Axios client in `src/services/api/client.ts` implements response interceptor unwrapping:
* When `res.data` has both `data` and `meta` keys, it unwraps `res.data = res.data.data`.
* On failure, it leaves the error envelope `{ error: { code, message }, request_id }` intact on `error.response.data`.

### 4.2 Current Integration Gap (Mock vs. Real)
* **Auth Token Header**: In `src/services/api/client.ts`, the request interceptor that injects `Authorization: Bearer ${token}` from `useAuthStore` is currently commented out.
* **Unwired Endpoints**: The methods declared in `src/services/api/jobs.ts` are currently **not imported** by any screen component.
* **Screens Running on Mocks**: `OwnerHelpFlowScreen.tsx`, `PartnerHomeScreen.tsx`, `IncomingOfferScreen.tsx`, and `ActiveJobScreen.tsx` currently run against in-memory mock fixtures (`MOCK_INCOMING_OFFER`, `MOCK_JOBS`) and simulated timeouts (`setTimeout`).

---

## 5. UI Design Language & Coding Standards

1. **Grouped-Card Design System (Strict Rule)**:
   * All secondary tabs (`Categories` / `ServicesView.tsx`, `Orders` / `ActivityView.tsx`, `Account` / `AccountView.tsx`) follow the iOS grouped-card design language:
     * Card background: `#FFFFFF`
     * Border: `1px solid #EAECEF`
     * Border radius: `16px`
     * Section headers: Small, uppercase, bold muted text (`#5E6470`, 12.5px, letter spacing 0.6)
     * Dividers: `StyleSheet.hairlineWidth` with `#EAECEF` background, indented past icons (`marginLeft: 60` or `68`)
   * **Never introduce multi-layer AI slope boxes, clunky gradients, or ad-hoc card borders.**
2. **Job vs. Assignment Paradigm**:
   * The owner tracks a **job** (`status`: `requested` → `matching` → `assigned` → `partner_en_route` → `in_progress` → `completed`).
   * The partner responds to an **assignment** (`status`: `offered` → `accepted` / `rejected`).
   * On mobile, the partner accept/complete endpoints must thread the `assignment_id` (`POST /job-assignments/{assignment_id}/respond`), not act directly on `jobId`.
3. **Offers Have No Countdown**:
   * Backend offers do not expire automatically. Do **not** build a 30-second ticking countdown ring on `IncomingOfferScreen.tsx` — display relative age (`offered_at`, e.g., "3 min ago").

---

## 6. Authoritative References (Do Not Duplicate)
* **Screen Specifications & Edge Cases**: [`docs/FRONTEND-GUIDE.md`](file:///c:/Users/adars/OneDrive/Desktop/new%20mobile%20app/docs/FRONTEND-GUIDE.md) — Screen-by-screen inventory, loading/empty/error states, and transition rules.
* **API Payloads & Response Schemas**: [`HANDOFF-frontend-contract.md`](file:///c:/Users/adars/OneDrive/Desktop/new%20mobile%20app/HANDOFF-frontend-contract.md) — Exact request bodies, response models, and error codes.
* **Frontend Work Backlog**: [`TASKS-frontend.md`](file:///c:/Users/adars/OneDrive/Desktop/new%20mobile%20app/TASKS-frontend.md) — Current sprint items and implementation tracking.
