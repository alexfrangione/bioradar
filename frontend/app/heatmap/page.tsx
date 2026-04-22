"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getCompany, getQuote, type Company, type Quote } from "@/lib/api";
import { POPULAR_TICKERS } from "@/lib/universe";
import SiteNav from "@/components/SiteNav";

// ---------------------------------------------------------------------------
// Heatmap
//
// Finviz-style tile map. Fans out getCompany() + getQuote() across the popular
// universe, sizes tiles by sqrt(market cap) and colors them by today's percent
// change. Intended as a one-glance sentiment pulse of the healthcare sector.
// ---------------------------------------------------------------------------

type Tile = {
  ticker: string;
  name: string | null;
  marketCap: number;
  pctChange: number | null;
  price: number | null;
};

export default function HeatmapPage() {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const results = await Promise.all(
        POPULAR_TICKERS.map(async (t) => {
          const [company, quote] = await Promise.all([
            getCompany(t),
            getQuote(t),
          ]);
          return buildTile(t, company, quote);
        }),
      );
      if (cancelled) return;
      setTiles(results.filter((r): r is Tile => r != null));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Sort by market cap descending so the big names anchor the top-left, per
  // Finviz convention. flex-grow sizing still lets small caps fill gaps.
  const sorted = useMemo(
    () => [...tiles].sort((a, b) => b.marketCap - a.marketCap),
    [tiles],
  );

  // Establish a sqrt-scaled size range so a 10x market-cap gap reads as ~3x
  // tile area — otherwise GILD would eat the whole screen.
  const { minRoot, maxRoot } = useMemo(() => {
    const roots = sorted
      .map((t) => Math.sqrt(Math.max(t.marketCap, 1)))
      .filter((r) => r > 0);
    if (roots.length === 0) return { minRoot: 1, maxRoot: 1 };
    return {
      minRoot: Math.min(...roots),
      maxRoot: Math.max(...roots),
    };
  }, [sorted]);

  const up = sorted.filter((t) => (t.pctChange ?? 0) > 0).length;
  const down = sorted.filter((t) => (t.pctChange ?? 0) < 0).length;

  return (
    <main className="min-h-screen">
      <SiteNav />

      <div className="max-w-[1400px] mx-auto px-8 pt-9 pb-20">
        {/* Header */}
        <div className="flex items-end justify-between mb-7 pb-5 border-b border-border-subtle gap-6 flex-wrap">
          <div>
            <h1 className="text-[32px] font-bold tracking-[-0.02em] mb-1.5">
              Heatmap
            </h1>
            <p className="text-text-dim text-sm leading-relaxed m-0">
              {loading ? (
                "Loading…"
              ) : (
                <>
                  <span className="text-accent-green font-medium">{up} up</span>
                  {" · "}
                  <span className="text-accent-red font-medium">
                    {down} down
                  </span>
                  {" "}across popular healthcare · tile size = market cap
                </>
              )}
            </p>
          </div>

          <Legend />
        </div>

        {loading ? (
          <div className="text-sm text-text-dim py-10">Loading heatmap…</div>
        ) : sorted.length === 0 ? (
          <div className="bg-bg-elev border border-border-subtle rounded-xl px-7 py-12 text-center">
            <div className="text-text font-medium mb-1">No data</div>
            <div className="text-sm text-text-dim">
              Quotes are unavailable — try again in a minute.
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5 content-start">
            {sorted.map((t) => (
              <HeatmapTile
                key={t.ticker}
                tile={t}
                minRoot={minRoot}
                maxRoot={maxRoot}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function HeatmapTile({
  tile,
  minRoot,
  maxRoot,
}: {
  tile: Tile;
  minRoot: number;
  maxRoot: number;
}) {
  const { bg, fg } = colorFor(tile.pctChange);

  // Map sqrt-cap to flex-grow. Ensures a monotonic size relationship without
  // any tile dominating the row.
  const root = Math.sqrt(Math.max(tile.marketCap, 1));
  const span = Math.max(maxRoot - minRoot, 1);
  const t = (root - minRoot) / span; // 0..1
  const grow = 1 + t * 6; // 1..7
  const minW = 140 + Math.round(t * 100); // 140..240px

  return (
    <Link
      href={`/company/${tile.ticker}`}
      style={{
        flexGrow: grow,
        minWidth: `${minW}px`,
        backgroundColor: bg,
      }}
      className="rounded-lg border border-border-subtle px-4 py-4 flex flex-col justify-between h-[110px] hover:border-border transition-colors"
    >
      <div className="flex items-center justify-between">
        <span
          className="font-mono font-semibold text-[15px]"
          style={{ color: fg }}
        >
          {tile.ticker}
        </span>
        <span
          className="font-mono text-[11px] tabular-nums"
          style={{ color: fg, opacity: 0.75 }}
        >
          {formatCap(tile.marketCap)}
        </span>
      </div>
      <div>
        <div
          className="font-mono font-semibold text-[22px] tabular-nums leading-none"
          style={{ color: fg }}
        >
          {formatPct(tile.pctChange)}
        </div>
        <div
          className="font-mono text-[11px] tabular-nums mt-0.5"
          style={{ color: fg, opacity: 0.7 }}
        >
          {tile.price != null ? `$${tile.price.toFixed(2)}` : "—"}
        </div>
      </div>
    </Link>
  );
}

function Legend() {
  const stops = [
    { label: "≤ −3%", color: "#7a1f1f" },
    { label: "−1%", color: "#4a2326" },
    { label: "0", color: "#2a2f36" },
    { label: "+1%", color: "#234531" },
    { label: "≥ +3%", color: "#1d6b3a" },
  ];
  return (
    <div className="inline-flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-dim">
        Change
      </span>
      <div className="inline-flex rounded-lg overflow-hidden border border-border-subtle">
        {stops.map((s) => (
          <div
            key={s.label}
            className="px-2.5 py-1.5 font-mono text-[10.5px] text-text"
            style={{ backgroundColor: s.color }}
          >
            {s.label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTile(
  ticker: string,
  company: Company | null,
  quote: Quote | null,
): Tile | null {
  const marketCap = company?.market_cap_usd ?? 0;
  if (!company || company.placeholder) return null;
  return {
    ticker,
    name: company.name ?? ticker,
    marketCap: marketCap > 0 ? marketCap : 1,
    pctChange: quote?.percent_change ?? null,
    price: quote?.price ?? null,
  };
}

function formatPct(v: number | null): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function formatCap(v: number): string {
  if (!Number.isFinite(v) || v <= 1) return "—";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toLocaleString()}`;
}

// Gradient from deep red → neutral → deep green, keyed off percent change.
// Foreground text stays near-white for legibility at every stop.
function colorFor(pct: number | null): { bg: string; fg: string } {
  if (pct == null) return { bg: "#2a2f36", fg: "#e6edf3" };
  const clamped = Math.max(-3, Math.min(3, pct));
  if (clamped === 0) return { bg: "#2a2f36", fg: "#e6edf3" };
  if (clamped > 0) {
    // neutral → green (0..3%)
    const t = clamped / 3;
    const r = Math.round(lerp(42, 29, t));
    const g = Math.round(lerp(47, 107, t));
    const b = Math.round(lerp(54, 58, t));
    return { bg: `rgb(${r}, ${g}, ${b})`, fg: "#e6edf3" };
  }
  // neutral → red (0..-3%)
  const t = -clamped / 3;
  const r = Math.round(lerp(42, 122, t));
  const g = Math.round(lerp(47, 31, t));
  const b = Math.round(lerp(54, 31, t));
  return { bg: `rgb(${r}, ${g}, ${b})`, fg: "#e6edf3" };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
