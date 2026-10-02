import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "@xyflow/react/dist/style.css";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-jb", display: "swap" });

export const metadata: Metadata = {
  title: { default: "TRACE — Turn images into evidence", template: "%s · TRACE" },
  description: "AI-powered visual research that turns photographs into searchable clues, candidates, locations, and evidence.",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#08090b", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-dvh bg-bg font-sans text-fg antialiased">{children}</body>
    </html>
  );
}
