"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getPipeline, type Drug } from "@/lib/api";
import { POPULAR_TICKERS } from "@/lib/universe";
import SiteNav from "@/components/SiteNav";

// ---------------------------------------------------------------------------
// Pipeline explorer
//
// Cross-company drug index. Fans out getPipeline() across POPULAR_TICKERS and
// aggregates every drug-level row into one searchable table. Filters by phase,
// indication keyword, and trial status let users skim "everything in Ph3" or
// "everything in oncology" across the field.
// ---------------------------------------------------------------------------

type Row = Drug & { ticker: string; sponsor: string | null };

type PhaseFilter = "all" | "3" | "2" | "1";
type StatusFilter = "all" | "active" | "completed" | "planned" | "stopped";

const PHASE_MIN: Record<PhaseFilter, number> = {
  all: 0,
  "3": 3, // Phase 3 and above (inc. approved/marketed)
  "2": 2,
  "1": 1,
};

// Palette for the phase badge — Phase 3+ green, Phase 2 blue, Phase 1 amber,
// Preclinical/unknown dim.
function phaseColor(rank: number): string {
  if (rank >= 4) return "text-accent-green";
  if (rank >= 3) return "text-accent-green";
  if (rank >= 2) return "text-accent-blue";
  if (rank >= 1) return "text-accent-amber";
  return "text-text-dimmer";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PipelinePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const [phase, setPhase] = useState<PhaseFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const perTicker = await Promise.all(
        POPULAR_TICKERS.map(async (t) => {
          const res = await getPipeline(t, 40);
          if (!res?.drugs) return [] as Row[];
          return res.drugs.map((d) => ({
            ...d,
            ticker: t,
            sponsor: res.sponsor ?? null,
          }));
        }),
      );
      if (cancelled) return;
      setRows(perTicker.flat());
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const minPhase = PHASE_MIN[phase];
    let out = rows.filter((r) => {
      if (r.highest_phase_rank < minPhase) return false;
      if (status !== "all") {
        const s = r.latest_status.toLowerCase();
        if (status === "active" && !/recruit|active|ongoing|enrolling/.test(s))
          return false;
        if (status === "completed" && !/complet/.test(s)) return false;
        if (status === "planned" && !/not yet|planned|pending/.test(s))
          return false;
        if (status === "stopped" && !/terminat|withdrawn|suspended/.test(s))
          return false;
      }
      if (q) {
        const hay = [
          r.drug ?? "",
          r.ticker,
          r.sponsor ?? "",
          r.indication ?? "",
          ...(r.indications ?? []),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    out = [...out].sort((a, b) => {
      if (a.highest_phase_rank !== b.highest_phase_rank)
        return b.highest_phase_rank - a.highest_phase_rank;
      return b.trial_count - a.trial_count;
    });
    return out;
  }, [rows, phase, status, query]);

  return (
    <main className="min-h-screen">
      <SiteNav />

      <div className="max-w-[1200px] mx-auto px-8 pt-9 pb-20">
        {/* Header */}
        <div className="flex items-end justify-between mb-7 pb-5 border-b border-border-subtle gap-6 flex-wrap">
          <div>
            <h1 className="text-[32px] font-bold tracking-[-0.02em] mb-1.5">
              Pipeline
            </h1>
            <p className="text-text-dim text-sm leading-relaxed m-0">
              {loading ? (
                "Loading…"
              ) : (
                <>
                  <span className="text-accent-green font-medium">
                    {filtered.length}{" "}
                    {filtered.length === 1 ? "drug" : "drugs"}
                  </span>{" "}
                  across popular healthcare · from ClinicalTrials.gov
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search drug, indication…"
              className="bg-bg-elev border border-border rounded-lg px-3 py-1.5 text-[13px] text-text placeholder:text-text-dimmer focus:outline-none focus:border-accent-green/60 w-[220px]"
            />
            <FilterGroup<PhaseFilter>
              label="Phase"
              value={phase}
              onChange={setPhase}
              options={[
                { v: "all", label: "All" },
                { v: "1", label: "1+" },
                { v: "2", label: "2+" },
                { v: "3", label: "3+" },
              ]}
            />
            <FilterGroup<StatusFilter>
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { v: "all", label: "All" },
                { v: "active", label: "Active" },
                { v: "completed", label: "Done" },
                { v: "planned", label: "Planned" },
                { v: "stopped", label: "Stopped" },
              ]}
            />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-sm text-text-dim py-10">Loading pipeline…</div>
        ) : filtered.length === 0 ? (
          <div className="bg-bg-elev border border-border-subtle rounded-xl px-7 py-12 text-center">
            <div className="text-text font-medium mb-1">No matches</div>
            <div className="text-sm text-text-dim">
              Loosen the filters or clear the search.
            </div>
          </div>
        ) : (
          <div className="bg-bg-elev border border-border-subtle rounded-xl overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left font-mono text-[10.5px] uppercase tracking-[0.12em] text-text-dim border-b border-border-subtle">
                  <th className="px-4 py-3">Drug</th>
                  <th className="px-4 py-3">Sponsor</th>
                  <th className="px-4 py-3">Indication</th>
                  <th className="px-4 py-3 text-right">Phase</th>
                  <th className="px-4 py-3 text-right">Trials</th>
                  <th className="px-4 py-3">Next completion</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr
                    key={`${r.ticker}-${r.drug}-${i}`}
                    className="border-b border-border-subtle last:border-b-0 hover:bg-bg-elev2 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-text max-w-[240px] truncate">
                      {r.drug ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/company/${r.ticker}`}
                        className="font-mono font-semibold text-text-dim hover:text-accent-green"
                      >
                        {r.ticker}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-text-dim max-w-[280px] truncate">
                      {r.indication ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`font-mono font-semibold ${phaseColor(r.highest_phase_rank)}`}
                      >
                        {r.highest_phase}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-text-dim">
                      {r.trial_count}
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-text-dim">
                      {r.next_completion_date ?? "—"}
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
