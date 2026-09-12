# 🚨 Sahayak — Real-Time Emergency Vehicle Assistance & Service Dispatch Platform

> **OJT Sem-3 | Product Development Track | PD-01 | Group G273**  
> **Institution:** Polaris School of Technology, Bengaluru  
> **Team:** Vinit Jangir (backend, data, dispatch) · Adarsh Pratap Singh (frontend, admin UI)  
> **Mentor:** Subham Das · **Duration:** 20 weeks

---

## 🚗 The Problem

When a vehicle breaks down, owners search Google Maps or call personal contacts. Static shop pins don't show:
- Whether a mechanic is **available**
- Whether they can handle the **specific service**
- Whether they'll actually **show up**
- What the realistic **ETA** is

Result: long downtime, price uncertainty, and zero accountability.

---

## 💡 The Solution

**Sahayak** is a roadside-assistance marketplace and dispatch platform for Bengaluru.

A vehicle owner submits a help request with their live pickup location, vehicle details, and issue type.  
The dispatch engine finds nearby **verified** partners in Redis, validates their exact service/equipment eligibility in PostgreSQL, scores candidates by **distance + workload + skill + rating**, then makes sequential offers — with full assignment history.

```text
Breakdown → select vehicle/service → share pickup point
→ dispatch engine ranks eligible partners → offer sent → accepted/rejected → retry next
→ owner tracks status/ETA → partner arrives → job completed → rating recorded
```

---

## ✨ Core Features

| Feature | Description |
|---|---|
| 🔐 Multi-role auth | Owner, Partner, Admin with RBAC |
| 🚗 Vehicle profiles | Registration snapshot on each job |
| 📍 Live location | Partner publishes coordinates to Redis GEO |
| 🤖 Dispatch engine | Weighted scoring: distance + load + skill + rating |
| 📋 Assignment log | Every offer/reject/timeout recorded |
| 🗺️ Job tracking | Full status timeline from request to completion |
| 🛡️ Admin dashboard | Verification, manual override, ops recovery |
| ⭐ Ratings | Bidirectional, with Bayesian smoothing |
| 📊 Baseline comparison | Weighted match vs nearest-partner baseline |

---

## 🏗️ Architecture

```
React (Owner / Partner / Admin UI)
         │
         ▼ HTTPS
    FastAPI (Python)
         │
    ┌────┴────────────────┐
    │                     │
Redis GEO          PostgreSQL + PostGIS
(live partner      (users, jobs, history,
 locations)         assignments, ratings)
    │
Google Maps API (geocoding, routes, ETA)
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React + TypeScript, React Query |
| **Backend** | FastAPI + Python 3.11+ |
| **Database** | PostgreSQL 15+ + PostGIS |
| **Cache / Geo** | Redis 7+ (GEO commands) |
| **Maps** | Google Maps API |
| **Auth** | Supabase Auth / JWT |
| **Containers** | Docker + Docker Compose |
| **Testing** | pytest · Playwright · Locust/k6 |
| **CI/CD** | GitHub Actions |

---

## 📁 Repository Structure

```
sahayak/
├── README.md
├── .env.example
├── .gitignore
├── backend/
│   ├── app/
│   │   ├── api/            # Route handlers & dependencies
│   │   ├── models/         # SQLAlchemy ORM models
│   │   ├── schemas/        # Pydantic request/response contracts
│   │   ├── services/       # Business logic (dispatch, jobs, partner...)
│   │   ├── repositories/   # Database access & query composition
│   │   ├── utils/          # Scoring, helpers, error utilities
│   │   ├── middlewares/    # Correlation ID, auth, error handling
│   │   └── config/         # Settings & dependency wiring
│   ├── alembic/            # Database migrations
│   ├── tests/
│   │   ├── unit/
│   │   ├── integration/
│   │   └── api/
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app/            # Routes & providers
│   │   ├── features/       # jobs, vehicles, offers, partners, verification
│   │   ├── components/     # Shared UI components
│   │   ├── pages/          # Owner, Partner, Admin page trees
│   │   ├── services/       # Typed API client
│   │   └── hooks/          # auth, maps, polling hooks
│   ├── tests/
│   ├── package.json
│   └── Dockerfile
├── infra/
│   ├── docker-compose.yml
│   ├── docker-compose.test.yml
│   ├── nginx/
│   └── prometheus/
├── scripts/
│   ├── seed_demo_data.py
│   └── backup_db.sh
├── docs/
│   ├── SAHAYAK-COMPLETE-PROJECT-DOCUMENTATION.md
│   ├── adr/                # Architecture Decision Records
│   ├── diagrams/
│   └── interview-notes/    # No identifying participant data in public repo
└── .github/
    └── workflows/
        ├── backend-ci.yml
        ├── frontend-ci.yml
        ├── security.yml
        └── deploy-staging.yml
