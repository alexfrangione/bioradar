"use client";

import { useEffect, useState } from "react";
import {
  isWatching,
  subscribeWatchlist,
  toggleWatchlist,
} from "@/lib/watchlist";

type Props = {
  ticker: string;
  /** Visual size variant. "md" is the header default, "sm" fits table rows. */
  size?: "sm" | "md";
};

/**
 * Star button — adds / removes a ticker from the localStorage watchlist.
 *
 * Renders in a safe "empty" state on the server (ssr) to avoid hydration
 * mismatches, then fills in the true watching state after mount.
 */
export default function StarButton({ ticker, size = "md" }: Props) {
  const [mounted, setMounted] = useState(false);
  const [watched, setWatched] = useState(false);

  useEffect(() => {
    setMounted(true);
    setWatched(isWatching(ticker));
    // Keep in sync when other components (or other tabs) mutate the list.
    return subscribeWatchlist(() => setWatched(isWatching(ticker)));
  }, [ticker]);

  const handleClick = () => {
    const nowWatched = toggleWatchlist(ticker);
    setWatched(nowWatched);
  };

  const dims = size === "sm" ? "w-7 h-7" : "w-9 h-9";
  const iconSize = size === "sm" ? 14 : 18;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
      title={watched ? "Remove from watchlist" : "Add to watchlist"}
      className={`${dims} flex items-center justify-center rounded-md border transition-colors ${
        mounted && watched
          ? "border-accent-amber/40 bg-accent-amber/10 text-accent-amber hover:bg-accent-amber/20"
          : "border-border text-text-dim hover:border-border-subtle hover:text-text"
      }`}
    >
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill={mounted && watched ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <polygon points="12 2.5 14.9 9 22 10 16.5 14.8 18 22 12 18 6 22 7.5 14.8 2 10 9.1 9" />
      </svg>
    </button>
  );
}
