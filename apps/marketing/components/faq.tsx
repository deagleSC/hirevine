import { ChevronDown } from "lucide-react";

export type FaqItem = { q: string; a: string };

/** Native <details> accordion: works without JavaScript and is keyboard accessible. */
export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <div className="mx-auto grid max-w-3xl divide-y rounded-xl border bg-card">
      {items.map((i) => (
        <details key={i.q} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
            {i.q}
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <p className="pt-3 text-sm leading-relaxed text-muted-foreground">{i.a}</p>
        </details>
      ))}
    </div>
  );
}

export function faqSchema(items: FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a } })),
  };
}
