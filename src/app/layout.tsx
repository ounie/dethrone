import type { Metadata } from "next";
import { Geist, Geist_Mono, Cinzel } from "next/font/google";
import "./globals.css";

/**
 * The same three faces the arena itself loads, self-hosted by `next/font` at
 * build time — so the read-only public deploy makes no third-party request to
 * render, which matters for a page whose whole claim is that it holds nothing
 * and phones nowhere it did not say it would.
 *
 * Cinzel is the engraved display face and is a variable font (wght 400–900), so
 * no `weight` is passed: the axis ships and `.display` picks 700.
 */
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const cinzel = Cinzel({ variable: "--font-cinzel", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Dethrone Console",
  description:
    "A single-tenant operator console for the Dethrone arena. One wallet, held server-side. The console is a keyboard, not a player.",
  // No open-graph image and no analytics. This page can hold a key; it should
  // ask the network for as little as possible and offer it nothing.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} ${cinzel.variable}`}>
        {children}
      </body>
    </html>
  );
}
