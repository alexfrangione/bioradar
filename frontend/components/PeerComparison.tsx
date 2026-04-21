"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getCompany, getQuote, type Company, type Quote } from "@/lib/api";
import { cohortForTicker, type Cohort } from "@/lib/cohorts";

// Data we need per peer row. All nullable — a peer ticker may not resolve
// in EDGAR or Twelve Data, and we just render em-dashes for those cells.
type PeerRow = {
  ticker: string;
  isFocus: boolean; // is this the company page we're on?
  company: Company | null;
  quote: Quote | null;
};

// Which columns we color-grade, and the direction that counts as "better".
// "up" means higher is better (market cap, runway, % change), "down" means
// lower is better (none right now, but kept for future e.g. burn/mcap ratio).
type GradedKey = "market_cap" | "cash" | "runway" | "percent_change";
const GRADE_DIRECTION: Record<GradedKey, "up" | "down"> = {
  market_cap: "up",
  cash: "up",
  runway: "up",
  percent_change: "up",
};

export default function PeerComparison({ ticker }: { ticker: string }) {
  const cohort = useMemo(() => cohortForTicker(ticker), [ticker]);

  const [rows, setRows] = useState<PeerRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!cohort) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const results = await Promise.all(
        cohort.tickers.map(async (t) => {
          const [company, quote] = await Promise.all([
            getCompany(t),
            getQuote(t),
          ]);
          return {
            ticker: t,
            isFocus: t === ticker.toUpperCase(),
            company,
            quote,
          } as PeerRow;
        }),
      );
      if (cancelled) return;
      setRows(results);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [cohort, ticker]);

  // Precompute ranks for each graded column. Rank 0 = best, higher = worse.
  // Missing values are ranked last so they render neutrally.
  const ranks = useMemo(() => {
    const pick: Record<GradedKey, (r: PeerRow) => number | null> = {
      market_cap: (r) => r.company?.market_cap_usd ?? null,
      cash: (r) => r.company?.cash_usd ?? null,
      runway: (r) => r.company?.runway_months ?? null,
      percent_change: (r) => r.quote?.percent_change ?? null,
    };
    const out: Record<GradedKey, Map<string, number>> = {
      market_cap: new Map(),
      cash: new Map(),
      runway: new Map(),
      percent_change: new Map(),
    };
    (Object.keys(pick) as GradedKey[]).forEach((key) => {
      const dir = GRADE_DIRECTION[key];
      const vals = rows.map((r) => ({ ticker: r.ticker, v: pick[key](r) }));
      // Sort by value — best first, missing last.
      vals.sort((a, b) => {
        if (a.v == null && b.v == null) return 0;
        if (a.v == null) return 1;
        if (b.v == null) return -1;
        return dir === "up" ? b.v - a.v : a.v - b.v;
      });
      vals.forEach((x, i) => out[key].set(x.ticker, i));
    });
    return out;
  }, [rows]);

  // Cohort averages (ignoring missing values).
  const averages = useMemo(() => {
    const avg = (vals: (number | null | undefined)[]) => {
      const clean = vals.filter((v): v is number => v != null);
      if (clean.length === 0) return null;
      return clean.reduce((s, n) => s + n, 0) / clean.length;
    };
    return {
      market_cap: avg(rows.map((r) => r.company?.market_cap_usd)),
      cash: avg(rows.map((r) => r.company?.cash_usd)),
      runway: avg(rows.map((r) => r.company?.runway_months)),
      percent_change: avg(rows.map((r) => r.quote?.percent_change)),
    };
  }, [rows]);

  if (!cohort) {
    return (
      <section className="rounded-lg border border-border-subtle bg-bg-elev/30 p-6">
        <SectionHeader />
        <div className="text-sm text-text-dim py-3">
          No peer cohort defined for{" "}
          <span className="font-mono font-semibold text-text">{ticker}</span>.
          Cohorts currently cover gene editing, mRNA, rare-disease gene therapy,
          and large-cap biotech — more coming soon.
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border-subtle bg-bg-elev/30">
      <div className="px-6 pt-6 pb-4 border-b border-border-subtle">
        <SectionHeader />
        <div className="text-xs text-text-dim mt-1">
          {cohort.label} · {cohort.tickers.length} tickers
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <div className="p-6 text-sm text-text-dim">Loading peers…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-text-dimmer">
                <th className="px-4 py-2.5 text-left font-medium">Ticker</th>
                <th className="px-4 py-2.5 text-left font-medium">Name</th>
                <th className="px-4 py-2.5 text-right font-medium">Price</th>
                <th className="px-4 py-2.5 text-right font-medium">Chg</th>
                <th className="px-4 py-2.5 text-right font-medium">Mkt Cap</th>
                <th className="px-4 py-2.5 text-right font-medium">Cash</th>
                <th className="px-4 py-2.5 text-right font-medium">Runway</th>
                <th className="px-4 py-2.5 text-left font-medium">Health</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <PeerRowView key={r.ticker} row={r} ranks={ranks} total={rows.length} />
              ))}
              <tr className="border-t-2 border-border bg-bg-elev/50">
                <td
                  className="px-4 py-3 text-[11px] text-text-dimmer uppercase tracking-widest font-semibold"
                  colSpan={4}
                >
                  Cohort average
                </td>
                <td className="px-4 py-3 text-right font-mono text-text-dim">
                  {formatUSD(averages.market_cap)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-text-dim">
                  {formatUSD(averages.cash)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-text-dim">
                  {averages.runway != null
                    ? `${Math.round(averages.runway)} mo`
                    : "—"}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="px-6 py-3 border-t border-border-subtle text-[11px] text-text-dimmer">
        Cells tinted green are top-ranked in the cohort, red are worst-ranked.
      </div>
    </section>
  );
}

