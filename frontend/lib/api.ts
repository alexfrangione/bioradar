/**
 * Thin API client for the BioTicker backend.
 */

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type Company = {
  ticker: string;
  name: string | null;
  exchange?: string;
  hq?: string;
  sector?: string;
  industry?: string;
  description?: string;
  market_cap_usd?: number;
  cash_usd?: number;
  quarterly_burn_usd?: number;
  runway_months?: number | null;
  shares_outstanding?: number;
  eps_ttm?: number | null;
  pe_ratio?: number | null;
  health?: "strong" | "stable" | "watch" | "risk";
  placeholder?: boolean;
  message?: string;
};

export type Trial = {
  nct_id: string | null;
  title: string | null;
  drug: string | null;
  drugs: string[];
  indication: string | null;
  conditions: string[];
  phase: string;
  phases_raw: string[];
  phase_rank: number;
  status: string;
  status_raw: string | null;
  primary_completion_date: string | null;
  last_update_date?: string | null;
  why_stopped?: string | null;
  url: string | null;
};

export type DrugTrialRef = {
  nct_id: string | null;
  title: string | null;
  phase: string;
  phase_rank: number;
  status: string;
  status_raw: string | null;
  indication: string | null;
  primary_completion_date: string | null;
  url: string | null;
};

export type StatusCounts = {
  active: number;
  planned: number;
  completed: number;
  stopped: number;
  other: number;
};

export type Drug = {
  drug: string | null;
  highest_phase: string;
  highest_phase_rank: number;
  indications: string[];
  indication: string | null;
  trial_count: number;
  latest_status: string;
  latest_status_raw: string | null;
  status_counts: StatusCounts;
  next_completion_date: string | null;
  nct_ids: string[];
  trials: DrugTrialRef[];
};

export type PipelineResponse = {
  ticker: string;
  sponsor: string | null;
  count: number; // raw trial count
  drug_count?: number;
  drugs?: Drug[];
  trials: Trial[];
  error?: string;
};

export type SearchHit = {
  symbol: string;
  name: string;
  exchange?: string | null;
  country?: string | null;
  type?: string | null;
};

export type SearchResponse = {
  query: string;
  results: SearchHit[];
  error?: string;
};

export type PricePoint = {
  date: string;
  close: number;
  volume: number;
};

export type PricesResponse = {
  ticker: string;
  period: string;
  source?: string;
  count: number;
  points: PricePoint[];
  error?: string;
};

export type CatalystType =
  | "approval"
  | "readout-positive"
  | "readout-negative"
  | "failure"
  | "fda-advisory"
  | "launch"
  | "filing"
  | "licensing"
  | "readout" // legacy
  | "other";

export type CatalystSource =
  | "curated" // hand-written in SEED_CATALYSTS
  | "ctgov-derived" // inferred from ClinicalTrials.gov pipeline data
  | "edgar-8k" // from SEC EDGAR 8-K filings (phase 2)
  | "news"; // from news API (phase 3)

export type CatalystEvent = {
  date: string;
  title: string;
  type: CatalystType;
  impact: "high" | "medium" | "low";
  past: boolean;
  summary?: string;
  source?: CatalystSource;
  /** Link back to source-of-truth (e.g. SEC filing). Only present on
   * machine-derived events where we have a real URL. */
  url?: string | null;
};

export type CatalystsResponse = {
  ticker: string;
  count: number;
  events: CatalystEvent[];
};

export type EarningsEvent = {
  date: string;
  period: string; // "Q3 2024"
  past: boolean;
};

export type EarningsResponse = {
  ticker: string;
  count: number;
  events: EarningsEvent[];
};

export type Quote = {
  ticker: string;
  name?: string | null;
  exchange?: string | null;
  currency?: string;
  datetime?: string | null;
  is_market_open?: boolean;
  price: number | null;
  previous_close: number | null;
  change: number | null;
  percent_change: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  average_volume: number | null;
  fifty_two_week_low: number | null;
  fifty_two_week_high: number | null;
  fifty_two_week_range: string | null;
  error?: string;
};

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------
// We rely on the backend's Cache-Control headers rather than forcing
// `no-store`. That lets Vercel's edge and the browser cache short-lived
// responses, which is a big perf win for repeat navigation.
//
// `next.revalidate` hints Next.js's data cache to revalidate every 60s for
// server components. Client components still honor the upstream header.
async function getJSON<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.error(`GET ${path} failed:`, err);
    return null;
  }
}

export function getCompany(ticker: string) {
  return getJSON<Company>(`/api/company/${encodeURIComponent(ticker)}`);
}

export function getPipeline(ticker: string, limit: number = 25) {
  return getJSON<PipelineResponse>(
    `/api/company/${encodeURIComponent(ticker)}/pipeline?limit=${limit}`,
  );
}

export function getPrices(ticker: string, period: string = "2y") {
  return getJSON<PricesResponse>(
    `/api/company/${encodeURIComponent(ticker)}/prices?period=${encodeURIComponent(
      period,
    )}`,
  );
}

export function getCatalysts(ticker: string) {
  return getJSON<CatalystsResponse>(
    `/api/company/${encodeURIComponent(ticker)}/catalysts`,
  );
}

export function getEarnings(ticker: string) {
  return getJSON<EarningsResponse>(
    `/api/company/${encodeURIComponent(ticker)}/earnings`,
  );
}

export function getQuote(ticker: string) {
  return getJSON<Quote>(`/api/company/${encodeURIComponent(ticker)}/quote`);
}

export function searchTickers(q: string, limit: number = 8) {
  return getJSON<SearchResponse>(
    `/api/search?q=${encodeURIComponent(q)}&limit=${limit}`,
  );
}

export { API_URL };
