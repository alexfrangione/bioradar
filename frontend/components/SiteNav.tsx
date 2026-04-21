"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Brand from "@/components/Brand";

// Shared top nav. One source of truth for the link set so every page stays in
// lockstep. Active-state highlighting keys off the current pathname.

type NavLink = { href: string; label: string };

const LINKS: NavLink[] = [
  { href: "/catalysts", label: "Catalysts" },
  { href: "/screener", label: "Screener" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/heatmap", label: "Heatmap" },
  { href: "/watchlist", label: "Watchlist" },
];

export default function SiteNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav className="flex items-center justify-between px-8 py-4 border-b border-border-subtle">
      <Link href="/" className="inline-flex">
        <Brand size="nav" />
      </Link>
      <div className="flex items-center gap-6">
        {LINKS.map((l) => {
          const active = pathname === l.href || pathname.startsWith(l.href + "/");
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`text-[13px] font-medium transition-colors ${
                active
                  ? "text-text"
                  : "text-text-dim hover:text-text"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
        <button className="px-3.5 py-1.5 text-[13px] font-medium bg-bg-elev border border-border rounded-lg hover:bg-bg-elev2 text-text">
          Log in
        </button>
      </div>
    </nav>
  );
}
