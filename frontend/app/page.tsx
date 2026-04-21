"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { searchTickers, type SearchHit } from "@/lib/api";
import { BrandMark } from "@/components/Brand";
import SiteNav from "@/components/SiteNav";

// ---------------------------------------------------------------------------
// Static marketing data
//
// These drive the landing page's above-the-fold "proof of life" signals —
// ticker tape, sector pulse, and this week's catalyst strip. They're static
// seeds for now so the page renders instantly without a backend round-trip.
// A future /api/market/snapshot endpoint can replace these.
// ---------------------------------------------------------------------------

type Tick = { sym: string; px: string; chg: string; dir: "up" | "dn" };
const TAPE: Tick[] = [
  { sym: "MRNA", px: "$98.41", chg: "+2.1%", dir: "up" },
  { sym: "VRTX", px: "$481.22", chg: "+0.4%", dir: "up" },
  { sym: "CRSP", px: "$61.42", chg: "+3.2%", dir: "up" },
  { sym: "BEAM", px: "$28.77", chg: "−1.8%", dir: "dn" },
  { sym: "SRPT", px: "$128.04", chg: "+5.6%", dir: "up" },
  { sym: "NTLA", px: "$14.82", chg: "−0.9%", dir: "dn" },
  { sym: "REGN", px: "$842.11", chg: "+0.8%", dir: "up" },
  { sym: "BNTX", px: "$108.55", chg: "−2.4%", dir: "dn" },
  { sym: "EDIT", px: "$7.11", chg: "+4.1%", dir: "up" },
  { sym: "BIIB", px: "$192.18", chg: "−0.3%", dir: "dn" },
  { sym: "ALNY", px: "$218.49", chg: "+3.4%", dir: "up" },
  { sym: "MDGL", px: "$259.01", chg: "+0.7%", dir: "up" },
];

type StripEvent = {
  day: string;
  ticker: string;
  tag: string;
  type: "earnings" | "pdufa" | "adcom" | "readout";
  today?: boolean;
};
const STRIP: StripEvent[] = [
  { day: "Mon 21", ticker: "ISRG", tag: "Earnings", type: "earnings", today: true },
  { day: "Tue 22", ticker: "INSM", tag: "PDUFA", type: "pdufa" },
  { day: "Wed 23", ticker: "BEAM", tag: "BEACON readout", type: "readout" },
  { day: "Thu 24", ticker: "SRPT", tag: "AdCom", type: "adcom" },
  { day: "Fri 25", ticker: "MRNA", tag: "PDUFA", type: "pdufa" },
];

