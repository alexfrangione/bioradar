/**
 * Thin API client for the BioRadar backend.
 *
 * The base URL comes from NEXT_PUBLIC_API_URL so the same code works in
 * local dev and in production.
 */

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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
