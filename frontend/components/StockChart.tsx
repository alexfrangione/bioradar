"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getCatalysts,
  getPrices,
  type CatalystEvent,
  type PricePoint,
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

export default function StockChart({ ticker }: Props) {
  const [period, setPeriod] = useState("2y");
  const [prices, setPrices] = useState<PricePoint[]>([]);
  const [catalysts, setCatalysts] = useState<CatalystEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getPrices(ticker, period), getCatalysts(ticker)])
      .then(([p, c]) => {
        if (cancelled) return;
        if (!p) {
          setError("Couldn't load price data.");
          setPrices([]);
        } else {
          setPrices(p.points);
        }
        setCatalysts(c?.events ?? []);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [ticker, period]);

  // Only show catalysts that fall inside the visible price window.
  const visibleCatalysts = useMemo(() => {
    if (prices.length === 0) return [] as CatalystEvent[];
    const first = prices[0].date;
    const last = prices[prices.length - 1].date;
    return catalysts.filter((e) => e.date >= first && e.date <= last);
  }, [catalysts, prices]);

  const change = useMemo(() => {
    if (prices.length < 2) return null;
    const first = prices[0].close;
    const last = prices[prices.length - 1].close;
    const pct = ((last - first) / first) * 100;
    return { first, last, pct };
  }, [prices]);

  return (
    <section className="rounded-xl border border-border-subtle bg-bg-elev">
      <header className="px-5 py-3.5 border-b border-border-subtle flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs font-semibold tracking-widest uppercase text-accent-blue">
            Price & Catalysts
          </div>
          <h2 className="text-sm text-text-dim mt-0.5">
            Daily close with event overlays
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

      <div className="p-4 pt-3" style={{ height: 360 }}>
        {loading && (
          <div className="h-full flex items-center justify-center text-sm text-text-dim">
            Loading price data…
          </div>
        )}
        {!loading && error && (
          <div className="h-full flex items-center justify-center text-sm text-accent-red">
            {error}
          </div>
        )}
        {!loading && !error && prices.length === 0 && (
          <div className="h-full flex items-center justify-center text-sm text-text-dim">
            No price data available.
          </div>
        )}
        {!loading && !error && prices.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={prices}
              margin={{ top: 10, right: 20, bottom: 0, left: 0 }}
            >
              <CartesianGrid stroke="#1f242c" strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                stroke="#6b7380"
                fontSize={11}
                tickLine={false}
                tickFormatter={(d: string) => d.slice(0, 7)}
                minTickGap={40}
              />
              <YAxis
                stroke="#6b7380"
                fontSize={11}
                tickLine={false}
                width={48}
                domain={["auto", "auto"]}
                tickFormatter={(v: number) => `$${v.toFixed(0)}`}
              />
              <Tooltip
                content={<ChartTooltip catalysts={visibleCatalysts} />}
                cursor={{ stroke: "#58a6ff", strokeWidth: 1, opacity: 0.3 }}
              />
              <Line
                type="monotone"
                dataKey="close"
                stroke="#58a6ff"
                strokeWidth={1.75}
                dot={false}
                isAnimationActive={false}
              />
              {visibleCatalysts.map((e) => (
                <ReferenceLine
                  key={`${e.date}-${e.title}`}
                  x={e.date}
                  stroke={catalystColor(e)}
                  strokeDasharray="4 3"
                  strokeOpacity={0.8}
                  label={{
                    value: catalystLabel(e),
                    position: "top",
                    fill: catalystColor(e),
                    fontSize: 10,
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {!loading && visibleCatalysts.length > 0 && (
        <div className="px-5 py-3 border-t border-border-subtle flex flex-wrap gap-x-5 gap-y-2 text-[11px]">
          <LegendDot color="#3fb950" label="Approval" />
          <LegendDot color="#bc8cff" label="Readout" />
          <LegendDot color="#d29922" label="Launch / Filing" />
          <LegendDot color="#6b7380" label="Other" />
        </div>
      )}
    </section>
  );
}

function catalystColor(e: CatalystEvent): string {
  switch (e.type) {
    case "approval":
      return "#3fb950"; // green
    case "readout":
      return "#bc8cff"; // purple
    case "launch":
    case "filing":
      return "#d29922"; // amber
    default:
      return "#6b7380"; // gray
  }
}

function catalystLabel(e: CatalystEvent): string {
  switch (e.type) {
    case "approval":
      return "APPR";
    case "readout":
      return "DATA";
    case "launch":
      return "LAUNCH";
    case "filing":
      return "FILE";
    default:
      return "EVT";
  }
}

function ChartTooltip({
  active,
  payload,
  label,
  catalysts,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
  catalysts: CatalystEvent[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const close = payload[0].value;
  const event = catalysts.find((c) => c.date === label);

  return (
    <div className="rounded-md border border-border bg-bg-app/95 backdrop-blur px-3 py-2 shadow-lg text-xs">
      <div className="font-mono text-text-dim">{label}</div>
      <div className="font-mono font-semibold text-base mt-0.5">
        ${close.toFixed(2)}
      </div>
      {event && (
        <div
          className="mt-2 pt-2 border-t border-border-subtle text-[11px]"
          style={{ color: catalystColor(event) }}
        >
          <div className="uppercase tracking-wider font-semibold">
            {event.type} · {event.impact} impact
          </div>
          <div className="text-text mt-0.5">{event.title}</div>
        </div>
      )}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-text-dim">
      <span
        className="w-2.5 h-2.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
