# Sahayak — Backend

FastAPI + Python backend for the Sahayak roadside assistance dispatch platform.

## Setup

```bash
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Run migrations
alembic upgrade head

# Start dev server
uvicorn app.main:app --reload
```

API docs available at `http://localhost:8000/docs`

## Structure

```
app/
├── api/          # Route handlers and FastAPI dependencies
├── models/       # SQLAlchemy ORM table definitions
├── schemas/      # Pydantic request/response contracts
├── services/     # Business logic: dispatch, jobs, partner, notifications
├── repositories/ # Database access and query composition
├── utils/        # Scoring algorithm, helpers, error utilities
├── middlewares/  # Correlation ID, auth validation, error handling
└── config/       # Settings (Pydantic BaseSettings) and DI wiring
```

## Test

```bash
pytest
pytest tests/unit/
pytest tests/integration/
pytest tests/api/
```
