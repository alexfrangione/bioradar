"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getCompany, type Company } from "@/lib/api";
import { POPULAR_TICKERS } from "@/lib/universe";
import SiteNav from "@/components/SiteNav";

// ---------------------------------------------------------------------------
// Screener
//
// Cross-company filter view. Fans out getCompany() across POPULAR_TICKERS and
// renders a sortable/filterable table. Intended as a "skim the field" tool —
// pick a size band and runway profile, click into the interesting names.
// ---------------------------------------------------------------------------

type Row = Company & { ticker: string };

// Filter buckets. Market cap is bucketed rather than slider-based so users can
// think in standard biotech size bands (mega / large / mid / small / nano).
type CapBucket = "all" | "mega" | "large" | "mid" | "small" | "nano";
type HealthFilter = "all" | "strong" | "stable" | "watch" | "risk";
type RunwayFilter = "all" | "12" | "24" | "36";
type SortKey = "marketCap" | "runway" | "pe" | "ticker";

const CAP_BANDS: Record<
  Exclude<CapBucket, "all">,
  { min: number; max: number; label: string }
> = {
  mega: { min: 200_000_000_000, max: Infinity, label: "Mega (> $200B)" },
  large: { min: 10_000_000_000, max: 200_000_000_000, label: "Large ($10–200B)" },
  mid: { min: 2_000_000_000, max: 10_000_000_000, label: "Mid ($2–10B)" },
  small: { min: 300_000_000, max: 2_000_000_000, label: "Small ($300M–2B)" },
  nano: { min: 0, max: 300_000_000, label: "Nano (< $300M)" },
};

const HEALTH_COLOR: Record<NonNullable<Company["health"]>, string> = {
  strong: "text-accent-green",
  stable: "text-accent-blue",
  watch: "text-accent-amber",
  risk: "text-accent-red",
};

