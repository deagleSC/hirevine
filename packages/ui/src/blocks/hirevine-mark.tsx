import { cn } from "@hirevine/ui/lib/utils";

/** Brand mark. Each app serves `/app-logo.png` from its public folder. */
export function HirevineMark({ size = 64, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/app-logo.png"
      alt="Hirevine"
      width={size}
      height={size}
      className={cn("rounded-xl object-cover shadow-sm", className)}
    />
  );
}
