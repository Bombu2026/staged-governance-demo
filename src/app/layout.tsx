import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({ subsets: ["latin"], axes: ["opsz"], variable: "--font-bricolage" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "Pooled funding: a concept demo for Slop",
  description:
    "Independent concept demo of all-or-nothing pooled funding for open-source builds: several funders fill a pool, contributors list it with a Proof of Love vote, and it is paid by Points or refunded in full. The simulation runs in your browser; an optional live mode uses the Base Sepolia testnet only. Not affiliated with or endorsed by slop.cash.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0f0e0c",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${bricolage.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
