import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BioRadar — biotech investor research",
  description:
    "Pipeline, catalysts, and risk-adjusted valuation for any biotech ticker.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-bg-page text-text">{children}</body>
    </html>
  );
}
