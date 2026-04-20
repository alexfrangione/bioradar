import Link from "next/link";
import { getCompany, type Company } from "@/lib/api";

// Next.js 14 dynamic route — `params.ticker` from the URL.
type Params = { ticker: string };

export default async function CompanyPage({ params }: { params: Params }) {
  const ticker = params.ticker.toUpperCase();
  const company = await getCompany(ticker);

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
            ← Back to search
          </Link>
        </div>
      </nav>

      {/* Error: backend unreachable */}
      {company === null && <BackendDown ticker={ticker} />}

      {/* Placeholder: unknown ticker */}
      {company?.placeholder && <Placeholder company={company} />}

      {/* Real company data */}
      {company && !company.placeholder && <CompanyHeader company={company} />}
    </main>
  );
}

/* ---------- sub-components ---------- */

function CompanyHeader({ company }: { company: Company }) {
  return (
    <>
      <div className="px-8 py-5 border-b border-border-subtle flex items-center justify-between gap-5">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-[#2d4a7c] to-[#1f3356] flex items-center justify-center font-bold text-[#c5d7f2] text-sm">
            {company.ticker}
          </div>
          <div>
            <div className="font-semibold text-lg leading-tight">
              {company.name}
            </div>
            <div className="text-xs text-text-dim font-mono mt-0.5">
              {company.exchange}: {company.ticker}
              {company.hq ? ` · ${company.hq}` : ""}
            </div>
          </div>
        </div>
        <div className="flex gap-7 items-center">
          <Metric
            label="Market Cap"
            value={formatUSD(company.market_cap_usd)}
          />
          <Metric
            label="Cash"
            value={formatUSD(company.cash_usd)}
            sub="most recent"
          />
          <Metric
            label="Runway"
            value={
              company.runway_months
                ? `${company.runway_months} mo`
                : "profitable"
            }
            sub={
              company.quarterly_burn_usd
                ? `${formatUSD(company.quarterly_burn_usd)} Q burn`
                : undefined
            }
          />
          {company.health && <HealthChip health={company.health} />}
        </div>
      </div>

      {company.description && (
        <p className="px-8 py-4 text-[13px] text-text-dim border-b border-border-subtle leading-relaxed">
          {company.description}
        </p>
      )}

      <div className="p-8">
        <div className="rounded-xl border border-border-subtle bg-bg-elev p-8 text-center">
          <div className="text-xs font-semibold tracking-widest uppercase text-accent-blue mb-3">
            Coming next
          </div>
          <h2 className="text-xl font-semibold mb-2">
            Pipeline, catalyst calendar, and rNPV workbench
          </h2>
          <p className="text-text-dim max-w-xl mx-auto text-sm">
            The header strip above is wired to real API data. In the next
            iteration we&apos;ll add the pipeline table, catalyst calendar,
            financial charts, and interactive valuation model you saw in the
            mockups.
          </p>
        </div>
      </div>
    </>
  );
}

function Placeholder({ company }: { company: Company }) {
  return (
    <div className="px-8 py-20 text-center">
      <div className="inline-block px-4 py-2 rounded-md bg-accent-amber/10 text-accent-amber text-xs font-semibold uppercase tracking-widest mb-5 border border-accent-amber/30">
        No seed data
      </div>
      <h1 className="text-3xl font-bold mb-3">
        <span className="font-mono">{company.ticker}</span>
      </h1>
      <p className="text-text-dim max-w-md mx-auto mb-6">{company.message}</p>
      <Link
        href="/"
        className="inline-block px-5 py-2.5 rounded-md bg-accent-blue text-bg-app font-semibold text-sm"
      >
        ← Back to search
      </Link>
    </div>
  );
}

function BackendDown({ ticker }: { ticker: string }) {
  return (
    <div className="px-8 py-20 text-center">
      <div className="inline-block px-4 py-2 rounded-md bg-accent-red/10 text-accent-red text-xs font-semibold uppercase tracking-widest mb-5 border border-accent-red/30">
        Backend unreachable
      </div>
      <h1 className="text-3xl font-bold mb-3">
        Can&apos;t load <span className="font-mono">{ticker}</span>
      </h1>
      <p className="text-text-dim max-w-md mx-auto mb-2">
        The frontend loaded, but the backend API isn&apos;t responding.
      </p>
      <p className="text-text-dimmer text-xs max-w-md mx-auto mb-6">
        Check that FastAPI is running at{" "}
        <code className="font-mono">NEXT_PUBLIC_API_URL</code>.
      </p>
      <Link
        href="/"
        className="inline-block px-5 py-2.5 rounded-md bg-bg-elev border border-border text-sm"
      >
        ← Back
      </Link>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wider text-text-dimmer mb-1">
        {label}
      </span>
      <span className="font-mono text-base font-semibold">{value}</span>
      {sub && <span className="text-[11px] text-text-dim mt-0.5">{sub}</span>}
    </div>
  );
}

function HealthChip({ health }: { health: string }) {
  const styles: Record<string, string> = {
    strong: "bg-accent-green/10 text-accent-green border-accent-green/30",
    stable: "bg-accent-green/10 text-accent-green border-accent-green/30",
    watch: "bg-accent-amber/10 text-accent-amber border-accent-amber/30",
    risk: "bg-accent-red/10 text-accent-red border-accent-red/30",
  };
  const cls = styles[health] ?? styles.stable;
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wider text-text-dimmer mb-1">
        Health
      </span>
      <span
        className={`px-2.5 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wider border ${cls}`}
      >
        {health}
      </span>
    </div>
  );
}

function formatUSD(n?: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n}`;
}
