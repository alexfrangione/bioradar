# BioRadar

A biotech investor research platform — pipeline, catalysts, financial health,
and risk-adjusted valuation for any biotech ticker.

## Tech stack

- **Backend:** Python + FastAPI (deployed on Render)
- **Frontend:** Next.js 14 + Tailwind (deployed on Vercel)
- **Database:** Postgres (Supabase — added in a later iteration)
- **Data sources:** ClinicalTrials.gov, SEC EDGAR, yfinance (added iteratively)

## Repo layout

```
bioradar/
├── backend/           FastAPI app
├── frontend/          Next.js app
├── .gitignore
├── README.md          ← you are here
└── SETUP.md           step-by-step local run + deploy guide
```

## Quick start

See **SETUP.md** for the full walkthrough. Short version:

```powershell
# Terminal 1 — backend
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend
npm install
copy .env.example .env.local
npm run dev
```

Then open http://localhost:3000.

## What works in this scaffold

- Landing page with ticker search (matches the design mockups)
- Company page that fetches and renders data from the backend
- Seed data for CRSP, SRPT, BEAM, VRTX, MRNA
- Graceful handling of unknown tickers and a down backend
- CORS configured for local dev and Vercel deployments
- Ready to deploy: Render (backend) + Vercel (frontend)

## What's next

The pipeline table, catalyst calendar, financial health cards, rNPV
workbench, and charts are designed (see `bioradar-mockups.html`) but not
yet wired to real data. Built out iteratively in follow-up sessions.
