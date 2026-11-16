import { HirevineMark } from "@hirevine/ui/blocks/hirevine-mark";
import Link from "next/link";

import { FOOTER, LINKS, SITE_TAGLINE } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:px-8 lg:grid-cols-[1.4fr_3fr]">
        <div className="grid content-start gap-3">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <HirevineMark size={28} className="size-7 rounded-md shadow-none" />
            Hirevine
          </Link>
          <p className="max-w-xs text-sm text-muted-foreground">{SITE_TAGLINE}</p>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {FOOTER.map((col) => (
            <div key={col.title} className="grid content-start gap-2.5">
              <h3 className="text-sm font-semibold">{col.title}</h3>
              {col.links.map((l) => (
                <Link key={l.label} href={l.href} className="text-sm text-muted-foreground hover:text-foreground">
                  {l.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="border-t">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:px-6 lg:px-8">
          <span>© {new Date().getFullYear()} Hirevine. All rights reserved.</span>
          <a href={LINKS.github} className="hover:text-foreground">Source on GitHub</a>
        </div>
      </div>
    </footer>
  );
}
