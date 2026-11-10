import Link from "next/link";
import type { ReactNode } from "react";

import { HirevineMark } from "./hirevine-mark";

/**
 * Split-screen auth page (shadcn login-02 layout, brand panel as in hirevine-v2-web):
 * a brand panel on large screens, the form centred on the other side.
 */
export function AuthLayout({ tagline, children }: { tagline: string; children: ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="relative hidden items-center justify-center bg-gradient-to-br from-primary/10 via-primary/5 to-background p-8 lg:flex">
        <div className="flex flex-col items-center gap-6 text-center">
          <HirevineMark size={96} />
          <div>
            <p className="text-lg font-semibold tracking-tight">Hirevine</p>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">{tagline}</p>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 lg:hidden">
          <Link href="/" className="flex items-center gap-2 font-medium">
            <HirevineMark size={24} className="size-6 rounded-md shadow-none" />
            Hirevine
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
    </div>
  );
}
