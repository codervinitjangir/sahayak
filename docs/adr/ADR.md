# ADR-001: FastAPI for Backend APIs

**Status:** Accepted  
**Date:** 2026-09-06  

## Decision

Use FastAPI and Python for backend services.

## Context

The team has Python familiarity and needs validated async-friendly APIs. FastAPI provides Pydantic validation, automatic OpenAPI documentation, and native async support.

## Consequences

FastAPI is used. The team must maintain async/database-session discipline and avoid blocking map/network calls in request paths.

---

# ADR-002: Redis GEO for Live Partner Location; PostgreSQL for Durable Data

**Status:** Accepted  
**Date:** 2026-09-06  

## Decision

Store current available-partner positions in Redis GEO, not in the relational `partners` table.

## Rationale

Coordinates change frequently and nearby search is latency-sensitive; completed jobs and their geography need durable relational storage.

## Consequence

Redis loss does not corrupt history, but live presence must be republished and matching degrades to manual handling during an outage.

---

# ADR-003: Unified Partner Application and Capability Model

**Status:** Accepted  
**Date:** 2026-09-06  

## Decision

One partner application supports mechanics, tow operators and fuel agents through `partner_services` and `partner_equipment`.

## Rationale

Separate apps/codebases by service type duplicate flow and block multi-capability partners.

## Consequence

Eligibility rules are more important and must explicitly enforce service/equipment verification.

---

# ADR-004: Assignment Attempts are First-Class Records

**Status:** Accepted  
**Date:** 2026-09-06  

## Decision

Model a job request separately from `job_assignments`.

## Rationale

An assignment is an offer/attempt; one job can require several. Losing rejected/timeout attempts would hide dispatch quality and weaken evaluation.

## Consequence

Reports can calculate acceptance/retry metrics; state transitions are slightly more complex.

---

# ADR-005: Weighted Matching with a Nearest-Only Baseline

**Status:** Accepted  
**Date:** 2026-09-06  

## Decision

Rank eligible candidates using distance, load, skill and rating while retaining nearest eligible partner as experimental baseline.

## Rationale

Product differentiation needs evidence beyond claiming that a score is smarter.

## Consequence

Weights and scenario data must be documented; results are evaluation evidence, not a claim of universal optimality.

---

# ADR-006: Docker Compose Before Kubernetes

**Status:** Accepted  
**Date:** 2026-09-06  

## Decision

Use Docker Compose for MVP/local/staging parity; postpone Kubernetes.

## Rationale

Five-month, two-person scope should prove product correctness before cluster complexity.

---

# ADR-007: Test-Mode Payments Only

**Status:** Accepted  
**Date:** 2026-09-06  

## Decision

Persist payment intent/status simulation without moving money.

## Rationale

A student MVP does not have the regulatory/operational foundation for payment aggregation.
