"""
Finnhub news integration for BioRadar — pulls recent company-news headlines
and classifies them into catalyst events.

Data source:
  • https://finnhub.io/api/v1/company-news?symbol={T}&from={YYYY-MM-DD}&to={...}

Finnhub's free tier: 60 calls/minute, no credit card required. Set
FINNHUB_API_KEY in backend/.env; if unset, the fetcher returns an empty list
and the catalyst endpoint degrades gracefully.

Design decisions:
  - 90-day rolling window by default. News more than a quarter old is rarely
    relevant to a forward-looking catalyst calendar, and the default limits
    classifier noise.
  - Only headlines with a confident catalyst-keyword match surface as events.
    Unclassified chatter (generic market coverage, analyst notes, routine
    investor presentations) is dropped.
  - Same-day / same-type dedup. Major news breaks as 5-10 near-duplicate
    headlines within hours; we want one event per story.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from time import time as _now

import httpx

_CACHE_TTL = 30 * 60  # 30 minutes — news moves faster than SEC/CT.gov
_news_cache: dict[str, tuple[float, list[dict]]] = {}

# Default look-back window for the news query. Kept conservative to reduce
# headline noise and keep response times tight.
_DEFAULT_WINDOW_DAYS = 90


def _api_key() -> str | None:
    key = os.getenv("FINNHUB_API_KEY")
    return key.strip() if key else None


# ---------------------------------------------------------------------------
# Keyword classifier
# ---------------------------------------------------------------------------
# (keywords, type, impact, title_prefix) — first match wins, order specific→generic.
#
# Tuned for biotech press headlines. The patterns overlap with the EDGAR 8-K
# set but add headline-specific phrasing ("announces", "reports", "greenlight").
_HEADLINE_PATTERNS: list[tuple[tuple[str, ...], str, str, str]] = [
    (
        (
            "fda approves",
            "fda approval",
            "fda greenlight",
            "fda clears",
            "receives approval",
            "wins approval",
            "ema approves",
            "ema approval",
            "chmp recommends",
        ),
        "approval",
        "high",
        "FDA approval",
    ),
    (
        (
            "pdufa",
            "advisory committee",
            "adcom",
            "fda panel",
            "complete response letter",
            "crl from fda",
        ),
        "fda-advisory",
        "high",
        "FDA advisory",
    ),
    (
        (
            "positive topline",
            "positive phase",
            "positive data",
            "met primary",
            "met the primary",
            "hit primary",
            "hits primary",
            "hits the primary",
            "achieved primary",
            "achieves primary",
            "statistically significant",
            "beats expectations",
            "beats trial",
        ),
        "readout-positive",
        "high",
        "Positive data",
    ),
    (
        (
            "did not meet",
            "failed to meet",
            "missed primary",
            "missed the primary",
            "negative topline",
            "trial fails",
            "trial failed",
            "study failed",
            "disappointing",
        ),
        "readout-negative",
        "high",
        "Negative data",
    ),
    (
        (
            "discontinues",
            "discontinuation",
            "halts trial",
            "halted trial",
            "terminates trial",
            "pauses trial",
            "clinical hold",
            "fda clinical hold",
        ),
        "failure",
        "high",
        "Discontinuation",
    ),
    (
        (
            "topline results",
            "interim analysis",
            "interim data",
            "phase 1 data",
            "phase 2 data",
            "phase 3 data",
            "readout",
            "reports data",
            "announces data",
            "presents data",
        ),
        "readout",
        "medium",
        "Clinical data",
    ),
    (
        (
            "license agreement",
            "licensing agreement",
            "collaboration agreement",
            "strategic partnership",
            "acquires",
            "acquisition of",
            "to acquire",
            "merger",
            "buyout",
        ),
        "licensing",
        "medium",
        "Deal",
    ),
    (
        (
            "files nda",
            "files bla",
            "submits nda",
            "submits bla",
            "new drug application",
            "biologics license application",
            "files for approval",
            "marketing authorization",
        ),
        "filing",
        "medium",
        "Regulatory filing",
    ),
]


def classify_headline(
    headline: str, summary: str = ""
) -> tuple[str, str, str] | None:
    """Classify a news headline. Returns (type, impact, title_prefix) or None.

    The summary is consulted as a fallback — some wire services put the
    catalyst keyword in the summary but use a terse headline.
    """
    text = f"{headline} {summary}".lower()
    if not text.strip():
        return None
    for keywords, ctype, impact, prefix in _HEADLINE_PATTERNS:
        if any(kw in text for kw in keywords):
            return (ctype, impact, prefix)
    return None


# ---------------------------------------------------------------------------
# Fetcher
# ---------------------------------------------------------------------------
async def _fetch_news(
    ticker: str, from_date: str, to_date: str
) -> list[dict]:
    """Raw fetch against Finnhub's /company-news endpoint. Returns [] on any
    error so callers can degrade gracefully."""
    key = _api_key()
    if not key:
        print(
            f"[bioradar][finnhub] {ticker}: FINNHUB_API_KEY not set — skipping. "
            f"Add it to backend/.env and restart uvicorn."
        )
        return []

    cache_key = f"{ticker}|{from_date}|{to_date}"
    cached = _news_cache.get(cache_key)
    if cached and (_now() - cached[0]) < _CACHE_TTL:
        print(
            f"[bioradar][finnhub] {ticker}: cache hit "
            f"({len(cached[1])} articles, window {from_date}→{to_date})"
        )
        return cached[1]

    url = "https://finnhub.io/api/v1/company-news"
    params = {
        "symbol": ticker,
        "from": from_date,
        "to": to_date,
        "token": key,
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.get(url, params=params)
        if r.status_code != 200:
            # Common failures: 401 (bad key), 403 (suspended), 429 (rate limit).
            body_preview = r.text[:200] if r.text else ""
            print(
                f"[bioradar][finnhub] {ticker}: HTTP {r.status_code} "
                f"(window {from_date}→{to_date}). body: {body_preview!r}"
            )
            return []
        data = r.json()
        if not isinstance(data, list):
            print(
                f"[bioradar][finnhub] {ticker}: unexpected response shape "
                f"(expected list, got {type(data).__name__})"
            )
            return []
        print(
            f"[bioradar][finnhub] {ticker}: fetched {len(data)} articles "
            f"(window {from_date}→{to_date})"
        )
        _news_cache[cache_key] = (_now(), data)
        return data
    except httpx.HTTPError as exc:
        print(f"[bioradar][finnhub] {ticker}: HTTP error — {exc}")
        return []


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
async def get_finnhub_catalysts(
    ticker: str, window_days: int = _DEFAULT_WINDOW_DAYS, limit: int = 20
) -> list[dict]:
    """Return catalyst events derived from Finnhub company-news headlines.

    Only headlines that classify confidently against the keyword patterns are
    surfaced — this keeps the calendar from drowning in generic market chatter.

    Each event is tagged `source: "news"` with the article URL, and we
    dedup near-duplicate stories (same date + same type) since wire services
    cross-post aggressively.
    """
    ticker = ticker.upper().strip()
    today = datetime.utcnow().date()
    from_date = (today - timedelta(days=window_days)).isoformat()
    to_date = today.isoformat()

    raw = await _fetch_news(ticker, from_date, to_date)
    if not raw:
        return []

    out: list[dict] = []
    for article in raw:
        headline = str(article.get("headline") or "").strip()
        summary_txt = str(article.get("summary") or "").strip()
        if not headline:
            continue

        classification = classify_headline(headline, summary_txt)
        if not classification:
            continue
        ctype, impact, prefix = classification

        ts = article.get("datetime")
        if not isinstance(ts, (int, float)) or ts <= 0:
            continue
        try:
            event_date = datetime.fromtimestamp(
                int(ts), tz=timezone.utc
            ).date().isoformat()
        except (ValueError, OSError, OverflowError):
            continue

        url_val = article.get("url") or None
        source_name = str(article.get("source") or "").strip()

        # Build summary: headline + source. The article's own summary field
        # is often just a generic blurb — less informative than the headline
        # itself plus provenance. If the article summary looks substantive
        # (longer than the headline, different content), include it.
        summary_parts = [headline]
        if source_name:
            summary_parts.append(source_name)
        if summary_txt and len(summary_txt) > len(headline) and not _is_repetitive(
            headline, summary_txt
        ):
            summary_parts.append(summary_txt[:200])
        summary_text = " · ".join(summary_parts)

        out.append(
            {
                "date": event_date,
                "title": f"{prefix} — {_trim(headline, 120)}",
                "type": ctype,
                "impact": impact,
                "summary": summary_text,
                "source": "news",
                "url": url_val,
            }
        )

    # Dedup: same (date, type) → keep the first occurrence (newest wins
    # because Finnhub returns newest-first).
    seen: set[tuple[str, str]] = set()
    deduped: list[dict] = []
    for e in out:
        key = (e["date"], e["type"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(e)

    deduped.sort(key=lambda e: e["date"])
    if limit and len(deduped) > limit:
        deduped = deduped[-limit:]

    if raw:
        print(
            f"[bioradar][finnhub] {ticker}: classified {len(out)}/{len(raw)} "
            f"articles, {len(deduped)} after dedup"
        )
    return deduped


def _trim(s: str, n: int) -> str:
    s = s.strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _is_repetitive(headline: str, summary: str) -> bool:
    """True if the summary text is essentially the same as the headline
    (common when a wire service uses the headline as its own summary)."""
    h = headline.strip().lower()
    s = summary.strip().lower()
    return s == h or s.startswith(h) or h.startswith(s)
