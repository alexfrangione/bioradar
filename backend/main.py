"""
BioRadar API — FastAPI backend.

Endpoints:
  GET  /                                     -> service info
  GET  /api/health                           -> health check
  GET  /api/companies                        -> list of seeded tickers
  GET  /api/company/{ticker}                 -> company fundamentals (seed)
  GET  /api/company/{ticker}/pipeline        -> clinical trial pipeline (live)
  GET  /api/company/{ticker}/prices          -> daily price history
  GET  /api/company/{ticker}/quote           -> live quote (Twelve Data)
  GET  /api/company/{ticker}/catalysts       -> catalyst events (seed)
  GET  /api/company/{ticker}/earnings        -> earnings dates (seed)
"""

import asyncio
import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from time import time as _now
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from edgar import get_edgar_company_data, get_edgar_earnings

# Always load .env from next to main.py — not from the process CWD.
# This way the key is found whether you run uvicorn from backend/ or the repo root.
_ENV_PATH = Path(__file__).resolve().parent / ".env"
load_dotenv(_ENV_PATH)
print(
    f"[bioradar] env loaded from {_ENV_PATH if _ENV_PATH.exists() else '(none)'} "
    f"· twelvedata_key={'yes' if os.getenv('TWELVE_DATA_API_KEY') else 'no'}"
)

app = FastAPI(
    title="BioRadar API",
    version="0.3.0",
    description="Biotech investor research platform — backend API.",
)

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
allowed_origins = [frontend_url, "http://localhost:3000"]
if frontend_url and frontend_url not in allowed_origins:
    allowed_origins.append(frontend_url.rstrip("/"))

# Allow:
#   - any localhost / 127.0.0.1 port (dev: 3000, 3001, etc.)
#   - any *.vercel.app subdomain (production + preview deploys)
cors_regex = r"^(https://.*\.vercel\.app|http://(localhost|127\.0\.0\.1)(:\d+)?)$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=cors_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Seed data — company fundamentals
# ---------------------------------------------------------------------------
# pe_ratio is null for unprofitable biotechs (no positive earnings to divide by).
SEED_COMPANIES: dict[str, dict] = {
    "CRSP": {
        "ticker": "CRSP",
        "name": "CRISPR Therapeutics AG",
        "exchange": "NASDAQ",
        "hq": "Zug, Switzerland",
        "sector": "Healthcare",
        "industry": "Biotechnology",
        "description": (
            "Gene-editing company developing CRISPR/Cas9 therapies for "
            "hemoglobinopathies, oncology, and cardiovascular disease."
        ),
        "market_cap_usd": 4_120_000_000,
        "cash_usd": 1_820_000_000,
        "quarterly_burn_usd": 217_000_000,
        "runway_months": 21,
        "shares_outstanding": 84_000_000,
        "eps_ttm": -7.85,
        "pe_ratio": None,
        "health": "stable",
    },
    "SRPT": {
        "ticker": "SRPT",
        "name": "Sarepta Therapeutics",
        "exchange": "NASDAQ",
        "hq": "Cambridge, MA",
        "sector": "Healthcare",
        "industry": "Biotechnology",
        "description": (
            "Genetic medicine company focused on Duchenne muscular dystrophy "
            "and other rare neuromuscular diseases."
        ),
        "market_cap_usd": 11_400_000_000,
        "cash_usd": 1_130_000_000,
        "quarterly_burn_usd": 155_000_000,
        "runway_months": 18,
        "shares_outstanding": 95_500_000,
        "eps_ttm": -2.45,
        "pe_ratio": None,
        "health": "stable",
    },
    "BEAM": {
        "ticker": "BEAM",
        "name": "Beam Therapeutics",
        "exchange": "NASDAQ",
        "hq": "Cambridge, MA",
        "sector": "Healthcare",
        "industry": "Biotechnology",
        "description": (
            "Base-editing company developing precision genetic medicines for "
            "sickle cell disease, oncology, and inherited metabolic disorders."
        ),
        "market_cap_usd": 2_840_000_000,
        "cash_usd": 978_000_000,
        "quarterly_burn_usd": 98_000_000,
        "runway_months": 30,
        "shares_outstanding": 82_300_000,
        "eps_ttm": -4.65,
        "pe_ratio": None,
        "health": "stable",
    },
    "VRTX": {
        "ticker": "VRTX",
        "name": "Vertex Pharmaceuticals",
        "exchange": "NASDAQ",
        "hq": "Boston, MA",
        "sector": "Healthcare",
        "industry": "Biotechnology",
        "description": (
            "Commercial-stage biotech with a dominant cystic fibrosis "
            "franchise, expanding into pain, T1D, and sickle cell via Casgevy."
        ),
        "market_cap_usd": 112_000_000_000,
        "cash_usd": 13_800_000_000,
        "quarterly_burn_usd": 0,
        "runway_months": None,
        "shares_outstanding": 258_000_000,
        "eps_ttm": 14.72,
        "pe_ratio": 29.5,
        "health": "strong",
    },
    "MRNA": {
        "ticker": "MRNA",
        "name": "Moderna",
        "exchange": "NASDAQ",
        "hq": "Cambridge, MA",
        "sector": "Healthcare",
        "industry": "Biotechnology",
        "description": (
            "mRNA pioneer. Post-COVID pivot to oncology, rare disease, and "
            "respiratory vaccines."
        ),
        "market_cap_usd": 14_200_000_000,
        "cash_usd": 9_100_000_000,
        "quarterly_burn_usd": 420_000_000,
        "runway_months": 22,
        "shares_outstanding": 381_000_000,
        "eps_ttm": -10.20,
        "pe_ratio": None,
        "health": "watch",
    },
}

