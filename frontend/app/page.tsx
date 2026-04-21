"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { searchTickers, type SearchHit } from "@/lib/api";

const EXAMPLE_TICKERS = ["CRSP", "SRPT", "BEAM", "VRTX", "MRNA"];

const UPCOMING_CATALYSTS = [
  { ticker: "SRPT", event: "FDA AdCom — May 8", color: "bg-accent-purple" },
  { ticker: "BEAM", event: "BEACON Ph1/2 readout — Q3", color: "bg-accent-blue" },
  { ticker: "CRSP", event: "ASCO presentation — Jun 5", color: "bg-accent-amber" },
  { ticker: "VRTX", event: "Earnings — May 2", color: "bg-accent-green" },
  { ticker: "NTLA", event: "NTLA-2002 Ph3 interim — Q2", color: "bg-accent-blue" },
];

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
    // If the user picked a highlighted suggestion, use its symbol. Otherwise,
    // fall back to whatever they typed.
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
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-4 border-b border-border-subtle">
        <div className="flex items-center gap-2.5 font-bold tracking-tight">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-accent-blue to-accent-purple flex items-center justify-center text-bg-app font-bold text-sm">
            B
          </div>
          BioRadar
        </div>
        <div className="flex items-center gap-6">
          <a className="text-text-dim hover:text-text text-[13px] cursor-pointer">
            Methodology
          </a>
          <Link
            href="/watchlist"
            className="text-text-dim hover:text-text text-[13px] cursor-pointer"
          >
            Watchlist
          </Link>
          <button className="px-3.5 py-1.5 text-[13px] font-medium bg-bg-elev border border-border rounded-md hover:bg-bg-elev2">
            Log in
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center text-center px-8 py-24">
        <div className="text-xs font-semibold text-accent-blue tracking-widest uppercase mb-4">
          Due diligence for biotech investors
        </div>
        <h1 className="text-5xl md:text-[3rem] font-bold tracking-tight leading-[1.1] max-w-3xl mb-4">
          Every biotech, decoded in one page.
        </h1>
        <p className="text-text-dim text-lg max-w-xl mb-10">
          Pipeline, upcoming catalysts, cash runway, and risk-adjusted pipeline
          valuation — for any ticker, in seconds.
        </p>

        <form
          onSubmit={handleSubmit}
          className="w-full max-w-xl flex gap-2 mb-4"
        >
          <div ref={boxRef} className="relative flex-1">
            <input
              className="w-full px-4 py-3 rounded-lg bg-bg-elev border border-border text-text placeholder:text-text-dimmer outline-none focus:border-accent-blue"
              placeholder="Enter ticker or company name — CRSP, Vertex, Moderna…"
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
                      // onMouseDown (not onClick) so we fire before the input blur
                      // closes the dropdown.
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
            className="px-6 rounded-lg bg-accent-blue text-bg-app font-semibold hover:bg-sky-400 transition-colors"
          >
            Analyze →
          </button>
        </form>

        <div className="flex items-center gap-2 flex-wrap justify-center">
          <span className="text-text-dimmer text-[13px] mr-1">Try:</span>
          {EXAMPLE_TICKERS.map((t) => (
            <button
              key={t}
              onClick={() => go(t)}
              className="px-3 py-1 rounded-full bg-bg-elev border border-border-subtle font-mono text-xs text-text-dim hover:bg-bg-elev2 hover:text-text"
            >
              {t}
            </button>
          ))}
        </div>
      </section>

      {/* Catalyst tape */}
      <div className="border-t border-border-subtle bg-bg-elev px-8 py-3.5 flex gap-10 items-center overflow-hidden whitespace-nowrap text-[13px]">
        <span className="text-accent-blue font-semibold text-[11px] tracking-widest uppercase pr-5 border-r border-border-subtle">
          Upcoming
        </span>
        {UPCOMING_CATALYSTS.map((c, i) => (
          <span
            key={i}
            className="text-text-dim flex gap-2 items-center shrink-0"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${c.color}`} />
            <span className="text-text font-mono font-semibold">
              {c.ticker}
            </span>
            {c.event}
          </span>
        ))}
      </div>
    </main>
  );
}
