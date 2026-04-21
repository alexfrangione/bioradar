/**
 * Thin API client for the BioRadar backend.
 *
 * The base URL comes from NEXT_PUBLIC_API_URL so the same code works in
 * local dev and in production.
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
  description?: string;
  market_cap_usd?: number;
  cash_usd?: number;
  quarterly_burn_usd?: number;
  runway_months?: number | null;
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
  url: string | null;
};

export type PipelineResponse = {
  ticker: string;
  sponsor: string;
  count: number;
  trials: Trial[];
};

export type PricePoint = {
  date: string; // YYYY-MM-DD
  close: number;
  volume: number;
};

export type PricesResponse = {
  ticker: string;
  period: string;
  count: number;
  points: PricePoint[];
};

export type CatalystType = "approval" | "readout" | "launch" | "filing" | "other";

export type CatalystEvent = {
  date: string; // YYYY-MM-DD
  title: string;
  type: CatalystType;
  impact: "high" | "medium" | "low";
  past: boolean;
};

export type CatalystsResponse = {
  ticker: string;
  count: number;
  events: CatalystEvent[];
};

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------
export async function getCompany(ticker: string): Promise<Company | null> {
  try {
    const res = await fetch(
      `${API_URL}/api/company/${encodeURIComponent(ticker)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    return (await res.json()) as Company;
  } catch (err) {
    console.error("getCompany failed:", err);
    return null;
  }
}

export async function getPipeline(
  ticker: string,
): Promise<PipelineResponse | null> {
  try {
    const res = await fetch(
      `${API_URL}/api/company/${encodeURIComponent(ticker)}/pipeline`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    return (await res.json()) as PipelineResponse;
  } catch (err) {
    console.error("getPipeline failed:", err);
    return null;
  }
}

export async function getPrices(
  ticker: string,
  period: string = "2y",
): Promise<PricesResponse | null> {
  try {
    const res = await fetch(
      `${API_URL}/api/company/${encodeURIComponent(
        ticker,
      )}/prices?period=${encodeURIComponent(period)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    return (await res.json()) as PricesResponse;
  } catch (err) {
    console.error("getPrices failed:", err);
    return null;
  }
}

export async function getCatalysts(
  ticker: string,
): Promise<CatalystsResponse | null> {
  try {
    const res = await fetch(
      `${API_URL}/api/company/${encodeURIComponent(ticker)}/catalysts`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    return (await res.json()) as CatalystsResponse;
  } catch (err) {
    console.error("getCatalysts failed:", err);
    return null;
  }
}

export { API_URL };
