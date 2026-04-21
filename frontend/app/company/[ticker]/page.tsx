import Link from "next/link";
import { getCompany, getQuote, type Company, type Quote } from "@/lib/api";
import Pipeline from "@/components/Pipeline";
import StockChart from "@/components/StockChart";
import StarButton from "@/components/StarButton";
import Valuation from "@/components/Valuation";
import PeerComparison from "@/components/PeerComparison";
import SiteNav from "@/components/SiteNav";

// Next.js 14 dynamic route — `params.ticker` from the URL.
type Params = { ticker: string };

export default async function CompanyPage({ params }: { params: Params }) {
  const ticker = params.ticker.toUpperCase();
  // Fetch company + quote in parallel. Quote can be null if Twelve Data
  // errors or is rate-limited; header falls back gracefully.
  const [company, quote] = await Promise.all([
    getCompany(ticker),
    getQuote(ticker),
  ]);

  return (
    <main className="min-h-screen">
      {/* Top nav */}
      <SiteNav />

      {/* Error: backend unreachable */}
      {company === null && <BackendDown ticker={ticker} />}

      {/* Placeholder: unknown ticker */}
      {company?.placeholder && <Placeholder company={company} />}

      {/* Real company data */}
      {company && !company.placeholder && (
        <CompanyHeader company={company} quote={quote} />
      )}
    </main>
  );
}

/* ---------- sub-components ---------- */

function CompanyHeader({
  company,
  quote,
}: {
  company: Company;
  quote: Quote | null;
}) {
  const hasPrice = quote && !quote.error && quote.price != null;
  const changeDir =
    quote?.change == null ? 0 : quote.change > 0 ? 1 : quote.change < 0 ? -1 : 0;

  return (
    <>
      {/* Identity row */}
      <div className="px-8 py-5 border-b border-border-subtle flex items-center justify-between gap-5 flex-wrap">
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
              {company.sector ? ` · ${company.sector}` : ""}
            </div>
          </div>
          <StarButton ticker={company.ticker} />
        </div>

        {/* Live price block */}
        {hasPrice && (
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-2xl font-bold leading-none">
              ${quote!.price!.toFixed(2)}
            </span>
            <span
              className={`font-mono text-sm font-semibold ${
                changeDir > 0
                  ? "text-accent-green"
                  : changeDir < 0
                    ? "text-accent-red"
                    : "text-text-dim"
              }`}
            >
              {changeDir >= 0 ? "+" : ""}
              {quote!.change?.toFixed(2) ?? "0.00"} (
              {changeDir >= 0 ? "+" : ""}
              {quote!.percent_change?.toFixed(2) ?? "0.00"}%)
            </span>
            {quote!.is_market_open === false && (
              <span className="text-[10px] uppercase tracking-wider text-text-dimmer border border-border-subtle px-1.5 py-0.5 rounded">
                Closed
              </span>
            )}
          </div>
        )}
      </div>

      {/* Metrics row */}
      <div className="px-8 py-4 border-b border-border-subtle flex flex-wrap gap-x-8 gap-y-4 items-center">
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
              : company.cash_usd != null
                ? "profitable"
                : "—"
          }
          sub={
            company.quarterly_burn_usd
              ? `${formatUSD(company.quarterly_burn_usd)} Q burn`
              : undefined
          }
        />
        <Metric
          label="P/E (TTM)"
          value={
            company.pe_ratio != null ? company.pe_ratio.toFixed(1) : "—"
          }
          sub={
            company.eps_ttm != null
              ? `EPS $${company.eps_ttm.toFixed(2)}`
              : company.eps_ttm === null && company.pe_ratio === null
                ? undefined
                : "unprofitable"
          }
        />
        <Metric
          label="52-Wk Range"
          value={formatRange(
            quote?.fifty_two_week_low,
            quote?.fifty_two_week_high,
          )}
        />
        <Metric
          label="Avg Volume"
          value={formatVolume(quote?.average_volume)}
          sub="3-month"
        />
        {company.health && <HealthChip health={company.health} />}
      </div>

      {company.description && (
        <p className="px-8 py-4 text-[13px] text-text-dim border-b border-border-subtle leading-relaxed">
          {company.description}
        </p>
      )}

      <div className="p-8 space-y-6">
        <StockChart ticker={company.ticker} />
        <Pipeline ticker={company.ticker} />
        <Valuation company={company} quote={quote} />
        <PeerComparison ticker={company.ticker} />
      </div>
    </>
  );
}

function Placeholder({ company }: { company: Company }) {
  return (
    <div className="px-8 py-20 text-center">
      <div className="inline-block px-4 py-2 rounded-md bg-accent-amber/10 text-accent-amber text-xs font-semibold uppercase tracking-widest mb-5 border border-accent-amber/30">
        Ticker not found
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

function formatVolume(n?: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function formatRange(lo?: number | null, hi?: number | null): string {
  if (lo == null || hi == null) return "—";
  return `$${lo.toFixed(2)} – $${hi.toFixed(2)}`;
}