TICKER_TO_SPONSOR: dict[str, str] = {
    "CRSP": "CRISPR Therapeutics",
    "SRPT": "Sarepta Therapeutics",
    "BEAM": "Beam Therapeutics",
    "VRTX": "Vertex Pharmaceuticals",
    "MRNA": "Moderna",
}

# ---------------------------------------------------------------------------
# Seed data — catalyst events
# ---------------------------------------------------------------------------
# Event types:
#   approval            (green)    — FDA/EMA approval
#   readout-positive    (green)    — clinical trial met endpoint / positive data
#   readout-negative    (red)      — missed endpoint / failure / safety signal
#   failure             (red)      — program discontinuation
#   fda-advisory        (purple)   — AdCom vote, PDUFA, CRL
#   launch              (amber)    — commercial launch, first patient dosed
#   filing              (amber)    — BLA/NDA/IND submission
#   licensing           (blue)     — partnership / licensing deal
#   other               (gray)     — fallback
SEED_CATALYSTS: dict[str, list[dict]] = {
    "CRSP": [
        {
            "date": "2022-10-27",
            "title": "Exa-cel Phase 1/2 positive data at ASH",
            "type": "readout-positive",
            "impact": "high",
            "summary": (
                "Partnered with Vertex, CRSP presented updated Phase 1/2 data at ASH 2022 "
                "showing the CRISPR/Cas9 therapy exa-cel (later branded Casgevy) eliminated "
                "vaso-occlusive crises in SCD patients and transfusion dependence in "
                "beta-thalassemia patients. The readout set up the BLA filing."
            ),
        },
        {
            "date": "2023-10-31",
            "title": "FDA AdCom voted favorably for Casgevy",
            "type": "fda-advisory",
            "impact": "high",
            "summary": (
                "FDA's advisory committee reviewed safety data — specifically concerns "
                "around off-target edits — and broadly agreed the benefit/risk profile "
                "favored approval for sickle cell. No formal vote was taken, but the tone "
                "was positive. Stock rallied ahead of the PDUFA date."
            ),
        },
        {
            "date": "2023-12-08",
            "title": "Casgevy FDA approval (SCD)",
            "type": "approval",
            "impact": "high",
            "summary": (
                "FDA granted approval for Casgevy (exa-cel) in sickle cell disease — the "
                "first-ever CRISPR gene-editing therapy approved in the US. Priced at "
                "$2.2M per patient. Revenue split 60/40 with Vertex (Vertex leads "
                "commercialization)."
            ),
        },
        {
            "date": "2024-01-16",
            "title": "Casgevy FDA approval (beta-thalassemia)",
            "type": "approval",
            "impact": "high",
            "summary": (
                "Second FDA approval for Casgevy, this time in transfusion-dependent "
                "beta-thalassemia. Expanded the addressable population by ~1,500 US "
                "patients and strengthened the rationale for a full commercial build-out."
            ),
        },
        {
            "date": "2024-02-14",
            "title": "Casgevy — first commercial patient dosed",
            "type": "launch",
            "impact": "medium",
            "summary": (
                "First commercial patient received Casgevy at an authorized treatment "
                "center. The launch is deliberately slow — the ~12-month cell collection, "
                "editing, and myeloablative conditioning cycle limits near-term revenue ramp."
            ),
        },
        {
            "date": "2024-05-07",
            "title": "CTX112 IND cleared by FDA",
            "type": "filing",
            "impact": "low",
            "summary": (
                "FDA cleared the IND for CTX112, a next-generation allogeneic CAR-T "
                "targeting CD19 for B-cell malignancies. Incorporates gene edits intended "
                "to improve persistence vs. the earlier CTX110 program."
            ),
        },
        {
            "date": "2025-06-10",
            "title": "CTX112 Phase 1 readout (B-cell malignancies)",
            "type": "readout-positive",
            "impact": "medium",
            "summary": (
                "Phase 1 update showed complete responses in heavily pretreated NHL "
                "patients with a manageable safety profile. Response durability remains "
                "the key open question vs. autologous CAR-Ts like Yescarta and Breyanzi."
            ),
        },
        {
            "date": "2025-10-20",
            "title": "VERVE-102 co-development deal expanded",
            "type": "licensing",
            "impact": "medium",
            "summary": (
                "Expanded partnership with Verve Therapeutics on VERVE-102, an in vivo "
                "base editor targeting PCSK9 for heterozygous familial hypercholesterolemia. "
                "Deal includes an upfront payment plus tiered milestones and royalties."
            ),
        },
        {
            "date": "2026-02-20",
            "title": "VERVE-102 Phase 1b data (cardiovascular)",
            "type": "readout-positive",
            "impact": "medium",
            "summary": (
                "First Phase 1b data showing durable LDL-C reductions from a single "
                "infusion of VERVE-102. A validating readout for in vivo base editing "
                "as a modality — potential multi-billion-dollar market if durability holds."
            ),
        },
    ],
    "SRPT": [
        {
            "date": "2023-05-12",
            "title": "Elevidys FDA AdCom (split vote)",
            "type": "fda-advisory",
            "impact": "high",
            "summary": (
                "AdCom split 8–6 in favor of accelerated approval for Elevidys in DMD. "
                "Reviewers debated whether microdystrophin expression was a reasonable "
                "surrogate for clinical benefit. The close vote hinted at the narrower "
                "label the FDA would ultimately issue."
            ),
        },
        {
            "date": "2023-06-22",
            "title": "Elevidys accelerated FDA approval",
            "type": "approval",
            "impact": "high",
            "summary": (
                "FDA granted accelerated approval for Elevidys in ambulatory DMD patients "
                "ages 4–5 — narrower than Sarepta's requested 4–7 label. First gene therapy "
                "for DMD. Full approval contingent on the confirmatory EMBARK trial."
            ),
        },
        {
            "date": "2023-10-30",
            "title": "EMBARK Phase 3 confirmatory missed primary endpoint",
            "type": "readout-negative",
            "impact": "high",
            "summary": (
                "EMBARK missed its primary endpoint (change in NSAA at 52 weeks) though "
                "secondary timed-function tests favored Elevidys. Stock dropped ~40% "
                "intraday on fears the FDA would pull accelerated approval. Management "
                "argued the secondaries justified full approval."
            ),
        },
        {
            "date": "2024-06-20",
            "title": "Elevidys full approval + label expansion",
            "type": "approval",
            "impact": "high",
            "summary": (
                "Despite the EMBARK miss, FDA granted full approval and expanded the "
                "label to all ambulatory DMD patients ages 4+ and accelerated approval "
                "for non-ambulatory. A major vote of confidence. Stock rallied ~35%."
            ),
        },
        {
            "date": "2024-07-15",
            "title": "Elevidys label expanded to ambulatory 4+",
            "type": "launch",
            "impact": "medium",
            "summary": (
                "Commercial launch rolled out to expanded patient population. Capacity "
                "constraints at manufacturing sites remain a gating factor for near-term "
                "revenue growth."
            ),
        },
        {
            "date": "2025-05-14",
            "title": "Elevidys Q1 sales miss on commercial guidance",
            "type": "readout-negative",
            "impact": "medium",
            "summary": (
                "Q1 Elevidys sales came in ~15% below consensus as treatment center "
                "onboarding slowed and payer approval timelines extended. Management "
                "lowered FY guidance. Stock -22% on the print."
            ),
        },
        {
            "date": "2025-10-15",
            "title": "SRP-9003 Phase 3 interim (LGMD2E)",
            "type": "readout-positive",
            "impact": "medium",
            "summary": (
                "Interim readout for SRP-9003 in limb-girdle muscular dystrophy type 2E "
                "showed sustained beta-sarcoglycan expression and functional improvements. "
                "Potential second gene-therapy franchise beyond DMD."
            ),
        },
    ],
    "BEAM": [
        {
            "date": "2023-06-15",
            "title": "BEAM-101 IND cleared",
            "type": "filing",
            "impact": "low",
            "summary": (
                "FDA cleared the IND for BEAM-101, Beam's lead ex vivo base-editing "
                "candidate for sickle cell disease. Uses a fundamentally different "
                "approach than Casgevy — base editing converts one nucleotide without "
                "making a double-strand break."
            ),
        },
        {
            "date": "2023-12-09",
            "title": "BEAM-101 initial Phase 1/2 data at ASH",
            "type": "readout-positive",
            "impact": "high",
            "summary": (
                "First-in-human base editing data at ASH 2023 showed successful "
                "engraftment and high fetal hemoglobin levels in the initial SCD patients. "
                "Viewed as proof-of-concept for the base editing platform. Shares +50% "
                "on the day."
            ),
        },
        {
            "date": "2024-12-09",
            "title": "BEAM-101 Phase 1/2 update (SCD)",
            "type": "readout-positive",
            "impact": "high",
            "summary": (
                "Updated Phase 1/2 data from a larger cohort confirmed durable HbF "
                "elevation and resolution of vaso-occlusive crises. Strengthens the "
                "differentiation story vs. Casgevy on both efficacy and safety."
            ),
        },
        {
            "date": "2025-03-24",
            "title": "BEAM-302 first patient dosed (AATD)",
            "type": "launch",
            "impact": "medium",
            "summary": (
                "First patient dosed in the Phase 1 trial of BEAM-302, an in vivo base "
                "editor for alpha-1 antitrypsin deficiency. Would be the first in vivo "
                "base-editing trial reading out — milestone for the platform."
            ),
        },
        {
            "date": "2026-01-15",
            "title": "BEAM-302 Phase 1 first data (AATD)",
            "type": "readout-positive",
            "impact": "medium",
            "summary": (
                "First clinical evidence of in vivo base editing correcting the PiZ "
                "mutation. If the biomarker data holds up, it opens the door to "
                "expanding Beam's pipeline into large liver-directed indications."
            ),
        },
    ],
    "VRTX": [
        {
            "date": "2024-01-30",
            "title": "Casgevy launch — first patient dosed",
            "type": "launch",
            "impact": "medium",
            "summary": (
                "Partnered with CRISPR Therapeutics. Vertex leads commercialization and "
                "takes ~60% of the economics. Slow ramp expected given the multi-month "
                "treatment cycle and limited authorized treatment centers."
            ),
        },
        {
            "date": "2024-05-22",
            "title": "Vanzacaftor triple Phase 3 positive (CF)",
            "type": "readout-positive",
            "impact": "high",
            "summary": (
                "Vanzacaftor triple combination met both Phase 3 primary endpoints, "
                "demonstrating non-inferior lung function improvement vs. Trikafta with "
                "a once-daily dose and lower royalty burden. Sets up a defensive transition "
                "as Trikafta IP erodes."
            ),
        },
        {
            "date": "2024-12-20",
            "title": "Alyftrek FDA approval (next-gen CFTR)",
            "type": "approval",
            "impact": "high",
            "summary": (
                "FDA approved Alyftrek (vanzacaftor/tezacaftor/deutivacaftor), Vertex's "
                "next-generation CF triple. Once-daily dosing, broader genotype coverage, "
                "and reduced royalty obligations. Positioned to replace Trikafta as the "
                "CF franchise anchor."
            ),
        },
        {
            "date": "2025-01-30",
            "title": "Journavx (suzetrigine) FDA approval — acute pain",
            "type": "approval",
            "impact": "high",
            "summary": (
                "FDA approved Journavx (suzetrigine), a first-in-class NaV1.8 inhibitor "
                "for moderate-to-severe acute pain. Non-opioid, non-addictive. Major "
                "diversification beyond CF — addressable US market is ~80M acute pain "
                "prescriptions per year."
            ),
        },
        {
            "date": "2025-04-10",
            "title": "Alyftrek commercial launch",
            "type": "launch",
            "impact": "medium",
            "summary": (
                "Alyftrek commercial launch kicked off with broad payer coverage and "
                "rapid switching from Trikafta. Management guided 80%+ conversion of "
                "the Trikafta patient base within 18 months."
            ),
        },
        {
            "date": "2025-12-15",
            "title": "VX-880 Phase 1/2 update (Type 1 diabetes)",
            "type": "readout-positive",
            "impact": "medium",
            "summary": (
                "VX-880 stem cell–derived islet therapy showed continued insulin "
                "independence in the treated cohort. Encapsulated version (VX-264) in "
                "earlier trials aims to remove the immunosuppression requirement, the "
                "key barrier to broad T1D use."
            ),
        },
    ],
    "MRNA": [
        {
            "date": "2023-08-18",
            "title": "mRNA-1345 RSV Phase 3 positive",
            "type": "readout-positive",
            "impact": "high",
            "summary": (
                "Phase 3 ConquerRSV trial showed 83.7% efficacy against RSV lower "
                "respiratory tract disease in adults 60+. Positioned Moderna to enter "
                "the RSV market alongside Pfizer and GSK with a platform advantage on "
                "manufacturing speed."
            ),
        },
        {
            "date": "2023-10-16",
            "title": "mRNA-1010 seasonal flu Phase 3 missed endpoint",
            "type": "readout-negative",
            "impact": "high",
            "summary": (
                "Phase 3 trial of mRNA-1010 quadrivalent flu vaccine missed the primary "
                "immunogenicity non-inferiority endpoint for influenza B strains. Forced "
                "a pipeline reprioritization and cast doubt on the combo flu/COVID "
                "program's timeline."
            ),
        },
        {
            "date": "2024-02-22",
            "title": "FY2024 COVID revenue guidance cut",
            "type": "readout-negative",
            "impact": "medium",
            "summary": (
                "Management lowered FY2024 Spikevax revenue guidance as booster uptake "
                "fell faster than modeled. Highlighted the urgency of pipeline diversification "
                "beyond COVID. Shares -13%."
            ),
        },
        {
            "date": "2024-05-31",
            "title": "mRESVIA (RSV) FDA approval",
            "type": "approval",
            "impact": "high",
            "summary": (
                "FDA approved mRESVIA for adults 60+, Moderna's second commercial product "
                "and first non-COVID approval. Enters a competitive RSV market (Pfizer "
                "Abrysvo, GSK Arexvy). Platform validation for the mRNA modality beyond "
                "pandemic use."
            ),
        },
        {
            "date": "2024-09-10",
            "title": "mRNA-4157 Phase 2b melanoma 3-year follow-up",
            "type": "readout-positive",
            "impact": "high",
            "summary": (
                "3-year follow-up of the Phase 2b trial of mRNA-4157 (personalized cancer "
                "vaccine) + Keytruda continued to show ~49% reduction in recurrence/death "
                "vs. Keytruda alone in high-risk melanoma. Durable benefit supports the "
                "Phase 3 design."
            ),
        },
        {
            "date": "2025-07-10",
            "title": "mRNA-4157 Phase 3 interim (melanoma)",
            "type": "readout-positive",
            "impact": "high",
            "summary": (
                "Phase 3 INTerpath-001 interim analysis confirmed the Phase 2b recurrence "
                "signal with an independent cohort. Sets up a first commercial launch "
                "for personalized mRNA cancer vaccines as early as 2026/2027."
            ),
        },
    ],
}

