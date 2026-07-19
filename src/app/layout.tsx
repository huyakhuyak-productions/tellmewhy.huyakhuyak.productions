import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import Script from "next/script";
import { SITE_DESCRIPTION, SITE_URL } from "@/lib/site";
import { getUmamiConfig } from "@/lib/umami";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Serif display for the emotional, journal-like headings — warmth the UI
// grotesque can't carry on its own.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "tellmewhy — a private place to talk",
    template: "%s · tellmewhy",
  },
  description: SITE_DESCRIPTION,
  applicationName: "tellmewhy",
  openGraph: {
    type: "website",
    siteName: "tellmewhy",
    title: "tellmewhy — a private place to talk",
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "tellmewhy — a private place to talk",
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f5fa" },
    { media: "(prefers-color-scheme: dark)", color: "#131218" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Self-hosted, cookieless page-view analytics (disclosed in the privacy
  // copy). Renders nothing unless both env vars are set — see lib/umami.ts.
  const umami = getUmamiConfig();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {children}
        {umami && (
          <Script src={umami.src} data-website-id={umami.websiteId} strategy="afterInteractive" />
        )}
      </body>
    </html>
  );
}
