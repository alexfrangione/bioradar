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
from datetime import date, datetime, timedelta
from pathlib import Path
from time import time as _now
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from edgar import get_edgar_catalysts, get_edgar_company_data, get_edgar_earnings
from finnhub import get_finnhub_catalysts
from sector_filter import is_healthcare_ticker

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
#   - bioticker.us and any subdomain (www, staging, etc.)
cors_regex = (
    r"^(https://(bioticker\.us|.*\.bioticker\.us|.*\.vercel\.app)"
    r"|http://(localhost|127\.0\.0\.1)(:\d+)?)$"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=cors_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Cache-Control middleware
# ---------------------------------------------------------------------------
# Attach per-endpoint Cache-Control headers so Vercel's edge and the browser
# can serve repeat requests without hitting Render. `stale-while-revalidate`
# lets us keep serving the last good value while a background refresh runs.
#
# Buckets:
#   quote    -> 60s fresh / 120s swr   (semi-live price)
#   prices   -> 300s fresh / 600s swr  (daily bars rarely change intraday)
#   company  -> 900s fresh / 1800s swr (fundamentals are ~static)
#   pipeline -> 900s fresh / 1800s swr (CT.gov updates are slow)
#   catalysts-> 600s fresh / 1200s swr
#   earnings -> 600s fresh / 1200s swr
#   search   -> 120s fresh / 300s swr  (autocomplete hot path)
_CACHE_RULES: tuple[tuple[str, str], ...] = (
    ("/api/health", "public, max-age=60"),
    ("/api/search", "public, max-age=120, stale-while-revalidate=300"),
    ("/api/screener", "public, max-age=300, stale-while-revalidate=600"),
    ("/quote", "public, max-age=60, stale-while-revalidate=120"),
    ("/prices", "public, max-age=300, stale-while-revalidate=600"),
    ("/pipeline", "public, max-age=900, stale-while-revalidate=1800"),
    ("/catalysts", "public, max-age=600, stale-while-revalidate=1200"),
    ("/earnings", "public, max-age=600, stale-while-revalidate=1200"),
    # /api/company/{ticker} catch-all (must come last so the more-specific
    # /pipeline, /quote, etc. suffixes match first).
    ("/api/company/", "public, max-age=900, stale-while-revalidate=1800"),
    ("/api/companies", "public, max-age=3600"),
)


@app.middleware("http")
async def add_cache_headers(request, call_next):
    response = await call_next(request)
    # Only cache GETs on 2xx responses. Skip if handler already set the header.
    if request.method != "GET" or not (200 <= response.status_code < 300):
        return response
    if "cache-control" in (h.lower() for h in response.headers.keys()):
        return response
    path = request.url.path
    for needle, directive in _CACHE_RULES:
        if needle in path:
            response.headers["Cache-Control"] = directive
            break
    return response


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

# Popular healthcare directory. Maps ticker -> (primary_name, exchange, aliases).
# Used by /api/search two ways:
#   1. Known-healthcare fast-path — skip EDGAR classification for these.
#   2. Local name/alias match — before hitting Twelve Data, resolve queries
#      like "medtronic" or "crispr" against this directory so common companies
#      show up even when Twelve Data's symbol_search doesn't surface them.
# Aliases are short forms/shorthand ("Vertex" for "Vertex Pharmaceuticals").
_HEALTHCARE_DIRECTORY: dict[str, tuple[str, str, tuple[str, ...]]] = {
    # Gene editing / RNAi / cell therapy
    "MRNA": ("Moderna", "NASDAQ", ()),
    "VRTX": ("Vertex Pharmaceuticals", "NASDAQ", ("Vertex",)),
    "CRSP": ("CRISPR Therapeutics", "NASDAQ", ("CRISPR",)),
    "BEAM": ("Beam Therapeutics", "NASDAQ", ("Beam",)),
    "SRPT": ("Sarepta Therapeutics", "NASDAQ", ("Sarepta",)),
    "NTLA": ("Intellia Therapeutics", "NASDAQ", ("Intellia",)),
    "EDIT": ("Editas Medicine", "NASDAQ", ("Editas",)),
    "ALNY": ("Alnylam Pharmaceuticals", "NASDAQ", ("Alnylam",)),
    "ARWR": ("Arrowhead Pharmaceuticals", "NASDAQ", ("Arrowhead",)),
    "IONS": ("Ionis Pharmaceuticals", "NASDAQ", ("Ionis",)),
    "BLUE": ("bluebird bio", "NASDAQ", ("bluebird",)),
    "KRYS": ("Krystal Biotech", "NASDAQ", ("Krystal",)),
    "VRCA": ("Verrica Pharmaceuticals", "NASDAQ", ("Verrica",)),
    # Large/mid-cap biotech
    "REGN": ("Regeneron Pharmaceuticals", "NASDAQ", ("Regeneron",)),
    "BNTX": ("BioNTech", "NASDAQ", ()),
    "BIIB": ("Biogen", "NASDAQ", ()),
    "GILD": ("Gilead Sciences", "NASDAQ", ("Gilead",)),
    "AMGN": ("Amgen", "NASDAQ", ()),
    "INCY": ("Incyte", "NASDAQ", ()),
    "BMRN": ("BioMarin Pharmaceutical", "NASDAQ", ("BioMarin",)),
    "SGEN": ("Seagen", "NASDAQ", ()),
    "EXEL": ("Exelixis", "NASDAQ", ()),
    "HALO": ("Halozyme Therapeutics", "NASDAQ", ("Halozyme",)),
    "NBIX": ("Neurocrine Biosciences", "NASDAQ", ("Neurocrine",)),
    "MDGL": ("Madrigal Pharmaceuticals", "NASDAQ", ("Madrigal",)),
    "INSM": ("Insmed", "NASDAQ", ()),
    "MRTX": ("Mirati Therapeutics", "NASDAQ", ("Mirati",)),
    "LGND": ("Ligand Pharmaceuticals", "NASDAQ", ("Ligand",)),
    "ACAD": ("ACADIA Pharmaceuticals", "NASDAQ", ("ACADIA",)),
    "RIGL": ("Rigel Pharmaceuticals", "NASDAQ", ("Rigel",)),
    "RARE": ("Ultragenyx Pharmaceutical", "NASDAQ", ("Ultragenyx",)),
    "VKTX": ("Viking Therapeutics", "NASDAQ", ("Viking",)),
    "AXSM": ("Axsome Therapeutics", "NASDAQ", ("Axsome",)),
    "CRNX": ("Crinetics Pharmaceuticals", "NASDAQ", ("Crinetics",)),
    "CPRX": ("Catalyst Pharmaceuticals", "NASDAQ", ()),
    "ETNB": ("89bio", "NASDAQ", ()),
    "IMVT": ("Immunovant", "NASDAQ", ()),
    "ITCI": ("Intra-Cellular Therapies", "NASDAQ", ("Intra-Cellular",)),
    "MNMD": ("Mind Medicine", "NASDAQ", ("MindMed",)),
    "PTCT": ("PTC Therapeutics", "NASDAQ", ("PTC",)),
    "RNA": ("Avidity Biosciences", "NASDAQ", ("Avidity",)),
    "RYTM": ("Rhythm Pharmaceuticals", "NASDAQ", ("Rhythm",)),
    "SAVA": ("Cassava Sciences", "NASDAQ", ("Cassava",)),
    "SMMT": ("Summit Therapeutics", "NASDAQ", ("Summit",)),
    "TGTX": ("TG Therapeutics", "NASDAQ", ()),
    "TVTX": ("Travere Therapeutics", "NASDAQ", ("Travere",)),
    # Megacap pharma
    "PFE": ("Pfizer", "NYSE", ()),
    "MRK": ("Merck & Co.", "NYSE", ("Merck",)),
    "LLY": ("Eli Lilly", "NYSE", ("Lilly",)),
    "JNJ": ("Johnson & Johnson", "NYSE", ("Johnson and Johnson",)),
    "ABBV": ("AbbVie", "NYSE", ()),
    "NVO": ("Novo Nordisk", "NYSE", ()),
    "AZN": ("AstraZeneca", "NASDAQ", ()),
    "BMY": ("Bristol-Myers Squibb", "NYSE", ("Bristol Myers",)),
    "SNY": ("Sanofi", "NASDAQ", ()),
    "GSK": ("GSK plc", "NYSE", ("GlaxoSmithKline",)),
    "NVS": ("Novartis", "NYSE", ()),
    "RHHBY": ("Roche Holding", "OTC", ("Roche",)),
    "TAK": ("Takeda Pharmaceutical", "NYSE", ("Takeda",)),
    # Medical devices
    "MDT": ("Medtronic", "NYSE", ()),
    "ISRG": ("Intuitive Surgical", "NASDAQ", ("Intuitive",)),
    "SYK": ("Stryker", "NYSE", ()),
    "BSX": ("Boston Scientific", "NYSE", ()),
    "EW": ("Edwards Lifesciences", "NYSE", ("Edwards",)),
    "DXCM": ("DexCom", "NASDAQ", ("Dexcom",)),
    "BDX": ("Becton Dickinson", "NYSE", ("BD",)),
    "ZBH": ("Zimmer Biomet", "NYSE", ("Zimmer",)),
    "ABT": ("Abbott Laboratories", "NYSE", ("Abbott",)),
    "BAX": ("Baxter International", "NYSE", ("Baxter",)),
    "PODD": ("Insulet", "NASDAQ", ()),
    "HOLX": ("Hologic", "NASDAQ", ()),
    "RMD": ("ResMed", "NYSE", ()),
    "IDXX": ("IDEXX Laboratories", "NASDAQ", ("IDEXX",)),
    # Life-sciences tools / diagnostics
    "TMO": ("Thermo Fisher Scientific", "NYSE", ("Thermo Fisher",)),
    "DHR": ("Danaher", "NYSE", ()),
    "WAT": ("Waters Corporation", "NYSE", ("Waters",)),
    "A": ("Agilent Technologies", "NYSE", ("Agilent",)),
    "MTD": ("Mettler-Toledo", "NYSE", ("Mettler",)),
    "ILMN": ("Illumina", "NASDAQ", ()),
    "LH": ("Labcorp Holdings", "NYSE", ("Labcorp", "Laboratory Corporation")),
    "DGX": ("Quest Diagnostics", "NYSE", ("Quest",)),
    "CRL": ("Charles River Laboratories", "NYSE", ("Charles River",)),
    "ICLR": ("ICON plc", "NASDAQ", ("ICON",)),
    "IQV": ("IQVIA Holdings", "NYSE", ("IQVIA",)),
    "EXAS": ("Exact Sciences", "NASDAQ", ()),
    "NTRA": ("Natera", "NASDAQ", ()),
    "GH": ("Guardant Health", "NASDAQ", ("Guardant",)),
    # Managed care / services / distribution
    "UNH": ("UnitedHealth Group", "NYSE", ("UnitedHealth",)),
    "CVS": ("CVS Health", "NYSE", ("CVS",)),
    "CI": ("Cigna Group", "NYSE", ("Cigna",)),
    "HUM": ("Humana", "NYSE", ()),
    "ELV": ("Elevance Health", "NYSE", ("Elevance", "Anthem")),
    "CNC": ("Centene", "NYSE", ()),
    "MOH": ("Molina Healthcare", "NYSE", ("Molina",)),
    "MCK": ("McKesson", "NYSE", ()),
    "CAH": ("Cardinal Health", "NYSE", ("Cardinal",)),
    "COR": ("Cencora", "NYSE", ("AmerisourceBergen",)),
    "WBA": ("Walgreens Boots Alliance", "NASDAQ", ("Walgreens",)),
}

# Derived set used by the /api/search fast-path check.
_POPULAR_HEALTHCARE: frozenset[str] = frozenset(_HEALTHCARE_DIRECTORY.keys())


def _local_healthcare_match(q: str, limit: int) -> list[dict]:
    """
    Search the local healthcare directory by ticker prefix, name prefix,
    or alias prefix (then substring). Returns up to `limit` hits sorted by
    match quality. Zero network calls — this runs on every keystroke.
    """
    q_clean = q.strip()
    if not q_clean:
        return []
    q_upper = q_clean.upper()
    q_lower = q_clean.lower()

    # Rank 0 = ticker prefix, 1 = name/alias prefix, 2 = name/alias substring.
    scored: list[tuple[int, str, dict]] = []
    for ticker, (name, exchange, aliases) in _HEALTHCARE_DIRECTORY.items():
        name_l = name.lower()
        alias_ls = tuple(a.lower() for a in aliases)

        rank: int | None = None
        if ticker.startswith(q_upper):
            rank = 0
        elif name_l.startswith(q_lower) or any(a.startswith(q_lower) for a in alias_ls):
            rank = 1
        elif q_lower in name_l or any(q_lower in a for a in alias_ls):
            rank = 2

        if rank is not None:
            scored.append(
                (
                    rank,
                    ticker,
                    {
                        "symbol": ticker,
                        "name": name,
                        "exchange": exchange,
                        "country": "United States",
                        "type": "Common Stock",
                    },
                )
            )

    scored.sort(key=lambda x: (x[0], x[1]))
    return [hit for (_, _, hit) in scored[:limit]]

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
# Cache pre-warming
# ---------------------------------------------------------------------------
# Biggest single cause of "first visit is slow" is cold per-process caches
# after a Render deploy or restart. On startup, fetch the popular universe's
# company + pipeline data in the background. Errors are swallowed — this is
# pure optimization, the real endpoints work fine if warming fails.
async def _warm_caches() -> None:
    try:
        tickers = sorted(set(SEED_COMPANIES.keys()) | _POPULAR_HEALTHCARE)
        # getCompany fills the EDGAR + Twelve Data profile caches; getPipeline
        # fills the CT.gov cache. Fan-out is OK — EDGAR rate limits are 10
        # req/s and we have ~50 tickers total.
        async def _one(ticker: str) -> None:
            try:
                await get_edgar_company_data(ticker)
            except Exception:
                pass

        await asyncio.gather(*(_one(t) for t in tickers), return_exceptions=True)
        print(f"[bioradar] cache warm-up complete for {len(tickers)} tickers")
    except Exception as exc:
        print(f"[bioradar] cache warm-up failed: {exc}")


@app.on_event("startup")
async def _on_startup() -> None:
    # Fire-and-forget — don't block the server becoming healthy.
    asyncio.create_task(_warm_caches())


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
# Free tier is 8 credits/minute. Each /quote hit = 1 credit, and we invoke
# it twice per company page load (once inside get_company for market-cap
# math, once from the /quote endpoint for 52-week range + avg volume). Without
# caching that ceilings the site at 4 page loads/minute before null fields
# start showing. 120s of staleness is fine for market-cap-style data.
_PROFILE_TTL_SECONDS = 3600  # 1 hour — profile data is near-static
_QUOTE_TTL_SECONDS = 600     # 10 minutes — screener-scale fan-out needs headroom;
                              # quote movement within 10 min is noise for the
                              # market-cap / 52w / avg-vol fields we display
_SCREENER_TTL_SECONDS = 300  # 5 min cache for the full screener payload
_FAIL_TTL_SECONDS = 60       # 60s negative cache so a single rate-limit
                              # doesn't hide fields for an hour

# Global Twelve Data concurrency cap. Free tier is 8 credits/min; if every
# tab / screener load fires requests concurrently, we trip the per-minute
# limit instantly and everything downstream negative-caches. Serialising to
# 2-at-a-time dramatically reduces burst failures.
_TD_SEMAPHORE = asyncio.Semaphore(2)

_profile_cache: dict[str, tuple[float, dict | None]] = {}
# ticker (upper) → (timestamp, raw /quote JSON or None). Shared by
# _fetch_twelvedata_quote_basic (used by get_company), the /quote
# endpoint, AND the batched /api/screener endpoint so one network call
# feeds every code path that needs quote data.
_quote_cache: dict[str, tuple[float, dict | None]] = {}
# Screener response cache — keyed by the sorted ticker CSV so different
# filters (same ticker set) hit the same cached row array.
_screener_cache: dict[str, tuple[float, list[dict]]] = {}


def _cache_fresh(ts: float, val: object, success_ttl: int) -> bool:
    """Success values get the full TTL; failure (None) values expire fast
    so a one-off rate-limit doesn't poison the cache for the full window."""
    ttl = success_ttl if val is not None else _FAIL_TTL_SECONDS
    return (_now() - ts) < ttl


async def _fetch_twelvedata_profile(ticker: str) -> dict | None:
    """Fetch sector, industry, description, HQ from Twelve Data /profile."""
    api_key = os.getenv("TWELVE_DATA_API_KEY")
    if not api_key:
        return None

    cached = _profile_cache.get(ticker)
    if cached and _cache_fresh(cached[0], cached[1], _PROFILE_TTL_SECONDS):
        return cached[1]

    try:
        async with _TD_SEMAPHORE:
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
        _profile_cache[ticker] = (_now(), None)
        return None


async def _fetch_twelvedata_quote_basic(ticker: str) -> dict | None:
    """Fetch the /quote payload — works on free tier.

    Returned shape is the raw Twelve Data JSON (has `name`, `exchange`,
    `fifty_two_week`, `average_volume`, etc). Shared cache with the
    /api/company/{ticker}/quote endpoint so one network call feeds both
    the market-cap computation and the header stats.
    """
    api_key = os.getenv("TWELVE_DATA_API_KEY")
    if not api_key:
        return None

    cached = _quote_cache.get(ticker)
    if cached and _cache_fresh(cached[0], cached[1], _QUOTE_TTL_SECONDS):
        return cached[1]

    try:
        async with _TD_SEMAPHORE:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(
                    "https://api.twelvedata.com/quote",
                    params={"symbol": ticker, "apikey": api_key},
                )
        if r.status_code != 200:
            _quote_cache[ticker] = (_now(), None)
            return None
        data = r.json()
        if isinstance(data, dict) and data.get("status") == "error":
            _quote_cache[ticker] = (_now(), None)
            return None
        _quote_cache[ticker] = (_now(), data)
        return data
    except httpx.HTTPError:
        _quote_cache[ticker] = (_now(), None)
        return None


async def _fetch_twelvedata_quote_batch(tickers: list[str]) -> dict[str, dict | None]:
    """Batch /quote: comma-separated symbols, one HTTP call per chunk.

    Twelve Data accepts up to ~120 symbols per /quote call. Each symbol is
    still billed as 1 credit, but we collapse N round-trips into 1. When >1
    symbol is requested, the API returns a dict keyed by symbol; when 1, it
    returns the quote object directly. This helper normalises both.

    Side-effect: populates _quote_cache for every ticker we asked about so
    that subsequent single-ticker lookups (from get_company / /quote) hit
    cache and don't re-spend credits.
    """
    if not tickers:
        return {}
    api_key = os.getenv("TWELVE_DATA_API_KEY")
    if not api_key:
        return {t: None for t in tickers}

    # 60/chunk keeps URLs comfortably short and leaves headroom.
    results: dict[str, dict | None] = {t: None for t in tickers}
    CHUNK = 60
    for i in range(0, len(tickers), CHUNK):
        chunk = tickers[i : i + CHUNK]
        symbol_param = ",".join(chunk)
        try:
            async with _TD_SEMAPHORE:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    r = await client.get(
                        "https://api.twelvedata.com/quote",
                        params={"symbol": symbol_param, "apikey": api_key},
                    )
            if r.status_code != 200:
                for t in chunk:
                    _quote_cache[t] = (_now(), None)
                continue
            payload = r.json()
            if len(chunk) == 1:
                if (
                    not isinstance(payload, dict)
                    or payload.get("status") == "error"
                ):
                    _quote_cache[chunk[0]] = (_now(), None)
                else:
                    _quote_cache[chunk[0]] = (_now(), payload)
                    results[chunk[0]] = payload
            else:
                if not isinstance(payload, dict):
                    for t in chunk:
                        _quote_cache[t] = (_now(), None)
                    continue
                for t in chunk:
                    entry = payload.get(t)
                    if isinstance(entry, dict) and entry.get("status") != "error":
                        _quote_cache[t] = (_now(), entry)
                        results[t] = entry
                    else:
                        _quote_cache[t] = (_now(), None)
        except httpx.HTTPError:
            for t in chunk:
                _quote_cache[t] = (_now(), None)
    return results


async def _fetch_twelvedata_statistics(ticker: str) -> dict | None:
    """Fetch market cap, P/E, EPS, shares from Twelve Data /statistics.

    This endpoint is sometimes gated by plan tier; we gracefully return None
    on any error so the caller can just show "—" in those cells.
    """
    api_key = os.getenv("TWELVE_DATA_API_KEY")
    if not api_key:
        return None
    try:
        async with _TD_SEMAPHORE:
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


@app.get("/api/screener")
async def get_screener(tickers: str = "") -> dict:
    """Batched row data for the Screener page.

    Collapses the old "fire 98 getCompany() calls from the browser" pattern
    into a single backend call. That pattern would burn 98 Twelve Data
    credits inside a minute on the free tier (8 credits/min) and leave 90+
    tickers negative-cached with no fundamentals.

    Strategy:
      1. Reuse fresh entries in _quote_cache where available.
      2. Single batched Twelve Data /quote for everything else (comma-
         separated symbols, one HTTP round trip).
      3. Per-ticker EDGAR fundamentals (already throttled via _SEC_SEMAPHORE
         in edgar.py).
      4. Compute market_cap = shares × price, pe = price / eps.
      5. Cache the assembled rows for 5 min so fast re-visits are free.
    """
    tickers_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not tickers_list:
        return {"count": 0, "rows": []}

    # Response-level cache keyed by the requested ticker set.
    cache_key = ",".join(sorted(tickers_list))
    cached = _screener_cache.get(cache_key)
    if cached and (_now() - cached[0]) < _SCREENER_TTL_SECONDS:
        return {"count": len(cached[1]), "rows": cached[1], "cached": True}

    # Decide who actually needs a fresh quote pull.
    # Twelve Data free tier (8 credits/min) can't serve a 98-ticker screener
    # fan-out — batched or not — so the primary source here is yfinance via
    # one bulk download. Same pattern, same Render-proven library that
    # backs /api/company/{ticker}/prices.
    to_fetch: list[str] = []
    for t in tickers_list:
        if t in SEED_COMPANIES:
            continue  # seeded rows already have fundamentals baked in
        cached_quote = _quote_cache.get(t)
        if cached_quote and _cache_fresh(
            cached_quote[0], cached_quote[1], _QUOTE_TTL_SECONDS
        ):
            continue
        to_fetch.append(t)

    if to_fetch:
        # Yahoo gets grumpy at 90+ tickers in one call (anti-scraping), so we
        # chunk and run the chunks concurrently in threads. Each chunk is one
        # curl_cffi-backed yf.download call.
        CHUNK = 15
        chunks = [to_fetch[i : i + CHUNK] for i in range(0, len(to_fetch), CHUNK)]
        chunk_results = await asyncio.gather(
            *[
                asyncio.to_thread(_fetch_yfinance_bulk_sync, chunk, "1y")
                for chunk in chunks
            ],
            return_exceptions=True,
        )
        derived: dict[str, dict] = {}
        for result in chunk_results:
            if isinstance(result, dict):
                derived.update(result)

        for t in to_fetch:
            quote = derived.get(t)
            if quote is not None:
                # Cache successful quote for the full 10 min TTL.
                _quote_cache[t] = (_now(), quote)
            # On miss we deliberately do NOT populate a negative cache entry:
            # other code paths (single-ticker /quote) should be free to retry
            # via their own fallback chain rather than inherit a miss from
            # the bulk screener load.

    async def build_row(ticker: str) -> dict | None:
        seed = SEED_COMPANIES.get(ticker)
        if seed is not None:
            return {
                "ticker": ticker,
                "name": seed.get("name"),
                "market_cap_usd": seed.get("market_cap_usd"),
                "runway_months": seed.get("runway_months"),
                "pe_ratio": seed.get("pe_ratio"),
                "health": seed.get("health"),
                "placeholder": seed.get("placeholder", False),
            }
        edgar_data = await get_edgar_company_data(ticker)
        quote_cached = _quote_cache.get(ticker)
        quote = quote_cached[1] if quote_cached else None
        price = (
            _to_float(quote.get("close"))
            if isinstance(quote, dict)
            else None
        )

        name = None
        if isinstance(edgar_data, dict):
            name = edgar_data.get("name")
        if not name and isinstance(quote, dict):
            name = quote.get("name")

        market_cap = None
        pe_ratio = None
        runway_months = None
        if isinstance(edgar_data, dict):
            shares = edgar_data.get("shares_outstanding")
            eps = edgar_data.get("eps_ttm")
            if shares and price is not None:
                try:
                    market_cap = float(price) * float(shares)
                except (TypeError, ValueError):
                    pass
            if eps and eps > 0 and price is not None:
                try:
                    pe_ratio = float(price) / float(eps)
                except (TypeError, ValueError, ZeroDivisionError):
                    pass
            runway_months = edgar_data.get("runway_months")
            if market_cap is None:
                market_cap = edgar_data.get("market_cap_usd")
            if pe_ratio is None:
                pe_ratio = edgar_data.get("pe_ratio")

        if (
            name is None
            and market_cap is None
            and runway_months is None
            and pe_ratio is None
        ):
            return None
        return {
            "ticker": ticker,
            "name": name,
            "market_cap_usd": market_cap,
            "runway_months": runway_months,
            "pe_ratio": pe_ratio,
            "health": None,
            "placeholder": False,
        }

    rows_raw = await asyncio.gather(
        *[build_row(t) for t in tickers_list], return_exceptions=True
    )
    rows: list[dict] = []
    for r in rows_raw:
        if isinstance(r, dict):
            rows.append(r)

    # Only cache if we got a reasonable density of data. Caching a partial
    # failure (say only the 5 seeds resolved) would stick the screener at
    # "only 5 companies" for the full 5-min window even after upstream
    # recovers. Threshold = 50% of requested tickers.
    if len(rows) >= max(1, len(tickers_list) // 2):
        _screener_cache[cache_key] = (_now(), rows)
    return {"count": len(rows), "rows": rows}


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

    # If Twelve Data missed (rate-limit / unconfigured), derive price from
    # yfinance so market-cap and P/E math still has a price to multiply by.
    if quote_basic is None:
        derived = await asyncio.to_thread(_fetch_yfinance_bulk_sync, [ticker], "1y")
        quote_basic = derived.get(ticker)
        if quote_basic is not None:
            _quote_cache[ticker] = (_now(), quote_basic)

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

    # Pass 1 — local healthcare directory.
    # Resolves common queries like "medtronic", "crispr", "intuitive" against
    # an in-process dict with zero network calls. This catches cases where
    # Twelve Data's symbol_search fails to surface the right ticker (either
    # because the query is a fuzzy name match it doesn't rank high, or
    # because the company is a medical-device / diagnostics name outside our
    # original biotech-heavy _POPULAR_HEALTHCARE set).
    local_hits = _local_healthcare_match(q, limit)
    if len(local_hits) >= limit:
        return {"query": q, "results": local_hits}

    # Pass 2 — Twelve Data symbol_search.
    # Overfetch modestly so the healthcare filter has enough to choose from
    # without exploding the per-keystroke fan-out. 20 is enough slack that
    # filter misses don't drop the result count while keeping classification
    # snappy.
    overfetch = max(int(limit * 2), limit + 4)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                "https://api.twelvedata.com/symbol_search",
                params={"symbol": q, "outputsize": min(overfetch, 20)},
            )
        if r.status_code != 200:
            # Twelve Data unreachable — fall back to whatever local hits we
            # found rather than returning an empty dropdown.
            return {
                "query": q,
                "results": local_hits,
                "error": f"twelvedata HTTP {r.status_code}",
            }
        data = r.json()
    except httpx.HTTPError as exc:
        return {"query": q, "results": local_hits, "error": str(exc)}

    raw = data.get("data", []) if isinstance(data, dict) else []
    # Seed the dedupe set with local-match symbols so Twelve Data can't
    # surface a duplicate entry.
    seen: set[str] = {hit["symbol"] for hit in local_hits}
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

    # Healthcare-sector filter — BioRadar only surfaces biotech / pharma /
    # life-science / medical-device / diagnostics / healthcare-services
    # tickers in search. Classify each candidate in parallel so the overall
    # request stays fast.
    ordered = primary + secondary
    if not ordered:
        return {"query": q, "results": local_hits}

    # Fast-path: tickers we already know are healthcare (seeded + the popular
    # biotech universe) skip the EDGAR classify. That collapses the common
    # case — users typing a familiar ticker — to a zero-network-hop filter.
    known_healthcare = set(SEED_COMPANIES.keys()) | _POPULAR_HEALTHCARE
    known_hits = [hit for hit in ordered if hit["symbol"] in known_healthcare]

    # If local_hits + known_hits from Twelve Data satisfy the limit, return
    # immediately and skip EDGAR entirely.
    if len(local_hits) + len(known_hits) >= limit:
        merged = local_hits + known_hits
        return {"query": q, "results": merged[:limit]}

    # Otherwise classify the unknowns, but only as many as we still need to
    # fill the limit — classifying extras just burns latency we won't surface.
    unknowns = [hit for hit in ordered if hit["symbol"] not in known_healthcare]
    needed = limit - len(local_hits) - len(known_hits)
    to_classify = unknowns[: max(needed * 2, needed + 2)]

    checks = await asyncio.gather(
        *[
            is_healthcare_ticker(
                hit["symbol"],
                seed_tickers=set(SEED_COMPANIES.keys()),
                edgar_lookup=get_edgar_company_data,
            )
            for hit in to_classify
        ],
        return_exceptions=True,
    )
    classify_map = {
        hit["symbol"]: (ok is True)
        for hit, ok in zip(to_classify, checks)
    }
    td_filtered = [
        hit
        for hit in ordered
        if hit["symbol"] in known_healthcare or classify_map.get(hit["symbol"], False)
    ]
    merged = local_hits + td_filtered
    return {"query": q, "results": merged[:limit]}


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

    drugs = _aggregate_trials_by_drug(trials)

    return {
        "ticker": ticker,
        "sponsor": sponsor,
        "count": len(trials),
        "drug_count": len(drugs),
        "drugs": drugs,
        # Keep raw trials for the chart's derived-events overlay.
        "trials": trials,
    }


# Priority used for the rollup status pill: if *any* trial in a group is in a
# given state, surface that state (preferring more-active states). Answers
# "where is this drug now?" rather than "what did the last trial do?" — so a
# program with one Terminated Ph3 and four active lower-phase trials still
# reads as Recruiting, with the stopped trial visible in the expand panel.
_STATUS_PRIORITY: tuple[str, ...] = (
    "RECRUITING",
    "ACTIVE_NOT_RECRUITING",
    "NOT_YET_RECRUITING",
    "COMPLETED",
    "TERMINATED",
    "SUSPENDED",
    "WITHDRAWN",
)
_STATUS_LABEL: dict[str, str] = {
    "RECRUITING": "Recruiting",
    "ACTIVE_NOT_RECRUITING": "Active, not recruiting",
    "NOT_YET_RECRUITING": "Not yet recruiting",
    "COMPLETED": "Completed",
    "TERMINATED": "Terminated",
    "SUSPENDED": "Suspended",
    "WITHDRAWN": "Withdrawn",
}


def _status_bucket(raw: str | None) -> str:
    """Map a ClinicalTrials.gov status onto a coarse UI bucket used by the
    stacked bar (active / planned / done / stopped / other)."""
    if raw in ("RECRUITING", "ACTIVE_NOT_RECRUITING"):
        return "active"
    if raw == "NOT_YET_RECRUITING":
        return "planned"
    if raw == "COMPLETED":
        return "completed"
    if raw in ("TERMINATED", "SUSPENDED", "WITHDRAWN"):
        return "stopped"
    return "other"


def _aggregate_trials_by_drug(trials: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Collapse multiple trials of the same drug into a single pipeline row.

    Grouping key: lowercased+stripped drug name (so "CTX-001" and "ctx-001"
    merge, but "CTX-001" and "CTX-001 (KT-001)" stay separate — safer than
    over-normalizing).

    Trials with no drug listed are kept as their own row, keyed by nct_id so
    they don't all collapse into a single "Unnamed" bucket.

    For each group we surface:
      - drug:               canonical display name (shortest non-empty variant)
      - highest_phase:      the furthest-advanced phase any trial has reached
      - highest_phase_rank: numeric rank for sorting/coloring
      - indications:        deduped list of all indications across trials
      - trial_count:        how many trials in the group
      - latest_status:      activity-priority rollup — "what is this drug
                            doing right now", NOT "what did the last trial do"
      - status_counts:      {active,planned,completed,stopped,other} — used
                            by the frontend to render the expand-panel bar
      - nct_ids / trials:   drill-down data for the row's expand panel
    """
    groups: dict[str, list[dict[str, Any]]] = {}
    order: list[str] = []

    for t in trials:
        drug = (t.get("drug") or "").strip()
        if drug:
            key = drug.lower()
        else:
            # Unnamed drug — give it a unique key so it stays its own row.
            key = f"__nct__:{t.get('nct_id') or id(t)}"
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(t)

    aggregated: list[dict[str, Any]] = []
    for key in order:
        group = groups[key]

        # Display name — pick the shortest non-empty name (usually the
        # cleanest "BEAM-101" over "BEAM-101 (CTX-001 analog)").
        names = [t.get("drug") for t in group if t.get("drug")]
        display = min(names, key=len) if names else None

        # Highest phase across the group.
        top = max(group, key=lambda t: t.get("phase_rank", 0))

        # Activity-priority status rollup. Walk the priority list and return
        # the first status any trial in the group currently has.
        raws_in_group = {t.get("status_raw") for t in group if t.get("status_raw")}
        status_raw: str | None = None
        for candidate in _STATUS_PRIORITY:
            if candidate in raws_in_group:
                status_raw = candidate
                break
        if status_raw is None:
            # Fallback — whatever the most-advanced trial reports.
            status_raw = top.get("status_raw")
        status_label = _STATUS_LABEL.get(status_raw or "", top.get("status") or "Unknown")

        # Bucketed counts for the stacked bar in the drilldown panel.
        status_counts = {
            "active": 0,
            "planned": 0,
            "completed": 0,
            "stopped": 0,
            "other": 0,
        }
        for t in group:
            status_counts[_status_bucket(t.get("status_raw"))] += 1

        # Dedupe indications, preserving first-seen order.
        seen_ind: set[str] = set()
        indications: list[str] = []
        for t in group:
            for c in t.get("conditions") or []:
                if c and c not in seen_ind:
                    seen_ind.add(c)
                    indications.append(c)

        # Next meaningful completion date. We want the investor-facing answer
        # to "when's the next catalyst for this drug?" — so:
        #   1. If any trial has an upcoming primary completion, pick the
        #      soonest one (the next real readout window).
        #   2. Otherwise (all trials are done) fall back to the MOST RECENT
        #      past completion so the row surfaces the latest readout rather
        #      than the oldest one.
        today_iso = date.today().isoformat()
        dates = [
            t.get("primary_completion_date")
            for t in group
            if t.get("primary_completion_date")
        ]
        future_dates = [d for d in dates if d >= today_iso]
        if future_dates:
            next_completion = min(future_dates)
        elif dates:
            next_completion = max(dates)
        else:
            next_completion = None

        aggregated.append(
            {
                "drug": display,
                "highest_phase": top.get("phase", "N/A"),
                "highest_phase_rank": top.get("phase_rank", 0),
                "indications": indications,
                "indication": indications[0] if indications else None,
                "trial_count": len(group),
                "latest_status": status_label,
                "latest_status_raw": status_raw,
                "status_counts": status_counts,
                "next_completion_date": next_completion,
                "nct_ids": [t.get("nct_id") for t in group if t.get("nct_id")],
                "trials": [
                    {
                        "nct_id": t.get("nct_id"),
                        "title": t.get("title"),
                        "phase": t.get("phase"),
                        "phase_rank": t.get("phase_rank"),
                        "status": t.get("status"),
                        "status_raw": t.get("status_raw"),
                        "indication": t.get("indication"),
                        "primary_completion_date": t.get("primary_completion_date"),
                        "url": t.get("url"),
                    }
                    for t in group
                ],
            }
        )

    aggregated.sort(
        key=lambda d: (
            -d["highest_phase_rank"],
            d.get("next_completion_date") or "9999-99-99",
        )
    )
    return aggregated


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


def _derive_quote_from_points(points: list[dict]) -> dict | None:
    """Build a quote-shape dict (price, 52w high/low, avg volume) from a
    list of daily OHLCV points. Returns None if the list is empty.

    Used as a Twelve Data-free fallback so /api/company/{ticker}/quote
    still yields 52w range + avg volume even when Twelve Data's 8-credit/min
    free-tier ceiling rate-limits us.
    """
    if not points:
        return None
    closes = [p["close"] for p in points if p.get("close") is not None]
    if not closes:
        return None
    volumes = [p["volume"] for p in points if p.get("volume")]
    last = float(closes[-1])
    prev = float(closes[-2]) if len(closes) >= 2 else last
    hi = max(float(c) for c in closes)
    lo = min(float(c) for c in closes)
    avg_vol = int(sum(volumes) / len(volumes)) if volumes else None
    return {
        "close": last,
        "previous_close": prev,
        "change": last - prev,
        "percent_change": ((last - prev) / prev * 100) if prev else None,
        "volume": volumes[-1] if volumes else None,
        "average_volume": avg_vol,
        "fifty_two_week": {"high": hi, "low": lo, "range": f"{lo:.2f} - {hi:.2f}"},
        "datetime": points[-1].get("date"),
    }


def _fetch_yfinance_bulk_sync(
    tickers: list[str], period: str = "1y"
) -> dict[str, dict]:
    """One yf.download call for all tickers. Returns map of ticker -> quote
    dict derived via _derive_quote_from_points.

    yfinance batches efficiently when you pass space-separated tickers and
    group_by='ticker'. 98 tickers × 1y history is one Yahoo call (with the
    curl_cffi session to dodge their scraping filter), which is how the
    existing /prices endpoint already runs reliably on Render.
    """
    try:
        import yfinance as yf  # type: ignore
    except ImportError:
        return {}
    if not tickers:
        return {}

    session = _yf_session()
    kwargs: dict[str, Any] = {
        "tickers": " ".join(tickers),
        "period": period,
        "auto_adjust": True,
        "progress": False,
        "threads": True,
        "group_by": "ticker",
    }
    if session is not None:
        kwargs["session"] = session

    try:
        df = yf.download(**kwargs)
    except Exception:  # noqa: BLE001
        return {}

    if df is None or getattr(df, "empty", True):
        return {}

    out: dict[str, dict] = {}
    multi = hasattr(df.columns, "nlevels") and df.columns.nlevels > 1

    for t in tickers:
        try:
            if multi:
                if t not in df.columns.get_level_values(0):
                    continue
                sub = df[t]
            else:
                sub = df
            if sub is None or getattr(sub, "empty", True):
                continue
            if "Close" not in sub.columns:
                continue
            # Build point list from the sub-frame, then reuse _derive_quote_from_points.
            points: list[dict] = []
            for idx, row in sub.iterrows():
                close_val = row.get("Close")
                if close_val is None or close_val != close_val:
                    continue
                try:
                    close_f = float(close_val)
                except (TypeError, ValueError):
                    continue
                vol_val = row.get("Volume")
                try:
                    vol_i = (
                        int(vol_val)
                        if vol_val is not None and vol_val == vol_val
                        else 0
                    )
                except (TypeError, ValueError):
                    vol_i = 0
                points.append(
                    {
                        "date": idx.strftime("%Y-%m-%d"),
                        "close": close_f,
                        "volume": vol_i,
                    }
                )
            derived = _derive_quote_from_points(points)
            if derived is not None:
                out[t] = derived
        except Exception:  # noqa: BLE001
            continue
    return out


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

    Routes through the shared _quote_cache so we don't burn a second Twelve
    Data credit when the company page also calls get_company (which needs
    /quote for market-cap math). That pattern would otherwise double our
    API spend per page and cause the 8-credits/min free tier to rate-limit
    52-week range + avg-volume for every concurrent visitor.
    """
    ticker = ticker.upper().strip()

    # Primary: Twelve Data /quote (if configured). Gives us name, exchange,
    # intraday open/high/low, and pre-computed 52w + avg volume.
    data = None
    if os.getenv("TWELVE_DATA_API_KEY"):
        data = await _fetch_twelvedata_quote_basic(ticker)

    # Fallback: derive price + 52w range + avg volume from a year of yfinance
    # OHLCV. Works when Twelve Data is rate-limited (free-tier 8/min ceiling),
    # unconfigured, or transiently unreachable. yfinance backs /prices on
    # Render so we know it's reliable there.
    if data is None:
        derived = await asyncio.to_thread(_fetch_yfinance_bulk_sync, [ticker], "1y")
        data = derived.get(ticker)
        if data is not None:
            _quote_cache[ticker] = (_now(), data)

    if data is None:
        return {
            "ticker": ticker,
            "error": "quote data unavailable from Twelve Data and yfinance",
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

# Words we strip before hashing a title for dedup — they add no signal.
_DEDUP_STOPWORDS = {
    "the", "and", "for", "with", "from", "trial", "trials", "phase",
    "readout", "data", "study", "results", "interim", "topline",
}


def _title_tokens(title: str) -> set[str]:
    """Significant 4+ char lowercase words from a title — used for fuzzy
    dedup between hand-curated and derived catalyst events.
    """
    words = re.findall(r"\b[\w\-]{4,}\b", title.lower())
    return {w for w in words if w not in _DEDUP_STOPWORDS}


def _dates_within(d1: str, d2: str, days: int) -> bool:
    """True if two ISO-date strings are within `days` of each other."""
    try:
        a = datetime.strptime(d1, "%Y-%m-%d").date()
        b = datetime.strptime(d2, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return False
    return abs((a - b).days) <= days


async def _derive_catalysts_from_pipeline(ticker: str) -> list[dict]:
    """Derive catalyst events from the company's ClinicalTrials.gov pipeline.

    For each drug aggregate we emit at most one event, chosen by trial state:
      - If all trials are stopped       → "failure" event at the most recent date
      - Else if next_completion is future → upcoming "readout" event
      - Else (all trials are in the past) → past "readout" (low impact)

    Impact is driven by the drug's highest phase — Ph3+ events are "high",
    Ph2 is "medium", earlier is "low". The summary line embeds the indication
    and active-trial count so the calendar row is self-explanatory.
    """
    try:
        pipeline = await get_pipeline(ticker)
    except Exception as exc:  # noqa: BLE001 — defensive: never let calendar 500
        print(f"[bioradar] catalyst derivation: pipeline fetch failed for {ticker}: {exc}")
        return []

    drugs = (pipeline or {}).get("drugs") or []
    if not drugs:
        return []

    today_iso = date.today().isoformat()
    events: list[dict] = []

    for d in drugs:
        next_date = d.get("next_completion_date")
        if not next_date:
            continue

        drug_name = d.get("drug") or "Unnamed asset"
        phase = d.get("highest_phase") or "N/A"
        phase_rank = int(d.get("highest_phase_rank") or 0)
        indication = d.get("indication")
        counts = d.get("status_counts") or {}
        trial_count = int(d.get("trial_count") or 0)

        impact = "high" if phase_rank >= 4 else "medium" if phase_rank >= 3 else "low"

        active = int(counts.get("active") or 0)
        completed = int(counts.get("completed") or 0)
        stopped = int(counts.get("stopped") or 0)
        planned = int(counts.get("planned") or 0)

        # Only call the program "all stopped" if nothing else is live or done —
        # a planned (NOT_YET_RECRUITING) trial means the drug is still in play.
        all_stopped = (
            stopped > 0 and active == 0 and completed == 0 and planned == 0
        )
        is_future = next_date >= today_iso

        # Build a concise summary line — always include the phase + trial
        # count so the click-to-expand is never just a blank "ClinicalTrials.gov".
        summary_bits: list[str] = []
        if indication:
            summary_bits.append(indication)
        summary_bits.append(f"{phase} program")
        if is_future and active:
            summary_bits.append(f"{active} active trial{'s' if active != 1 else ''}")
        else:
            summary_bits.append(f"{trial_count} trial{'s' if trial_count != 1 else ''}")
        summary_bits.append("ClinicalTrials.gov")

        if all_stopped:
            stop_summary = (
                f"{indication + ' · ' if indication else ''}"
                f"All {trial_count} {phase} trial{'s' if trial_count != 1 else ''} "
                f"terminated, suspended, or withdrawn · ClinicalTrials.gov"
            )
            events.append({
                "date": next_date,
                "title": f"{drug_name} — {phase} trials stopped",
                "type": "failure",
                "impact": "medium",
                "summary": stop_summary,
                "source": "ctgov-derived",
            })
        elif is_future:
            events.append({
                "date": next_date,
                "title": f"{drug_name} — {phase} readout window",
                "type": "readout",
                "impact": impact,
                "summary": " · ".join(summary_bits),
                "source": "ctgov-derived",
            })
        else:
            # Past readout — surface but at low impact; the investor-relevant
            # question is usually "what did we learn?" not "what's coming?"
            events.append({
                "date": next_date,
                "title": f"{drug_name} — {phase} readout complete",
                "type": "readout",
                "impact": "low",
                "summary": " · ".join(summary_bits),
                "source": "ctgov-derived",
            })

    return events


def _merge_catalysts(seed: list[dict], derived: list[dict]) -> list[dict]:
    """Merge hand-curated (seed) and derived events, preferring seed on
    conflict. Two events are considered a conflict if they're within 31 days
    AND their title tokens share at least one significant word (typically the
    drug name).
    """
    seed_signatures = [
        {"date": s.get("date"), "tokens": _title_tokens(s.get("title") or "")}
        for s in seed
        if s.get("date")
    ]

    merged: list[dict] = list(seed)
    for d in derived:
        d_date = d.get("date")
        d_tokens = _title_tokens(d.get("title") or "")
        if not d_date:
            continue
        is_dup = False
        for sig in seed_signatures:
            if not sig["tokens"] or not d_tokens:
                continue
            if _dates_within(sig["date"], d_date, 31) and (sig["tokens"] & d_tokens):
                is_dup = True
                break
        if not is_dup:
            merged.append(d)
    return merged


@app.get("/api/company/{ticker}/catalysts")
async def get_catalysts(ticker: str) -> dict:
    ticker = ticker.upper().strip()
    seed = SEED_CATALYSTS.get(ticker, [])
    # Tag seed events with a source so clients can surface provenance.
    seed = [{**e, "source": e.get("source", "curated")} for e in seed]

    # Look up the company name so the Finnhub layer can distinguish stories
    # about this company from sector/ETF coverage that merely mentions the
    # ticker. For seeded tickers we have it directly; for others we fall
    # through to ticker-only matching (EDGAR could fill it in too, but
    # that's an extra lookup — not worth the cost here).
    company_name: str | None = None
    seed_company = SEED_COMPANIES.get(ticker)
    if seed_company:
        company_name = seed_company.get("name")

    # Fetch all three machine-derived layers in parallel. Every layer is
    # best-effort; a failure in any one can't 500 the calendar.
    edgar_task = asyncio.create_task(_safe_edgar_catalysts(ticker))
    ctgov_task = asyncio.create_task(_derive_catalysts_from_pipeline(ticker))
    news_task = asyncio.create_task(_safe_finnhub_catalysts(ticker, company_name))
    edgar_events, ctgov_events, news_events = await asyncio.gather(
        edgar_task, ctgov_task, news_task
    )

    # Priority order: seed > edgar-8k > ctgov-derived > news. Each later
    # layer only contributes events that don't collide with any higher-
    # priority entry. News is lowest-priority because headlines are the
    # noisiest signal — SEC filings and trial registry data beat press.
    merged = _merge_catalysts(seed, edgar_events)
    merged = _merge_catalysts(merged, ctgov_events)
    merged = _merge_catalysts(merged, news_events)

    today = datetime.utcnow().date()
    enriched = []
    for e in merged:
        try:
            d = datetime.strptime(e["date"], "%Y-%m-%d").date()
        except (ValueError, TypeError, KeyError):
            continue
        enriched.append({**e, "past": d < today})

    enriched.sort(key=lambda e: e["date"])

    return {
        "ticker": ticker,
        "count": len(enriched),
        "events": enriched,
    }


async def _safe_edgar_catalysts(ticker: str) -> list[dict]:
    """Wrapper so an EDGAR outage doesn't break the whole catalyst endpoint."""
    try:
        return await get_edgar_catalysts(ticker)
    except Exception as exc:  # noqa: BLE001
        print(f"[bioradar] edgar catalyst fetch failed for {ticker}: {exc}")
        return []


async def _safe_finnhub_catalysts(
    ticker: str, company_name: str | None = None
) -> list[dict]:
    """Wrapper so a Finnhub outage / rate-limit doesn't break the calendar."""
    try:
        return await get_finnhub_catalysts(ticker, company_name=company_name)
    except Exception as exc:  # noqa: BLE001
        print(f"[bioradar] finnhub catalyst fetch failed for {ticker}: {exc}")
        return []


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
