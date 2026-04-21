"use client";

import { useEffect, useState } from "react";
import {
  getPipeline,
  type PipelineResponse,
  type Drug,
  type DrugTrialRef,
  type StatusCounts,
} from "@/lib/api";

type Props = {
  ticker: string;
};

/**
 * Pipeline panel — one row per drug candidate.
 *
 * The main table stays lean: phase, drug, indications, rollup status,
 * completion, trial count. Clicking a row expands it to reveal the
 * underlying trials, with a stacked-composition bar + per-bucket counts
 * as a headline ("3 active · 1 completed · 1 stopped"). The status pill
 * uses an activity-priority rollup, so a program with one terminated Ph3
 * plus four active lower-phase trials still reads as Recruiting — the
 * stopped trial is visible in the drilldown.
 */
export default function Pipeline({ ticker }: Props) {
  const [data, setData] = useState<PipelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setExpanded(new Set());
    getPipeline(ticker, 100)
      .then((res) => {
        if (cancelled) return;
        if (!res) {
          setError(
            "Couldn't load pipeline. ClinicalTrials.gov or the backend may be unavailable.",
          );
        } else {
          setData(res);
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  const drugs: Drug[] = data?.drugs ?? [];
  const drugCount = data?.drug_count ?? drugs.length;

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <section className="rounded-xl border border-border-subtle bg-bg-elev">
      <header className="px-5 py-3.5 border-b border-border-subtle flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold tracking-widest uppercase text-accent-blue">
            Pipeline
          </div>
          <h2 className="text-sm text-text-dim mt-0.5">
            Drug candidates sponsored by {data?.sponsor ?? ticker} ·{" "}
            <span className="font-mono">ClinicalTrials.gov</span>
          </h2>
        </div>
        {data && (
          <span className="text-xs text-text-dim font-mono">
            {drugCount} drug{drugCount === 1 ? "" : "s"} · {data.count} trial
            {data.count === 1 ? "" : "s"}
          </span>
        )}
      </header>

      {loading && (
        <div className="px-5 py-8 text-center text-text-dim text-sm">
          Loading pipeline…
        </div>
      )}

      {!loading && error && (
        <div className="px-5 py-6 text-sm text-accent-red">{error}</div>
      )}

      {!loading && data && drugs.length === 0 && (
        <div className="px-5 py-8 text-center text-text-dim text-sm">
          No trials found for this sponsor.
        </div>
      )}

      {!loading && drugs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-text-dimmer border-b border-border-subtle">
                <th className="w-[36px] px-4 py-2.5"></th>
                <th className="text-left font-semibold px-3 py-2.5 w-[90px]">
                  Phase
                </th>
                <th className="text-left font-semibold px-3 py-2.5">
                  Drug / Candidate
                </th>
                <th className="text-left font-semibold px-3 py-2.5">
                  Indications
                </th>
                <th className="text-left font-semibold px-3 py-2.5 w-[160px]">
                  Status
                </th>
                <th className="text-left font-semibold px-3 py-2.5 w-[130px]">
                  Next Completion
                </th>
                <th className="text-right font-semibold px-5 py-2.5 w-[110px]">
                  Trials
                </th>
              </tr>
            </thead>
            <tbody>
              {drugs.map((d, i) => {
                const key = d.drug ?? d.nct_ids[0] ?? String(i);
                const isOpen = expanded.has(key);
                return (
                  <DrugRow
                    key={key}
                    drug={d}
                    isOpen={isOpen}
                    onToggle={() => toggle(key)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DrugRow({
  drug,
  isOpen,
  onToggle,
}: {
  drug: Drug;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const extraIndications = Math.max(drug.indications.length - 1, 0);

  return (
    <>
      <tr
        onClick={onToggle}
        className={`group border-b border-border-subtle last:border-b-0 transition-colors cursor-pointer ${
          isOpen
            ? "bg-bg-elev2/30"
            : "hover:bg-bg-elev2/50"
        }`}
      >
        <td className="pl-5 pr-1 py-3 w-[36px]">
          <Chevron open={isOpen} />
        </td>
        <td className="px-3 py-3">
          <PhaseBadge
            phase={drug.highest_phase}
            rank={drug.highest_phase_rank}
          />
        </td>
        <td className="px-3 py-3 font-medium">
          {drug.drug ?? <span className="text-text-dim italic">Unnamed</span>}
        </td>
        <td className="px-3 py-3 text-text-dim max-w-[340px]">
          <div className="truncate">
            {drug.indication ?? (
              <span className="text-text-dimmer italic">n/a</span>
            )}
            {extraIndications > 0 && (
              <span className="text-text-dimmer text-xs ml-2">
                +{extraIndications} more
              </span>
            )}
          </div>
        </td>
        <td className="px-3 py-3">
          <StatusPill
            status={drug.latest_status}
            raw={drug.latest_status_raw}
          />
        </td>
        <td className="px-3 py-3">
          <CompletionDate date={drug.next_completion_date} />
        </td>
        <td className="px-5 py-3 text-right">
          <TrialCountButton count={drug.trial_count} open={isOpen} />
        </td>
      </tr>

      {isOpen && (
        <tr className="border-b border-border-subtle last:border-b-0 bg-bg-app/30">
          <td colSpan={7} className="px-5 py-4">
            <StatusHeadline counts={drug.status_counts} />
            <div className="mt-3 rounded-md border border-border-subtle overflow-hidden">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-text-dimmer bg-bg-elev/50">
                    <th className="text-left font-semibold px-3 py-2 w-[80px]">
                      Phase
                    </th>
                    <th className="text-left font-semibold px-3 py-2">
                      Title
                    </th>
                    <th className="text-left font-semibold px-3 py-2 w-[150px]">
                      Indication
                    </th>
                    <th className="text-left font-semibold px-3 py-2 w-[170px]">
                      Status
                    </th>
                    <th className="text-left font-semibold px-3 py-2 w-[120px]">
                      Completion
                    </th>
                    <th className="text-right font-semibold px-3 py-2 w-[110px]">
                      NCT ID
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {drug.trials.map((t, i) => (
                    <TrialSubRow
                      key={t.nct_id ?? `${i}`}
                      trial={t}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ────── expand-panel headline: stacked bar + per-bucket counts ────── */

function StatusHeadline({ counts }: { counts: StatusCounts }) {
  const total =
    counts.active + counts.planned + counts.completed + counts.stopped + counts.other;
  if (total === 0) return null;

  const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;

  // Order inside the bar: active → planned → completed → stopped → other.
  return (
    <div className="flex items-center gap-3.5 flex-wrap">
      <div className="flex h-2 w-[220px] min-w-[160px] rounded overflow-hidden bg-bg-elev2">
        {counts.active > 0 && (
          <div
            className="bg-accent-green"
            style={{ width: pct(counts.active) }}
          />
        )}
        {counts.planned > 0 && (
          <div
            className="bg-accent-amber"
            style={{ width: pct(counts.planned) }}
          />
        )}
        {counts.completed > 0 && (
          <div
            className="bg-accent-blue"
            style={{ width: pct(counts.completed) }}
          />
        )}
        {counts.stopped > 0 && (
          <div
            className="bg-accent-red"
            style={{ width: pct(counts.stopped) }}
          />
        )}
        {counts.other > 0 && (
          <div
            className="bg-text-dimmer"
            style={{ width: pct(counts.other) }}
          />
        )}
      </div>
      <div className="flex gap-3 font-mono text-[11px] text-text-dim">
        {counts.active > 0 && (
          <span>
            <b className="text-accent-green font-semibold">{counts.active}</b>{" "}
            active
          </span>
        )}
        {counts.planned > 0 && (
          <span>
            <b className="text-accent-amber font-semibold">{counts.planned}</b>{" "}
            planned
          </span>
        )}
        {counts.completed > 0 && (
          <span>
            <b className="text-accent-blue font-semibold">{counts.completed}</b>{" "}
            completed
          </span>
        )}
        {counts.stopped > 0 && (
          <span>
            <b className="text-accent-red font-semibold">{counts.stopped}</b>{" "}
            stopped
          </span>
        )}
        {counts.other > 0 && (
          <span>
            <b className="text-text font-semibold">{counts.other}</b> other
          </span>
        )}
      </div>
    </div>
  );
}

/* ────── individual trial row inside the expand panel ────── */

function TrialSubRow({ trial }: { trial: DrugTrialRef }) {
  return (
    <tr className="border-t border-border-subtle first:border-t-0">
      <td className="px-3 py-2">
        <PhaseBadge phase={trial.phase} rank={trial.phase_rank} />
      </td>
      <td className="px-3 py-2 text-text-dim max-w-[340px] truncate">
        {trial.title ?? <span className="text-text-dimmer italic">—</span>}
      </td>
      <td className="px-3 py-2 text-text-dim max-w-[150px] truncate">
        {trial.indication ?? (
          <span className="text-text-dimmer italic">n/a</span>
        )}
      </td>
      <td className="px-3 py-2">
        <StatusPill status={trial.status} raw={trial.status_raw} />
      </td>
      <td className="px-3 py-2">
        <CompletionDate date={trial.primary_completion_date} size="sm" />
      </td>
      <td className="px-3 py-2 text-right">
        {trial.url && trial.nct_id ? (
          <a
            href={trial.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-[11px] text-accent-blue hover:underline"
          >
            {trial.nct_id} ↗
          </a>
        ) : (
          <span className="font-mono text-[11px] text-text-dimmer">—</span>
        )}
      </td>
    </tr>
  );
}

/* ────── affordances ────── */

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-150 ${
        open ? "rotate-90 text-accent-blue" : "text-text-dimmer"
      }`}
      aria-hidden
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

function TrialCountButton({ count, open }: { count: number; open: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-mono text-[12px] transition-colors ${
        open
          ? "bg-accent-blue/10 border-accent-blue/40 text-accent-blue"
          : "bg-bg-elev2 border-border text-text-dim group-hover:text-text"
      }`}
    >
      {count}
      <svg
        width={10}
        height={10}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`transition-transform duration-150 ${
          open ? "rotate-90" : ""
        }`}
        aria-hidden
      >
        <polyline points="9 6 15 12 9 18" />
      </svg>
    </span>
  );
}

/**
 * Completion date rendered with past/upcoming styling.
 *
 * Upcoming dates get a small amber dot so the eye picks out "catalysts
 * coming up"; past dates drop to a dimmer color and a tiny "past" caption
 * so readouts that already landed recede visually. All comparisons use the
 * ISO string directly — cheaper than parsing a Date and good enough for
 * day-level precision.
 */
function CompletionDate({
  date,
  size = "md",
}: {
  date: string | null | undefined;
  size?: "sm" | "md";
}) {
  if (!date) {
    return (
      <span
        className={`font-mono text-text-dimmer ${
          size === "sm" ? "text-[11px]" : "text-xs"
        }`}
      >
        —
      </span>
    );
  }
  const todayIso = new Date().toISOString().slice(0, 10);
  const isFuture = date >= todayIso;
  const dateCls = isFuture ? "text-text" : "text-text-dimmer";
  const sizeCls = size === "sm" ? "text-[11px]" : "text-xs";

  return (
    <div className="flex items-center gap-1.5">
      {isFuture && (
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full bg-accent-amber shrink-0"
          title="Upcoming"
        />
      )}
      <span className={`font-mono ${dateCls} ${sizeCls}`}>{date}</span>
      {!isFuture && (
        <span
          className={`text-text-dimmer ${
            size === "sm" ? "text-[9px]" : "text-[10px]"
          } uppercase tracking-wider`}
        >
          past
        </span>
      )}
    </div>
  );
}

function PhaseBadge({ phase, rank }: { phase: string; rank: number }) {
  const cls =
    rank >= 4
      ? "bg-accent-green/15 text-accent-green border-accent-green/30"
      : rank === 3
        ? "bg-accent-blue/15 text-accent-blue border-accent-blue/30"
        : rank === 2
          ? "bg-accent-purple/15 text-accent-purple border-accent-purple/30"
          : "bg-bg-elev2 text-text-dim border-border-subtle";
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border font-mono ${cls}`}
    >
      {phase}
    </span>
  );
}

function StatusPill({
  status,
  raw,
}: {
  status: string;
  raw: string | null;
}) {
  let cls = "bg-bg-elev2 text-text-dim border-border-subtle";
  if (raw === "RECRUITING" || raw === "ACTIVE_NOT_RECRUITING") {
    cls = "bg-accent-green/10 text-accent-green border-accent-green/30";
  } else if (raw === "COMPLETED") {
    cls = "bg-accent-blue/10 text-accent-blue border-accent-blue/30";
  } else if (
    raw === "SUSPENDED" ||
    raw === "TERMINATED" ||
    raw === "WITHDRAWN"
  ) {
    cls = "bg-accent-red/10 text-accent-red border-accent-red/30";
  } else if (raw === "NOT_YET_RECRUITING") {
    cls = "bg-accent-amber/10 text-accent-amber border-accent-amber/30";
  }
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${cls}`}
    >
      {status}
    </span>
  );
}
