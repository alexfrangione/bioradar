"""
Healthcare-sector filter.

BioRadar only shows biotech / pharma / life-science / medical-device /
diagnostics / healthcare-services tickers in search + autocomplete. Everything
else (Netflix, Apple, Tesla, ...) gets hidden from `/api/search`.

Classification strategy, in order:
  1. SEED_COMPANIES allowlist (always healthcare).
  2. SEC EDGAR submissions  -> authoritative SIC code (numeric) + description.
  3. Twelve Data /profile   -> sector + industry strings (fallback when EDGAR
                               has no mapping, e.g. foreign ADRs).
  4. Unknown                -> NOT healthcare (fail closed so Netflix stays
                               hidden even if we can't reach data sources).

Results are cached in-process for 24h so repeat searches are fast.
"""

from __future__ import annotations

import os
from time import time as _now
from typing import Any

import httpx

# ---------------------------------------------------------------------------
# SIC code ranges — authoritative healthcare universe
# ---------------------------------------------------------------------------
# Standard Industrial Classification codes published by the SEC. We cover
# every code that could plausibly house a biotech / pharma / life-science /
# medical-device / diagnostics / healthcare-services company.
#
# Ranges are *inclusive*. A ticker matches if its SIC is in any range below.
_HEALTHCARE_SIC_RANGES: tuple[tuple[int, int], ...] = (
    # Pharmaceutical preparations / in-vitro diagnostics / biologicals
    (2833, 2836),
    # Perfumes, cosmetics & other toilet prep — excluded (2840-2844)

    # Medical instruments & supplies
    #   3826 = Laboratory analytical instruments
    #   3841 = Surgical & medical instruments
    #   3842 = Orthopedic, prosthetic & surgical appliances
    #   3843 = Dental equipment & supplies
    #   3844 = X-ray apparatus
    #   3845 = Electromedical & electrotherapeutic apparatus
    #   3851 = Ophthalmic goods
    (3826, 3826),
    (3841, 3845),
    (3851, 3851),

    # Medical/hospital equipment wholesale
    (5047, 5047),
    # Drugs wholesale
    (5122, 5122),
    # Retail drug stores
    (5912, 5912),

    # Hospital & medical service plans (health insurers incl. UNH, CI, HUM)
    (6324, 6324),

    # Health services — hospitals, nursing care, clinics, labs, home health
    #   8000 = Health services (generic)
    #   8011 = Offices & clinics of doctors of medicine
    #   8050 = Nursing & personal care facilities
    #   8060 = Hospitals
    #   8062 = General medical & surgical hospitals
    #   8071 = Medical laboratories
    #   8082 = Home health care services
    #   8090 = Services-health services (misc.)
    #   8093 = Specialty outpatient facilities
    (8000, 8099),

    # Commercial physical & biological research (covers contract research orgs,
    # genomics shops, preclinical service providers — e.g. CRL, ICLR, IQV)
    (8731, 8731),
)

# ---------------------------------------------------------------------------
# String matchers — fallback when we don't have an SIC code
# ---------------------------------------------------------------------------
# Twelve Data returns `sector` ("Healthcare", "Technology", ...) and
# `industry` ("Biotechnology", "Pharmaceuticals", ...). SEC sometimes returns
# only a description. We match case-insensitively.

_HEALTHCARE_SECTOR_KEYWORDS: tuple[str, ...] = (
    "health",           # "Healthcare", "Health Care"
    "pharma",           # "Pharmaceuticals"
    "biotech",          # "Biotechnology"
    "life science",     # "Life Sciences"
    "medical",
)

_HEALTHCARE_INDUSTRY_KEYWORDS: tuple[str, ...] = (
    "biotech",
    "pharma",
    "drug",             # "Drug Manufacturers"
    "medical",          # "Medical Devices", "Medical Instruments"
    "health",           # "Health Information Services", "Healthcare Plans"
    "life scienc",      # "Life Sciences Tools & Services"
    "diagnostic",       # "Diagnostics & Research"
    "hospital",
    "clinical",
    "therapeut",        # "Therapeutics"
    "genom",            # "Genomics"
    "dental",
    "surgical",
    "biolog",           # "Biological products"
    "vaccine",
    "nursing",
)


def _sic_is_healthcare(sic: str | int | None) -> bool:
    if sic is None or sic == "":
        return False
    try:
        code = int(str(sic).strip())
    except (TypeError, ValueError):
        return False
    return any(low <= code <= high for (low, high) in _HEALTHCARE_SIC_RANGES)


