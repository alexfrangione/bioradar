"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  getCatalysts,
  getEarnings,
  type CatalystEvent,
  type CatalystSource,
  type CatalystType,
  type EarningsEvent,
} from "@/lib/api";
import { getWatchlist, subscribeWatchlist } from "@/lib/watchlist";
import Brand from "@/components/Brand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// A single unified row that renders in the calendar. We normalise both
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
  source?: CatalystSource | "earnings";
};

type Scope = "week" | "month" | "quarter";
type Universe = "popular" | "watchlist";
type Tier = "a" | "b" | "c" | "d";

const SCOPE_DAYS: Record<Scope, number> = {
  week: 7,
  month: 31,
  quarter: 93,
};

const SCOPE_LABEL: Record<Scope, string> = {
  week: "This week",
  month: "This month",
  quarter: "This quarter",
};

// Curated universe for the default "Popular biotech" view so the calendar is
// useful out-of-the-box — no empty state for first-time visitors. Covers the
// liquid mid/large-cap biotechs with the most catalyst density. The watchlist
// view still shows whatever the user has starred.
const POPULAR_TICKERS = [
  "MRNA",
  "VRTX",
  "CRSP",
  "BEAM",
  "SRPT",
  "NTLA",
  "REGN",
  "BNTX",
  "EDIT",
  "BIIB",
  "ALNY",
  "MDGL",
  "ARWR",
  "INSM",
  "GILD",
];

// ---------------------------------------------------------------------------
// Tiering
//
// The tier assignment is the editorial layer — what "really matters" this
// week vs what's routine background. Rules:
//   Tier A — high-impact FDA or pivotal readouts (cards w/ blurbs)
//   Tier B — other clinical readouts (medium tiles)
//   Tier C — earnings (chips)
//   Tier D — everything else (filings, licensing, low-impact items)
// ---------------------------------------------------------------------------

const TIER_A_TYPES = new Set<TimelineEvent["type"]>([
  "approval",
  "fda-advisory",
]);

const READOUT_TYPES = new Set<TimelineEvent["type"]>([
  "readout",
  "readout-positive",
  "readout-negative",
  "failure",
]);

function tierOf(e: TimelineEvent): Tier {
  if (e.type === "earnings") return "c";
  if (TIER_A_TYPES.has(e.type) && e.impact === "high") return "a";
  // High-impact readouts are also tier-A (think Ph3 primary endpoint reads).
  if (READOUT_TYPES.has(e.type) && e.impact === "high") return "a";
  if (READOUT_TYPES.has(e.type)) return "b";
  return "d";
}

// ---------------------------------------------------------------------------
// Type styling
// ---------------------------------------------------------------------------

type Palette = "amber" | "blue" | "purple" | "green" | "red" | "dim";

function paletteOf(t: TimelineEvent["type"]): Palette {
  switch (t) {
    case "approval":
    case "readout-positive":
    case "launch":
      return "green";
    case "readout-negative":
    case "failure":
      return "red";
    case "fda-advisory":
      return "blue";
    case "readout":
      return "purple";
    case "filing":
      return "amber";
    case "licensing":
      return "blue";
    case "earnings":
      return "green";
    default:
      return "dim";
  }
}

const TYPE_LABEL: Record<TimelineEvent["type"], string> = {
  approval: "Approval",
  "readout-positive": "Readout +",
  readout: "Readout",
  "readout-negative": "Readout −",
  failure: "Failure",
  "fda-advisory": "AdCom",
  launch: "Launch",
  filing: "Filing",
  licensing: "Licensing",
  earnings: "Earnings",
  other: "Other",
};

