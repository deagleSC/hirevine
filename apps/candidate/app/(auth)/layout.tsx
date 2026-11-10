import { AuthLayout } from "@hirevine/ui/blocks/auth-layout";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return <AuthLayout tagline="Find roles, apply, and see clear feedback on every application.">{children}</AuthLayout>;
}