# ---------------------------------------------------------------------------
# ClinicalTrials.gov display helpers
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
# Routes — basic
# ---------------------------------------------------------------------------
@app.get("/")
def root() -> dict:
    return {"service": "BioRadar API", "version": "0.3.0", "docs": "/docs"}


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


# ---------------------------------------------------------------------------
# Twelve Data fallback — lets us handle tickers beyond the SEED_COMPANIES set
# ---------------------------------------------------------------------------
_PROFILE_TTL_SECONDS = 3600  # 1 hour — Twelve Data free tier is rate-limited
_profile_cache: dict[str, tuple[float, dict | None]] = {}


async def _fetch_twelvedata_profile(ticker: str) -> dict | None:
    """Fetch sector, industry, description, HQ from Twelve Data /profile."""
    api_key = os.getenv("TWELVE_DATA_API_KEY")
    if not api_key:
        return None

    cached = _profile_cache.get(ticker)
    if cached and (_now() - cached[0]) < _PROFILE_TTL_SECONDS:
        return cached[1]

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.get(
                "https://api.twelvedata.com/profile",
                params={"symbol": ticker, "apikey": api_key},
            )
        if r.status_code != 200:
            _profile_cache[ticker] = (_now(), None)
            return None
        data = r.json()
        if isinstance(data, dict) and data.get("status") == "error":
            _profile_cache[ticker] = (_now(), None)
            return None
        _profile_cache[ticker] = (_now(), data)
        return data
    except httpx.HTTPError:
        return None


