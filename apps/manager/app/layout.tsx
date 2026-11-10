import "./globals.css";

import { UiProvider } from "@hirevine/ui/blocks/theme-provider";
import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import type { ReactNode } from "react";

import { Providers } from "./providers";

const fontSans = Outfit({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: { default: "Hirevine for hiring managers", template: "%s · Hirevine" },
  description: "AI does the screening work. You make the decisions.",
  icons: { icon: "/app-logo.png", apple: "/app-logo.png" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontSans.variable} suppressHydrationWarning>
      <body>
        <UiProvider>
          <Providers>{children}</Providers>
        </UiProvider>
      </body>
    </html>
  );
}