const HEALTH_DOT: Record<NonNullable<Company["health"]>, string> = {
  strong: "bg-accent-green",
  stable: "bg-accent-blue",
  watch: "bg-accent-amber",
  risk: "bg-accent-red",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ScreenerPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const [cap, setCap] = useState<CapBucket>("all");
  const [health, setHealth] = useState<HealthFilter>("all");
  const [runway, setRunway] = useState<RunwayFilter>("all");
  const [sort, setSort] = useState<SortKey>("marketCap");

  // Fan-out fetch once on mount. getCompany is cheap — the backend caches the
  // SEC EDGAR fundamentals — and the list is ~15 tickers.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const results = await Promise.all(
        POPULAR_TICKERS.map(async (t) => {
          const c = await getCompany(t);
          if (!c) return null;
          return { ...c, ticker: t } as Row;
        }),
      );
      if (cancelled) return;
      setRows(results.filter(Boolean) as Row[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    let out = rows.filter((r) => !r.placeholder);
    if (cap !== "all") {
      const band = CAP_BANDS[cap];
      out = out.filter((r) => {
        const mc = r.market_cap_usd ?? 0;
        return mc >= band.min && mc < band.max;
      });
    }
    if (health !== "all") {
      out = out.filter((r) => r.health === health);
    }
    if (runway !== "all") {
      const minMonths = Number(runway);
      out = out.filter(
        (r) => r.runway_months != null && r.runway_months >= minMonths,
      );
    }
    out = [...out].sort((a, b) => {
      if (sort === "ticker") return a.ticker.localeCompare(b.ticker);
      if (sort === "runway")
        return (b.runway_months ?? -1) - (a.runway_months ?? -1);
      if (sort === "pe") return (b.pe_ratio ?? -1) - (a.pe_ratio ?? -1);
      return (b.market_cap_usd ?? 0) - (a.market_cap_usd ?? 0);
    });
    return out;
  }, [rows, cap, health, runway, sort]);

  return (
    <main className="min-h-screen">
      <SiteNav />

      <div className="max-w-[1200px] mx-auto px-8 pt-9 pb-20">
        {/* Header */}
        <div className="flex items-end justify-between mb-7 pb-5 border-b border-border-subtle gap-6 flex-wrap">
          <div>
            <h1 className="text-[32px] font-bold tracking-[-0.02em] mb-1.5">
              Screener
            </h1>
            <p className="text-text-dim text-sm leading-relaxed m-0">
              {loading ? (
                "Loading…"
              ) : (
                <>
                  <span className="text-accent-green font-medium">
                    {filtered.length}{" "}
                    {filtered.length === 1 ? "company" : "companies"}
                  </span>{" "}
                  across popular healthcare · filter by size, health, and runway
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <FilterGroup<CapBucket>
              label="Cap"
              value={cap}
              onChange={setCap}
              options={[
                { v: "all", label: "All" },
                { v: "mega", label: "Mega" },
                { v: "large", label: "Large" },
                { v: "mid", label: "Mid" },
                { v: "small", label: "Small" },
                { v: "nano", label: "Nano" },
              ]}
            />
            <FilterGroup<HealthFilter>
              label="Health"
              value={health}
              onChange={setHealth}
              options={[
                { v: "all", label: "All" },
                { v: "strong", label: "Strong" },
                { v: "stable", label: "Stable" },
                { v: "watch", label: "Watch" },
                { v: "risk", label: "Risk" },
              ]}
            />
            <FilterGroup<RunwayFilter>
              label="Runway"
              value={runway}
              onChange={setRunway}
              options={[
                { v: "all", label: "Any" },
                { v: "12", label: "12m+" },
                { v: "24", label: "24m+" },
                { v: "36", label: "36m+" },
              ]}
            />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-sm text-text-dim py-10">Loading companies…</div>
        ) : filtered.length === 0 ? (
          <div className="bg-bg-elev border border-border-subtle rounded-xl px-7 py-12 text-center">
            <div className="text-text font-medium mb-1">No matches</div>
            <div className="text-sm text-text-dim">
              Loosen the filters or try a different size band.
            </div>
          </div>
        ) : (
          <div className="bg-bg-elev border border-border-subtle rounded-xl overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left font-mono text-[10.5px] uppercase tracking-[0.12em] text-text-dim border-b border-border-subtle">
                  <Th onClick={() => setSort("ticker")} active={sort === "ticker"}>
                    Ticker
                  </Th>
                  <Th>Name</Th>
                  <Th
                    onClick={() => setSort("marketCap")}
                    active={sort === "marketCap"}
                    align="right"
                  >
                    Market cap
                  </Th>
                  <Th
                    onClick={() => setSort("runway")}
                    active={sort === "runway"}
                    align="right"
                  >
                    Runway
                  </Th>
                  <Th
                    onClick={() => setSort("pe")}
                    active={sort === "pe"}
                    align="right"
                  >
                    P/E
                  </Th>
                  <Th align="right">Health</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.ticker}
                    className="border-b border-border-subtle last:border-b-0 hover:bg-bg-elev2 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/company/${r.ticker}`}
                        className="font-mono font-semibold text-text hover:text-accent-green"
                      >
                        {r.ticker}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-text-dim max-w-[260px] truncate">
                      {r.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatCap(r.market_cap_usd)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatRunway(r.runway_months)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-text-dim">
                      {r.pe_ratio != null ? r.pe_ratio.toFixed(1) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.health ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={`inline-block w-[7px] h-[7px] rounded-full ${HEALTH_DOT[r.health]}`}
                          />
                          <span
                            className={`font-medium capitalize ${HEALTH_COLOR[r.health]}`}
                          >
                            {r.health}
                          </span>
                        </span>
                      ) : (
                        <span className="text-text-dimmer">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCap(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toLocaleString()}`;
}

function formatRunway(m: number | null | undefined): string {
  if (m == null) return "—";
  if (m >= 120) return ">10y";
  if (m >= 24) return `${(m / 12).toFixed(1)}y`;
  return `${Math.round(m)}mo`;
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function FilterGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { v: T; label: string }[];
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-dim">
        {label}
      </span>
      <div className="inline-flex bg-bg-elev border border-border rounded-lg overflow-hidden">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={`px-2.5 py-1.5 text-[12px] font-medium border-r border-border-subtle last:border-r-0 transition-colors ${
              o.v === value
                ? "bg-bg-elev2 text-text"
                : "text-text-dim hover:text-text"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Th({
  children,
  onClick,
  active,
  align = "left",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  align?: "left" | "right";
}) {
  const alignClass = align === "right" ? "text-right" : "text-left";
  const clickable = onClick != null;
  return (
    <th
      onClick={onClick}
      className={`px-4 py-3 font-mono text-[10.5px] uppercase tracking-[0.12em] ${alignClass} ${
        clickable ? "cursor-pointer select-none hover:text-text" : ""
      } ${active ? "text-text" : ""}`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {active && <span className="text-accent-green text-[9px]">●</span>}
      </span>
    </th>
  );
}