async def _fetch_twelvedata_quote_basic(ticker: str) -> dict | None:
    """Fetch just the /quote payload — works on free tier.

    Returned shape is the raw Twelve Data JSON (has `name`, `exchange`,
    `fifty_two_week`, etc). Used as a fallback when /profile is gated.
    """
    api_key = os.getenv("TWELVE_DATA_API_KEY")
    if not api_key:
        return None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                "https://api.twelvedata.com/quote",
                params={"symbol": ticker, "apikey": api_key},
            )
        if r.status_code != 200:
            return None
        data = r.json()
        if isinstance(data, dict) and data.get("status") == "error":
            return None
        return data
    except httpx.HTTPError:
        return None


async def _fetch_twelvedata_statistics(ticker: str) -> dict | None:
    """Fetch market cap, P/E, EPS, shares from Twelve Data /statistics.

    This endpoint is sometimes gated by plan tier; we gracefully return None
    on any error so the caller can just show "—" in those cells.
    """
    api_key = os.getenv("TWELVE_DATA_API_KEY")
    if not api_key:
        return None
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.get(
                "https://api.twelvedata.com/statistics",
                params={"symbol": ticker, "apikey": api_key},
            )
        if r.status_code != 200:
            return None
        data = r.json()
        if isinstance(data, dict) and data.get("status") == "error":
            return None
        return data
    except httpx.HTTPError:
        return None