def _text_is_healthcare(
    sector: str | None = None,
    industry: str | None = None,
    sic_desc: str | None = None,
) -> bool:
    """True if any of the free-text fields look healthcare-ish."""
    sector_l = (sector or "").lower()
    industry_l = (industry or "").lower()
    desc_l = (sic_desc or "").lower()

    if any(k in sector_l for k in _HEALTHCARE_SECTOR_KEYWORDS):
        return True
    if any(k in industry_l for k in _HEALTHCARE_INDUSTRY_KEYWORDS):
        return True
    # SIC description is essentially an industry string too
    if any(k in desc_l for k in _HEALTHCARE_INDUSTRY_KEYWORDS):
        return True
    return False


def classify(
    sic: str | int | None = None,
    sic_desc: str | None = None,
    sector: str | None = None,
    industry: str | None = None,
) -> bool:
    """
    Return True iff the supplied metadata classifies the ticker as a
    healthcare / life-science company.

    This is a pure function with no I/O so it's easy to unit-test.
    """
    if _sic_is_healthcare(sic):
        return True
    return _text_is_healthcare(
        sector=sector, industry=industry, sic_desc=sic_desc
    )


# ---------------------------------------------------------------------------
# Caching wrapper around real data sources
# ---------------------------------------------------------------------------
_CACHE_TTL = 24 * 3600  # 24h — sector membership is ~static
_classification_cache: dict[str, tuple[float, bool]] = {}


def _cached(ticker: str) -> bool | None:
    hit = _classification_cache.get(ticker)
    if hit and (_now() - hit[0]) < _CACHE_TTL:
        return hit[1]
    return None


def _store(ticker: str, value: bool) -> bool:
    _classification_cache[ticker] = (_now(), value)
    return value


async def _fetch_twelvedata_sector(ticker: str) -> dict[str, Any] | None:
    """Fetch sector/industry strings from Twelve Data /profile."""
    key = os.getenv("TWELVE_DATA_API_KEY")
    if not key:
        return None
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(
                "https://api.twelvedata.com/profile",
                params={"symbol": ticker, "apikey": key},
            )
        if r.status_code != 200:
            return None
        data = r.json()
        if not isinstance(data, dict):
            return None
        # Error payload: {"code": 400, "status": "error", ...}
        if data.get("status") == "error":
            return None
        return data
    except httpx.HTTPError:
        return None


async def is_healthcare_ticker(
    ticker: str,
    *,
    seed_tickers: set[str] | None = None,
    edgar_lookup=None,
) -> bool:
    """
    Async classifier. Returns True iff `ticker` is in the BioRadar healthcare
    universe (biotech, pharma, medical devices, diagnostics, life sciences,
    healthcare services).

    Parameters
    ----------
    ticker : str
        Uppercase ticker symbol.
    seed_tickers : set[str] | None
        Tickers that should ALWAYS be treated as healthcare (SEED_COMPANIES).
    edgar_lookup : async callable(ticker) -> dict | None
        Injected dependency -> returns {"industry": sicDesc, "sector": ...}.
        Main wires this to `get_edgar_company_data` to reuse its TTL cache.
    """
    ticker = (ticker or "").upper().strip()
    if not ticker:
        return False

    # 1. Seed companies are always included.
    if seed_tickers and ticker in seed_tickers:
        return _store(ticker, True)

    # 2. In-process cache.
    cached = _cached(ticker)
    if cached is not None:
        return cached

    # 3. SEC EDGAR — authoritative SIC code + description.
    if edgar_lookup is not None:
        try:
            edgar_data = await edgar_lookup(ticker)
        except Exception:
            edgar_data = None
        if isinstance(edgar_data, dict):
            # edgar.get_edgar_company_data returns `industry` = sicDescription
            # and `sector` = coarse bucket. Both are useful.
            if _text_is_healthcare(
                sector=edgar_data.get("sector"),
                industry=edgar_data.get("industry"),
            ):
                return _store(ticker, True)

    # 4. Twelve Data profile — fallback for tickers not in SEC or where
    #    EDGAR returned no sector (foreign ADRs, newly listed, etc.).
    profile = await _fetch_twelvedata_sector(ticker)
    if isinstance(profile, dict):
        if _text_is_healthcare(
            sector=profile.get("sector"),
            industry=profile.get("industry"),
        ):
            return _store(ticker, True)

    # 5. Fail closed — if we can't classify, hide it.
    return _store(ticker, False)
