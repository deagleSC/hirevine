import "./globals.css";

import { UiProvider } from "@hirevine/ui/blocks/theme-provider";
import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import type { ReactNode } from "react";

import { Providers } from "./providers";

const fontSans = Outfit({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: { default: "Hirevine jobs", template: "%s · Hirevine" },
  description: "Find roles, apply, and see clear feedback on every application.",
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