def _format_hq(profile: dict | None) -> str | None:
    """Build a short HQ string: 'Cambridge, MA' or 'Zug, Switzerland'."""
    if not isinstance(profile, dict):
        return None
    city = (profile.get("city") or "").strip()
    state = (profile.get("state") or "").strip()
    country = (profile.get("country") or "").strip()
    parts: list[str] = []
    if city:
        parts.append(city)
    if state:
        parts.append(state)
    elif country and country.lower() != "united states":
        parts.append(country)
    return ", ".join(parts) if parts else None


# Regex of common corporate suffixes to strip for ClinicalTrials.gov queries.
# Matches ", Inc.", " Inc", ", Corporation", " Holdings", " AG", etc.
_SUFFIX_RE = re.compile(
    r"[,]?\s+(Inc\.?|Incorporated|Corporation|Corp\.?|Co\.?|Company|"
    r"Limited|Ltd\.?|Holdings|Group|LLC|L\.L\.C\.|AG|S\.A\.|SA|NV|"
    r"plc|PLC|N\.V\.)\s*$",
    re.IGNORECASE,
)


def _clean_sponsor_name(name: str) -> str:
    """Strip common corporate suffixes so ClinicalTrials.gov sponsor search matches."""
    if not name:
        return name
    cleaned = name.strip()
    # Strip suffixes up to 2 times ("Foo Holdings, Inc." → "Foo")
    for _ in range(2):
        new = _SUFFIX_RE.sub("", cleaned).strip().rstrip(",")
        if new == cleaned:
            break
        cleaned = new
    return cleaned