```

---

## 🚀 Quick Start (Local Development)

### Prerequisites

- Docker & Docker Compose v2
- Python 3.11+
- Node.js 20+
- Git

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/codervinitjangir/sahayak.git
cd sahayak

# 2. Copy environment config
cp .env.example .env
# Edit .env and fill in your secrets

# 3. Start infrastructure
docker compose -f infra/docker-compose.yml up -d postgres redis

# 4. Backend setup
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload

# 5. Frontend setup (new terminal)
cd frontend
npm ci
npm run dev
```

Backend runs at: `http://localhost:8000`  
API docs at: `http://localhost:8000/docs`  
Frontend runs at: `http://localhost:5173`

---

## 🧪 Test Commands

```bash
# Backend unit & integration tests
cd backend
pytest

# Frontend unit tests
cd frontend
npm test

# End-to-end browser tests
npx playwright test

# Load test (while app is running)
k6 run tests/load/dispatch.js
```

---

## 🔗 API Overview

Base URL: `/api/v1`  
All protected routes require: `Authorization: Bearer <token>`

| Family | Endpoints |
|---|---|
| `/auth` | register, login, verify-phone, refresh, logout |
| `/vehicles` | CRUD for owner vehicles |
| `/services` | List service categories & bookable services |
| `/jobs` | Create, list, get, cancel, rate |
| `/partner` | Profile, availability, location, offers, jobs |
| `/assignments` | Accept / reject offers |
| `/admin` | Verification, manual dispatch, metrics |
| `/health` `/ready` | Liveness & readiness probes |

---

## 🤖 Dispatch Algorithm

The dispatch engine is the core engineering contribution.

**Eligibility gates** (all must pass before scoring):
- Partner is `available` and `verified`
- Partner offers the requested service
- Partner has verified equipment (if required)
- Partner is below concurrent-job cap
- Location freshness < 120s
- Partner not already tried for this job

**Scoring formula** (all components normalized to [0, 1]):

| Component | Formula | Weight |
|---|---|---|
| Distance | `1 − min(d / 7000m, 1)` | 0.45 |
| Load | `1 / (1 + active_jobs)` | 0.20 |
| Skill | `0.5 + 0.5 · min(completed_service_jobs / 10, 1)` | 0.20 |
| Rating | Bayesian-smoothed rating / 5 | 0.15 |

Every dispatch also records which partner the **nearest-only baseline** would have picked — enabling a direct quality comparison without any A/B risk to owners.

---

## 🔒 Security & Privacy

- No real payment processing — test/stub mode only
- Do **not** commit `.env` or any secrets
- Do **not** use real customer locations or documents in demo fixtures
- Restrict Google Maps API keys by HTTP referrer / IP
- All secrets must go through environment variables or a secret manager
- RBAC enforced server-side for every route

---

## 📈 Project Roadmap

| Phase | Weeks | Focus |
|---|---|---|
| Kickoff | 1 | Repo, board, interview scripts, roles |
| Research + Architecture | 2–4 | Interviews, HLD/LLD, schema, auth scaffold |
| Dispatch Foundation | 5–8 | Redis/PostGIS, matching benchmark, pilot |
| User/Partner Flows | 9–12 | Request, offers, tracking, maps |
| Integration + Trust | 13–16 | Admin, verification, ratings, load tests |
| Finalization | 17–20 | Polish, docs, demo rehearsal |

---

## 👥 Contributors

| Name | Role |
|---|---|
| [Vinit Jangir](https://github.com/codervinitjangir) | Backend, database, dispatch engine, infrastructure |
| Adarsh Pratap Singh | Frontend (owner/partner/admin), UX implementation |


---

## 📄 License

[MIT](LICENSE) © 2026 Vinit Jangir
