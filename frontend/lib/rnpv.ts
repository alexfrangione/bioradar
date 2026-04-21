/**
 * Risk-adjusted NPV (rNPV) math for pipeline valuation.
 *
 * The model is deliberately simple so it's legible to end users:
 *   1. Each drug has a probability-of-success (PoS), peak annual sales, and
 *      a launch year.
 *   2. Revenue ramps 25% → 50% → 75% → 100% over the first four years.
 *   3. Peak revenue holds until the patent-exclusivity window closes.
 *   4. Each year's revenue × operating margin is discounted back to today.
 *   5. The full sum is multiplied by PoS to produce the risk-adjusted NPV.
 *
 * Defaults are seeded from phase (see `defaultPoSForPhase`) using the BIO
 * Clinical Development Success Rates 2011–2020 dataset as a reference.
 */

export type DrugAssumptions = {
  pos: number; // 0..1
  peakSalesUsd: number; // $ peak revenue
  launchYear: number; // first year of any revenue
};

export type GlobalAssumptions = {
  discountRate: number; // 0..1 (e.g. 0.12)
  operatingMargin: number; // 0..1 (e.g. 0.30)
  patentYears: number; // years of protected sales from launch
};

export const DEFAULT_GLOBALS: GlobalAssumptions = {
  discountRate: 0.12,
  operatingMargin: 0.3,
  patentYears: 12,
};

// Cumulative PoS from current phase to approval. Derived from BIO 2011–2020:
//   Ph1→Ph2 52% · Ph2→Ph3 29% · Ph3→NDA 58% · NDA→Approval 91%
// Rounded a touch for friendlier sliders.
export function defaultPoSForPhase(phaseRank: number): number {
  if (phaseRank >= 6) return 1.0; // Approved
  if (phaseRank >= 5) return 0.91; // Filed / Registration
  if (phaseRank >= 4) return 0.53; // Phase 3
  if (phaseRank >= 3) return 0.15; // Phase 2
  if (phaseRank >= 2) return 0.08; // Phase 1
  return 0.04; // Preclinical
}

// Rule-of-thumb time-to-market by phase. Intentionally coarse — user can edit.
export function defaultLaunchYear(
  phaseRank: number,
  currentYear: number,
): number {
  if (phaseRank >= 6) return currentYear;
  if (phaseRank >= 5) return currentYear + 1;
  if (phaseRank >= 4) return currentYear + 3;
  if (phaseRank >= 3) return currentYear + 5;
  if (phaseRank >= 2) return currentYear + 7;
  return currentYear + 9;
}

// Indication-agnostic default peak sales — users should edit this per drug
// once they look at each indication. $500M is a reasonable mid-size rare /
// oncology peak; blockbusters are $1B+.
export const DEFAULT_PEAK_SALES_USD = 500_000_000;

// Linear ramp for the first four years, then flat at peak until patent cliff.
function rampFraction(yearsSinceLaunch: number): number {
  if (yearsSinceLaunch < 0) return 0;
  if (yearsSinceLaunch < 1) return 0.25;
  if (yearsSinceLaunch < 2) return 0.5;
  if (yearsSinceLaunch < 3) return 0.75;
  return 1.0;
}

/**
 * Compute a single drug's rNPV as of `currentYear`. Years strictly before
 * `currentYear` are ignored (no retroactive cash flows counted).
 */
export function computeRNPV(
  drug: DrugAssumptions,
  globals: GlobalAssumptions,
  currentYear: number,
): number {
  let sum = 0;
  const end = drug.launchYear + globals.patentYears;
  for (let y = drug.launchYear; y < end; y++) {
    if (y < currentYear) continue;
    const yearsSinceLaunch = y - drug.launchYear;
    const yearsFromNow = y - currentYear;
    const revenue = drug.peakSalesUsd * rampFraction(yearsSinceLaunch);
    const cashFlow = revenue * globals.operatingMargin;
    const discounted = cashFlow / Math.pow(1 + globals.discountRate, yearsFromNow);
    sum += discounted;
  }
  return sum * drug.pos;
}

/**
 * Sensitivity deltas for a single input. Returns rNPV at (base - delta),
 * (base), and (base + delta) — useful for tornado charts.
 */
export function sensitivity(
  base: DrugAssumptions,
  globals: GlobalAssumptions,
  currentYear: number,
  knob: "pos" | "peakSalesUsd" | "launchYear" | "discountRate",
  deltaPct: number,
): { low: number; mid: number; high: number } {
  const mid = computeRNPV(base, globals, currentYear);
  const bump = (n: number, dir: 1 | -1) => n * (1 + dir * deltaPct);

  let low: number;
  let high: number;
  switch (knob) {
    case "pos":
      low = computeRNPV({ ...base, pos: bump(base.pos, -1) }, globals, currentYear);
      high = computeRNPV({ ...base, pos: bump(base.pos, 1) }, globals, currentYear);
      break;
    case "peakSalesUsd":
      low = computeRNPV(
        { ...base, peakSalesUsd: bump(base.peakSalesUsd, -1) },
        globals,
        currentYear,
      );
      high = computeRNPV(
        { ...base, peakSalesUsd: bump(base.peakSalesUsd, 1) },
        globals,
        currentYear,
      );
      break;
    case "launchYear": {
      // ±2 years rather than ±%, since year deltas are whole numbers
      const dy = 2;
      low = computeRNPV({ ...base, launchYear: base.launchYear - dy }, globals, currentYear);
      high = computeRNPV({ ...base, launchYear: base.launchYear + dy }, globals, currentYear);
      break;
    }
    case "discountRate":
      low = computeRNPV(
        base,
        { ...globals, discountRate: bump(globals.discountRate, -1) },
        currentYear,
      );
      high = computeRNPV(
        base,
        { ...globals, discountRate: bump(globals.discountRate, 1) },
        currentYear,
      );
      break;
  }
  return { low, mid, high };
}