@app.get("/api/company/{ticker}")
async def get_company(ticker: str) -> dict:
    ticker = ticker.upper().strip()
    company = SEED_COMPANIES.get(ticker)
    if company is not None:
        return company

    # Unknown ticker — fallback chain:
    #   1. Grab the live price from Twelve Data /quote (free tier) for
    #      market-cap math and to salvage name/exchange if EDGAR misses.
    #   2. SEC EDGAR — authoritative + free. Fills cash, burn, runway, EPS,
    #      shares outstanding, P/E, sector, HQ, etc. US-listed filers only.
    #   3. Twelve Data /profile — richer descriptions (gated on paid tiers,
    #      gracefully None on free).
    #   4. Twelve Data /quote — at least gives us name + exchange for non-US
    #      ADRs that aren't in EDGAR.
    quote_basic, edgar_data = await asyncio.gather(
        _fetch_twelvedata_quote_basic(ticker),
        # We'll set price inside get_edgar_company_data via a second call
        # below if quote_basic has one — but it's cheaper to just run it
        # without the price and update market cap / P/E afterwards since
        # EDGAR returns shares_outstanding + eps_ttm directly.
        get_edgar_company_data(ticker),
    )

    # Re-compute market cap and P/E now that we have the price.
    price = _to_float(quote_basic.get("close")) if isinstance(quote_basic, dict) else None
    if edgar_data and price is not None:
        shares = edgar_data.get("shares_outstanding")
        if shares and edgar_data.get("market_cap_usd") is None:
            edgar_data["market_cap_usd"] = float(price) * float(shares)
        eps = edgar_data.get("eps_ttm")
        if eps and eps > 0 and edgar_data.get("pe_ratio") is None:
            edgar_data["pe_ratio"] = float(price) / float(eps)

    # Only hit the paid-tier profile endpoint if EDGAR didn't yield anything —
    # no point spending an API call when EDGAR already filled in sector/HQ.
    profile: dict | None = None
    if not edgar_data:
        profile = await _fetch_twelvedata_profile(ticker)

    if not edgar_data and not profile and not quote_basic:
        return {
            "ticker": ticker,
            "name": None,
            "placeholder": True,
            "message": (
                f"Couldn't find {ticker}. Check that it's a valid US-listed "
                "ticker. (Seeded data is available for CRSP, SRPT, BEAM, "
                "VRTX, and MRNA.)"
            ),
        }

    # Build the response by layering sources: EDGAR → Twelve Data /profile →
    # /quote. Each layer only fills in what the previous one left null.
    edgar_data = edgar_data or {}
    profile = profile or {}
    quote_basic = quote_basic or {}

    def first(*values):
        """Return the first non-None, non-empty value."""
        for v in values:
            if v is not None and v != "":
                return v
        return None

    # If EDGAR doesn't have the common name (rare), try profile/quote.
    name = first(edgar_data.get("name"), profile.get("name"), quote_basic.get("name"))
    exchange = first(
        edgar_data.get("exchange"),
        profile.get("exchange"),
        quote_basic.get("exchange"),
    )
    hq = first(edgar_data.get("hq"), _format_hq(profile))
    sector = first(edgar_data.get("sector"), profile.get("sector"))
    industry = first(edgar_data.get("industry"), profile.get("industry"))
    description = first(edgar_data.get("description"), profile.get("description"))

    return {
        "ticker": ticker,
        "name": name,
        "exchange": exchange,
        "hq": hq,
        "sector": sector,
        "industry": industry,
        "description": description,
        "market_cap_usd": edgar_data.get("market_cap_usd"),
        "cash_usd": edgar_data.get("cash_usd"),
        "quarterly_burn_usd": edgar_data.get("quarterly_burn_usd"),
        "runway_months": edgar_data.get("runway_months"),
        "shares_outstanding": edgar_data.get("shares_outstanding"),
        "eps_ttm": edgar_data.get("eps_ttm"),
        "pe_ratio": edgar_data.get("pe_ratio"),
        "health": None,
        "placeholder": False,
    }


