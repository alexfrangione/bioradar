"use client";

import { useEffect, useMemo, useState } from "react";
import { getPipeline, type Company, type Drug, type Quote } from "@/lib/api";
import {
  DEFAULT_GLOBALS,
  DEFAULT_PEAK_SALES_USD,
  computeRNPV,
  defaultLaunchYear,
  defaultPoSForPhase,
  type DrugAssumptions,
  type GlobalAssumptions,
} from "@/lib/rnpv";

/* ---------- types ---------- */

type DrugRow = {
  key: string;
  name: string; // display name
  indication: string | null;
  phase: string;
  phaseRank: number;
  assumptions: DrugAssumptions;
  rnpv: number; // computed
};

/* ---------- component ---------- */

export default function Valuation({
  company,
  quote,
}: {
  company: Company;
  quote: Quote | null;
}) {
  const [drugs, setDrugs] = useState<Drug[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [globals, setGlobals] = useState<GlobalAssumptions>(DEFAULT_GLOBALS);
  // Keyed by drug key so edits survive other re-renders.
  const [overrides, setOverrides] = useState<Record<string, DrugAssumptions>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const currentYear = useMemo(() => new Date().getFullYear(), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const res = await getPipeline(company.ticker, 25);
      if (cancelled) return;
      setDrugs(res?.drugs ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [company.ticker]);

  // Build the per-drug rows with default assumptions, overridden by user
  // edits. Recomputed whenever globals or overrides change.
  const rows: DrugRow[] = useMemo(() => {
    if (!drugs) return [];
    return drugs.map((d, i) => {
      const key = `${(d.drug ?? "unnamed").toLowerCase()}-${i}`;
      const defaults: DrugAssumptions = {
        pos: defaultPoSForPhase(d.highest_phase_rank),
        peakSalesUsd: DEFAULT_PEAK_SALES_USD,
        launchYear: defaultLaunchYear(d.highest_phase_rank, currentYear),
      };
      const a = overrides[key] ?? defaults;
      const rnpv = computeRNPV(a, globals, currentYear);
      return {
        key,
        name: d.drug ?? "Unnamed asset",
        indication: d.indication,
        phase: d.highest_phase,
        phaseRank: d.highest_phase_rank,
        assumptions: a,
        rnpv,
      };
    });
  }, [drugs, overrides, globals, currentYear]);

  // Portfolio-level aggregates.
  const totalRNPV = useMemo(() => rows.reduce((s, r) => s + r.rnpv, 0), [rows]);
  const shares = company.shares_outstanding ?? 0;
  const cash = company.cash_usd ?? 0;
  const equityValue = totalRNPV + cash;
  const fairPerShare = shares > 0 ? equityValue / shares : 0;
  const currentPrice = quote?.price ?? null;
  const upsidePct =
    currentPrice && currentPrice > 0
      ? ((fairPerShare - currentPrice) / currentPrice) * 100
      : null;

  const updateDrug = (key: string, patch: Partial<DrugAssumptions>) => {
    setOverrides((prev) => {
      const existing = prev[key] ?? rows.find((r) => r.key === key)?.assumptions;
      if (!existing) return prev;
      return { ...prev, [key]: { ...existing, ...patch } };
    });
  };

  const resetDrug = (key: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /* ---------- render ---------- */

  if (loading) {
    return (
      <section className="rounded-lg border border-border-subtle bg-bg-elev/30 p-6">
        <SectionHeader />
        <div className="text-sm text-text-dim py-4">Loading pipeline…</div>
      </section>
    );
  }

  if (!drugs || drugs.length === 0) {
    return (
      <section className="rounded-lg border border-border-subtle bg-bg-elev/30 p-6">
        <SectionHeader />
        <div className="text-sm text-text-dim py-4">
          No pipeline data available for this ticker — nothing to value.
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border-subtle bg-bg-elev/30">
      {/* Headline */}
      <div className="px-6 pt-6 pb-5 border-b border-border-subtle">
        <SectionHeader />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mt-5">
          <Stat label="Pipeline rNPV" value={formatUSD(totalRNPV)} emphasis />
          <Stat
            label="Fair value / share"
            value={shares > 0 ? `$${fairPerShare.toFixed(2)}` : "—"}
            sub={shares > 0 ? `on ${formatShares(shares)} sh` : undefined}
            emphasis
          />
          <Stat
            label="Current price"
            value={currentPrice != null ? `$${currentPrice.toFixed(2)}` : "—"}
          />
          <Stat
            label="Upside"
            valueSlot={
              upsidePct == null ? (
                <span className="font-mono text-lg text-text-dimmer">—</span>
              ) : (
                <span
                  className={`font-mono text-lg font-semibold ${
                    upsidePct >= 0 ? "text-accent-green" : "text-accent-red"
                  }`}
                >
                  {upsidePct >= 0 ? "+" : ""}
                  {upsidePct.toFixed(1)}%
                </span>
              )
            }
          />
        </div>
      </div>

      {/* Global assumptions */}
      <div className="px-6 py-5 border-b border-border-subtle">
        <div className="text-[11px] font-semibold text-text-dimmer uppercase tracking-widest mb-3">
          Global assumptions
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <GlobalSlider
            label="Discount rate"
            value={globals.discountRate}
            min={0.05}
            max={0.2}
            step={0.005}
            format={(v) => `${(v * 100).toFixed(1)}%`}
            onChange={(v) => setGlobals({ ...globals, discountRate: v })}
          />
          <GlobalSlider
            label="Operating margin at peak"
            value={globals.operatingMargin}
            min={0.1}
            max={0.5}
            step={0.01}
            format={(v) => `${(v * 100).toFixed(0)}%`}
            onChange={(v) => setGlobals({ ...globals, operatingMargin: v })}
          />
          <GlobalSlider
            label="Years of exclusivity"
            value={globals.patentYears}
            min={5}
            max={20}
            step={1}
            format={(v) => `${v} yrs`}
            onChange={(v) => setGlobals({ ...globals, patentYears: v })}
          />
        </div>
      </div>

      {/* Per-drug table */}
      <div className="px-2 py-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-text-dimmer">
              <th className="px-4 py-2 text-left font-medium">Asset</th>
              <th className="px-4 py-2 text-left font-medium">Phase</th>
              <th className="px-4 py-2 text-right font-medium">PoS</th>
              <th className="px-4 py-2 text-right font-medium">Peak sales</th>
              <th className="px-4 py-2 text-right font-medium">Launch</th>
              <th className="px-4 py-2 text-right font-medium">rNPV</th>
              <th className="px-4 py-2 text-right font-medium">% of total</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .slice()
              .sort((a, b) => b.rnpv - a.rnpv)
              .map((r) => (
                <DrugRowView
                  key={r.key}
                  row={r}
                  totalRNPV={totalRNPV}
                  isEdited={Boolean(overrides[r.key])}
                  expanded={expanded.has(r.key)}
                  onToggle={() => toggleExpand(r.key)}
                  onChange={(patch) => updateDrug(r.key, patch)}
                  onReset={() => resetDrug(r.key)}
                />
              ))}
            <tr className="border-t-2 border-border bg-bg-elev/50">
              <td className="px-4 py-3 font-semibold" colSpan={5}>
                Total pipeline
              </td>
              <td className="px-4 py-3 text-right font-mono font-semibold">
                {formatUSD(totalRNPV)}
              </td>
              <td className="px-4 py-3 text-right font-mono text-text-dim">
                100%
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Methodology footnote */}
      <div className="px-6 py-4 border-t border-border-subtle text-[11px] text-text-dimmer leading-relaxed">
        Model: revenue ramps 25/50/75/100% over years 1–4, holds at peak through
        exclusivity, then zero. Cash flow = revenue × op margin, discounted back
        to today, multiplied by PoS. Fair value / share = (pipeline rNPV + cash) ÷ shares outstanding.
        Defaults seeded from current phase — edit any row to refine.
      </div>
    </section>
  );
}

/* ---------- pieces ---------- */

function SectionHeader() {
  return (
    <>
      <div className="text-xs font-semibold text-accent-purple tracking-widest uppercase mb-1">
        Valuation
      </div>
      <h2 className="text-xl font-bold tracking-tight">Risk-adjusted NPV</h2>
    </>
  );
}

function Stat({
  label,
  value,
  valueSlot,
  sub,
  emphasis,
}: {
  label: string;
  value?: string;
  valueSlot?: React.ReactNode;
  sub?: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-text-dimmer uppercase tracking-wider mb-1">
        {label}
      </div>
      {valueSlot ?? (
        <span
          className={`font-mono ${emphasis ? "text-lg font-semibold" : "text-lg"}`}
        >
          {value}
        </span>
      )}
      {sub && <div className="text-[11px] text-text-dimmer mt-0.5">{sub}</div>}
    </div>
  );
}

function GlobalSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[11px] text-text-dim uppercase tracking-wider">
          {label}
        </span>
        <span className="font-mono text-sm text-text">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-accent-blue"
      />
    </label>
  );
}

