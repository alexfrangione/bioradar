"use client";

import { useEffect, useState } from "react";
import { getPipeline, type PipelineResponse, type Trial } from "@/lib/api";

type Props = {
  ticker: string;
};

export default function Pipeline({ ticker }: Props) {
  const [data, setData] = useState<PipelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPipeline(ticker)
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

  return (
    <section className="rounded-xl border border-border-subtle bg-bg-elev">
      <header className="px-5 py-3.5 border-b border-border-subtle flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold tracking-widest uppercase text-accent-blue">
            Pipeline
          </div>
          <h2 className="text-sm text-text-dim mt-0.5">
            Clinical trials sponsored by {data?.sponsor ?? ticker} ·{" "}
            <span className="font-mono">ClinicalTrials.gov</span>
          </h2>
        </div>
        {data && (
          <span className="text-xs text-text-dim font-mono">
            {data.count} trial{data.count === 1 ? "" : "s"}
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

      {!loading && data && data.trials.length === 0 && (
        <div className="px-5 py-8 text-center text-text-dim text-sm">
          No trials found for this sponsor.
        </div>
      )}

      {!loading && data && data.trials.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-text-dimmer border-b border-border-subtle">
                <th className="text-left font-semibold px-5 py-2.5 w-[90px]">
                  Phase
                </th>
                <th className="text-left font-semibold px-3 py-2.5">
                  Drug / Candidate
                </th>
                <th className="text-left font-semibold px-3 py-2.5">
                  Indication
                </th>
                <th className="text-left font-semibold px-3 py-2.5 w-[140px]">
                  Status
                </th>
                <th className="text-left font-semibold px-3 py-2.5 w-[130px]">
                  Primary Completion
                </th>
                <th className="text-right font-semibold px-5 py-2.5 w-[100px]">
                  NCT ID
                </th>
              </tr>
            </thead>
            <tbody>
              {data.trials.map((t) => (
                <TrialRow key={t.nct_id ?? t.title ?? Math.random()} trial={t} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TrialRow({ trial }: { trial: Trial }) {
  return (
    <tr className="border-b border-border-subtle last:border-b-0 hover:bg-bg-elev2/50 transition-colors">
      <td className="px-5 py-3">
        <PhaseBadge phase={trial.phase} rank={trial.phase_rank} />
      </td>
      <td className="px-3 py-3 font-medium">
        {trial.drug ?? <span className="text-text-dim italic">—</span>}
        {trial.drugs.length > 1 && (
          <span className="text-text-dimmer text-xs ml-2">
            +{trial.drugs.length - 1}
          </span>
        )}
      </td>
      <td className="px-3 py-3 text-text-dim max-w-[280px] truncate">
        {trial.indication ?? (
          <span className="text-text-dimmer italic">n/a</span>
        )}
      </td>
      <td className="px-3 py-3">
        <StatusPill status={trial.status} raw={trial.status_raw} />
      </td>
      <td className="px-3 py-3 font-mono text-xs text-text-dim">
        {trial.primary_completion_date ?? "—"}
      </td>
      <td className="px-5 py-3 text-right">
        {trial.url && trial.nct_id ? (
          <a
            href={trial.url}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs text-accent-blue hover:underline"
          >
            {trial.nct_id} ↗
          </a>
        ) : (
          <span className="font-mono text-xs text-text-dimmer">—</span>
        )}
      </td>
    </tr>
  );
}

function PhaseBadge({ phase, rank }: { phase: string; rank: number }) {
  // Color intensifies with phase rank.
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
  let cls =
    "bg-bg-elev2 text-text-dim border-border-subtle";
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
