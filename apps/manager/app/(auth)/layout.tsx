import { AuthLayout } from "@hirevine/ui/blocks/auth-layout";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return <AuthLayout tagline="AI does the screening work. You make the decisions.">{children}</AuthLayout>;
}
