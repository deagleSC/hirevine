import { Button } from "@hirevine/ui/components/button";
import { ArrowRight } from "lucide-react";

import { Reveal } from "@/components/reveal";
import { LINKS } from "@/lib/site";

export function CtaBand({ title, body }: { title: string; body: string }) {
  return (
    <section className="px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <Reveal className="relative isolate mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-neutral-950 px-6 py-14 text-neutral-100 sm:px-12 sm:py-20">
        <div className="hv-grid absolute inset-0 -z-10 opacity-30" aria-hidden />
        <div className="absolute -right-20 -bottom-24 -z-10 h-72 w-[36rem] max-w-[200vw] rounded-full bg-primary/40 blur-3xl" aria-hidden />
        <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="grid max-w-2xl gap-3">
            <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-5xl">{title}</h2>
            <p className="text-neutral-300 sm:text-lg">{body}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="h-12 px-6 text-base">
              <a href={LINKS.tryPreview}>
                Try the preview <ArrowRight />
              </a>
            </Button>
            <Button asChild size="lg" variant="ghost" className="h-12 px-6 text-base text-neutral-100 hover:bg-white/10 hover:text-white">
              <a href={LINKS.browseJobs}>Browse open roles</a>
            </Button>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
