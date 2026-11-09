import "@hirevine/ui/styles.css";
import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Providers } from "./providers";

export const metadata: Metadata = {
  title: { default: "Hirevine for hiring managers", template: "%s · Hirevine" },
  description: "AI does the screening work. You make the decisions.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
