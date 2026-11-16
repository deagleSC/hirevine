import type { ReactNode } from "react";

/** Title block for inner pages. */
export function PageHero({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: ReactNode; children?: ReactNode }) {
  return (
    <section className="relative overflow-hidden border-b">
      <div className="absolute inset-x-0 top-0 -z-10 h-80 bg-[radial-gradient(ellipse_at_top,var(--color-primary)_0%,transparent_65%)] opacity-10" aria-hidden />
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-14 sm:px-6 sm:py-20">
        <p className="text-sm font-semibold text-primary">{eyebrow}</p>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl">{title}</h1>
        <div className="max-w-2xl text-lg text-pretty text-muted-foreground">{intro}</div>
        {children}
      </div>
    </section>
  );
}

/** Long-form text (legal pages, about). */
export function Prose({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16 [&_a]:font-medium [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:mt-1.5 [&_p]:mt-4 [&_p]:leading-relaxed [&_p]:text-muted-foreground [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-muted-foreground">
      {children}
    </div>
  );
}
