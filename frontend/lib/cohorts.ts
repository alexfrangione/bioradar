/**
 * Peer cohort definitions. Intentionally hand-curated — peers by modality or
 * indication space matter more than SIC-code matching for biotechs. If a
 * ticker isn't in any cohort, we fall back to a "no cohort defined" state.
 */

export type Cohort = {
  id: string;
  label: string;
  tickers: string[]; // ordered roughly by market cap
};

export const COHORTS: Cohort[] = [
  {
    id: "gene-editing",
    label: "Gene editing",
    tickers: ["CRSP", "BEAM", "NTLA", "EDIT", "VERV"],
  },
  {
    id: "mrna",
    label: "mRNA platforms",
    tickers: ["MRNA", "BNTX"],
  },
  {
    id: "gene-therapy-rare",
    label: "Gene therapy · rare disease",
    tickers: ["SRPT", "RGNX", "RCKT", "SLDB"],
  },
  {
    id: "large-cap-biotech",
    label: "Large-cap biotech",
    tickers: ["VRTX", "REGN", "BIIB", "GILD", "AMGN"],
  },
];

// Reverse lookup so we can find a ticker's cohort in O(1).
const TICKER_TO_COHORT: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const c of COHORTS) for (const t of c.tickers) m[t] = c.id;
  return m;
})();

export function cohortForTicker(ticker: string): Cohort | null {
  const id = TICKER_TO_COHORT[ticker.toUpperCase()];
  if (!id) return null;
  return COHORTS.find((c) => c.id === id) ?? null;
}
