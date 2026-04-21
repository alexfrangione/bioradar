"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getCatalysts,
  getEarnings,
  getPipeline,
  getPrices,
  type CatalystEvent,
  type CatalystType,
  type EarningsEvent,
  type PricePoint,
  type Trial,
} from "@/lib/api";

type Props = {
  ticker: string;
};

const PERIODS: { label: string; value: string }[] = [
  { label: "6M", value: "6mo" },
  { label: "1Y", value: "1y" },
  { label: "2Y", value: "2y" },
  { label: "5Y", value: "5y" },
];

const CHART_HEIGHT = 440;

// ---------------------------------------------------------------------------
// Feed row — unified "kind" so catalysts and earnings live in the same list
// ---------------------------------------------------------------------------
type FeedItem =
  | { kind: "catalyst"; date: string; event: CatalystEvent }
  | { kind: "earnings"; date: string; event: EarningsEvent };

export default function StockChart({ ticker }: Props) {
  const [period, setPeriod] = useState("2y");
  const [prices, setPrices] = useState<PricePoint[]>([]);
  const [catalysts, setCatalysts] = useState<CatalystEvent[]>([]);
  const [earnings, setEarnings] = useState<EarningsEvent[]>([]);
  const [trials, setTrials] = useState<Trial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      getPrices(ticker, period),
      getCatalysts(ticker),
      getEarnings(ticker),
      getPipeline(ticker),
    ])
      .then(([p, c, e, pl]) => {
        if (cancelled) return;
        if (!p) {
          setError("Couldn't load price data.");
          setPrices([]);
        } else {
          setPrices(p.points);
        }
        setCatalysts(c?.events ?? []);
        setEarnings(e?.events ?? []);
        setTrials(pl?.trials ?? []);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [ticker, period]);

  const firstDate = prices.length > 0 ? prices[0].date : null;
  const lastDate = prices.length > 0 ? prices[prices.length - 1].date : null;

  // Lookup: trading-date -> close. For catalyst dots we snap to the nearest
  // trading day on or before the event date (markets are closed on weekends).
  const priceByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of prices) m.set(p.date, p.close);
    return m;
  }, [prices]);

  const sortedDates = useMemo(() => prices.map((p) => p.date), [prices]);

  function nearestTradingDate(target: string): string | null {
    if (!firstDate || !lastDate) return null;
    if (target < firstDate || target > lastDate) return null;
    if (priceByDate.has(target)) return target;
    // Binary search for the largest date <= target
    let lo = 0;
    let hi = sortedDates.length - 1;
    let best: string | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sortedDates[mid] <= target) {
        best = sortedDates[mid];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  // Derive CatalystEvent-compatible items from live ClinicalTrials.gov
  // pipeline data. We surface three things:
  //   • Terminated / Withdrawn / Suspended trials  → "failure" (red)
  //   • Completed trials (past)                    → "readout" (purple)
  //   • Active trials with upcoming readout        → "readout" (purple, future)
  const trialDerivedEvents = useMemo<CatalystEvent[]>(() => {
    const today = new Date().toISOString().slice(0, 10);
    const out: CatalystEvent[] = [];
    for (const t of trials) {
      const raw = (t.status_raw ?? "").toUpperCase();
      const phase = t.phase && t.phase !== "N/A" ? t.phase : "";
      const indication = t.indication ?? "";
      const drug = t.drug ?? "";

      const isFailure =
        raw === "TERMINATED" ||
        raw === "WITHDRAWN" ||
        raw === "SUSPENDED";

      if (isFailure) {
        const date = t.last_update_date ?? t.primary_completion_date;
        if (!date) continue;
        const verb =
          raw === "TERMINATED"
            ? "Terminated"
            : raw === "WITHDRAWN"
              ? "Withdrawn"
              : "Suspended";
        const titleBits = [verb, phase, drug || indication].filter(Boolean);
        out.push({
          date,
          title: `${titleBits.join(" · ")}${t.nct_id ? ` (${t.nct_id})` : ""}`,
          type: "failure",
          impact: "medium",
          past: date <= today,
          summary:
            (t.why_stopped ? `Reason: ${t.why_stopped}. ` : "") +
            (t.title ? `${t.title}. ` : "") +
            (t.url ? `Source: ${t.url}` : "Source: ClinicalTrials.gov"),
        });
        continue;
      }

      if (raw === "COMPLETED") {
        const date = t.primary_completion_date ?? t.last_update_date;
        if (!date) continue;
        const titleBits = [
          "Completed",
          phase,
          drug || indication,
        ].filter(Boolean);
        out.push({
          date,
          title: `${titleBits.join(" · ")}${t.nct_id ? ` (${t.nct_id})` : ""}`,
          type: "readout",
          impact: "medium",
          past: date <= today,
          summary:
            (t.title ? `${t.title}. ` : "") +
            "Trial reached its primary completion date — topline results may follow in subsequent filings or press releases. " +
            (t.url ? `Source: ${t.url}` : "Source: ClinicalTrials.gov"),
        });
        continue;
      }

      const isActive =
        raw === "RECRUITING" ||
        raw === "ACTIVE_NOT_RECRUITING" ||
        raw === "ENROLLING_BY_INVITATION";

      if (isActive && t.primary_completion_date && t.primary_completion_date > today) {
        // Upcoming readout — only include if phase is Phase 2 or later
        // to avoid flooding the chart with early-stage milestones.
        if (t.phase_rank >= 2) {
          const titleBits = [
            "Upcoming readout",
            phase,
            drug || indication,
          ].filter(Boolean);
          out.push({
            date: t.primary_completion_date,
            title: `${titleBits.join(" · ")}${t.nct_id ? ` (${t.nct_id})` : ""}`,
            type: "readout",
            impact: t.phase_rank >= 3 ? "high" : "medium",
            past: false,
            summary:
              (t.title ? `${t.title}. ` : "") +
              `Primary completion expected ${t.primary_completion_date}. Trial is currently ${t.status.toLowerCase()}. ` +
              (t.url ? `Source: ${t.url}` : "Source: ClinicalTrials.gov"),
          });
        }
      }
    }
    return out;
  }, [trials]);

  // Deduplicate: if a seeded catalyst and a derived event share the same
  // (date, type) bucket, prefer the seeded one (it's usually more curated).
  const visibleCatalysts = useMemo(() => {
    if (!firstDate || !lastDate) return [] as CatalystEvent[];
    const seededKeys = new Set(
      catalysts.map((c) => `${c.date}|${c.type}`),
    );
    const derived = trialDerivedEvents.filter(
      (e) => !seededKeys.has(`${e.date}|${e.type}`),
    );
    const all = [...catalysts, ...derived];
    return all.filter((e) => e.date >= firstDate && e.date <= lastDate);
  }, [catalysts, trialDerivedEvents, firstDate, lastDate]);

  const visibleEarnings = useMemo(() => {
    if (!firstDate || !lastDate) return [] as EarningsEvent[];
    return earnings.filter((e) => e.date >= firstDate && e.date <= lastDate);
  }, [earnings, firstDate, lastDate]);

  // Events feed: catalysts + earnings, sorted newest-first
  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [
      ...visibleCatalysts.map<FeedItem>((e) => ({
        kind: "catalyst",
        date: e.date,
        event: e,
      })),
      ...visibleEarnings.map<FeedItem>((e) => ({
        kind: "earnings",
        date: e.date,
        event: e,
      })),
    ];
    items.sort((a, b) => (a.date < b.date ? 1 : -1));
    return items;
  }, [visibleCatalysts, visibleEarnings]);

  const change = useMemo(() => {
    if (prices.length < 2) return null;
    const first = prices[0].close;
    const last = prices[prices.length - 1].close;
    return { first, last, pct: ((last - first) / first) * 100 };
  }, [prices]);

  const hasData = !loading && !error && prices.length > 0;

  return (
    <section className="rounded-xl border border-border-subtle bg-bg-elev">
      <header className="px-5 py-3.5 border-b border-border-subtle flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs font-semibold tracking-widest uppercase text-accent-blue">
            Price & Trading Activity
          </div>
          <h2 className="text-sm text-text-dim mt-0.5">
            Daily close with catalyst overlays and trading volume
          </h2>
        </div>
        <div className="flex items-center gap-4">
          {change && (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-mono font-semibold">
                ${change.last.toFixed(2)}
              </span>
              <span
                className={`font-mono text-xs ${
                  change.pct >= 0 ? "text-accent-green" : "text-accent-red"
                }`}
              >
                {change.pct >= 0 ? "+" : ""}
                {change.pct.toFixed(1)}%
              </span>
            </div>
          )}
          <div className="flex rounded-md overflow-hidden border border-border-subtle">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPeriod(p.value)}
                className={`px-2.5 py-1 text-xs font-mono transition-colors ${
                  period === p.value
                    ? "bg-accent-blue/15 text-accent-blue"
                    : "text-text-dim hover:text-text hover:bg-bg-elev2"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* --------------------- LEFT: chart --------------------- */}
        <div className="p-4 pt-3 lg:border-r lg:border-border-subtle">
          {loading && (
            <div
              style={{ height: CHART_HEIGHT }}
              className="flex items-center justify-center text-sm text-text-dim"
            >
              Loading chart data…
            </div>
          )}
          {!loading && error && (
            <div
              style={{ height: CHART_HEIGHT }}
              className="flex items-center justify-center text-sm text-accent-red"
            >
              {error}
            </div>
          )}
          {!loading && !error && prices.length === 0 && (
            <div
              style={{ height: CHART_HEIGHT }}
              className="flex items-center justify-center text-sm text-text-dim"
            >
              No price data available.
            </div>
          )}

          {hasData && (
            <div style={{ height: CHART_HEIGHT }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={prices}
                  margin={{ top: 10, right: 16, bottom: 0, left: 0 }}
                >
                  <defs>
                    {/* Blue gradient under the price line */}
                    <linearGradient
                      id="priceShadow"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#58a6ff"
                        stopOpacity={0.32}
                      />
                      <stop
                        offset="100%"
                        stopColor="#58a6ff"
                        stopOpacity={0}
                      />
                    </linearGradient>
                    {/* Gray gradient for volume, riding on top of the blue */}
                    <linearGradient
                      id="volumeShadow"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#8b949e"
                        stopOpacity={0.58}
                      />
                      <stop
                        offset="100%"
                        stopColor="#8b949e"
                        stopOpacity={0.06}
                      />
                    </linearGradient>
                  </defs>

                  <CartesianGrid stroke="#1f242c" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    stroke="#6b7380"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(d: string) => d.slice(0, 7)}
                    minTickGap={40}
                  />
                  {/* Price axis — visible on the left */}
                  <YAxis
                    yAxisId="price"
                    stroke="#6b7380"
                    fontSize={11}
                    tickLine={false}
                    width={56}
                    domain={["auto", "auto"]}
                    tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                  />
                  {/* Volume axis — hidden, only used to scale the shadow.
                      Lower multiplier = taller volume area on the chart. */}
                  <YAxis
                    yAxisId="volume"
                    orientation="right"
                    hide
                    domain={[0, (dataMax: number) => dataMax * 2]}
                  />
                  <Tooltip
                    content={
                      <PriceTooltip
                        catalysts={visibleCatalysts}
                        earnings={visibleEarnings}
                      />
                    }
                    cursor={{
                      stroke: "#58a6ff",
                      strokeWidth: 1,
                      opacity: 0.3,
                    }}
                  />

                  {/* Blue gradient fill under the price line (bottom layer) */}
                  <Area
                    yAxisId="price"
                    type="monotone"
                    dataKey="close"
                    stroke="none"
                    fill="url(#priceShadow)"
                    isAnimationActive={false}
                  />

                  {/* Volume — gray gradient riding above the blue fill */}
                  <Area
                    yAxisId="volume"
                    type="monotone"
                    dataKey="volume"
                    stroke="none"
                    fill="url(#volumeShadow)"
                    isAnimationActive={false}
                  />

                  {/* Price line (drawn on top of the fills) */}
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="close"
                    stroke="#58a6ff"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />

                  {/* Highlight line — appears when hovering an event in the feed */}
                  {hoverDate && (
                    <ReferenceLine
                      yAxisId="price"
                      x={nearestTradingDate(hoverDate) ?? hoverDate}
                      stroke="#e6edf3"
                      strokeOpacity={0.35}
                      strokeWidth={1}
                      strokeDasharray="3 3"
                    />
                  )}

                  {/* Earnings markers — small gray dots on the price line.
                      Rendered first so catalyst halos layer on top if they collide. */}
                  {visibleEarnings.flatMap((e) => {
                    const d = nearestTradingDate(e.date);
                    if (!d) return [];
                    const y = priceByDate.get(d);
                    if (y == null) return [];
                    const isHovered = hoverDate === e.date;
                    return [
                      <ReferenceDot
                        key={`eps-ring-${e.date}`}
                        yAxisId="price"
                        x={d}
                        y={y}
                        r={isHovered ? 8 : 6}
                        fill="#8b949e"
                        fillOpacity={isHovered ? 0.28 : 0.18}
                        stroke="none"
                        isFront
                      />,
                      <ReferenceDot
                        key={`eps-${e.date}`}
                        yAxisId="price"
                        x={d}
                        y={y}
                        r={isHovered ? 4.5 : 3.5}
                        fill="#8b949e"
                        stroke="#0d1117"
                        strokeWidth={1.5}
                        isFront
                      />,
                    ];
                  })}

                  {/* Catalyst markers — colored dot with a glow halo ring.
                      Two ReferenceDots per event: faded halo underneath + solid on top. */}
                  {visibleCatalysts.flatMap((e) => {
                    const d = nearestTradingDate(e.date);
                    if (!d) return [];
                    const y = priceByDate.get(d);
                    if (y == null) return [];
                    const isHovered = hoverDate === e.date;
                    const color = catalystColor(e.type);
                    return [
                      <ReferenceDot
                        key={`halo-${e.date}-${e.title}`}
                        yAxisId="price"
                        x={d}
                        y={y}
                        r={isHovered ? 18 : 14}
                        fill={color}
                        fillOpacity={isHovered ? 0.3 : 0.22}
                        stroke="none"
                        isFront
                      />,
                      <ReferenceDot
                        key={`cat-${e.date}-${e.title}`}
                        yAxisId="price"
                        x={d}
                        y={y}
                        r={isHovered ? 10 : 8}
                        fill={color}
                        stroke="#0d1117"
                        strokeWidth={2.5}
                        isFront
                      />,
                    ];
                  })}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* --------------------- RIGHT: events panel --------------------- */}
        <aside className="flex flex-col">
          <div className="px-5 py-3 border-b border-border-subtle lg:border-b-0 flex items-center justify-between">
            <div className="text-[11px] font-semibold tracking-widest uppercase text-text-dim">
              Events
            </div>
            <div className="text-[11px] text-text-dimmer font-mono">
              {feed.length}
            </div>
          </div>
          <div
            className="flex-1 overflow-y-auto px-4 pb-4"
            style={{ maxHeight: CHART_HEIGHT + 12 }}
          >
            {hasData && feed.length === 0 && (
              <div className="text-xs text-text-dim py-6 text-center">
                No events in this period.
              </div>
            )}
            {feed.map((item) => {
              const key = `${item.kind}-${item.date}-${
                item.kind === "catalyst" ? item.event.title : item.event.period
              }`;
              return (
                <EventRow
                  key={key}
                  item={item}
                  prices={prices}
                  onHover={setHoverDate}
                  expanded={expandedKey === key}
                  onToggle={() =>
                    setExpandedKey((cur) => (cur === key ? null : key))
                  }
                />
              );
            })}
          </div>
        </aside>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Event row
// ---------------------------------------------------------------------------
function EventRow({
  item,
  prices,
  onHover,
  expanded,
  onToggle,
}: {
  item: FeedItem;
  prices: PricePoint[];
  onHover: (d: string | null) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (item.kind === "earnings") {
    const e = item.event;
    const reaction = earningsReaction(e.date, prices);
    const sentiment = reaction ? sentimentFromPct(reaction.pct) : null;
    const sentimentCls = sentiment ? sentimentColor(sentiment) : "";

    return (
      <div
        className="py-2.5 border-b border-border-subtle last:border-b-0 cursor-pointer transition-colors hover:bg-bg-elev2/40 rounded px-1 -mx-1"
        onMouseEnter={() => onHover(e.date)}
        onMouseLeave={() => onHover(null)}
        onClick={onToggle}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wider uppercase text-text-dimmer">
            <span className="w-1.5 h-1.5 rounded-full bg-text-dimmer" />
            Earnings
          </span>
          <span className="font-mono text-[11px] text-text-dimmer">
            {formatDate(e.date)}
          </span>
        </div>
        <div className="text-[12px] text-text-dim mt-1 leading-snug flex items-center gap-2 flex-wrap">
          <span>
            {e.period} report{e.past ? "" : " · upcoming"}
          </span>
          {reaction && sentiment && (
            <span
              className={`inline-flex items-center gap-1 font-mono text-[11px] px-1.5 py-0.5 rounded ${sentimentCls}`}
            >
              {reaction.pct >= 0 ? "+" : ""}
              {reaction.pct.toFixed(1)}%
              <span className="uppercase tracking-wider text-[9px] opacity-80">
                {sentimentLabel(sentiment)}
              </span>
            </span>
          )}
        </div>
        {expanded && (
          <div className="mt-2 pt-2 border-t border-border-subtle text-[12px] text-text-dim leading-relaxed">
            {!e.past ? (
              <>
                Upcoming {e.period} earnings report. Reports can drive
                short-term moves in either direction — watch for guidance
                revisions and pipeline commentary.
              </>
            ) : reaction && sentiment ? (
              <>
                <span className={sentimentCls}>
                  {sentimentDescription(sentiment)}
                </span>{" "}
                The stock moved{" "}
                <span className={`font-mono ${sentimentCls}`}>
                  {reaction.pct >= 0 ? "+" : ""}
                  {reaction.pct.toFixed(1)}%
                </span>{" "}
                over the 3 trading days following the report ($
                {reaction.baseline.toFixed(2)} → ${reaction.after.toFixed(2)}).
                <div className="text-[10px] text-text-dimmer mt-1 italic">
                  Based on 3-day price reaction, not analyst consensus.
                </div>
              </>
            ) : (
              <>
                Price data unavailable around this report — sentiment can&apos;t
                be computed.
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  const e = item.event;
  const color = catalystColor(e.type);
  return (
    <div
      className="py-3 border-b border-border-subtle last:border-b-0 cursor-pointer transition-colors hover:bg-bg-elev2/40 rounded px-1 -mx-1"
      onMouseEnter={() => onHover(e.date)}
      onMouseLeave={() => onHover(null)}
      onClick={onToggle}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wider"
          style={{
            color,
            borderColor: `${color}66`,
            backgroundColor: `${color}14`,
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: color }}
          />
          {catalystLabel(e.type)}
        </span>
        <span className="font-mono text-[11px] text-text-dimmer">
          {formatDate(e.date)}
        </span>
      </div>
      <div className="text-[13px] text-text mt-1.5 leading-snug flex items-start gap-1.5">
        <span className="flex-1">{e.title}</span>
        <span
          className={`text-text-dimmer text-[10px] mt-1 transition-transform flex-shrink-0 ${
            expanded ? "rotate-90" : ""
          }`}
          aria-hidden
        >
          ▸
        </span>
      </div>
      {e.impact && (
        <div className="text-[10px] uppercase tracking-wider text-text-dimmer mt-1 font-mono">
          {e.impact} impact
        </div>
      )}
      {expanded && (
        <div className="mt-2 pt-2 border-t border-border-subtle text-[12px] text-text-dim leading-relaxed">
          {e.summary ?? (
            <span className="italic text-text-dimmer">
              No summary available.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function catalystColor(type: CatalystType): string {
  switch (type) {
    case "approval":
    case "readout-positive":
      return "#3fb950"; // green
    case "readout-negative":
    case "failure":
      return "#f85149"; // red
    case "fda-advisory":
    case "readout":
      return "#bc8cff"; // purple
    case "launch":
    case "filing":
      return "#d29922"; // amber
    case "licensing":
      return "#58a6ff"; // blue
    default:
      return "#6b7380"; // gray
  }
}

function catalystLabel(type: CatalystType): string {
  switch (type) {
    case "approval":
      return "Approval";
    case "readout-positive":
      return "Data +";
    case "readout-negative":
      return "Data −";
    case "failure":
      return "Failure";
    case "fda-advisory":
      return "AdCom";
    case "launch":
      return "Launch";
    case "filing":
      return "Filing";
    case "licensing":
      return "Deal";
    case "readout":
      return "Readout";
    default:
      return "Event";
  }
}

function catalystTypeLabel(type: CatalystType): string {
  switch (type) {
    case "approval":
      return "Approval";
    case "readout-positive":
      return "Positive readout";
    case "readout-negative":
      return "Negative readout";
    case "failure":
      return "Failure";
    case "fda-advisory":
      return "FDA advisory";
    case "launch":
      return "Launch";
    case "filing":
      return "Filing";
    case "licensing":
      return "Licensing";
    case "readout":
      return "Readout";
    default:
      return "Event";
  }
}

// Earnings sentiment — computed from 3-day stock reaction to the report.
// Returns null if we can't find enough price data around the date.
type EarningsSentiment = "positive" | "muted" | "negative";

function earningsReaction(
  date: string,
  sortedPrices: PricePoint[],
  daysAfter = 3,
): { baseline: number; after: number; pct: number } | null {
  if (sortedPrices.length === 0) return null;
  // Find the last trading day at or before `date` (earnings may fall on a weekend).
  let baselineIdx = -1;
  for (let i = 0; i < sortedPrices.length; i++) {
    if (sortedPrices[i].date <= date) baselineIdx = i;
    else break;
  }
  if (baselineIdx < 0) return null;
  const afterIdx = baselineIdx + daysAfter;
  if (afterIdx >= sortedPrices.length) return null;
  const baseline = sortedPrices[baselineIdx].close;
  const after = sortedPrices[afterIdx].close;
  if (baseline === 0) return null;
  const pct = ((after - baseline) / baseline) * 100;
  return { baseline, after, pct };
}

function sentimentFromPct(pct: number): EarningsSentiment {
  if (pct >= 3) return "positive";
  if (pct <= -3) return "negative";
  return "muted";
}

function sentimentLabel(s: EarningsSentiment): string {
  return s;
}

function sentimentColor(s: EarningsSentiment): string {
  switch (s) {
    case "positive":
      return "text-accent-green";
    case "negative":
      return "text-accent-red";
    case "muted":
      return "text-text-dim";
  }
}

function sentimentDescription(s: EarningsSentiment): string {
  switch (s) {
    case "positive":
      return "Market received the report well.";
    case "negative":
      return "Market received the report poorly.";
    case "muted":
      return "Market reaction was roughly flat.";
  }
}

function formatVolume(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return `${v}`;
}

function formatDate(d: string): string {
  // "2024-05-08" -> "May 08, 2024"
  try {
    const dt = new Date(d + "T00:00:00Z");
    return dt.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return d;
  }
}

// ---------------------------------------------------------------------------
// Price tooltip
// ---------------------------------------------------------------------------
function PriceTooltip({
  active,
  payload,
  label,
  catalysts,
  earnings,
}: {
  active?: boolean;
  payload?: Array<{ value: number; payload?: { volume?: number; close?: number } }>;
  label?: string;
  catalysts: CatalystEvent[];
  earnings: EarningsEvent[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  // ComposedChart may emit volume first if Area is declared first — find price
  const priceEntry = payload.find(
    (p) => p.payload && typeof p.payload.close === "number",
  );
  const close = priceEntry?.payload?.close ?? payload[0].value;
  const volume = payload[0].payload?.volume;
  const cat = catalysts.find((c) => c.date === label);
  const eps = earnings.find((e) => e.date === label);

  return (
    <div className="rounded-md border border-border bg-bg-app/95 backdrop-blur px-3 py-2 shadow-lg text-xs min-w-[180px]">
      <div className="font-mono text-text-dim">{label}</div>
      <div className="font-mono font-semibold text-base mt-0.5">
        ${typeof close === "number" ? close.toFixed(2) : "—"}
      </div>
      {typeof volume === "number" && (
        <div className="font-mono text-[11px] text-text-dim mt-0.5">
          Vol {formatVolume(volume)}
        </div>
      )}
      {cat && (
        <div
          className="mt-2 pt-2 border-t border-border-subtle text-[11px]"
          style={{ color: catalystColor(cat.type) }}
        >
          <div className="uppercase tracking-wider font-semibold">
            {catalystTypeLabel(cat.type)} · {cat.impact} impact
          </div>
          <div className="text-text mt-0.5">{cat.title}</div>
        </div>
      )}
      {eps && (
        <div className="mt-2 pt-2 border-t border-border-subtle text-[11px] text-text-dim">
          <div className="uppercase tracking-wider font-semibold">Earnings</div>
          <div className="text-text mt-0.5">{eps.period} report</div>
        </div>
      )}
    </div>
  );
}
