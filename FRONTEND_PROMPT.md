Complete the Sahayak frontend. Target app: web/ first, taken to completion. 
Afterwards, repeat the same page inventory and rules for mobile/.
Do NOT modify the backend. If a screen needs an endpoint that doesn't exist, 
flag it as a backend gap. Never fake it.

=== 0. Read first, in this order ===
1. CLAUDE.md (root), TASKS.md, TASKS-frontend.md
2. docs/FRONTEND-GUIDE.md (screen-level guide) and HANDOFF-frontend-contract.md 
   (contract log, newest sections first)
3. The real backend route files in backend/app/api/ and the schemas in 
   backend/app/schemas/. These are the ground truth. Where a doc and the code 
   disagree, the code wins. Note the disagreement in TASKS-frontend.md.
4. The existing frontend: web/src (pages, features, services, components/ui) and 
   especially the landing/home page, which defines the visual language.

=== 1. Non-negotiable rules ===
A. ALL data comes from the backend API. No demo data anywhere in app code:
   - Remove partner.mock.ts, the VITE_PARTNER_API_MOCK / IS_DEMO_MODE branches, 
     hardcoded partner ids (e.g. ptr_ramesh_01), fixtures, lorem text, 
     fabricated stats on the landing page (ride counts, testimonials, ratings).
   - Test fixtures may live in tests/ only and must never be imported by app code.
   - If an endpoint does not exist (e.g. partner earnings), render an honest 
     "not available yet" state. Do not show invented numbers.
   - Reference data is the one exception. If there is no GET endpoint for 
     services, a constant of the six service codes (flatbed_towing, 
     wheel_lift_towing, battery_jumpstart, flat_tyre, minor_repair, 
     fuel_delivery) is acceptable. Flag it as a gap and keep it in one file.
B. Contract rules (verify each against code):
   - Unwrap the envelope: success is {data, meta}, failure is {error:{code,message}, request_id}.
   - Send Authorization: Bearer <Supabase access token> on every authenticated call.
   - Never send user_id, partner_id or role in a body. Identity comes from the token.
   - Decimal fields (partner_rating, prices) arrive as strings. Parse them before display.
   - Branch on error.code, never on message text.
   - USER_NOT_REGISTERED -> route to the signup screen. IDENTITY_NOT_LINKED -> 
     do NOT sign the user out (that creates a login loop). 401 -> re-authenticate.
   - Partner name/phone arrive null for non-owners. Render only what the API 
     returns. Do not add client-side logic that tries to hide or guess.
   - Matching scores (score, score_components, was_baseline_choice) are never 
     shown to owners or partners. Admin analytics only.
   - No websockets exist. Use polling: GET /jobs/{id} and GET /partners/me/offers 
     about every 5 seconds while the screen is visible. Stop on terminal job 
     states and pause when the tab is hidden.
   - Offers never expire server-side. Do not build a countdown timer.
   - no_match_found can mean "nobody nearby" or "dispatch unavailable". The UI 
     cannot tell which. Show neutral wording, allow the owner to cancel, and 
     offer "request again" (creates a new job).

=== 2. Design system ===
The landing/home page is the source of truth. Every new page must look like it 
belongs to it.
1. Extract the tokens actually in use (colours, typography, spacing, radii, 
   shadows, breakpoints, button/input/card styles) into ONE shared place (the 
   Tailwind theme or CSS variables, whichever the project uses). Refactor 
   one-off colours and magic numbers in existing pages to use it.
2. Build and reuse components in components/ui (Button, Input, Card, Badge, 
   Modal, Skeleton, EmptyState, ErrorState, StatusPill, Timeline, StarRating, 
   Toast). Do not restyle per page.
3. Design tool (optional): run /mcp to see what is connected. If a Figma MCP or 
   Stitch MCP is available, use it to pull design context or to draft screens in 
   the home page's visual language. Treat the output as a visual reference only. 
   Rebuild with the project's own components and strip any placeholder data it 
   generates. If neither is connected, derive everything from the home page 
   code. Do not block on this.
4. Mobile-first. Owners are stranded on a phone: large tap targets, readable in 
   sunlight (strong contrast), skeleton loaders, minimal typing. Basic 
   accessibility: labelled inputs, visible focus, contrast.

