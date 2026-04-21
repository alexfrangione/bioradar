"""
Unit tests for backend/sector_filter.py.

Run from the repo root:
    python test_sector_filter.py

Covers:
- SIC-code ranges (in-range + out-of-range)
- Sector / industry string matching
- Async classifier with injected mocks (seed, edgar, twelve data fallback)
- Classification cache behaviour
"""

from __future__ import annotations

import asyncio
import sys
import types
from pathlib import Path

# Make backend/ importable whether you run this from the repo root or from
# inside the backend/ directory.
HERE = Path(__file__).resolve().parent
for candidate in (HERE / "backend", HERE):
    if (candidate / "sector_filter.py").exists():
        sys.path.insert(0, str(candidate))
        break

# sector_filter imports httpx for its Twelve Data fallback path, but every
# async test in this file monkey-patches that call anyway. If httpx isn't
# installed in the interpreter running the tests (e.g. system Python vs the
# backend venv), stub it so the import succeeds.
if "httpx" not in sys.modules:
    try:
        import httpx  # noqa: F401
    except ModuleNotFoundError:
        stub = types.ModuleType("httpx")

        class _HTTPError(Exception):
            pass

        class _AsyncClient:
            def __init__(self, *a, **kw):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def get(self, *a, **kw):
                raise _HTTPError("stubbed httpx")

        stub.HTTPError = _HTTPError
        stub.AsyncClient = _AsyncClient
        sys.modules["httpx"] = stub

import sector_filter  # noqa: E402


def _reset_cache() -> None:
    sector_filter._classification_cache.clear()


def test_sic_range_pharma():
    # 2834 (pharma prep), 2836 (biological products)
    assert sector_filter._sic_is_healthcare(2834) is True
    assert sector_filter._sic_is_healthcare("2836") is True
    # 2832 is just outside the pharma range
    assert sector_filter._sic_is_healthcare(2832) is False


def test_sic_range_medical_devices():
    for code in (3826, 3841, 3842, 3843, 3844, 3845, 3851):
        assert sector_filter._sic_is_healthcare(code) is True, code
    # 3827 = optical instruments: not healthcare
    assert sector_filter._sic_is_healthcare(3827) is False
    # 3850 = drops out (only 3851 matches in that band)
    assert sector_filter._sic_is_healthcare(3850) is False


def test_sic_range_health_services():
    for code in (8000, 8011, 8060, 8071, 8099):
        assert sector_filter._sic_is_healthcare(code) is True, code
    # 8100 is outside 8000-8099
    assert sector_filter._sic_is_healthcare(8100) is False


def test_sic_range_research():
    assert sector_filter._sic_is_healthcare(8731) is True
    # 8732 = commercial nonphysical research (market research) — excluded
    assert sector_filter._sic_is_healthcare(8732) is False


def test_sic_range_misc_healthcare():
    # Hospital & medical service plans (UNH / CI / HUM)
    assert sector_filter._sic_is_healthcare(6324) is True
    # Retail drug stores
    assert sector_filter._sic_is_healthcare(5912) is True
    # Drugs wholesale
    assert sector_filter._sic_is_healthcare(5122) is True
    # Medical/hospital equipment wholesale
    assert sector_filter._sic_is_healthcare(5047) is True


def test_sic_non_healthcare():
    # Famous non-healthcare tickers' SIC codes
    non_hc = (
        7372,  # Prepackaged software (NFLX-ish)
        3571,  # Electronic computers (AAPL)
        5961,  # Catalog retail (AMZN before reclass)
        3711,  # Motor vehicles (TSLA)
        6021,  # National commercial banks
    )
    for code in non_hc:
        assert sector_filter._sic_is_healthcare(code) is False, code


def test_sic_garbage_input():
    assert sector_filter._sic_is_healthcare(None) is False
    assert sector_filter._sic_is_healthcare("") is False
    assert sector_filter._sic_is_healthcare("not a number") is False


def test_text_healthcare_sector():
    assert sector_filter._text_is_healthcare(sector="Healthcare") is True
    assert sector_filter._text_is_healthcare(sector="Health Care") is True
    assert sector_filter._text_is_healthcare(sector="Technology") is False
    assert sector_filter._text_is_healthcare(sector=None) is False


def test_text_healthcare_industry():
    assert sector_filter._text_is_healthcare(industry="Biotechnology") is True
    assert sector_filter._text_is_healthcare(industry="Pharmaceuticals") is True
    assert (
        sector_filter._text_is_healthcare(industry="Drug Manufacturers—General")
        is True
    )
    assert sector_filter._text_is_healthcare(industry="Medical Devices") is True
    assert sector_filter._text_is_healthcare(industry="Diagnostics & Research") is True
    assert (
        sector_filter._text_is_healthcare(industry="Life Sciences Tools & Services")
        is True
    )
    assert sector_filter._text_is_healthcare(industry="Software—Infrastructure") is False


