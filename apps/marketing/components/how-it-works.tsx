"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@hirevine/ui/lib/utils";

import { Screenshot } from "@/components/section";

export type Step = { title: string; body: string; image: { src: string; alt: string } };

/**
 * Steps on the left; on large screens a sticky screenshot on the right follows the step in view.
 * On smaller screens each step shows its own screenshot inline.
 */
export function HowItWorks({ steps }: { steps: Step[] }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.index));
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
      <ol className="relative grid gap-10 lg:gap-0">
        <span className="absolute top-2 bottom-2 left-[15px] hidden w-px bg-border lg:block" aria-hidden />
        <span
          className="absolute top-2 left-[15px] hidden w-px bg-primary transition-[height] duration-500 lg:block"
          style={{ height: `${(active / Math.max(1, steps.length - 1)) * 100}%` }}
          aria-hidden
        />
        {steps.map((s, i) => (
          <li
            key={s.title}
            ref={(el) => {
              refs.current[i] = el;
            }}
            data-index={i}
            className="relative grid gap-4 lg:min-h-[34vh] lg:content-center lg:pl-14"
          >
            <span
              className={cn(
                "absolute top-1/2 left-0 hidden size-8 -translate-y-1/2 items-center justify-center rounded-full border-2 bg-background text-sm font-semibold transition-colors duration-300 lg:flex",
                i <= active ? "border-primary text-primary" : "text-muted-foreground",
              )}
              aria-hidden
            >
              {i + 1}
            </span>
            <div className={cn("grid gap-2 transition-opacity duration-300", i === active ? "lg:opacity-100" : "lg:opacity-45")}>
              <p className="text-sm font-semibold text-primary lg:hidden">Step {i + 1}</p>
              <h3 className="text-2xl font-semibold tracking-tight">{s.title}</h3>
              <p className="text-pretty text-muted-foreground">{s.body}</p>
            </div>
            <div className="lg:hidden">
              <Screenshot {...s.image} />
            </div>
          </li>
        ))}
      </ol>
      <div className="hidden lg:block">
        <div className="sticky top-24">
          <div className="relative">
            {steps.map((s, i) => (
              <div
                key={s.title}
                className={cn(
                  "transition-all duration-500",
                  i === active ? "relative opacity-100" : "pointer-events-none absolute inset-0 translate-y-3 opacity-0",
                )}
              >
                <Screenshot {...s.image} priority />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