# ---------------------------------------------------------------------------
# Ticker search / autocomplete — Twelve Data /symbol_search
# ---------------------------------------------------------------------------
@app.get("/api/search")
async def search_tickers(q: str, limit: int = 8) -> dict:
    q = q.strip()
    if not q:
        return {"query": q, "results": []}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                "https://api.twelvedata.com/symbol_search",
                params={"symbol": q, "outputsize": min(max(limit * 3, 1), 30)},
            )
        if r.status_code != 200:
            return {
                "query": q,
                "results": [],
                "error": f"twelvedata HTTP {r.status_code}",
            }
        data = r.json()
    except httpx.HTTPError as exc:
        return {"query": q, "results": [], "error": str(exc)}

    raw = data.get("data", []) if isinstance(data, dict) else []
    seen: set[str] = set()
    out: list[dict] = []
    # Prefer US-listed common stocks; push others to the end
    primary: list[dict] = []
    secondary: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        symbol = (item.get("symbol") or "").strip()
        name = (item.get("instrument_name") or "").strip()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        hit = {
            "symbol": symbol,
            "name": name,
            "exchange": item.get("exchange"),
            "country": item.get("country"),
            "type": item.get("instrument_type"),
        }
        country = (item.get("country") or "").lower()
        itype = (item.get("instrument_type") or "").lower()
        if country in {"united states", "us"} and "stock" in itype:
            primary.append(hit)
        else:
            secondary.append(hit)
    out = (primary + secondary)[:limit]
    return {"query": q, "results": out}


# ---------------------------------------------------------------------------
# Pipeline — live from ClinicalTrials.gov v2 API
# ---------------------------------------------------------------------------
@app.get("/api/company/{ticker}/pipeline")
async def get_pipeline(ticker: str, limit: int = 25) -> dict:
    ticker = ticker.upper().strip()
    sponsor = TICKER_TO_SPONSOR.get(ticker)

    # For unseeded tickers, derive the sponsor name. Try SEC EDGAR first
    # (authoritative + already cached from the /company call), then Twelve
    # Data. ClinicalTrials.gov does fuzzy matching, so stripping "Inc.",
    # "Corp.", etc. usually gives a good enough query.
    if not sponsor:
        name: str | None = None
        edgar_data = await get_edgar_company_data(ticker)
        if isinstance(edgar_data, dict):
            name = edgar_data.get("name")
        if not name:
            profile = await _fetch_twelvedata_profile(ticker)
            if isinstance(profile, dict):
                name = profile.get("name")
        if not name:
            quote_basic = await _fetch_twelvedata_quote_basic(ticker)
            if isinstance(quote_basic, dict):
                name = quote_basic.get("name")
        if name:
            sponsor = _clean_sponsor_name(name)

    if not sponsor:
        return {
            "ticker": ticker,
            "sponsor": None,
            "count": 0,
            "trials": [],
            "error": (
                f"Couldn't resolve a company name for {ticker} — pipeline "
                "lookup needs a sponsor name."
            ),
        }

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
        last_update = status.get("lastUpdatePostDateStruct", {}) or {}
        last_update_date = last_update.get("date")
        why_stopped = status.get("whyStopped")

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
                "last_update_date": last_update_date,
                "why_stopped": why_stopped,
                "url": (
                    f"https://clinicaltrials.gov/study/{ident.get('nctId')}"
                    if ident.get("nctId")
                    else None
                ),
            }
        )

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
# Price history (yfinance → Twelve Data fallback)
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
    try:
        from curl_cffi import requests as curl_requests  # type: ignore

        return curl_requests.Session(impersonate="chrome")
    except Exception:  # noqa: BLE001
        return None


def _fetch_yfinance(ticker: str, period: str) -> list[dict]:
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
        if close_f != close_f:
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