def test_text_healthcare_sic_desc():
    # SEC returns textual descriptions too
    assert (
        sector_filter._text_is_healthcare(sic_desc="Pharmaceutical Preparations")
        is True
    )
    assert (
        sector_filter._text_is_healthcare(sic_desc="Services-Prepackaged Software")
        is False
    )


def test_classify_mixed():
    # Pure classifier tying it all together
    assert sector_filter.classify(sic=2836) is True
    assert (
        sector_filter.classify(sector="Healthcare", industry="Biotechnology") is True
    )
    assert sector_filter.classify(sic=7372, sector="Technology") is False
    # Missing everything → hide
    assert sector_filter.classify() is False


def test_async_seed_allowlist():
    """Seed tickers short-circuit — no network calls even if edgar_lookup errors."""
    _reset_cache()

    async def _boom(_ticker):
        raise RuntimeError("should not be called")

    ok = asyncio.run(
        sector_filter.is_healthcare_ticker(
            "SRPT",
            seed_tickers={"SRPT", "CRSP"},
            edgar_lookup=_boom,
        )
    )
    assert ok is True


def test_async_edgar_biotech_hit():
    _reset_cache()

    async def _edgar(_ticker):
        return {"industry": "Pharmaceutical Preparations", "sector": "Healthcare"}

    ok = asyncio.run(
        sector_filter.is_healthcare_ticker(
            "MRNA", seed_tickers=set(), edgar_lookup=_edgar
        )
    )
    assert ok is True


def test_async_edgar_non_healthcare():
    _reset_cache()

    async def _edgar(_ticker):
        # NFLX-style: not healthcare
        return {"industry": "Services-Prepackaged Software", "sector": "Technology"}

    ok = asyncio.run(
        sector_filter.is_healthcare_ticker(
            "NFLX", seed_tickers=set(), edgar_lookup=_edgar
        )
    )
    assert ok is False


def test_async_cache_roundtrip():
    """Second call shouldn't hit edgar_lookup."""
    _reset_cache()
    calls = {"n": 0}

    async def _edgar(_ticker):
        calls["n"] += 1
        return {"industry": "Biotechnology", "sector": "Healthcare"}

    async def _run():
        a = await sector_filter.is_healthcare_ticker(
            "BEAM", seed_tickers=set(), edgar_lookup=_edgar
        )
        b = await sector_filter.is_healthcare_ticker(
            "BEAM", seed_tickers=set(), edgar_lookup=_edgar
        )
        return a, b

    a, b = asyncio.run(_run())
    assert a is True and b is True
    assert calls["n"] == 1, f"expected 1 edgar call, got {calls['n']}"


def test_async_fail_closed_when_no_data():
    """If EDGAR returns nothing AND Twelve Data is unreachable, hide the ticker."""
    _reset_cache()

    async def _edgar(_ticker):
        return None

    # Monkey-patch the Twelve Data fetch so we don't hit the network.
    async def _profile_none(_ticker):
        return None

    original = sector_filter._fetch_twelvedata_sector
    sector_filter._fetch_twelvedata_sector = _profile_none
    try:
        ok = asyncio.run(
            sector_filter.is_healthcare_ticker(
                "UNKNOWN", seed_tickers=set(), edgar_lookup=_edgar
            )
        )
    finally:
        sector_filter._fetch_twelvedata_sector = original
    assert ok is False


def test_async_twelvedata_fallback():
    """If EDGAR misses but Twelve Data says healthcare, we include it."""
    _reset_cache()

    async def _edgar(_ticker):
        return None

    async def _profile(ticker):
        return {"sector": "Healthcare", "industry": "Biotechnology"}

    original = sector_filter._fetch_twelvedata_sector
    sector_filter._fetch_twelvedata_sector = _profile
    try:
        ok = asyncio.run(
            sector_filter.is_healthcare_ticker(
                "XBIO", seed_tickers=set(), edgar_lookup=_edgar
            )
        )
    finally:
        sector_filter._fetch_twelvedata_sector = original
    assert ok is True


if __name__ == "__main__":
    tests = [
        test_sic_range_pharma,
        test_sic_range_medical_devices,
        test_sic_range_health_services,
        test_sic_range_research,
        test_sic_range_misc_healthcare,
        test_sic_non_healthcare,
        test_sic_garbage_input,
        test_text_healthcare_sector,
        test_text_healthcare_industry,
        test_text_healthcare_sic_desc,
        test_classify_mixed,
        test_async_seed_allowlist,
        test_async_edgar_biotech_hit,
        test_async_edgar_non_healthcare,
        test_async_cache_roundtrip,
        test_async_fail_closed_when_no_data,
        test_async_twelvedata_fallback,
    ]
    failures = 0
    for t in tests:
        try:
            t()
            print(f"PASS  {t.__name__}")
        except AssertionError as e:
            failures += 1
            print(f"FAIL  {t.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failures += 1
            print(f"ERROR {t.__name__}: {type(e).__name__}: {e}")
    print()
    if failures:
        print(f"{failures} test(s) failed.")
        sys.exit(1)
    print(f"All {len(tests)} tests passed.")
