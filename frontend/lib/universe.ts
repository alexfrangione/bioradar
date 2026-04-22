// Curated universe of liquid healthcare tickers used across Screener,
// Pipeline, Heatmap, and the default "Popular" view on Catalysts. One source
// of truth so the cross-company pages stay in sync.
//
// Mirrors backend/main.py::_HEALTHCARE_DIRECTORY — keep in lockstep. The
// backend uses the same set for /api/search fast-path + local name matching.
//
// Coverage: biotech (gene editing, RNAi, cell therapy, oncology, rare
// disease, neurology), megacap pharma, medical devices, life-sciences tools,
// diagnostics, managed care, and drug distribution.
export const POPULAR_TICKERS = [
  // Biotech — gene editing / RNAi / cell therapy
  "MRNA", "VRTX", "CRSP", "BEAM", "SRPT", "NTLA", "EDIT", "ALNY",
  "ARWR", "IONS", "BLUE", "KRYS", "VRCA",
  // Large/mid-cap biotech
  "REGN", "BNTX", "BIIB", "GILD", "AMGN", "INCY", "BMRN", "SGEN",
  "EXEL", "HALO", "NBIX",
  // Mid/small biotech
  "MDGL", "INSM", "MRTX", "LGND", "ACAD", "RIGL", "RARE", "VKTX",
  "AXSM", "CRNX", "CPRX", "ETNB", "IMVT", "ITCI", "MNMD", "PTCT",
  "RNA", "RYTM", "SAVA", "SMMT", "TGTX", "TVTX",
  // Megacap pharma
  "PFE", "MRK", "LLY", "JNJ", "ABBV", "NVO", "AZN", "BMY", "SNY",
  "GSK", "NVS", "RHHBY", "TAK",
  // Medical devices
  "MDT", "ISRG", "SYK", "BSX", "EW", "DXCM", "BDX", "ZBH", "ABT",
  "BAX", "PODD", "HOLX", "RMD", "IDXX",
  // Life-sciences tools / diagnostics
  "TMO", "DHR", "WAT", "A", "MTD", "ILMN", "LH", "DGX", "CRL",
  "ICLR", "IQV", "EXAS", "NTRA", "GH",
  // Managed care / services / distribution
  "UNH", "CVS", "CI", "HUM", "ELV", "CNC", "MOH", "MCK", "CAH",
  "COR", "WBA",
];