async def _fetch_twelvedata_prices(
    ticker: str, period: str
) -> tuple[list[dict], str | None]:
    api_key = os.getenv("TWELVE_DATA_API_KEY")
    if not api_key:
        return [], (
            "twelvedata: no API key configured "
            "(set TWELVE_DATA_API_KEY env var on the server)"
        )

    days = _PERIOD_DAYS.get(period, 732)
    outputsize = min(int(days * 0.72) + 10, 5000)

    url = "https://api.twelvedata.com/time_series"
    params = {
        "symbol": ticker,
        "interval": "1day",
        "outputsize": str(outputsize),
        "apikey": api_key,
        "format": "JSON",
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(url, params=params)
    except httpx.HTTPError as exc:
        return [], f"twelvedata network error: {exc}"

    if r.status_code != 200:
        return [], f"twelvedata HTTP {r.status_code}"

    try:
        data = r.json()
    except Exception:  # noqa: BLE001
        return [], f"twelvedata bad JSON (preview: {r.text[:120]!r})"

    if isinstance(data, dict) and data.get("status") == "error":
        return [], f"twelvedata error: {data.get('message', 'unknown')}"

    values = data.get("values") if isinstance(data, dict) else None
    if not values:
        return [], "twelvedata returned no values"

    points: list[dict] = []
    for v in reversed(values):
        try:
            date_str = str(v.get("datetime", ""))[:10]
            if not date_str:
                continue
            close = float(v["close"])
        except (ValueError, KeyError, TypeError):
            continue
        try:
            volume = int(float(v.get("volume", 0) or 0))
        except (ValueError, TypeError):
            volume = 0
        points.append(
            {"date": date_str, "close": round(close, 2), "volume": volume}
        )

    if not points:
        return [], "twelvedata parsed zero rows"
    return points, None


@app.get("/api/company/{ticker}/prices")
async def get_prices(ticker: str, period: str = "2y") -> dict:
    ticker = ticker.upper().strip()
    allowed = {"1mo", "3mo", "6mo", "1y", "2y", "5y", "max"}
    if period not in allowed:
        period = "2y"

    points = await asyncio.to_thread(_fetch_yfinance, ticker, period)
    source = "yfinance"
    fallback_err: str | None = None

    if not points:
        points, fallback_err = await _fetch_twelvedata_prices(ticker, period)
        source = "twelvedata"

    if not points:
        return {
            "ticker": ticker,
            "period": period,
            "count": 0,
            "points": [],
            "error": fallback_err or "No data available from any source.",
        }

    return {
        "ticker": ticker,
        "period": period,
        "source": source,
        "count": len(points),
        "points": points,
    }


# ---------------------------------------------------------------------------
# Live quote — Twelve Data /quote (free tier)
# ---------------------------------------------------------------------------
def _to_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
        return f if f == f else None  # NaN check
    except (TypeError, ValueError):
        return None


def _to_int(v: Any) -> int | None:
    if v is None:
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


@app.get("/api/company/{ticker}/quote")
async def get_quote(ticker: str) -> dict:
    """
    Live quote: current price, volume, avg volume, 52-week range, daily change.
    """
    ticker = ticker.upper().strip()
    api_key = os.getenv("TWELVE_DATA_API_KEY")
    if not api_key:
        return {
            "ticker": ticker,
            "error": "TWELVE_DATA_API_KEY not configured on the server.",
        }

    url = "https://api.twelvedata.com/quote"
    params = {"symbol": ticker, "apikey": api_key}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(url, params=params)
    except httpx.HTTPError as exc:
        return {"ticker": ticker, "error": f"twelvedata network error: {exc}"}

    if r.status_code != 200:
        return {"ticker": ticker, "error": f"twelvedata HTTP {r.status_code}"}

    try:
        data = r.json()
    except Exception:  # noqa: BLE001
        return {
            "ticker": ticker,
            "error": f"twelvedata bad JSON (preview: {r.text[:120]!r})",
        }

    if isinstance(data, dict) and data.get("status") == "error":
        return {
            "ticker": ticker,
            "error": f"twelvedata error: {data.get('message', 'unknown')}",
        }

    fw = data.get("fifty_two_week") or {}

    return {
        "ticker": ticker,
        "name": data.get("name"),
        "exchange": data.get("exchange"),
        "currency": data.get("currency", "USD"),
        "datetime": data.get("datetime"),
        "is_market_open": bool(data.get("is_market_open", False)),
        "price": _to_float(data.get("close")),
        "previous_close": _to_float(data.get("previous_close")),
        "change": _to_float(data.get("change")),
        "percent_change": _to_float(data.get("percent_change")),
        "open": _to_float(data.get("open")),
        "high": _to_float(data.get("high")),
        "low": _to_float(data.get("low")),
        "volume": _to_int(data.get("volume")),
        "average_volume": _to_int(data.get("average_volume")),
        "fifty_two_week_low": _to_float(fw.get("low")),
        "fifty_two_week_high": _to_float(fw.get("high")),
        "fifty_two_week_range": fw.get("range"),
    }


# ---------------------------------------------------------------------------
# Catalysts
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


# ---------------------------------------------------------------------------
# Earnings
# ---------------------------------------------------------------------------
@app.get("/api/company/{ticker}/earnings")
async def get_earnings(ticker: str) -> dict:
    ticker = ticker.upper().strip()
    today = datetime.utcnow().date()

    # SEC EDGAR 8-K Item 2.02 (US filers) + 6-K (foreign private issuers like
    # CRSP) — the actual earnings press release, same-day accurate.
    enriched = await get_edgar_earnings(ticker)
    enriched.sort(key=lambda e: e["date"])

    return {
        "ticker": ticker,
        "count": len(enriched),
        "events": enriched,
    }
