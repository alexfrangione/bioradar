"""
BioRadar API — FastAPI backend.

Endpoints:
  GET  /                                     -> service info
  GET  /api/health                           -> health check
  GET  /api/companies                        -> list of seeded tickers
  GET  /api/company/{ticker}                 -> company fundamentals (seed)
  GET  /api/company/{ticker}/pipeline        -> clinical trial pipeline (live)
  GET  /api/company/{ticker}/prices          -> daily price history (yfinance)
  GET  /api/company/{ticker}/catalysts       -> upcoming catalyst events (seed)
"""

import os
from datetime import datetime, timedelta
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

app = FastAPI(
    title="BioRadar API",
    version="0.2.0",
    description="Biotech investor research platform — backend API.",
)

# ---------------------------------------------------------------------------
# CORS — allow the Next.js frontend to call this API.
# ---------------------------------------------------------------------------
frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
allowed_origins = [frontend_url, "http://localhost:3000"]
if frontend_url and frontend_url not in allowed_origins:
    allowed_origins.append(frontend_url.rstrip("/"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Seed data
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
        "quarterly_burn_usd": 0,
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

# ClinicalTrials.gov knows sponsor names, not tickers, so we map.
TICKER_TO_SPONSOR: dict[str, str] = {
    "CRSP": "CRISPR Therapeutics",
    "SRPT": "Sarepta Therapeutics",
    "BEAM": "Beam Therapeutics",
    "VRTX": "Vertex Pharmaceuticals",
    "MRNA": "Moderna",
}

# Hand-curated catalyst events — real historical + near-term events.
# `type` drives the color/icon on the chart overlay.
# `impact`: "high" | "medium" | "low"
SEED_CATALYSTS: dict[str, list[dict]] = {
    "CRSP": [
        {
            "date": "2023-12-08",
            "title": "Casgevy FDA approval (SCD)",
            "type": "approval",
            "impact": "high",
        },
        {
            "date": "2024-01-16",
            "title": "Casgevy FDA approval (beta-thalassemia)",
            "type": "approval",
            "impact": "high",
        },
        {
            "date": "2025-06-10",
            "title": "CTX112 Phase 1 readout (B-cell malignancies)",
            "type": "readout",
            "impact": "medium",
        },
        {
            "date": "2026-02-20",
            "title": "VERVE-102 Phase 1b data (cardiovascular)",
            "type": "readout",
            "impact": "medium",
        },
    ],
    "SRPT": [
        {
            "date": "2023-06-22",
            "title": "Elevidys accelerated FDA approval",
            "type": "approval",
            "impact": "high",
        },
        {
            "date": "2024-06-20",
            "title": "Elevidys full approval + label expansion",
            "type": "approval",
            "impact": "high",
        },
        {
            "date": "2025-10-15",
            "title": "SRP-9003 Phase 3 interim (LGMD2E)",
            "type": "readout",
            "impact": "medium",
        },
    ],
    "BEAM": [
        {
            "date": "2024-12-09",
            "title": "BEAM-101 Phase 1/2 data (SCD)",
            "type": "readout",
            "impact": "high",
        },
        {
            "date": "2026-01-15",
            "title": "BEAM-302 Phase 1 first data (AATD)",
            "type": "readout",
            "impact": "medium",
        },
    ],
    "VRTX": [
        {
            "date": "2024-01-30",
            "title": "Casgevy launch — first patient dosed",
            "type": "launch",
            "impact": "medium",
        },
        {
            "date": "2025-01-30",
            "title": "Suzetrigine FDA approval (acute pain)",
            "type": "approval",
            "impact": "high",
        },
        {
            "date": "2025-12-15",
            "title": "VX-880 Phase 1/2 update (T1D)",
            "type": "readout",
            "impact": "medium",
        },
    ],
    "MRNA": [
        {
            "date": "2023-08-18",
            "title": "mRNA-1345 RSV Phase 3 positive",
            "type": "readout",
            "impact": "high",
        },
        {
            "date": "2024-05-31",
            "title": "mRESVIA (RSV) FDA approval",
            "type": "approval",
            "impact": "high",
        },
        {
            "date": "2025-07-10",
            "title": "mRNA-4157 (INT) Phase 3 interim (melanoma)",
            "type": "readout",
            "impact": "high",
        },
    ],
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
_PHASE_DISPLAY = {
    "EARLY_PHASE1": "Early Phase 1",
    "PHASE1": "Phase 1",
    "PHASE2": "Phase 2",
    "PHASE3": "Phase 3",
    "PHASE4": "Phase 4",
    "NA": "N/A",
}

_PHASE_RANK = {
    "NA": 0,
    "EARLY_PHASE1": 1,
    "PHASE1": 2,
    "PHASE2": 3,
    "PHASE3": 4,
    "PHASE4": 5,
}

_STATUS_DISPLAY = {
    "RECRUITING": "Recruiting",
    "ACTIVE_NOT_RECRUITING": "Active",
    "ENROLLING_BY_INVITATION": "Enrolling",
    "NOT_YET_RECRUITING": "Not yet recruiting",
    "COMPLETED": "Completed",
    "SUSPENDED": "Suspended",
    "TERMINATED": "Terminated",
    "WITHDRAWN": "Withdrawn",
    "UNKNOWN": "Unknown",
}


def _pretty_phase(p: str) -> str:
    return _PHASE_DISPLAY.get(p, p.replace("_", " ").title())


def _pretty_status(s: str) -> str:
    return _STATUS_DISPLAY.get(s, s.replace("_", " ").title())


def _phase_rank(phases: list[str]) -> int:
    return max((_PHASE_RANK.get(p, 0) for p in phases), default=0)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/")
def root() -> dict:
    return {"service": "BioRadar API", "version": "0.2.0", "docs": "/docs"}


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/companies")
def list_companies() -> dict:
    return {
        "companies": [
            {"ticker": t, "name": c["name"]}
            for t, c in SEED_COMPANIES.items()
        ]
    }


@app.get("/api/company/{ticker}")
def get_company(ticker: str) -> dict:
    ticker = ticker.upper().strip()
    company = SEED_COMPANIES.get(ticker)
    if company is None:
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


# ---------------------------------------------------------------------------
# Pipeline — live from ClinicalTrials.gov v2 API
# ---------------------------------------------------------------------------
@app.get("/api/company/{ticker}/pipeline")
async def get_pipeline(ticker: str, limit: int = 25) -> dict:
    ticker = ticker.upper().strip()
    sponsor = TICKER_TO_SPONSOR.get(ticker)
    if not sponsor:
        raise HTTPException(
            status_code=404,
            detail=f"No sponsor mapping for ticker {ticker!r}.",
        )

    url = "https://clinicaltrials.gov/api/v2/studies"
    params = {
        "query.lead": sponsor,
        "pageSize": min(max(limit, 1), 100),
        "format": "json",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(url, params=params)
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"ClinicalTrials.gov request failed: {exc}",
        )

    studies_raw = data.get("studies", [])
    trials: list[dict[str, Any]] = []

    for s in studies_raw:
        proto = s.get("protocolSection", {}) or {}
        ident = proto.get("identificationModule", {}) or {}
        status = proto.get("statusModule", {}) or {}
        design = proto.get("designModule", {}) or {}
        conditions_mod = proto.get("conditionsModule", {}) or {}
        interventions_mod = proto.get("armsInterventionsModule", {}) or {}

        phases = design.get("phases") or []
        conditions = conditions_mod.get("conditions") or []

        drug_names: list[str] = []
        for iv in interventions_mod.get("interventions") or []:
            if iv.get("type") in {"DRUG", "BIOLOGICAL", "GENETIC"}:
                name = iv.get("name")
                if name:
                    drug_names.append(name)

        pcd = status.get("primaryCompletionDateStruct", {}) or {}
        completion_date = pcd.get("date")

        trials.append(
            {
                "nct_id": ident.get("nctId"),
                "title": ident.get("briefTitle"),
                "drug": drug_names[0] if drug_names else None,
                "drugs": drug_names,
                "indication": conditions[0] if conditions else None,
                "conditions": conditions,
                "phase": _pretty_phase(phases[0]) if phases else "N/A",
                "phases_raw": phases,
                "phase_rank": _phase_rank(phases),
                "status": _pretty_status(status.get("overallStatus", "UNKNOWN")),
                "status_raw": status.get("overallStatus"),
                "primary_completion_date": completion_date,
                "url": (
                    f"https://clinicaltrials.gov/study/{ident.get('nctId')}"
                    if ident.get("nctId")
                    else None
                ),
            }
        )

    # Sort by phase (late-stage first), then by completion date.
    trials.sort(
        key=lambda t: (
            -t["phase_rank"],
            t.get("primary_completion_date") or "9999-99-99",
        )
    )

    return {
        "ticker": ticker,
        "sponsor": sponsor,
        "count": len(trials),
        "trials": trials,
    }


# ---------------------------------------------------------------------------
# Price history
# ---------------------------------------------------------------------------
_PERIOD_DAYS = {
    "1mo": 31,
    "3mo": 92,
    "6mo": 184,
    "1y": 366,
    "2y": 732,
    "5y": 1830,
    "max": 10_000,
}


def _yf_session():
    """Browser-impersonating session so Yahoo is less likely to block us."""
    try:
        from curl_cffi import requests as curl_requests  # type: ignore

        return curl_requests.Session(impersonate="chrome")
    except Exception:  # noqa: BLE001
        return None


def _fetch_yfinance(ticker: str, period: str) -> list[dict]:
    """Primary source — works great on residential IPs, blocked on cloud IPs."""
    try:
        import yfinance as yf  # type: ignore
    except ImportError:
        return []

    session = _yf_session()
    df = None

    try:
        kwargs: dict[str, Any] = {
            "tickers": ticker,
            "period": period,
            "auto_adjust": True,
            "progress": False,
            "threads": False,
        }
        if session is not None:
            kwargs["session"] = session
        df = yf.download(**kwargs)
    except Exception:  # noqa: BLE001
        df = None

    if df is None or df.empty:
        try:
            t = (
                yf.Ticker(ticker, session=session)
                if session
                else yf.Ticker(ticker)
            )
            df = t.history(period=period, auto_adjust=True)
        except Exception:  # noqa: BLE001
            return []

    if df is None or df.empty:
        return []

    if hasattr(df.columns, "nlevels") and df.columns.nlevels > 1:
        df.columns = df.columns.get_level_values(0)

    points: list[dict] = []
    for idx, row in df.iterrows():
        close_val = row.get("Close")
        if close_val is None:
            continue
        try:
            close_f = float(close_val)
        except (TypeError, ValueError):
            continue
        if close_f != close_f:  # NaN
            continue
        vol = row.get("Volume")
        try:
            vol_i = int(vol) if vol is not None and vol == vol else 0
        except (TypeError, ValueError):
            vol_i = 0
        points.append(
            {
                "date": idx.strftime("%Y-%m-%d"),
                "close": round(close_f, 2),
                "volume": vol_i,
            }
        )
    return points


_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/csv,text/plain,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


async def _fetch_stooq(ticker: str, period: str) -> tuple[list[dict], str | None]:
    """
    Fallback source — Stooq publishes free daily CSV with no API key.
    Returns (points, error_detail). error_detail is None on success.
    """
    days = _PERIOD_DAYS.get(period, 732)
    end = datetime.utcnow().date()
    start = end - timedelta(days=days)
    url = (
        f"https://stooq.com/q/d/l/?s={ticker.lower()}.us&i=d"
        f"&d1={start.strftime('%Y%m%d')}&d2={end.strftime('%Y%m%d')}"
    )

    try:
        async with httpx.AsyncClient(
            timeout=20.0, headers=_BROWSER_HEADERS, follow_redirects=True
        ) as client:
            r = await client.get(url)
    except httpx.HTTPError as exc:
        return [], f"stooq network error: {exc}"

    if r.status_code != 200:
        return [], f"stooq HTTP {r.status_code}"
    if not r.text:
        return [], "stooq empty response body"

    text = r.text.strip()
    preview = text[:120].replace("\n", " ").replace("\r", " ")

    if "no data" in text[:200].lower():
        return [], f"stooq says no data (preview: {preview!r})"

    lines = text.split("\n")
    if len(lines) < 2:
        return [], f"stooq response too short (preview: {preview!r})"

    # First line should be the header "Date,Open,High,Low,Close,Volume"
    if not lines[0].lower().startswith("date"):
        return [], f"stooq unexpected format (preview: {preview!r})"

    points: list[dict] = []
    for line in lines[1:]:
        parts = line.strip().split(",")
        if len(parts) < 6:
            continue
        try:
            date_str = parts[0]
            if len(date_str) == 8 and date_str.isdigit():
                date_str = f"{date_str[0:4]}-{date_str[4:6]}-{date_str[6:8]}"
            close = float(parts[4])
        except (ValueError, IndexError):
            continue
        try:
            volume = int(parts[5]) if parts[5] and parts[5] != "-" else 0
        except (ValueError, IndexError):
            volume = 0
        points.append(
            {"date": date_str, "close": round(close, 2), "volume": volume}
        )

    if not points:
        return [], f"stooq parsed zero rows (preview: {preview!r})"
    return points, None


@app.get("/api/company/{ticker}/prices")
async def get_prices(ticker: str, period: str = "2y") -> dict:
    """
    Returns daily close prices for the ticker.
    Tries yfinance first (fast, local dev), falls back to Stooq (works from
    cloud IPs where Yahoo blocks us).
    """
    ticker = ticker.upper().strip()
    allowed = {"1mo", "3mo", "6mo", "1y", "2y", "5y", "max"}
    if period not in allowed:
        period = "2y"

    # Run sync yfinance in a threadpool so we don't block the event loop.
    import asyncio

    points = await asyncio.to_thread(_fetch_yfinance, ticker, period)
    source = "yfinance"
    stooq_err: str | None = None

    if not points:
        points, stooq_err = await _fetch_stooq(ticker, period)
        source = "stooq"

    if not points:
        return {
            "ticker": ticker,
            "period": period,
            "count": 0,
            "points": [],
            "error": stooq_err
            or "No data available from yfinance or Stooq.",
        }

    return {
        "ticker": ticker,
        "period": period,
        "source": source,
        "count": len(points),
        "points": points,
    }


# ---------------------------------------------------------------------------
# Catalysts — seeded for now, real data layer later.
# ---------------------------------------------------------------------------
@app.get("/api/company/{ticker}/catalysts")
def get_catalysts(ticker: str) -> dict:
    ticker = ticker.upper().strip()
    events = SEED_CATALYSTS.get(ticker, [])

    today = datetime.utcnow().date()
    enriched = []
    for e in events:
        try:
            d = datetime.strptime(e["date"], "%Y-%m-%d").date()
        except ValueError:
            continue
        enriched.append({**e, "past": d < today})

    enriched.sort(key=lambda e: e["date"])

    return {
        "ticker": ticker,
        "count": len(enriched),
        "events": enriched,
    }
