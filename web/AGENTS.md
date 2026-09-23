# Sahayak Frontend — Agent Standing Instructions

Welcome to the **Sahayak Frontend** codebase (`frontend/`). 
Sahayak is a real-time emergency roadside assistance and service dispatch platform for Bengaluru, India.

Before modifying or adding code, every agent **MUST** read and adhere to the standing instructions in this document and the rule files under `.agents/rules/`.

---

## 1. Project Philosophy & Golden Rules

1. **Emergency-First UX**:
   - Vehicle owners using this app are often stranded on roadsides under stress.
   - Prioritize location capture first, keep service choices simple, provide large tap targets (minimum 44x44px), and display clear loading/matching status.
   - Do not require unnecessary form inputs or deep multi-step setup when an owner needs urgent help.

2. **Strict Design Tokens & Accessibility (WCAG 2.1 AA)**:
   - Primary Teal: `#0F766E` (actions, interactive elements)
   - Emergency / Danger: `#B91C1C` (breakdown alerts, cancellations)
   - Success: `#15803D` (completed states, verified badges)
   - Warning: `#B45309` (matching, pending states)
   - Background: `#F8FAFC`, Surface: `#FFFFFF`
   - **Never convey state by color alone**: Always pair color with descriptive text and an icon.
   - Maintain minimum 16px font size for body text on mobile viewports.

3. **Three-Role Isolation**:
   - The frontend serves three user groups with distinct routes and permissions:
     - `/owner/*`: Stranded vehicle owners (vehicle profile, emergency request, live tracking, ratings).
     - `/partner/*`: Service partners (mechanic, tow, fuel; availability toggle, GPS beaconing, 45s offer timer).
     - `/admin/*`: Operations administrators (verification queue, live jobs board, manual dispatch override).
   - Never leak admin or partner controls into the owner view.

4. **API Discipline & Idempotency**:
   - All backend communication follows the REST JSON schema under `/api/v1`.
   - Critical operations (especially job submission) **MUST** include a client-generated `Idempotency-Key` header so network retries do not trigger duplicate dispatches.
   - Handle API error envelopes gracefully: `{"error": {"code": "...", "message": "..."}}`.
   - Never store privileged service keys or tokens in browser code.

5. **Component & Architecture Guidelines**:
   - Code is written in **TypeScript** (strict mode) with **React 18+**.
   - Server state is managed via **TanStack React Query**; avoid duplicate global state stores.
   - Reusable domain features belong in `src/features/<feature_name>/`.
   - Shared atomic/molecular UI primitives belong in `src/components/`.

---

## 2. Directory Structure Overview

```
frontend/
├── AGENTS.md                      # This file
├── .agents/
│   ├── rules/
│   │   ├── frontend.md            # React/TS conventions & component patterns
│   │   ├── design-system.md       # Design tokens & accessibility rules
│   │   └── api-client.md          # Typed API client & error handling
│   ├── workflows/
│   │   ├── new-feature.md         # Workflow for scaffolding features/
│   │   ├── new-component.md       # Workflow for shared UI components
│   │   └── new-page.md            # Workflow for role-based pages
│   └── skills/
│       ├── dispatch-ui/SKILL.md   # Offer timer & job timeline guide
│       └── maps-integration/SKILL.md # Google Maps patterns & fallbacks
├── src/
│   ├── app/                       # Routes, providers, route guards
│   ├── features/                  # Domain feature modules (jobs, vehicles, etc.)
│   ├── components/                # Reusable UI library (Button, StatusBadge, etc.)
│   ├── services/                  # Typed REST API client
│   ├── hooks/                     # Custom shared React hooks
│   ├── types/                     # Shared TypeScript domain models
│   └── pages/                     # Role-based pages (owner/, partner/, admin/)
├── tests/                         # Test suites (Vitest + RTL)
├── package.json
└── Dockerfile
```

---

## 3. Workflows & Slash Commands

When instructed to add new modules, follow the defined workflows:
- Feature Scaffolding: `.agents/workflows/new-feature.md`
- Shared Component Creation: `.agents/workflows/new-component.md`
- Role Page Creation: `.agents/workflows/new-page.md`
