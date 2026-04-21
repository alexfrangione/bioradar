"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  getCatalysts,
  getEarnings,
  type CatalystEvent,
  type CatalystType,
  type EarningsEvent,
} from "@/lib/api";
import { getWatchlist, subscribeWatchlist } from "@/lib/watchlist";

// A single unified row that renders in the timeline. We normalise both
// catalyst and earnings events to this shape so one list can sort/filter
// across them cleanly.
type TimelineEvent = {
  ticker: string;
  date: string; // YYYY-MM-DD
  title: string;
  type: CatalystType | "earnings";
  impact: "high" | "medium" | "low";
  past: boolean;
  summary?: string;
};

type Filter = "all" | "readout" | "fda" | "earnings" | "other";

const FILTER_LABELS: Record<Filter, string> = {
  all: "All",
  readout: "Readouts",
  fda: "FDA",
  earnings: "Earnings",
  other: "Other",
};

// Bucket raw event type → filter bucket. Readout buckets collapse positive/
// negative/unknown together; FDA covers approvals, AdComs, and filings.
function bucketOf(t: TimelineEvent["type"]): Filter {
  if (t === "earnings") return "earnings";
  if (t === "approval" || t === "fda-advisory" || t === "filing") return "fda";
  if (t === "readout" || t === "readout-positive" || t === "readout-negative" || t === "failure")
    return "readout";
  return "other";
}

