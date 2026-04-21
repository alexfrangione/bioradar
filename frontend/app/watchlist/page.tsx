"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  getCompany,
  getQuote,
  type Company,
  type Quote,
} from "@/lib/api";
import { getWatchlist, subscribeWatchlist } from "@/lib/watchlist";
import StarButton from "@/components/StarButton";

type View = "table" | "grid";

// What we load per watched ticker — company fundamentals plus live quote.
// Either can be null if the backend/Twelve Data fails for that ticker, so
// render code must guard.
type Row = {
  ticker: string;
  company: Company | null;
  quote: Quote | null;
};

const VIEW_KEY = "bioradar.watchlist.view";

export default function WatchlistPage() {
  const [mounted, setMounted] = useState(false);
  const [tickers, setTickers] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>("table");

  // Hydrate watchlist + view preference after mount (SSR-safe).
  useEffect(() => {
    setMounted(true);
    setTickers(getWatchlist());
    const saved = window.localStorage.getItem(VIEW_KEY);
    if (saved === "grid" || saved === "table") setView(saved);
    return subscribeWatchlist((next) => setTickers(next));
  }, []);

  // Persist view toggle so switching modes sticks across reloads.
  useEffect(() => {
    if (!mounted) return;
    window.localStorage.setItem(VIEW_KEY, view);
  }, [view, mounted]);

  // Fetch data for any tickers we don't already have loaded. We keep a cache
  // keyed by ticker so adding/removing doesn't re-hit the backend for ones
  // already fetched this session.
  useEffect(() => {
    if (!mounted || tickers.length === 0) {
      setLoading(false);
      return;
    }
    const missing = tickers.filter((t) => !rows[t]);
    if (missing.length === 0) return;

    let cancelled = false;
    setLoading(true);
    (async () => {
      const results = await Promise.all(
        missing.map(async (t) => {
          const [company, quote] = await Promise.all([
            getCompany(t),
            getQuote(t),
          ]);
          return { ticker: t, company, quote } as Row;
        }),
      );
      if (cancelled) return;
      setRows((prev) => {
        const next = { ...prev };
        for (const r of results) next[r.ticker] = r;
        return next;
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tickers, mounted, rows]);

  // Preserve watchlist order (insertion order from localStorage).
  const ordered = useMemo(
    () => tickers.map((t) => rows[t]).filter(Boolean) as Row[],
    [tickers, rows],
  );

  return (
    <main className="min-h-screen">
      {/* Top nav */}
      <nav className="flex items-center justify-between px-8 py-4 border-b border-border-subtle">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-bold tracking-tight"
        >
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-accent-blue to-accent-purple flex items-center justify-center text-bg-app font-bold text-sm">
            B
          </div>
          BioRadar
        </Link>
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="text-text-dim hover:text-text text-[13px]"
          >
            Search
          </Link>
          <Link
            href="/catalysts"
            className="text-text-dim hover:text-text text-[13px]"
          >
            Calendar
          </Link>
        </div>
      </nav>

      {/* Header row */}
      <div className="px-8 py-6 border-b border-border-subtle flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs font-semibold text-accent-amber tracking-widest uppercase mb-1.5">
            Your watchlist
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {mounted ? tickers.length : 0}{" "}
            <span className="text-text-dim font-normal">
              {tickers.length === 1 ? "ticker" : "tickers"}
            </span>
          </h1>
        </div>

        {/* View toggle */}
        {mounted && tickers.length > 0 && (
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setView("table")}
              className={`px-3 py-1.5 text-[12px] font-medium transition-colors ${
                view === "table"
                  ? "bg-bg-elev2 text-text"
                  : "bg-bg-elev text-text-dim hover:text-text"
              }`}
            >
              Table
            </button>
            <button
              type="button"
              onClick={() => setView("grid")}
              className={`px-3 py-1.5 text-[12px] font-medium border-l border-border transition-colors ${
                view === "grid"
                  ? "bg-bg-elev2 text-text"
                  : "bg-bg-elev text-text-dim hover:text-text"
              }`}
            >
              Cards
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      {!mounted ? (
        <div className="px-8 py-10 text-sm text-text-dim">Loading…</div>
      ) : tickers.length === 0 ? (
        <EmptyState />
      ) : view === "table" ? (
        <TableView rows={ordered} loading={loading} pending={tickers.length - ordered.length} />
      ) : (
        <GridView rows={ordered} loading={loading} pending={tickers.length - ordered.length} />
      )}
    </main>
  );
}

/* ---------- empty state ---------- */

function EmptyState() {
  return (
    <div className="px-8 py-24 text-center">
      <div className="inline-flex w-14 h-14 rounded-full bg-accent-amber/10 border border-accent-amber/30 items-center justify-center mb-5">
        <svg
          width={24}
          height={24}
          viewBox="0 0 24 24"
          className="text-accent-amber"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          <polygon points="12 2.5 14.9 9 22 10 16.5 14.8 18 22 12 18 6 22 7.5 14.8 2 10 9.1 9" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold mb-2">No tickers yet</h2>
      <p className="text-text-dim max-w-sm mx-auto mb-6 text-sm">
        Star any company to track it here. Your watchlist lives in this browser
        — no account required.
      </p>
      <Link
        href="/"
        className="inline-block px-5 py-2.5 rounded-md bg-accent-blue text-bg-app font-semibold text-sm"
      >
        Find a company →
      </Link>
    </div>
  );
}

/* ---------- table view ---------- */

function TableView({
  rows,
  loading,
  pending,
}: {
  rows: Row[];
  loading: boolean;
  pending: number;
}) {
  return (
    <div className="px-8 py-6">
      <div className="rounded-lg border border-border-subtle overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-elev text-[11px] uppercase tracking-wider text-text-dimmer">
            <tr>
              <Th>Ticker</Th>
              <Th>Name</Th>
              <Th align="right">Price</Th>
              <Th align="right">Chg</Th>
              <Th align="right">Market Cap</Th>
              <Th align="right">Cash</Th>
              <Th align="right">Runway</Th>
              <Th>Health</Th>
              <Th align="right"></Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <TableRow key={r.ticker} row={r} />
            ))}
            {pending > 0 && loading && (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-3 text-center text-xs text-text-dim"
                >
                  Loading {pending} more…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TableRow({ row }: { row: Row }) {
  const { ticker, company, quote } = row;
  const name = company?.name ?? ticker;
  const hasPrice = quote && !quote.error && quote.price != null;
  const changeDir =
    quote?.change == null ? 0 : quote.change > 0 ? 1 : quote.change < 0 ? -1 : 0;

  return (
    <tr className="border-t border-border-subtle hover:bg-bg-elev/40 transition-colors">
      <Td>
        <Link
          href={`/company/${ticker}`}
          className="font-mono font-semibold text-text hover:text-accent-blue"
        >
          {ticker}
        </Link>
      </Td>
      <Td>
        <Link
          href={`/company/${ticker}`}
          className="text-text-dim hover:text-text line-clamp-1"
        >
          {name}
        </Link>
      </Td>
      <Td align="right">
        {hasPrice ? (
          <span className="font-mono">${quote!.price!.toFixed(2)}</span>
        ) : (
          <span className="text-text-dimmer">—</span>
        )}
      </Td>
      <Td align="right">
        {hasPrice && quote!.percent_change != null ? (
          <span
            className={`font-mono text-xs ${
              changeDir > 0
                ? "text-accent-green"
                : changeDir < 0
                  ? "text-accent-red"
                  : "text-text-dim"
            }`}
          >
            {changeDir >= 0 ? "+" : ""}
            {quote!.percent_change!.toFixed(2)}%
          </span>
        ) : (
          <span className="text-text-dimmer">—</span>
        )}
      </Td>
      <Td align="right">
        <span className="font-mono text-xs">
          {formatUSD(company?.market_cap_usd)}
        </span>
      </Td>
      <Td align="right">
        <span className="font-mono text-xs">
          {formatUSD(company?.cash_usd)}
        </span>
      </Td>
      <Td align="right">
        <span className="font-mono text-xs">
          {company?.runway_months
            ? `${company.runway_months} mo`
            : company?.cash_usd != null
              ? "profitable"
              : "—"}
        </span>
      </Td>
      <Td>
        {company?.health ? (
          <HealthDot health={company.health} />
        ) : (
          <span className="text-text-dimmer">—</span>
        )}
      </Td>
      <Td align="right">
        <div className="flex justify-end">
          <StarButton ticker={ticker} size="sm" />
        </div>
      </Td>
    </tr>
  );
}

function Th({
  children,
  align = "left",
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-4 py-2.5 font-medium ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      className={`px-4 py-2.5 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </td>
  );
}

/* ---------- grid view ---------- */

function GridView({
  rows,
  loading,
  pending,
}: {
  rows: Row[];
  loading: boolean;
  pending: number;
}) {
  return (
    <div className="px-8 py-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {rows.map((r) => (
          <Card key={r.ticker} row={r} />
        ))}
        {pending > 0 && loading && (
          <div className="col-span-full text-center text-xs text-text-dim py-3">
            Loading {pending} more…
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ row }: { row: Row }) {
  const { ticker, company, quote } = row;
  const name = company?.name ?? ticker;
  const hasPrice = quote && !quote.error && quote.price != null;
  const changeDir =
    quote?.change == null ? 0 : quote.change > 0 ? 1 : quote.change < 0 ? -1 : 0;

  return (
    <div className="relative rounded-lg border border-border-subtle bg-bg-elev/40 p-4 hover:border-border hover:bg-bg-elev/70 transition-colors">
      {/* Star positioned over the card for quick removal. */}
      <div className="absolute top-3 right-3">
        <StarButton ticker={ticker} size="sm" />
      </div>

      <Link href={`/company/${ticker}`} className="block">
        <div className="flex items-center gap-2.5 mb-3 pr-9">
          <div className="w-8 h-8 rounded-md bg-gradient-to-br from-[#2d4a7c] to-[#1f3356] flex items-center justify-center font-bold text-[#c5d7f2] text-[11px]">
            {ticker}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-sm leading-tight line-clamp-1">
              {name}
            </div>
            <div className="text-[11px] text-text-dimmer font-mono">
              {company?.exchange ?? "—"}
            </div>
          </div>
        </div>

        <div className="flex items-baseline gap-2 mb-3">
          {hasPrice ? (
            <>
              <span className="font-mono text-lg font-bold">
                ${quote!.price!.toFixed(2)}
              </span>
              {quote!.percent_change != null && (
                <span
                  className={`font-mono text-xs font-semibold ${
                    changeDir > 0
                      ? "text-accent-green"
                      : changeDir < 0
                        ? "text-accent-red"
                        : "text-text-dim"
                  }`}
                >
                  {changeDir >= 0 ? "+" : ""}
                  {quote!.percent_change!.toFixed(2)}%
                </span>
              )}
            </>
          ) : (
            <span className="text-text-dimmer text-sm">Price unavailable</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-[11px]">
          <Stat label="Mkt Cap" value={formatUSD(company?.market_cap_usd)} />
          <Stat label="Cash" value={formatUSD(company?.cash_usd)} />
          <Stat
            label="Runway"
            value={
              company?.runway_months
                ? `${company.runway_months} mo`
                : company?.cash_usd != null
                  ? "profitable"
                  : "—"
            }
          />
          <Stat
            label="Health"
            valueSlot={
              company?.health ? (
                <HealthDot health={company.health} />
              ) : undefined
            }
            value="—"
          />
        </div>
      </Link>
    </div>
  );
}

function Stat({
  label,
  value,
  valueSlot,
}: {
  label: string;
  value: string;
  valueSlot?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-text-dimmer uppercase tracking-wider">{label}</span>
      {valueSlot ?? <span className="font-mono text-text">{value}</span>}
    </div>
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

/* ---------- formatters ---------- */

function formatUSD(n?: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n}`;
}