=== 3. Phase 1: audit BEFORE writing UI (stop and report after this) ===
Produce docs/FRONTEND-PAGE-INVENTORY.md with a table: page, route, role, 
backend endpoint(s) it needs, endpoint exists? (verified in code), current 
state (real data / mock / partial / missing), notes. Include every page below 
plus any that already exist. List every remaining demo-data usage by file and 
line. List every backend gap. Then STOP and wait for approval before Phase 2.

=== 4. Pages to cover (expected endpoints are to be verified in code) ===
Every page needs loading, empty and error states.

PUBLIC
- Landing/home (exists): remove fabricated stats, add clear owner and partner entry points.
- Login: phone number -> OTP -> token (Supabase Auth).

OWNER
- Signup/complete profile: POST /api/v1/users after OTP. Entered when USER_NOT_REGISTERED.
- Vehicles list + add vehicle: GET/POST /api/v1/vehicles, GET /vehicles/{id}. 
  Empty list is a normal state (an array, not a 404).
- Request help: choose service, pick vehicle, pickup location (browser 
  geolocation plus editable address text), optional description. Sends flat 
  pickup_lat / pickup_lng / pickup_address_text and service_code via POST /api/v1/jobs.
- Job tracking: GET /api/v1/jobs/{id}. Shows the status pill, timeline, 
  current_assignment (nullable), and partner details only if returned. Cancel 
  via POST /jobs/{id}/cancel, only while non-terminal.
- Rating: POST/GET /api/v1/jobs/{id}/ratings after completion (the path is 
  plural "ratings"). Handle the duplicate-rating 409.
- Job history: check whether a list endpoint exists. If not, flag it and do not fake one.
- Notifications feed: use the notification endpoints in backend/app/api (verify 
  the paths).
- Profile / sign out.

PARTNER
- Login + registration: POST /api/v1/partners, then link-auth (verify the flow in code).
- Service selection: POST /api/v1/partners/{id}/services.
- Availability toggle: PATCH /partners/{id}/availability. Location beacon: 
  POST /partners/{id}/location, only while available.
- Offers: GET /api/v1/partners/me/offers. Accept/reject through 
  POST /api/v1/job-assignments/{assignment_id}/respond with {action}. Handle 
  409 ASSIGNMENT_ALREADY_ANSWERED (refresh the list, do not retry) and 
  PARTNER_AT_CAPACITY (it looks like a decline from outside).
- Active job: GET /partners/me/jobs/active (null when idle). Status progression 
  via POST /jobs/{id}/status, completed requires price_final. Handle the 409 
  INVALID_STATUS_TRANSITION and the terminal state codes.
- Stats: GET /partners/me/stats.
- Earnings: no endpoint. Honest "not available yet" state.
- Documents/equipment: only build what an endpoint supports. Otherwise show the 
  partner's verification status if the API exposes it, and flag the gap.
- Notifications, ratings received.

ADMIN
- Check backend/app/api for admin routes and how an admin authenticates. 
  Build only what exists, likely an analytics dashboard (dispatch latency, 
  acceptance rate, matching accuracy vs baseline). Remember the metric rule: 
  exclude notes starting "Dispatch unavailable:" from match-rate numbers. 
  Anything the backend doesn't support goes in the gap list.

=== 5. Phase 2: build ===
After approval, work in this order and commit per group: (1) design tokens + 
shared components, (2) auth + API client cleanup + demo-data removal, (3) owner 
flow end to end, (4) partner flow end to end, (5) admin, (6) cleanup.
- One API client. Every service function documents its method, path and body shape.
- Contract tests for every service function asserting the exact method, path 
  and body (this is the bug class that bit us). Tests for loading/empty/error 
  states on the main screens.
- tsc --noEmit clean, full vitest run green.
- Add a check that fails if app code (not tests) contains: mock, demo, fixture, 
  or hardcoded ptr_/usr_ ids.

=== 6. Verification (do not skip) ===
Run against the real local backend, not mocks. Walk the full loop: owner 
signs up -> adds vehicle -> requests help -> partner (separate browser profile) 
sees the offer -> accepts -> moves through en route / in progress / completed -> 
owner rates. If you cannot run a step, say so explicitly. Do not claim it works.

=== 7. Report ===
Update TASKS-frontend.md. Final report: the page inventory with real status 
(verified vs unverified), the remaining backend gaps, every deviation from this 
prompt with the reason, and anything in the docs that did not match the code. 
Flag unexpected findings. Do not silently work around them.
