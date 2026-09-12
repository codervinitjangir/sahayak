# Sahayak Backend API

> Real-time emergency vehicle assistance and service dispatch platform.

---

## 🚀 Setup & Local Development

### 1. Create and Activate Virtual Environment

```bash
# Windows
python -m venv venv
venv\Scripts\activate

# macOS/Linux
python3 -m venv venv
source venv/bin/activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your actual Supabase credentials:

```bash
cp .env.example .env
```

Ensure `DATABASE_URL` is set to your Supabase PostgreSQL connection string.

### 4. Run the Development Server

```bash
uvicorn app.main:app --reload
```

- API Base URL: `http://localhost:8000`
- Interactive API Docs (Swagger): `http://localhost:8000/docs`
- Health Check Endpoint: `http://localhost:8000/health`

---

## 📌 Architecture Note

This is the initial FastAPI project skeleton connecting directly to our existing Supabase PostgreSQL database. 

ORM models (`app/models/`) and Pydantic schemas (`app/schemas/`) will be added next to mirror the 15 existing Supabase tables:
1. `users`
2. `vehicles`
3. `service_categories`
4. `services`
5. `admins`
6. `partners`
7. `partner_services`
8. `partner_equipment`
9. `partner_documents`
10. `jobs`
11. `job_assignments`
12. `job_status_history`
13. `ratings`
14. `payments`
15. `notifications`
