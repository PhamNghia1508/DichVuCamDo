import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Be_Vietnam_Pro, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const display = Instrument_Serif({ subsets: ["latin", "latin-ext"], weight: "400", style: ["normal", "italic"], variable: "--font-display", display: "swap" });
const sans = Be_Vietnam_Pro({ subsets: ["latin", "vietnamese"], weight: ["400", "500", "600", "700"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin", "vietnamese"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "TasteCircle — plan a night out everyone will love",
  description:
    "An AI agent that finds the dinner, activity and playlist your whole group overlaps on, using Qloo's Taste AI. Explains every pick for every friend.",
  openGraph: {
    title: "TasteCircle",
    description: "One night out. Everyone's taste. An AI group-outing planner powered by Qloo.",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#f1ede4" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
