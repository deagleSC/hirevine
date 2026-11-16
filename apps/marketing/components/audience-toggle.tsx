import { Briefcase, UserRound } from "lucide-react";
import Link from "next/link";

import { cn } from "@hirevine/ui/lib/utils";

export type Audience = "hiring" | "jobseekers";

const OPTIONS: { value: Audience; label: string; href: string; icon: typeof Briefcase }[] = [
  { value: "hiring", label: "For hiring teams", href: "/", icon: Briefcase },
  { value: "jobseekers", label: "For jobseekers", href: "/?for=jobseekers", icon: UserRound },
];

/** Switches the landing page between audiences; the choice lives in the URL so each view is linkable. */
export function AudienceToggle({ value }: { value: Audience }) {
  return (
    <nav aria-label="Choose your view" className="relative inline-grid grid-cols-2 rounded-full border bg-background/70 p-1 shadow-sm backdrop-blur">
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-primary shadow transition-transform duration-300 ease-out",
          value === "jobseekers" && "translate-x-full",
        )}
      />
      {OPTIONS.map((o) => (
        <Link
          key={o.value}
          href={o.href}
          scroll={false}
          aria-current={value === o.value ? "page" : undefined}
          className={cn(
            "relative z-10 flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors sm:px-5",
            value === o.value ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <o.icon className="size-4" aria-hidden />
          {o.label}
        </Link>
      ))}
    </nav>
  );
}
