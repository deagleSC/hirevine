import type { ReactNode } from "react";

/** A page section with a consistent container, spacing and optional eyebrow/title/intro. */
export function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
  muted,
  center,
}: {
  id?: string;
  eyebrow?: string;
  title?: ReactNode;
  intro?: ReactNode;
  children?: ReactNode;
  muted?: boolean;
  center?: boolean;
}) {
  return (
    <section id={id} className={"scroll-mt-20 py-16 sm:py-24 " + (muted ? "bg-muted/30" : "")}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {title ? (
          <div className={"mb-10 grid max-w-2xl gap-3 sm:mb-14 " + (center ? "mx-auto text-center" : "")}>
            {eyebrow ? <p className="text-sm font-semibold text-primary">{eyebrow}</p> : null}
            <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{title}</h2>
            {intro ? <p className="text-base text-pretty text-muted-foreground sm:text-lg">{intro}</p> : null}
          </div>
        ) : null}
        {children}
      </div>
    </section>
  );
}

/** A screenshot in a browser-like frame. */
export function Screenshot({ src, alt, priority }: { src: string; alt: string; priority?: boolean }) {
  return (
    <figure className="relative">
      <div className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-br from-primary/15 via-primary/5 to-transparent blur-2xl" aria-hidden />
      <div className="overflow-hidden rounded-xl border bg-card shadow-xl">
        <div className="flex items-center gap-1.5 border-b bg-muted/50 px-3 py-2" aria-hidden>
          <span className="size-2.5 rounded-full bg-red-400/70" />
          <span className="size-2.5 rounded-full bg-amber-400/70" />
          <span className="size-2.5 rounded-full bg-emerald-400/70" />
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- static screenshots, sized by CSS */}
        <img src={src} alt={alt} className="block h-auto w-full" loading={priority ? "eager" : "lazy"} />
      </div>
    </figure>
  );
}

/** Text beside a screenshot; alternates sides on large screens. */
export function FeatureRow({
  eyebrow,
  title,
  body,
  points,
  image,
  reverse,
}: {
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  image: { src: string; alt: string };
  reverse?: boolean;
}) {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={"grid gap-4 " + (reverse ? "lg:order-2" : "")}>
        <p className="text-sm font-semibold text-primary">{eyebrow}</p>
        <h3 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">{title}</h3>
        <p className="text-pretty text-muted-foreground">{body}</p>
        <ul className="grid gap-2 text-sm">
          {points.map((p) => (
            <li key={p} className="flex gap-2.5">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
              {p}
            </li>
          ))}
        </ul>
      </div>
      <Screenshot {...image} />
    </div>
  );
}
