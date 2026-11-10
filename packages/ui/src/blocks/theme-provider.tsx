"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

import { Toaster } from "@hirevine/ui/components/sonner";
import { TooltipProvider } from "@hirevine/ui/components/tooltip";

/** Theme (light/dark/system), tooltips and toasts for the whole app. */
export function UiProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange {...props}>
      <TooltipProvider delayDuration={0}>
        {children}
        <Toaster />
      </TooltipProvider>
    </NextThemesProvider>
  );
}