// Explicit class maps so Tailwind JIT can see every string.
const DOT_CLASS: Record<Palette, string> = {
  amber: "bg-accent-amber",
  blue: "bg-accent-blue",
  purple: "bg-accent-purple",
  green: "bg-accent-green",
  red: "bg-accent-red",
  dim: "bg-text-dim",
};
const TEXT_CLASS: Record<Palette, string> = {
  amber: "text-accent-amber",
  blue: "text-accent-blue",
  purple: "text-accent-purple",
  green: "text-accent-green",
  red: "text-accent-red",
  dim: "text-text-dim",
};
const BORDER_CLASS: Record<Palette, string> = {
  amber: "border-accent-amber",
  blue: "border-accent-blue",
  purple: "border-accent-purple",
  green: "border-accent-green",
  red: "border-accent-red",
  dim: "border-border",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CatalystsPage() {
  const [mounted, setMounted] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<Scope>("week");
  const [universe, setUniverse] = useState<Universe>("popular");

  // Hydrate watchlist once mounted; subscribe so stars on other tabs refresh.
  useEffect(() => {
    setMounted(true);
    setWatchlist(getWatchlist());
    return subscribeWatchlist((next) => setWatchlist(next));
  }, []);

  // Resolve universe → tickers. Popular is a curated constant so the page
  // always has content; watchlist reflects whatever the user has starred.
  const tickers = useMemo(
    () => (universe === "popular" ? POPULAR_TICKERS : watchlist),
    [universe, watchlist],
  );

  // Fan-out fetch across every ticker in the active universe. We refetch
  // when the set changes — data is cheap and the list is small.
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
          const [cat, earn] = await Promise.all([
            getCatalysts(t),
            getEarnings(t),
          ]);
          const catalystEvents: TimelineEvent[] = (cat?.events ?? []).map(
            (e: CatalystEvent) => ({
              ticker: t,
              date: e.date,
              title: e.title,
              type: e.type,
              impact: e.impact,
              past: e.past,
              summary: e.summary,
              source: e.source,
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
              source: "earnings",
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

  // Apply scope filter. We clip past events and anything beyond the scope
  // window; the glance counts and tier sections all operate on this list.
  const visible = useMemo(() => {
    const horizonDays = SCOPE_DAYS[scope];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + horizonDays);
    return events.filter((e) => {
      if (e.past) return false;
      const [y, m, d] = e.date.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      return dt >= today && dt <= horizon;
    });
  }, [events, scope]);

  // Split into tiers.
  const tiered = useMemo(() => {
    const buckets: Record<Tier, TimelineEvent[]> = { a: [], b: [], c: [], d: [] };
    for (const e of visible) buckets[tierOf(e)].push(e);
    return buckets;
  }, [visible]);

  // Glance-strip counts — by category rather than tier, so the user sees the
  // mix at a glance (matches legend order).
  const counts = useMemo(() => {
    const c = { pdufa: 0, adcom: 0, readout: 0, earnings: 0 };
    for (const e of visible) {
      if (e.type === "earnings") c.earnings++;
      else if (e.type === "approval") c.pdufa++;
      else if (e.type === "fda-advisory") c.adcom++;
      else if (READOUT_TYPES.has(e.type)) c.readout++;
    }
    return c;
  }, [visible]);

  const dateRange = useMemo(() => {
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + SCOPE_DAYS[scope]);
    const fmt = (d: Date) =>
      d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${fmt(start)} – ${fmt(end)}, ${end.getFullYear()}`;
  }, [scope]);

  return (
    <main className="min-h-screen">
      {/* ==================== NAV ==================== */}
      <nav className="flex items-center justify-between px-8 py-4 border-b border-border-subtle">
        <Link href="/" className="inline-flex">
          <Brand size="nav" />
        </Link>
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="text-text-dim hover:text-text text-[13px] font-medium"
          >
            Search
          </Link>
          <Link
            href="/watchlist"
            className="text-text-dim hover:text-text text-[13px] font-medium"
          >
            Watchlist
          </Link>
        </div>
      </nav>

      <div className="max-w-[1200px] mx-auto px-8 pt-9 pb-20">
        {/* ==================== HEADER ==================== */}
        <div className="flex items-end justify-between mb-7 pb-5 border-b border-border-subtle gap-6 flex-wrap">
          <div>
            <h1 className="text-[32px] font-bold tracking-[-0.02em] mb-1.5">
              Catalysts
            </h1>
            <p className="text-text-dim text-sm leading-relaxed m-0">
              {mounted && !loading ? (
                <>
                  <span className="text-accent-green font-medium">
                    {visible.length}{" "}
                    {visible.length === 1 ? "event" : "events"}
                  </span>{" "}
                  {tickers.length > 0 && (
                    <>
                      across {tickers.length}{" "}
                      {tickers.length === 1 ? "ticker" : "tickers"}
                      {universe === "popular" ? " (popular biotech)" : ""} ·{" "}
                    </>
                  )}
                  {dateRange}
                </>
              ) : (
                "Loading…"
              )}
            </p>
          </div>

          <div className="flex gap-2 items-center flex-wrap">
            <ToggleGroup<Universe>
              value={universe}
              onChange={setUniverse}
              options={[
                { v: "popular", label: "Popular biotech" },
                { v: "watchlist", label: "My watchlist" },
              ]}
            />
            <ToggleGroup<Scope>
              value={scope}
              onChange={setScope}
              options={[
                { v: "week", label: "Week" },
                { v: "month", label: "Month" },
                { v: "quarter", label: "Quarter" },
              ]}
            />
          </div>
        </div>

        {/* ==================== BODY ==================== */}
        {!mounted ? null : universe === "watchlist" && watchlist.length === 0 ? (
          <EmptyState kind="no-watchlist" />
        ) : loading && events.length === 0 ? (
          <div className="text-sm text-text-dim py-10">Loading calendar…</div>
        ) : visible.length === 0 ? (
          <EmptyState kind="no-events" scope={scope} />
        ) : (
          <>
            {/* Glance strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-7">
              <GlanceCard label="PDUFA" value={counts.pdufa} palette="amber" />
              <GlanceCard label="AdCom" value={counts.adcom} palette="blue" />
              <GlanceCard
                label="Readouts"
                value={counts.readout}
                palette="purple"
              />
              <GlanceCard
                label="Earnings"
                value={counts.earnings}
                palette="green"
              />
            </div>

            {/* Legend bar */}
            <div className="flex items-center justify-between mb-5">
              <div className="font-mono text-[11px] text-text-dim uppercase tracking-[0.14em]">
                Ranked by expected market impact
              </div>
              <Legend />
            </div>

            {/* Tiers */}
            <div className="grid gap-7">
              {tiered.a.length > 0 && (
                <TierSection
                  label="High impact"
                  labelPalette="amber"
                  count={tiered.a.length}
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {tiered.a.map((e, i) => (
                      <TierACard key={`${e.ticker}-${e.date}-${i}`} event={e} />
                    ))}
                  </div>
                </TierSection>
              )}

              {tiered.b.length > 0 && (
                <TierSection
                  label="Clinical readouts"
                  labelPalette="purple"
                  count={tiered.b.length}
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {tiered.b.map((e, i) => (
                      <TierBCard key={`${e.ticker}-${e.date}-${i}`} event={e} />
                    ))}
                  </div>
                </TierSection>
              )}

              {tiered.c.length > 0 && (
                <TierSection
                  label="Earnings"
                  labelPalette="green"
                  count={tiered.c.length}
                >
                  <div className="flex flex-wrap gap-2">
                    {tiered.c.map((e, i) => (
                      <TierChip
                        key={`${e.ticker}-${e.date}-${i}`}
                        event={e}
                        palette="green"
                      />
                    ))}
                  </div>
                </TierSection>
              )}

              {tiered.d.length > 0 && (
                <TierSection
                  label="Also this week"
                  labelPalette="dim"
                  count={tiered.d.length}
                >
                  <div className="flex flex-wrap gap-2">
                    {tiered.d.map((e, i) => (
                      <TierChip
                        key={`${e.ticker}-${e.date}-${i}`}
                        event={e}
                        palette={paletteOf(e.type)}
                      />
                    ))}
                  </div>
                </TierSection>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function ToggleGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { v: T; label: string }[];
}) {
  return (
    <div className="inline-flex bg-bg-elev border border-border rounded-lg overflow-hidden">
      {options.map((o, i) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`px-3.5 py-1.5 text-[12.5px] font-medium border-r border-border-subtle last:border-r-0 transition-colors ${
            o.v === value
              ? "bg-bg-elev2 text-text"
              : "text-text-dim hover:text-text"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex gap-3.5 font-mono text-[10px] text-text-dim tracking-[0.06em]">
      <LegendItem label="PDUFA" palette="amber" />
      <LegendItem label="AdCom" palette="blue" />
      <LegendItem label="Readout" palette="purple" />
      <LegendItem label="Earnings" palette="green" />
    </div>
  );
}

function LegendItem({ label, palette }: { label: string; palette: Palette }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block w-[7px] h-[7px] rounded-sm ${DOT_CLASS[palette]}`} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Glance card
// ---------------------------------------------------------------------------

function GlanceCard({
  label,
  value,
  palette,
}: {
  label: string;
  value: number;
  palette: Palette;
}) {
  return (
    <div className="bg-bg-elev border border-border-subtle rounded-[10px] px-4 py-3.5 grid gap-1">
      <div className="font-mono text-[10px] text-text-dim uppercase tracking-[0.12em]">
        {label}
      </div>
      <div
        className={`font-mono font-semibold text-[26px] tracking-[-0.01em] tabular-nums ${TEXT_CLASS[palette]}`}
      >
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tier section shell
// ---------------------------------------------------------------------------

function TierSection({
  label,
  labelPalette,
  count,
  children,
}: {
  label: string;
  labelPalette: Palette;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-3 mb-3 font-mono text-[11px] uppercase tracking-[0.14em]">
        <span
          className={`font-semibold ${labelPalette === "dim" ? "text-text-dim" : TEXT_CLASS[labelPalette]}`}
        >
          {label}
        </span>
        <span className="bg-bg-elev2 text-text px-2 py-[1px] rounded text-[10px] tracking-[0.06em]">
          {count}
        </span>
        <span className="flex-1 h-px bg-border-subtle" />
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tier A card — full editorial card
// ---------------------------------------------------------------------------

function TierACard({ event }: { event: TimelineEvent }) {
  const palette = paletteOf(event.type);
  const when = formatWhen(event.date);
  const daysOut = daysFromToday(event.date);

  return (
    <Link
      href={`/company/${event.ticker}`}
      className="group relative bg-bg-elev border border-border-subtle rounded-xl p-5 grid gap-3 overflow-hidden hover:border-border transition-colors"
    >
      <span
        className={`absolute left-0 top-0 bottom-0 w-[3px] ${DOT_CLASS[palette]}`}
      />
      <div className="flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.1em]">
        <span className={`${TEXT_CLASS[palette]} font-medium`}>
          {TYPE_LABEL[event.type]}
        </span>
        <span className="text-text-dim">{when.full}</span>
        <span className="ml-auto text-text-dimmer">
          {daysOut >= 0 ? `in ${daysOut}d` : `${Math.abs(daysOut)}d ago`}
        </span>
      </div>
      <div className="flex items-baseline gap-2.5">
        <span className="font-mono font-semibold text-[26px] text-text group-hover:text-accent-green transition-colors">
          {event.ticker}
        </span>
      </div>
      <div className="text-[16px] font-medium text-text leading-snug">
        {event.title}
      </div>
      {event.summary && (
        <div className="text-[13px] text-text-dim leading-relaxed">
          {event.summary}
        </div>
      )}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Tier B card — medium tile for readouts
// ---------------------------------------------------------------------------

function TierBCard({ event }: { event: TimelineEvent }) {
  const palette = paletteOf(event.type);
  const when = formatWhen(event.date);

  return (
    <Link
      href={`/company/${event.ticker}`}
      className={`block bg-bg-elev rounded-lg px-4 py-3.5 border-l-[3px] ${BORDER_CLASS[palette]} hover:bg-bg-elev2 transition-colors`}
    >
      <div className="flex justify-between font-mono text-[10px] text-text-dim uppercase tracking-[0.08em] mb-1.5">
        <span>{TYPE_LABEL[event.type]}</span>
        <span>{when.short}</span>
      </div>
      <div className="flex items-baseline gap-2.5 mb-1">
        <span className="font-mono font-semibold text-[15px] text-text">
          {event.ticker}
        </span>
      </div>
      <div className="text-text-dim text-[13px] leading-snug line-clamp-2">
        {event.title}
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Tier chip — compact chip for earnings + "also this week"
// ---------------------------------------------------------------------------

function TierChip({
  event,
  palette,
}: {
  event: TimelineEvent;
  palette: Palette;
}) {
  const when = formatWhen(event.date);
  return (
    <Link
      href={`/company/${event.ticker}`}
      className={`inline-flex items-baseline gap-2 bg-bg-elev border border-border-subtle border-l-[3px] ${BORDER_CLASS[palette]} rounded-full pl-3 pr-3.5 py-1.5 text-[13px] hover:bg-bg-elev2 transition-colors`}
    >
      <span className="font-mono font-semibold text-text">{event.ticker}</span>
      <span className="font-mono text-[10px] text-text-dim uppercase tracking-[0.08em]">
        {when.short}
        {event.type !== "earnings" && (
          <> · {TYPE_LABEL[event.type]}</>
        )}
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function formatWhen(isoDate: string): { full: string; short: string } {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const weekday = dt.toLocaleDateString(undefined, { weekday: "short" });
  const short = dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return {
    full: `${weekday} · ${short}`,
    short: `${weekday} ${d}`,
  };
}

function daysFromToday(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = target.getTime() - today.getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

function EmptyState({
  kind,
  scope,
}: {
  kind: "no-watchlist" | "no-events";
  scope?: Scope;
}) {
  if (kind === "no-watchlist") {
    return (
      <div className="py-24 text-center">
        <div className="inline-flex w-14 h-14 rounded-full bg-accent-green/10 border border-accent-green/30 items-center justify-center mb-5">
          <svg
            width={24}
            height={24}
            viewBox="0 0 24 24"
            className="text-accent-green"
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
          Add companies to your watchlist to see their catalysts, FDA dates,
          and earnings ranked by market impact.
        </p>
        <div className="flex gap-3 justify-center">
          <Link
            href="/"
            className="px-5 py-2.5 rounded-md bg-accent-green text-bg-page font-semibold text-sm"
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
    <div className="py-16 text-center">
      <p className="text-text-dim text-sm">
        No events {scope ? `in ${SCOPE_LABEL[scope].toLowerCase()}` : ""}.
        Try widening the window.
      </p>
    </div>
  );
}
