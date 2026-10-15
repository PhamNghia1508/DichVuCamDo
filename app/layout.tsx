import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

const serif = Fraunces({ subsets: ["latin", "vietnamese"], variable: "--font-serif", display: "swap", axes: ["opsz"] });
const sans = Inter({ subsets: ["latin", "vietnamese"], variable: "--font-sans", display: "swap" });

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
