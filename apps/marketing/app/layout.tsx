import "./globals.css";

import { UiProvider } from "@hirevine/ui/blocks/theme-provider";
import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { KEYWORDS, SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/site";

const fontSans = Outfit({ subsets: ["latin"], variable: "--font-sans" });
const TITLE = `${SITE_NAME} — AI screening with evidence, decisions by people`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: TITLE, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  keywords: KEYWORDS,
  applicationName: SITE_NAME,
  icons: { icon: "/app-logo.png", apple: "/app-logo.png" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    images: [{ url: "/screens/analytics-campaign.png", width: 1280, height: 720, alt: "Hirevine campaign analytics" }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: SITE_DESCRIPTION, images: ["/screens/analytics-campaign.png"] },
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontSans.variable} suppressHydrationWarning>
      <body className="min-h-svh bg-background text-foreground antialiased">
        <UiProvider>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2">
            Skip to content
          </a>
          <SiteHeader />
          <main id="main">{children}</main>
          <SiteFooter />
        </UiProvider>
      </body>
    </html>
  );
}
