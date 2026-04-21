"""
SEC EDGAR integration for BioRadar — pulls live fundamentals from the
free companyfacts and submissions APIs.

Data sources:
  • https://www.sec.gov/files/company_tickers.json   (ticker → CIK map)
  • https://data.sec.gov/submissions/CIK{10-digit}.json   (name, addresses, SIC)
  • https://data.sec.gov/api/xbrl/companyfacts/CIK{10-digit}.json  (XBRL facts)

SEC's fair-access policy requires a descriptive User-Agent with a contact
email. Set SEC_USER_AGENT in the backend/.env file; otherwise we fall back
to a generic UA.

All fetches are cached in-process for 12h. The ticker→CIK map is lazy-loaded
once and kept for the lifetime of the process.
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime
from time import time as _now
from typing import Any

import httpx

# ---------------------------------------------------------------------------
# Config + caches
# ---------------------------------------------------------------------------
_CACHE_TTL = 12 * 3600  # 12 hours

# ticker (upper) → 10-digit CIK
_ticker_to_cik: dict[str, str] = {}
_ticker_map_loaded_at: float = 0.0

# CIK → (timestamp, companyfacts JSON)
_facts_cache: dict[str, tuple[float, dict | None]] = {}
# CIK → (timestamp, submissions JSON)
_subs_cache: dict[str, tuple[float, dict | None]] = {}


def _user_agent() -> str:
    return os.getenv(
        "SEC_USER_AGENT",
        "BioRadar research bioradar@example.com",
    )


def _headers() -> dict[str, str]:
    # SEC requires a descriptive UA. Accept-Encoding helps throughput.
    return {
        "User-Agent": _user_agent(),
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
    }


# ---------------------------------------------------------------------------
# Raw fetches
# ---------------------------------------------------------------------------
async def _load_ticker_map() -> dict[str, str]:
    """Load the SEC ticker→CIK mapping once, cache for process lifetime."""
    global _ticker_to_cik, _ticker_map_loaded_at
    # Reload every 7 days in case new tickers are added
    if _ticker_to_cik and (_now() - _ticker_map_loaded_at) < 7 * 24 * 3600:
        return _ticker_to_cik

    url = "https://www.sec.gov/files/company_tickers.json"
    try:
        async with httpx.AsyncClient(timeout=20.0, headers=_headers()) as c:
            r = await c.get(url)
        if r.status_code != 200:
            return _ticker_to_cik or {}
        data = r.json()
    except httpx.HTTPError:
        return _ticker_to_cik or {}

    mapping: dict[str, str] = {}
    for entry in (data or {}).values():
        t = str(entry.get("ticker", "")).upper().strip()
        cik_num = entry.get("cik_str")
        if t and cik_num is not None:
            mapping[t] = str(cik_num).zfill(10)
    if mapping:
        _ticker_to_cik = mapping
        _ticker_map_loaded_at = _now()
    return _ticker_to_cik


async def _fetch_companyfacts(cik: str) -> dict | None:
    cached = _facts_cache.get(cik)
    if cached and (_now() - cached[0]) < _CACHE_TTL:
        return cached[1]
    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
    try:
        async with httpx.AsyncClient(timeout=20.0, headers=_headers()) as c:
            r = await c.get(url)
        if r.status_code != 200:
            _facts_cache[cik] = (_now(), None)
            return None
        data = r.json()
        _facts_cache[cik] = (_now(), data)
        return data
    except httpx.HTTPError:
        return None


async def _fetch_submissions(cik: str) -> dict | None:
    cached = _subs_cache.get(cik)
    if cached and (_now() - cached[0]) < _CACHE_TTL:
        return cached[1]
    url = f"https://data.sec.gov/submissions/CIK{cik}.json"
    try:
        async with httpx.AsyncClient(timeout=20.0, headers=_headers()) as c:
            r = await c.get(url)
        if r.status_code != 200:
            _subs_cache[cik] = (_now(), None)
            return None
        data = r.json()
        _subs_cache[cik] = (_now(), data)
        return data
    except httpx.HTTPError:
        return None


# ---------------------------------------------------------------------------
# XBRL fact extraction helpers
# ---------------------------------------------------------------------------
def _units(facts: dict, concept: str, unit: str = "USD") -> list[dict]:
    """Return the list of datapoints for a given us-gaap concept + unit."""
    return (
        facts.get("us-gaap", {})
        .get(concept, {})
        .get("units", {})
        .get(unit, [])
        or []
    )


def _instant_latest(facts: dict, concept: str, unit: str = "USD") -> float | None:
    """Latest value for a balance-sheet (instant) concept."""
    units = _units(facts, concept, unit)
    if not units:
        return None
    latest = max(units, key=lambda u: u.get("end", ""))
    return latest.get("val")


def _annual_latest(facts: dict, concept: str, unit: str = "USD") -> float | None:
    """Latest annual (FY) value — proxy for TTM on income statement items."""
    units = _units(facts, concept, unit)
    if not units:
        return None
    # Prefer 10-K / FY entries
    annual = [u for u in units if u.get("fp") == "FY"]
    pool = annual if annual else units
    latest = max(pool, key=lambda u: u.get("end", ""))
    return latest.get("val")


def _latest_quarterly_val(facts: dict, concept: str, unit: str = "USD") -> float | None:
    """
    Latest single-quarter (≈3-month) value for a duration concept.

    Many filings report both quarterly AND year-to-date values under the same
    concept; we filter to entries whose `start`→`end` span is roughly 80–100 days.
    """
    units = _units(facts, concept, unit)
    quarterly: list[dict] = []
    for u in units:
        start = u.get("start")
        end = u.get("end")
        if not start or not end:
            continue
        try:
            s = datetime.strptime(start, "%Y-%m-%d")
            e = datetime.strptime(end, "%Y-%m-%d")
        except ValueError:
            continue
        days = (e - s).days
        if 80 <= days <= 100:
            quarterly.append(u)
    if not quarterly:
        return None
    latest = max(quarterly, key=lambda u: u.get("end", ""))
    return latest.get("val")


# ---------------------------------------------------------------------------
# Submissions helpers
# ---------------------------------------------------------------------------
def _format_hq(addresses: dict | None) -> str | None:
    """Build 'City, State' or 'City, Country' from a SEC submissions address."""
    if not isinstance(addresses, dict):
        return None
    business = addresses.get("business") if "business" in addresses else addresses
    if not isinstance(business, dict):
        return None
    city = (business.get("city") or "").strip()
    state = (business.get("stateOrCountry") or "").strip()
    # SEC uses 2-letter codes for US states, full country code for non-US.
    parts: list[str] = []
    if city:
        parts.append(city.title())
    if state:
        parts.append(state)
    return ", ".join(parts) if parts else None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
async def get_edgar_company_data(
    ticker: str,
    price: float | None = None,
) -> dict | None:
    """
    Resolve a ticker to SEC EDGAR fundamentals.

    Returns a dict with keys compatible with the Company response shape, or
    None if the ticker isn't in EDGAR's US-listed company map (common for
    foreign ADRs and private companies).

    Market cap and P/E are computed using `price` from the caller (Twelve
    Data quote). If `price` is None, those two are left as None.
    """
    ticker = ticker.upper().strip()
    mapping = await _load_ticker_map()
    cik = mapping.get(ticker)
    if not cik:
        return None

    facts_resp, subs = await asyncio.gather(
        _fetch_companyfacts(cik),
        _fetch_submissions(cik),
    )
    facts = (facts_resp or {}).get("facts", {}) if isinstance(facts_resp, dict) else {}
    subs = subs or {}

    # --- Balance sheet ---
    cash = _instant_latest(facts, "CashAndCashEquivalentsAtCarryingValue")
    # Short-term investments (marketable securities) — biotech investors
    # typically consider these part of the usable cash pile.
    mkt_secs = _instant_latest(facts, "MarketableSecuritiesCurrent")
    total_cash: float | None = None
    if cash is not None:
        total_cash = float(cash) + float(mkt_secs or 0)

    # --- Operating cash flow (proxy for burn) ---
    # Positive = generating cash (profitable). Negative = burning cash.
    op_cf = _latest_quarterly_val(
        facts, "NetCashProvidedByUsedInOperatingActivities"
    )
    quarterly_burn: float | None = None
    if op_cf is not None and op_cf < 0:
        quarterly_burn = abs(op_cf)

    # --- Runway ---
    runway_months: int | None = None
    if total_cash and quarterly_burn and quarterly_burn > 0:
        runway_months = int(round((total_cash / quarterly_burn) * 3))

    # --- Shares outstanding ---
    shares = _instant_latest(facts, "CommonStockSharesOutstanding", "shares")
    if shares is None:
        shares = _instant_latest(
            facts, "EntityCommonStockSharesOutstanding", "shares"
        )
    if shares is None:
        # Some older filings use a different field under dei
        dei_units = (
            (facts_resp or {})
            .get("facts", {})
            .get("dei", {})
            .get("EntityCommonStockSharesOutstanding", {})
            .get("units", {})
            .get("shares", [])
            if isinstance(facts_resp, dict)
            else []
        )
        if dei_units:
            latest = max(dei_units, key=lambda u: u.get("end", ""))
            shares = latest.get("val")

    # --- EPS (annual as TTM proxy) ---
    eps_ttm = _annual_latest(facts, "EarningsPerShareDiluted", "USD/shares")
    if eps_ttm is None:
        eps_ttm = _annual_latest(facts, "EarningsPerShareBasic", "USD/shares")

    # --- Market cap + P/E (needs live price from caller) ---
    market_cap = None
    if price is not None and shares:
        market_cap = float(price) * float(shares)
    pe_ratio = None
    if price is not None and eps_ttm and eps_ttm > 0:
        pe_ratio = float(price) / float(eps_ttm)

    # --- Identity (from submissions) ---
    name = subs.get("name") or (facts_resp or {}).get("entityName")
    sic_desc = subs.get("sicDescription")
    hq = _format_hq(subs.get("addresses"))
    # SEC submissions has an "exchanges" list (['Nasdaq', 'NYSE', ...])
    exchanges = subs.get("exchanges") or []
    exchange = exchanges[0] if exchanges else None

    return {
        "name": name,
        "exchange": exchange,
        "hq": hq,
        "industry": sic_desc,
        "sector": _sector_from_sic(sic_desc),
        "description": None,  # Would require parsing 10-K Item 1
        "market_cap_usd": market_cap,
        "cash_usd": total_cash,
        "quarterly_burn_usd": quarterly_burn,
        "runway_months": runway_months,
        "shares_outstanding": int(shares) if shares else None,
        "eps_ttm": float(eps_ttm) if eps_ttm is not None else None,
        "pe_ratio": float(pe_ratio) if pe_ratio is not None else None,
    }


async def get_edgar_earnings(ticker: str, limit: int = 32) -> list[dict]:
    """
    Return a list of {date, period, past} earnings events for `ticker`, derived
    from SEC EDGAR 8-K filings with Item 2.02 ("Results of Operations and
    Financial Condition") — i.e. the actual earnings press release.

    An 8-K Item 2.02 is filed the same day as (or within 1 business day of)
    the earnings announcement, so this is the most accurate free source for
    day-precise earnings dates.

    We use the 8-K's `reportDate` (event date = announcement date) for the
    chart marker, and match each 8-K to the nearest-following 10-Q / 10-K
    to derive a "Q1 2024" / "FY 2023" fiscal-period label.

    Falls back to 10-Q / 10-K filing dates if a filer doesn't use 8-K 2.02
    (rare, but happens for some smaller issuers).

    Returns an empty list if the ticker isn't a US SEC filer.
    """
    ticker = ticker.upper().strip()
    mapping = await _load_ticker_map()
    cik = mapping.get(ticker)
    if not cik:
        return []

    subs = await _fetch_submissions(cik)
    if not isinstance(subs, dict):
        return []

    recent = (subs.get("filings") or {}).get("recent") or {}
    forms: list[str] = recent.get("form") or []
    filing_dates: list[str] = recent.get("filingDate") or []
    report_dates: list[str] = recent.get("reportDate") or []
    items_list: list[str] = recent.get("items") or []
    primary_descs: list[str] = recent.get("primaryDocDescription") or []

    # Pass 1: collect fiscal-period ends from periodic reports. We include
    # both US forms (10-Q / 10-K) and foreign-private-issuer forms (20-F).
    # 6-Ks don't count — they're current reports, not periodic.
    periodic_reports: list[tuple[str, str, str]] = []  # (period_end, form, filing_date)
    annual_forms = {"10-K", "20-F"}
    quarterly_forms = {"10-Q"}
    for i, form in enumerate(forms):
        if form not in annual_forms and form not in quarterly_forms:
            continue
        period_end = report_dates[i] if i < len(report_dates) else ""
        filing_date = filing_dates[i] if i < len(filing_dates) else ""
        if period_end and filing_date:
            periodic_reports.append((period_end, form, filing_date))
    periodic_reports.sort(key=lambda t: t[0])

    def _period_label_for(announcement_date: datetime) -> str:
        """Find the most recent fiscal period that ended before this
        announcement date. That's the period being reported on."""
        candidate: tuple[str, str, str] | None = None
        for p in periodic_reports:
            pd = datetime.strptime(p[0], "%Y-%m-%d")
            if pd <= announcement_date:
                candidate = p
            else:
                break
        if candidate:
            period_end_str, form, _ = candidate
            pd = datetime.strptime(period_end_str, "%Y-%m-%d")
            if form in annual_forms:
                return f"FY {pd.year}"
            q = (pd.month - 1) // 3 + 1
            return f"Q{q} {pd.year}"
        # Fallback: derive from announcement month (rough approximation)
        m = announcement_date.month
        y = announcement_date.year
        if m <= 3:
            return f"FY {y - 1}"
        if m <= 6:
            return f"Q1 {y}"
        if m <= 9:
            return f"Q2 {y}"
        return f"Q3 {y}"

    # Keywords we look for in a 6-K's primaryDocDescription to identify
    # earnings announcements from foreign private issuers.
    _FPI_EARNINGS_KEYWORDS = (
        "earnings",
        "financial result",
        "financial highlight",
        "quarterly result",
        "quarterly report",
        "half-year",
        "half year",
        "interim",
        "q1 ",
        "q2 ",
        "q3 ",
        "q4 ",
    )

    today = datetime.utcnow().date()
    out: list[dict] = []
    seen_dates: set[str] = set()

    # Pass 2: pull earnings announcements. Two sources:
    #   • 8-K with Item 2.02 (US filers — the actual earnings press release)
    #   • 6-K with an earnings-related primaryDocDescription (foreign private
    #     issuers like CRSP — they don't file 8-Ks)
    for i, form in enumerate(forms):
        is_earnings = False
        if form == "8-K":
            items = items_list[i] if i < len(items_list) else ""
            is_earnings = "2.02" in items
        elif form == "6-K":
            desc = (
                primary_descs[i] if i < len(primary_descs) else ""
            ).lower()
            is_earnings = any(kw in desc for kw in _FPI_EARNINGS_KEYWORDS)

        if not is_earnings:
            continue

        # Prefer `reportDate` (event date = earnings announcement).
        # Fall back to `filingDate` if reportDate is missing.
        announcement = (
            report_dates[i] if i < len(report_dates) and report_dates[i] else
            filing_dates[i] if i < len(filing_dates) else ""
        )
        if not announcement or announcement in seen_dates:
            continue
        try:
            ad = datetime.strptime(announcement, "%Y-%m-%d")
        except ValueError:
            continue
        seen_dates.add(announcement)
        out.append(
            {
                "date": announcement,
                "period": _period_label_for(ad),
                "past": ad.date() < today,
            }
        )

    # Last-resort fallback: if neither 8-K 2.02 nor earnings-tagged 6-K
    # filings exist, use periodic report filing dates. Less accurate (~2-5d
    # after the press release) but at least surfaces something.
    if not out:
        for period_end, form, filing_date in periodic_reports:
            try:
                fd = datetime.strptime(filing_date, "%Y-%m-%d").date()
                pd = datetime.strptime(period_end, "%Y-%m-%d")
            except ValueError:
                continue
            label = (
                f"FY {pd.year}"
                if form in annual_forms
                else f"Q{(pd.month - 1) // 3 + 1} {pd.year}"
            )
            out.append(
                {
                    "date": filing_date,
                    "period": label,
                    "past": fd < today,
                }
            )

    # Oldest first — matches the SEED_EARNINGS order convention.
    out.sort(key=lambda e: e["date"])
    if limit and len(out) > limit:
        out = out[-limit:]
    return out


def _sector_from_sic(sic_desc: str | None) -> str | None:
    """Coarse sector bucket from SIC description — keeps the UI consistent."""
    if not sic_desc:
        return None
    s = sic_desc.lower()
    if any(k in s for k in ("pharma", "biolog", "medical", "health", "drug")):
        return "Healthcare"
    if any(k in s for k in ("software", "computer", "services", "technology")):
        return "Technology"
    if any(k in s for k in ("bank", "insurance", "finance")):
        return "Financials"
    if any(k in s for k in ("oil", "gas", "mining", "energy")):
        return "Energy"
    if any(k in s for k in ("retail", "consumer", "food", "beverage")):
        return "Consumer"
    if any(k in s for k in ("industrial", "manufactur", "machinery", "aerospace")):
        return "Industrials"
    return None