export default function CatalystsPage() {
  const [mounted, setMounted] = useState(false);
  const [tickers, setTickers] = useState<string[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [showPast, setShowPast] = useState(false);

  // Hydrate watchlist once mounted; subscribe so stars on other tabs refresh.
  useEffect(() => {
    setMounted(true);
    setTickers(getWatchlist());
    return subscribeWatchlist((next) => setTickers(next));
  }, []);

  // Fan-out fetch. We always refetch on watchlist change — catalyst data is
  // cheap and the list is usually small. No per-ticker cache needed.
  useEffect(() => {
    if (!mounted) return;
    if (tickers.length === 0) {
      setEvents([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const perTicker = await Promise.all(
        tickers.map(async (t) => {
          const [cat, earn] = await Promise.all([getCatalysts(t), getEarnings(t)]);
          const catalystEvents: TimelineEvent[] = (cat?.events ?? []).map(
            (e: CatalystEvent) => ({
              ticker: t,
              date: e.date,
              title: e.title,
              type: e.type,
              impact: e.impact,
              past: e.past,
              summary: e.summary,
            }),
          );
          const earningsEvents: TimelineEvent[] = (earn?.events ?? []).map(
            (e: EarningsEvent) => ({
              ticker: t,
              date: e.date,
              title: `Earnings — ${e.period}`,
              type: "earnings",
              impact: "medium",
              past: e.past,
            }),
          );
          return [...catalystEvents, ...earningsEvents];
        }),
      );
      if (cancelled) return;
      const flat = perTicker.flat();
      flat.sort((a, b) => a.date.localeCompare(b.date));
      setEvents(flat);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tickers, mounted]);

  // Apply filter + past toggle. Counts for the filter chips reflect the
  // current past/future view so the number on the chip matches what you see.
  const visible = useMemo(() => {
    const base = showPast ? events : events.filter((e) => !e.past);
    return filter === "all" ? base : base.filter((e) => bucketOf(e.type) === filter);
  }, [events, filter, showPast]);

  const counts = useMemo(() => {
    const base = showPast ? events : events.filter((e) => !e.past);
    const c: Record<Filter, number> = { all: base.length, readout: 0, fda: 0, earnings: 0, other: 0 };
    for (const e of base) c[bucketOf(e.type)]++;
    return c;
  }, [events, showPast]);

  // Group by "YYYY-MM" so section headers stay chronological even when months
  // span across years.
  const grouped = useMemo(() => {
    const g = new Map<string, TimelineEvent[]>();
    for (const e of visible) {
      const key = e.date.slice(0, 7);
      if (!g.has(key)) g.set(key, []);
      g.get(key)!.push(e);
    }
    return Array.from(g.entries());
  }, [visible]);

  const pastCount = events.filter((e) => e.past).length;

  return (
    <main className="min-h-screen">
      <nav className="flex items-center justify-between px-8 py-4 border-b border-border-subtle">
        <Link href="/" className="flex items-center gap-2.5 font-bold tracking-tight">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-accent-blue to-accent-purple flex items-center justify-center text-bg-app font-bold text-sm">
            B
          </div>
          BioRadar
        </Link>
        <div className="flex items-center gap-6">
          <Link href="/" className="text-text-dim hover:text-text text-[13px]">
            Search
          </Link>
          <Link href="/watchlist" className="text-text-dim hover:text-text text-[13px]">
            Watchlist
          </Link>
        </div>
      </nav>

      {/* Header */}
      <div className="px-8 py-6 border-b border-border-subtle">
        <div className="text-xs font-semibold text-accent-blue tracking-widest uppercase mb-1.5">
          Catalyst calendar
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          {mounted && !loading ? visible.length : 0}{" "}
          <span className="text-text-dim font-normal">
            {visible.length === 1 ? "event" : "events"}
          </span>
          {mounted && tickers.length > 0 && (
            <span className="text-text-dimmer font-normal text-base ml-2">
              across {tickers.length} {tickers.length === 1 ? "ticker" : "tickers"}
            </span>
          )}
        </h1>
      </div>

      {/* Body */}
      {!mounted ? (
        <div className="px-8 py-10 text-sm text-text-dim">Loading…</div>
      ) : tickers.length === 0 ? (
        <EmptyState kind="no-watchlist" />
      ) : (
        <div className="px-8 py-6">
          {/* Filter controls */}
          <div className="flex items-center gap-2 flex-wrap mb-6">
            {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => {
              const active = filter === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${
                    active
                      ? "bg-accent-blue text-bg-app border-accent-blue"
                      : "bg-bg-elev text-text-dim border-border-subtle hover:text-text hover:border-border"
                  }`}
                >
                  {FILTER_LABELS[f]}{" "}
                  <span
                    className={`font-mono text-[11px] ${
                      active ? "opacity-80" : "text-text-dimmer"
                    }`}
                  >
                    {counts[f]}
                  </span>
                </button>
              );
            })}

            <div className="flex-1" />

            {pastCount > 0 && (
              <button
                type="button"
                onClick={() => setShowPast((v) => !v)}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors ${
                  showPast
                    ? "bg-bg-elev2 text-text border-border"
                    : "bg-bg-elev text-text-dim border-border-subtle hover:text-text"
                }`}
              >
                {showPast ? "Hide" : "Show"} past{" "}
                <span className="font-mono text-[11px] text-text-dimmer">({pastCount})</span>
              </button>
            )}
          </div>

          {loading && events.length === 0 ? (
            <div className="text-sm text-text-dim py-10">Loading calendar…</div>
          ) : grouped.length === 0 ? (
            <EmptyState kind="no-events" />
          ) : (
            <div className="space-y-8">
              {grouped.map(([monthKey, items]) => (
                <MonthSection key={monthKey} monthKey={monthKey} items={items} />
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

/* ---------- month section ---------- */

function MonthSection({
  monthKey,
  items,
}: {
  monthKey: string;
  items: TimelineEvent[];
}) {
  // monthKey is "YYYY-MM". Build a local Date on the 1st to get the label;
  // parse from YYYY-MM-01 so it renders stably regardless of TZ.
  const label = useMemo(() => {
    const [y, m] = monthKey.split("-").map(Number);
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }, [monthKey]);

  return (
    <section>
      <div className="flex items-baseline justify-between border-b border-border-subtle pb-2 mb-3">
        <h2 className="text-[11px] font-semibold text-text-dim uppercase tracking-widest">
          {label}
        </h2>
        <span className="font-mono text-[11px] text-text-dimmer">
          {items.length} {items.length === 1 ? "event" : "events"}
        </span>
      </div>
      <div className="flex flex-col">
        {items.map((e, i) => (
          <EventRow key={`${e.ticker}-${e.date}-${i}`} event={e} />
        ))}
      </div>
    </section>
  );
}

/* ---------- event row ---------- */

function EventRow({ event }: { event: TimelineEvent }) {
  const dayLabel = useMemo(() => {
    const [y, m, d] = event.date.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return {
      day: String(d).padStart(2, "0"),
      weekday: dt.toLocaleDateString(undefined, { weekday: "short" }),
    };
  }, [event.date]);

  return (
    <Link
      href={`/company/${event.ticker}`}
      className={`group flex items-center gap-4 py-3 border-b border-border-subtle/60 last:border-b-0 hover:bg-bg-elev/40 transition-colors -mx-2 px-2 rounded ${
        event.past ? "opacity-60" : ""
      }`}
    >
      {/* Date column (fixed width for alignment) */}
      <div className="w-14 flex-shrink-0 text-right">
        <div className="font-mono font-semibold text-text leading-none">
          {dayLabel.day}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-text-dimmer mt-1">
          {dayLabel.weekday}
        </div>
      </div>

      {/* Dot */}
      <TypeDot type={event.type} />

      {/* Ticker */}
      <div className="w-20 flex-shrink-0">
        <span className="font-mono font-semibold text-sm text-text group-hover:text-accent-blue">
          {event.ticker}
        </span>
      </div>

      {/* Title */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text leading-snug line-clamp-1">
          {event.title}
        </div>
        {event.summary && (
          <div className="text-[12px] text-text-dim line-clamp-1 mt-0.5">
            {event.summary}
          </div>
        )}
      </div>

      {/* Type pill + impact */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <TypePill type={event.type} />
        {!event.past && event.impact === "high" && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-accent-red/15 text-accent-red border border-accent-red/30">
            High
          </span>
        )}
      </div>
    </Link>
  );
}

/* ---------- type indicators ---------- */

// Explicit class strings — Tailwind's JIT can't see dynamic template-string
// class names, so we keep `bg-*` and `text-*` as complete strings here.
type TypeStyle = { dot: string; text: string };
const TYPE_STYLE: Record<TimelineEvent["type"], TypeStyle> = {
  "approval": { dot: "bg-accent-green", text: "text-accent-green" },
  "readout-positive": { dot: "bg-accent-green", text: "text-accent-green" },
  "readout": { dot: "bg-accent-blue", text: "text-accent-blue" },
  "readout-negative": { dot: "bg-accent-red", text: "text-accent-red" },
  "failure": { dot: "bg-accent-red", text: "text-accent-red" },
  "fda-advisory": { dot: "bg-accent-purple", text: "text-accent-purple" },
  "launch": { dot: "bg-accent-green", text: "text-accent-green" },
  "filing": { dot: "bg-accent-amber", text: "text-accent-amber" },
  "licensing": { dot: "bg-accent-blue", text: "text-accent-blue" },
  "earnings": { dot: "bg-text-dim", text: "text-text-dim" },
  "other": { dot: "bg-text-dim", text: "text-text-dim" },
};

const TYPE_LABEL: Record<TimelineEvent["type"], string> = {
  "approval": "Approval",
  "readout-positive": "Readout +",
  "readout": "Readout",
  "readout-negative": "Readout −",
  "failure": "Failure",
  "fda-advisory": "FDA AdCom",
  "launch": "Launch",
  "filing": "Filing",
  "licensing": "Licensing",
  "earnings": "Earnings",
  "other": "Other",
};

function TypeDot({ type }: { type: TimelineEvent["type"] }) {
  const style = TYPE_STYLE[type] ?? TYPE_STYLE.other;
  return (
    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${style.dot}`} />
  );
}

function TypePill({ type }: { type: TimelineEvent["type"] }) {
  const style = TYPE_STYLE[type] ?? TYPE_STYLE.other;
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider border border-border-subtle bg-bg-elev ${style.text}`}
    >
      {TYPE_LABEL[type] ?? type}
    </span>
  );
}

/* ---------- empty states ---------- */

function EmptyState({ kind }: { kind: "no-watchlist" | "no-events" }) {
  if (kind === "no-watchlist") {
    return (
      <div className="px-8 py-24 text-center">
        <div className="inline-flex w-14 h-14 rounded-full bg-accent-blue/10 border border-accent-blue/30 items-center justify-center mb-5">
          <svg
            width={24}
            height={24}
            viewBox="0 0 24 24"
            className="text-accent-blue"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinejoin="round"
            strokeLinecap="round"
          >
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 9h18M8 3v4M16 3v4" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold mb-2">Calendar is empty</h2>
        <p className="text-text-dim max-w-sm mx-auto mb-6 text-sm">
          Add companies to your watchlist to see their catalysts, FDA dates, and
          earnings on one timeline.
        </p>
        <div className="flex gap-3 justify-center">
          <Link
            href="/"
            className="px-5 py-2.5 rounded-md bg-accent-blue text-bg-app font-semibold text-sm"
          >
            Find a company →
          </Link>
          <Link
            href="/watchlist"
            className="px-5 py-2.5 rounded-md bg-bg-elev border border-border text-text font-semibold text-sm hover:bg-bg-elev2"
          >
            Open watchlist
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="px-8 py-16 text-center">
      <p className="text-text-dim text-sm">
        No events match the current filter.
      </p>
    </div>
  );
}
