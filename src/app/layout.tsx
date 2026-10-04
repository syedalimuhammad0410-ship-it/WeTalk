import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: { default: "WebScout AI", template: "%s · WebScout AI" },
  description: "Find businesses. Understand their websites. Discover opportunities. Start better conversations.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#fafaf9" }, { media: "(prefers-color-scheme: dark)", color: "#0c0c0e" }],
};

// Applies the saved theme before paint to avoid a flash of the wrong theme.
const themeScript = `(function(){try{var m=document.cookie.match(/(?:^|; )ws_theme=([^;]+)/);var p=m?decodeURIComponent(m[1]):'system';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.dataset.themePref=p;}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const pref = (await cookies()).get("ws_theme")?.value;
  return (
    <html lang="en" data-theme={pref === "dark" ? "dark" : pref === "light" ? "light" : undefined} className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans" style={{ ["--font-sans" as string]: "var(--font-geist-sans)", ["--font-mono" as string]: "var(--font-geist-mono)" }}>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
