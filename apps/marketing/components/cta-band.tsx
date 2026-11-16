import { Button } from "@hirevine/ui/components/button";
import { ArrowRight } from "lucide-react";

import { LINKS } from "@/lib/site";

export function CtaBand({ title, body }: { title: string; body: string }) {
  return (
    <section className="px-4 py-16 sm:px-6 sm:py-24">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-primary px-6 py-12 text-primary-foreground sm:px-12 sm:py-16">
        <div className="absolute -top-24 -right-24 size-72 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="relative grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="grid max-w-2xl gap-3">
            <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{title}</h2>
            <p className="text-primary-foreground/85 sm:text-lg">{body}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" variant="secondary">
              <a href={LINKS.managerSignUp}>
                Start a pilot <ArrowRight />
              </a>
            </Button>
            <Button asChild size="lg" variant="ghost" className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground">
              <a href={LINKS.browseJobs}>Browse open roles</a>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