/* ---------- row ---------- */

function PeerRowView({
  row,
  ranks,
  total,
}: {
  row: PeerRow;
  ranks: Record<GradedKey, Map<string, number>>;
  total: number;
}) {
  const { ticker, isFocus, company, quote } = row;
  const name = company?.name ?? ticker;
  const hasPrice = quote && !quote.error && quote.price != null;
  const changeDir =
    quote?.change == null ? 0 : quote.change > 0 ? 1 : quote.change < 0 ? -1 : 0;

  return (
    <tr
      className={`border-t border-border-subtle transition-colors ${
        isFocus ? "bg-accent-purple/5" : "hover:bg-bg-elev/40"
      }`}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {isFocus && (
            <span className="w-1 h-5 rounded-sm bg-accent-purple" aria-hidden />
          )}
          <Link
            href={`/company/${ticker}`}
            className="font-mono font-semibold text-text hover:text-accent-blue"
          >
            {ticker}
          </Link>
        </div>
      </td>
      <td className="px-4 py-3">
        <Link
          href={`/company/${ticker}`}
          className="text-text-dim hover:text-text line-clamp-1 max-w-[240px]"
        >
          {name}
        </Link>
      </td>
      <td className="px-4 py-3 text-right">
        {hasPrice ? (
          <span className="font-mono">${quote!.price!.toFixed(2)}</span>
        ) : (
          <span className="text-text-dimmer">—</span>
        )}
      </td>
      <td
        className={`px-4 py-3 text-right font-mono text-xs ${cellTint(
          ranks.percent_change.get(ticker),
          total,
        )}`}
      >
        {hasPrice && quote!.percent_change != null ? (
          <span
            className={
              changeDir > 0
                ? "text-accent-green"
                : changeDir < 0
                  ? "text-accent-red"
                  : "text-text-dim"
            }
          >
            {changeDir >= 0 ? "+" : ""}
            {quote!.percent_change!.toFixed(2)}%
          </span>
        ) : (
          <span className="text-text-dimmer">—</span>
        )}
      </td>
      <td
        className={`px-4 py-3 text-right font-mono text-xs ${cellTint(
          ranks.market_cap.get(ticker),
          total,
        )}`}
      >
        {formatUSD(company?.market_cap_usd)}
      </td>
      <td
        className={`px-4 py-3 text-right font-mono text-xs ${cellTint(
          ranks.cash.get(ticker),
          total,
        )}`}
      >
        {formatUSD(company?.cash_usd)}
      </td>
      <td
        className={`px-4 py-3 text-right font-mono text-xs ${cellTint(
          ranks.runway.get(ticker),
          total,
        )}`}
      >
        {company?.runway_months != null
          ? `${company.runway_months} mo`
          : company?.cash_usd != null && company?.quarterly_burn_usd == null
            ? "profitable"
            : "—"}
      </td>
      <td className="px-4 py-3">
        {company?.health ? <HealthDot health={company.health} /> : (
          <span className="text-text-dimmer">—</span>
        )}
      </td>
    </tr>
  );
}

/* ---------- bits ---------- */

function SectionHeader() {
  return (
    <>
      <div className="text-xs font-semibold text-accent-purple tracking-widest uppercase mb-1">
        Peer comparison
      </div>
      <h2 className="text-xl font-bold tracking-tight">Cohort check</h2>
    </>
  );
}

function HealthDot({ health }: { health: string }) {
  const cls: Record<string, string> = {
    strong: "bg-accent-green/15 text-accent-green border-accent-green/30",
    stable: "bg-accent-green/15 text-accent-green border-accent-green/30",
    watch: "bg-accent-amber/15 text-accent-amber border-accent-amber/30",
    risk: "bg-accent-red/15 text-accent-red border-accent-red/30",
  };
  const style = cls[health] ?? cls.stable;
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${style}`}
    >
      {health}
    </span>
  );
}

/**
 * Pick a background tint based on rank in the cohort. Rank 0 is best →
 * green tint, last rank → red tint, middle → none. Returns a pre-registered
 * Tailwind class string (JIT-safe).
 */
function cellTint(rank: number | undefined, total: number): string {
  if (rank == null || total <= 1) return "";
  if (rank === 0) return "bg-accent-green/10";
  if (rank === total - 1) return "bg-accent-red/10";
  // Second-best and second-worst get softer tints in larger cohorts.
  if (total >= 4) {
    if (rank === 1) return "bg-accent-green/5";
    if (rank === total - 2) return "bg-accent-red/5";
  }
  return "";
}

function formatUSD(n?: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
