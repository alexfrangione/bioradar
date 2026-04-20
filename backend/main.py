"""
BioRadar API — FastAPI backend.

This is the starter scaffold. It exposes:
  GET  /                       -> service info
  GET  /api/health             -> health check (used by uptime monitors)
  GET  /api/company/{ticker}   -> basic company info (seed data for now)

Real data sources (ClinicalTrials.gov, SEC EDGAR, yfinance) will be wired in
in the next iteration.
"""

import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(
    title="BioRadar API",
    version="0.1.0",
    description="Biotech investor research platform — backend API.",
)

# ---------------------------------------------------------------------------
# CORS — allow the Next.js frontend to call this API.
# ---------------------------------------------------------------------------
frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
allowed_origins = [frontend_url, "http://localhost:3000"]

# If FRONTEND_URL is set, also allow variations (with/without trailing slash)
if frontend_url and frontend_url not in allowed_origins:
    allowed_origins.append(frontend_url.rstrip("/"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",  # allow Vercel preview URLs
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Seed data — replaced by live data in the next iteration.
# ---------------------------------------------------------------------------
SEED_COMPANIES: dict[str, dict] = {
    "CRSP": {
        "ticker": "CRSP",
        "name": "CRISPR Therapeutics AG",
        "exchange": "NASDAQ",
        "hq": "Zug, Switzerland",
        "description": (
            "Gene-editing company developing CRISPR/Cas9 therapies for "
            "hemoglobinopathies, oncology, and cardiovascular disease."
        ),
        "market_cap_usd": 4_120_000_000,
        "cash_usd": 1_820_000_000,
        "quarterly_burn_usd": 217_000_000,
        "runway_months": 21,
        "health": "stable",
    },
    "SRPT": {
        "ticker": "SRPT",
        "name": "Sarepta Therapeutics",
        "exchange": "NASDAQ",
        "hq": "Cambridge, MA",
        "description": (
            "Genetic medicine company focused on Duchenne muscular dystrophy "
            "and other rare neuromuscular diseases."
        ),
        "market_cap_usd": 11_400_000_000,
        "cash_usd": 1_130_000_000,
        "quarterly_burn_usd": 155_000_000,
        "runway_months": 18,
        "health": "stable",
    },
    "BEAM": {
        "ticker": "BEAM",
        "name": "Beam Therapeutics",
        "exchange": "NASDAQ",
        "hq": "Cambridge, MA",
        "description": (
            "Base-editing company developing precision genetic medicines for "
            "sickle cell disease, oncology, and inherited metabolic disorders."
        ),
        "market_cap_usd": 2_840_000_000,
        "cash_usd": 978_000_000,
        "quarterly_burn_usd": 98_000_000,
        "runway_months": 30,
        "health": "stable",
    },
    "VRTX": {
        "ticker": "VRTX",
        "name": "Vertex Pharmaceuticals",
        "exchange": "NASDAQ",
        "hq": "Boston, MA",
        "description": (
            "Commercial-stage biotech with a dominant cystic fibrosis "
            "franchise, expanding into pain, T1D, and sickle cell via Casgevy."
        ),
        "market_cap_usd": 112_000_000_000,
        "cash_usd": 13_800_000_000,
        "quarterly_burn_usd": 0,  # profitable
        "runway_months": None,
        "health": "strong",
    },
    "MRNA": {
        "ticker": "MRNA",
        "name": "Moderna",
        "exchange": "NASDAQ",
        "hq": "Cambridge, MA",
        "description": (
            "mRNA pioneer. Post-COVID pivot to oncology, rare disease, and "
            "respiratory vaccines."
        ),
        "market_cap_usd": 14_200_000_000,
        "cash_usd": 9_100_000_000,
        "quarterly_burn_usd": 420_000_000,
        "runway_months": 22,
        "health": "watch",
    },
}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/")
def root() -> dict:
    return {
        "service": "BioRadar API",
        "version": "0.1.0",
        "docs": "/docs",
    }


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/company/{ticker}")
def get_company(ticker: str) -> dict:
    ticker = ticker.upper().strip()
    company = SEED_COMPANIES.get(ticker)
    if company is None:
        # Return a placeholder so the frontend can still render a shell for
        # any ticker the user searches. Real lookup comes in next iteration.
        return {
            "ticker": ticker,
            "name": None,
            "placeholder": True,
            "message": (
                "Live data coming soon. Try CRSP, SRPT, BEAM, VRTX, or MRNA "
                "for seed data."
            ),
        }
    return company


@app.get("/api/companies")
def list_companies() -> dict:
    """List tickers with seed data (used by the landing page chips)."""
    return {
        "companies": [
            {"ticker": t, "name": c["name"]}
            for t, c in SEED_COMPANIES.items()
        ]
    }
