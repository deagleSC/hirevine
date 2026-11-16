"use client";

import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";

/** Fades and lifts its children in when they scroll into view (CSS in globals.css). */
export function Reveal({
  children,
  delay = 0,
  as: Tag = "div",
  className,
}: {
  children: ReactNode;
  delay?: number;
  as?: ElementType;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref} data-reveal="" data-shown={shown} className={className} style={{ ["--reveal-delay" as string]: `${delay}ms` }}>
      {children}
    </Tag>
  );
}

/** Counts up to a numeric value when visible; keeps any prefix/suffix (e.g. "0.963", "100%"). */
export function CountUp({ value, className }: { value: string; className?: string }) {
  const m = value.match(/^([^\d]*)([\d.]+)(.*)$/);
  const target = m ? parseFloat(m[2]!) : 0;
  const decimals = m && m[2]!.includes(".") ? m[2]!.split(".")[1]!.length : 0;
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !m) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / 1400);
        setN(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <span ref={ref} className={className}>
      {m && n !== null ? `${m[1]}${n.toFixed(decimals)}${m[3]}` : value}
    </span>
  );
}
