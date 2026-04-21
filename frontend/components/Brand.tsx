/**
 * BioTicker wordmark + capsid mark.
 *
 * The capsid is the 6-spike (hexagonal) version of the 20A design — a small
 * virus silhouette that replaces the original green dot. Positioning constants
 * (margin-left, translateY) match the locked `capsid-density.html` mockup for
 * the 6-spike nav row.
 */

type BrandSize = "nav" | "hero";

function CapsidMark({ px }: { px: number }) {
  const core = 5;
  const spikeLen = 10; // line from r=5 out to cy=4 in the 28x28 viewBox
  const headR = 2;
  const stroke = 1.4;

  // Six spikes at 60° intervals.
  const angles = [0, 60, 120, 180, 240, 300];

  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 28 28"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="14" cy="14" r={core} fill="currentColor" />
      {angles.map((a) => (
        <g key={a} transform={`rotate(${a} 14 14)`}>
          <line
            x1="14"
            y1="14"
            x2="14"
            y2={14 - spikeLen}
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
          />
          <circle cx="14" cy="3" r={headR} fill="currentColor" />
        </g>
      ))}
    </svg>
  );
}

export function BrandMark({ px = 28 }: { px?: number }) {
  return (
    <span className="inline-block text-accent-green">
      <CapsidMark px={px} />
    </span>
  );
}

/**
 * Full wordmark: lowercase "bioticker" in Geist 600 with the capsid accent.
 * Use `size="nav"` inside headers (19px) and `size="hero"` for big landing
 * treatments (42px).
 */
export default function Brand({ size = "nav" }: { size?: BrandSize }) {
  const isNav = size === "nav";
  const fontPx = isNav ? 19 : 42;
  const markPx = isNav ? 15 : 28;
  // Pulled from capsid-density.html — 6-spike nav row positioning.
  const marginLeft = isNav ? 3 : 6;
  const translateY = isNav ? -3 : -9;

  return (
    <span
      className="inline-flex items-baseline font-semibold lowercase tracking-[-0.04em] text-text"
      style={{ fontSize: fontPx, gap: 0, fontFamily: "Geist, system-ui, sans-serif" }}
    >
      bioticker
      <span
        className="inline-block text-accent-green"
        style={{ marginLeft, transform: `translateY(${translateY}px)` }}
      >
        <CapsidMark px={markPx} />
      </span>
    </span>
  );
}
