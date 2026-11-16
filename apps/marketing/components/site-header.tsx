"use client";

import { HirevineMark } from "@hirevine/ui/blocks/hirevine-mark";
import { Button } from "@hirevine/ui/components/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@hirevine/ui/components/sheet";
import { Menu } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { LINKS, NAV } from "@/lib/site";

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header
      className={
        "sticky top-0 z-40 w-full transition-colors " +
        (scrolled ? "border-b bg-background/85 backdrop-blur" : "border-b border-transparent")
      }
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <HirevineMark size={28} className="size-7 rounded-md shadow-none" />
          Hirevine
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="ghost" className="hidden sm:inline-flex">
            <a href={LINKS.managerSignIn}>Sign in</a>
          </Button>
          <Button asChild className="hidden sm:inline-flex">
            <a href={LINKS.managerSignUp}>Start a pilot</a>
          </Button>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <nav aria-label="Mobile" className="grid gap-1 px-4">
                {NAV.map((n) => (
                  <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="rounded-md px-3 py-2.5 hover:bg-muted">
                    {n.label}
                  </Link>
                ))}
              </nav>
              <div className="grid gap-2 p-4">
                <Button asChild>
                  <a href={LINKS.managerSignUp}>Start a pilot</a>
                </Button>
                <Button asChild variant="outline">
                  <a href={LINKS.managerSignIn}>Sign in</a>
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
