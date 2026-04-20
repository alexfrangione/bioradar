# BioRadar backend

FastAPI service that powers the BioRadar frontend.

## Run locally

From the `backend/` folder, in a terminal:

```powershell
# 1) Create and activate a Python virtual environment
python -m venv venv
venv\Scripts\activate

# 2) Install dependencies
pip install -r requirements.txt

# 3) Copy the example env file
copy .env.example .env

# 4) Start the dev server (auto-reloads on file changes)
uvicorn main:app --reload --port 8000
```

Visit `http://localhost:8000/docs` to see auto-generated API docs.

## Endpoints

- `GET /` — service info
- `GET /api/health` — health check
- `GET /api/company/{ticker}` — basic company data (seed data for now)
- `GET /api/companies` — list of tickers with seed data