const DOT_COLOR: Record<StripEvent["type"], string> = {
  earnings: "bg-accent-green",
  pdufa: "bg-accent-amber",
  adcom: "bg-accent-blue",
  readout: "bg-accent-purple",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LandingPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const go = (ticker: string) => {
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    router.push(`/company/${t}`);
  };

  // Debounced search. Cancels in-flight lookups when the user types more.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const res = await searchTickers(q, 8);
      if (cancelled) return;
      setHits(res?.results ?? []);
      setHighlight(0);
      setSearching(false);
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // Close the dropdown when clicking outside the search box.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const showDropdown =
    open && query.trim().length >= 1 && (hits.length > 0 || searching);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (showDropdown && hits[highlight]) {
      go(hits[highlight].symbol);
    } else {
      go(query);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col">
      {/* ==================== NAV ==================== */}
      <SiteNav />

      {/* ==================== TICKER TAPE ==================== */}
      <div className="bg-bg-app border-b border-border-subtle py-2.5 overflow-hidden whitespace-nowrap">
        <div className="bt-tape-inner inline-flex gap-9 pl-9">
          {[...TAPE, ...TAPE].map((t, i) => (
            <span
              key={i}
              className="inline-flex gap-2 items-center font-mono text-[13px]"
            >
              <span className="font-semibold text-text">{t.sym}</span>
              <span className="text-text tabular-nums">{t.px}</span>
              <span
                className={`font-medium tabular-nums ${
                  t.dir === "up" ? "text-accent-green" : "text-accent-red"
                }`}
              >
                {t.chg}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* ==================== HERO ==================== */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-8 pt-14 pb-10">
        <div className="inline-flex items-center gap-2 bg-accent-green/[0.08] border border-accent-green/25 text-accent-green font-mono text-[11px] uppercase tracking-[0.1em] px-3.5 py-1.5 rounded-full mb-6">
          <span className="bt-pulse-dot w-1.5 h-1.5 rounded-full bg-accent-green" />
          Market open · 38 catalysts this week
        </div>

        <h1 className="text-5xl md:text-[3.5rem] font-bold tracking-[-0.03em] leading-[1.05] max-w-3xl mb-4">
          The biotech market,
          <br />
          <span className="text-accent-green">decoded.</span>
        </h1>
        <p className="text-text-dim text-[17px] max-w-xl leading-relaxed mb-7">
          Live prices, upcoming clinical readouts, PDUFA dates, and drug-by-drug
          pipelines — for every biotech ticker, in seconds.
        </p>

        <form
          onSubmit={handleSubmit}
          className="w-full max-w-xl flex gap-2"
        >
          <div ref={boxRef} className="relative flex-1">
            <input
              className="w-full px-4 py-3.5 rounded-lg bg-bg-elev border border-border text-text placeholder:text-text-dimmer outline-none focus:border-accent-green text-[16px]"
              placeholder="Enter a ticker — CRSP, Vertex, Moderna…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={handleKeyDown}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />

            {showDropdown && (
              <div className="absolute left-0 right-0 top-full mt-1.5 z-20 rounded-lg border border-border bg-bg-elev shadow-xl overflow-hidden text-left">
                {searching && hits.length === 0 && (
                  <div className="px-4 py-3 text-sm text-text-dim">
                    Searching…
                  </div>
                )}
                {hits.map((h, i) => (
                  <button
                    key={`${h.symbol}-${h.exchange ?? ""}-${i}`}
                    type="button"
                    onMouseEnter={() => setHighlight(i)}
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      go(h.symbol);
                    }}
                    className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors ${
                      i === highlight
                        ? "bg-bg-elev2"
                        : "hover:bg-bg-elev2/60"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono font-semibold text-sm text-text">
                        {h.symbol}
                      </span>
                      <span className="text-[13px] text-text-dim truncate">
                        {h.name}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-text-dimmer flex-shrink-0">
                      {h.exchange}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="submit"
            className="px-6 rounded-lg bg-accent-green text-bg-page font-semibold hover:bg-emerald-400 transition-colors text-sm"
          >
            Analyze →
          </button>
        </form>
      </section>

      {/* ==================== SECTOR PULSE ==================== */}
      <div className="bg-bg-app border-y border-border-subtle py-5 px-8 grid grid-cols-[auto_1fr] gap-8 items-center">
        <div className="flex items-center gap-2.5 font-mono text-[11px] text-text uppercase tracking-[0.14em] font-semibold whitespace-nowrap">
          <span className="inline-block translate-y-[2px]">
            <BrandMark px={13} />
          </span>
          Sector pulse
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <PulseCard
            tint="purple"
            icon={
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 2h6" />
                <path d="M10 2v6.5L5 18a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9.5V2" />
                <path d="M7 15h10" />
              </svg>
            }
            value="248"
            delta={{ text: "+12", dir: "up" }}
            label="Active Ph3 readouts tracked"
          />
          <PulseCard
            tint="amber"
            icon={
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
                <path d="M8 15l2 2 5-5" />
              </svg>
            }
            value="27"
            label="PDUFA dates this quarter"
          />
          <PulseCard
            tint="green"
            icon={
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2 4 7v7c0 5 4 8 8 8s8-3 8-8V7l-8-5z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            }
            value="14"
            delta={{ text: "+5 YoY", dir: "up" }}
            label="FDA approvals YTD"
          />
          <PulseCard
            tint="blue"
            icon={
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                <polyline points="16 7 22 7 22 13" />
              </svg>
            }
            value="+12.4%"
            delta={{ text: "▲", dir: "up" }}
            label="XBI biotech index · YTD"
          />
        </div>
      </div>

      {/* ==================== CATALYST STRIP ==================== */}
      <div className="bg-bg-elev border-t border-border-subtle py-3.5 px-8">
        <div className="flex items-center gap-6">
          <div className="flex flex-col gap-0.5 pr-5 border-r border-border-subtle whitespace-nowrap">
            <span className="font-mono text-[11px] text-text uppercase tracking-[0.14em] font-semibold">
              This week
            </span>
            <span className="font-mono text-[9.5px] text-text-dimmer uppercase tracking-[0.1em]">
              5 major catalysts
            </span>
          </div>

          <div className="flex-1 flex items-center gap-[22px] overflow-hidden">
            {STRIP.map((e) => (
              <span
                key={e.ticker + e.day}
                className="inline-flex items-baseline gap-2 whitespace-nowrap"
              >
                <span
                  className={`inline-block w-[7px] h-[7px] rounded-full ${DOT_COLOR[e.type]} -translate-y-[1px]`}
                />
                <span
                  className={`font-mono text-[10.5px] uppercase tracking-[0.12em] font-medium ${
                    e.today ? "text-accent-green" : "text-text-dim"
                  }`}
                >
                  {e.day}
                </span>
                <span className="font-mono font-semibold text-[13px] text-text">
                  {e.ticker}
                </span>
                <span className="text-[12px] text-text-dim">{e.tag}</span>
              </span>
            ))}
          </div>

          <Link
            href="/catalysts"
            className="pl-5 border-l border-border-subtle text-text-dim hover:text-accent-green text-[12px] font-medium whitespace-nowrap transition-colors"
          >
            See all catalysts →
          </Link>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Pulse card
// ---------------------------------------------------------------------------
// Small stat card used in the Sector pulse strip. We inline the tint→class map
// as full class strings so Tailwind's JIT extractor picks them up (it can't see
// dynamic template strings like `bg-accent-${tint}/12`).
// ---------------------------------------------------------------------------

type Tint = "purple" | "amber" | "green" | "blue";

const TINT_BG: Record<Tint, string> = {
  purple: "bg-accent-purple/[0.12] text-accent-purple",
  amber: "bg-accent-amber/[0.14] text-accent-amber",
  green: "bg-accent-green/[0.14] text-accent-green",
  blue: "bg-accent-blue/[0.12] text-accent-blue",
};

function PulseCard({
  tint,
  icon,
  value,
  label,
  delta,
}: {
  tint: Tint;
  icon: React.ReactNode;
  value: string;
  label: string;
  delta?: { text: string; dir: "up" | "dn" };
}) {
  return (
    <div className="flex items-center gap-3.5">
      <div
        className={`flex-shrink-0 w-9 h-9 rounded-[9px] flex items-center justify-center ${TINT_BG[tint]}`}
      >
        {icon}
      </div>
      <div className="min-w-0 grid gap-[2px]">
        <div className="font-mono font-semibold text-[20px] text-text tabular-nums tracking-[-0.01em] leading-none">
          {value}
          {delta && (
            <span
              className={`text-[11px] font-medium ml-1 ${
                delta.dir === "up" ? "text-accent-green" : "text-accent-red"
              }`}
            >
              {delta.text}
            </span>
          )}
        </div>
        <div className="text-[11.5px] text-text-dim leading-tight">{label}</div>
      </div>
    </div>
  );
}
