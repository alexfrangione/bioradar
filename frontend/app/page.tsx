"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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

  const go = (ticker: string) => {
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    router.push(`/company/${t}`);
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
          <a className="text-text-dim hover:text-text text-[13px] cursor-pointer">
            Watchlist
          </a>
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
          onSubmit={(e) => {
            e.preventDefault();
            go(query);
          }}
          className="w-full max-w-xl flex gap-2 mb-4"
        >
          <input
            className="flex-1 px-4 py-3 rounded-lg bg-bg-elev border border-border text-text placeholder:text-text-dimmer outline-none focus:border-accent-blue"
            placeholder="Enter ticker or company name — CRSP, Vertex, Moderna…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
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
