import { Badge } from "@hirevine/ui/components/badge";

const LABEL = { draft: "Draft", published: "Published", closed: "Closed" } as const;

export function JobStatusBadge({ status }: { status: keyof typeof LABEL }) {
  return <Badge variant={status === "published" ? "default" : status === "draft" ? "secondary" : "outline"}>{LABEL[status]}</Badge>;
}