function DrugRowView({
  row,
  totalRNPV,
  isEdited,
  expanded,
  onToggle,
  onChange,
  onReset,
}: {
  row: DrugRow;
  totalRNPV: number;
  isEdited: boolean;
  expanded: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<DrugAssumptions>) => void;
  onReset: () => void;
}) {
  const share = totalRNPV > 0 ? (row.rnpv / totalRNPV) * 100 : 0;

  return (
    <>
      <tr
        className="border-t border-border-subtle hover:bg-bg-elev/40 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <td className="px-4 py-3 align-top">
          <div className="flex items-start gap-2">
            <Chevron open={expanded} />
            <div className="min-w-0">
              <div className="font-semibold text-text leading-tight">
                {row.name}
              </div>
              {row.indication && (
                <div className="text-[11px] text-text-dim mt-0.5 line-clamp-1">
                  {row.indication}
                </div>
              )}
            </div>
          </div>
        </td>
        <td className="px-4 py-3 align-top">
          <PhasePill phase={row.phase} rank={row.phaseRank} />
        </td>
        <td className="px-4 py-3 align-top text-right font-mono">
          {(row.assumptions.pos * 100).toFixed(0)}%
        </td>
        <td className="px-4 py-3 align-top text-right font-mono">
          {formatUSD(row.assumptions.peakSalesUsd)}
        </td>
        <td className="px-4 py-3 align-top text-right font-mono">
          {row.assumptions.launchYear}
        </td>
        <td className="px-4 py-3 align-top text-right font-mono font-semibold">
          {formatUSD(row.rnpv)}
          {isEdited && (
            <div className="text-[9px] text-accent-amber uppercase tracking-wider mt-0.5">
              edited
            </div>
          )}
        </td>
        <td className="px-4 py-3 align-top text-right">
          <ShareBar pct={share} />
        </td>
      </tr>
      {expanded && (
        <tr className="bg-bg-elev/20">
          <td colSpan={7} className="px-4 pb-5 pt-2">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-3xl">
              <DrugSlider
                label="Probability of success"
                value={row.assumptions.pos}
                min={0.01}
                max={1}
                step={0.01}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                onChange={(v) => onChange({ pos: v })}
              />
              <DrugSlider
                label="Peak annual sales"
                value={row.assumptions.peakSalesUsd}
                min={50_000_000}
                max={5_000_000_000}
                step={50_000_000}
                format={formatUSD}
                onChange={(v) => onChange({ peakSalesUsd: v })}
              />
              <DrugSlider
                label="Launch year"
                value={row.assumptions.launchYear}
                min={new Date().getFullYear()}
                max={new Date().getFullYear() + 15}
                step={1}
                format={(v) => String(v)}
                onChange={(v) => onChange({ launchYear: v })}
              />
            </div>
            {isEdited && (
              <button
                type="button"
                onClick={onReset}
                className="mt-3 text-[11px] text-text-dim hover:text-text underline underline-offset-2"
              >
                Reset to defaults
              </button>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function DrugSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[11px] text-text-dim uppercase tracking-wider">
          {label}
        </span>
        <span className="font-mono text-sm text-text">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-accent-blue"
      />
    </label>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      className={`flex-shrink-0 mt-1 transition-transform ${
        open ? "rotate-90 text-accent-blue" : "text-text-dimmer"
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <polyline points="5 3 11 8 5 13" />
    </svg>
  );
}

function PhasePill({ phase, rank }: { phase: string; rank: number }) {
  const color =
    rank >= 5
      ? "bg-accent-green/15 text-accent-green border-accent-green/30"
      : rank >= 4
        ? "bg-accent-green/15 text-accent-green border-accent-green/30"
        : rank >= 3
          ? "bg-accent-blue/15 text-accent-blue border-accent-blue/30"
          : rank >= 2
            ? "bg-accent-purple/15 text-accent-purple border-accent-purple/30"
            : "bg-text-dim/15 text-text-dim border-text-dim/30";
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${color}`}
    >
      {phase}
    </span>
  );
}

function ShareBar({ pct }: { pct: number }) {
  return (
    <div className="inline-flex items-center gap-2">
      <div className="w-16 h-1.5 rounded bg-bg-elev2 overflow-hidden">
        <div
          className="h-full bg-accent-purple"
          style={{ width: `${Math.min(100, pct).toFixed(1)}%` }}
        />
      </div>
      <span className="font-mono text-[11px] text-text-dim w-10 text-right">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

/* ---------- formatters ---------- */

function formatUSD(n: number): string {
  if (!isFinite(n) || n === 0) return "$0";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function formatShares(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return n.toLocaleString();
}
