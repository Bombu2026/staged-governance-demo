"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { Kind } from "@/lib/pools/sim";
import type { Cmd } from "./engine";

export const KIND_NAME: Record<Kind, string> = { request: "Company request", proposal: "Contributor proposal" };

export function KindTag({ kind }: { kind: Kind }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[11px] font-bold uppercase leading-none tracking-wider text-muted">
      <span aria-hidden="true" className={`inline-block size-2 rounded-full ${kind === "request" ? "bg-accent" : "bg-ink"}`} />
      {KIND_NAME[kind]}
    </span>
  );
}

type Variant = "primary" | "secondary" | "ink" | "danger" | "for" | "against" | "abstain";

const VARIANT: Record<Variant, string> = {
  primary: "border-transparent bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-pressed",
  secondary: "border-line-strong text-ink hover:bg-raised",
  ink: "border-transparent bg-ink text-canvas hover:bg-ink/85",
  danger: "border-danger/50 text-danger hover:bg-danger/12",
  for: "border-success/50 text-success hover:bg-success/12",
  against: "border-danger/50 text-danger hover:bg-danger/12",
  abstain: "border-line-strong text-muted hover:bg-raised",
};

const PRESSED: Partial<Record<Variant, string>> = {
  for: "border-transparent bg-success text-on-accent",
  against: "border-transparent bg-danger text-on-accent",
  abstain: "border-transparent bg-muted text-on-accent",
};

// A button bound to an engine command. When the action would be refused it looks blocked and says
// why, but it still takes the click, which records the refusal.
export function CmdButton({
  cmd,
  children,
  variant = "secondary",
  pressed,
  full,
  small,
}: {
  cmd: Cmd;
  children: ReactNode;
  variant?: Variant;
  pressed?: boolean;
  full?: boolean;
  small?: boolean;
}) {
  const id = useId();
  const blocked = cmd.why !== null && !pressed;
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${full ? "w-full" : "items-start"}`}>
      <button
        type="button"
        onClick={cmd.run}
        aria-pressed={pressed}
        aria-disabled={blocked || undefined}
        aria-describedby={blocked ? id : undefined}
        className={`inline-flex items-center justify-center rounded-md border font-bold leading-tight transition-colors motion-reduce:transition-none ${
          small ? "min-h-10 px-3.5 text-sm" : "min-h-12 px-[22px] text-base"
        } ${full ? "w-full" : ""} ${pressed ? (PRESSED[variant] ?? VARIANT[variant]) : blocked ? "cursor-not-allowed border-transparent bg-raised text-muted" : VARIANT[variant]}`}
      >
        {children}
      </button>
      {blocked && (
        <p id={id} className="text-[13px] leading-snug text-muted">
          {cmd.why}
        </p>
      )}
    </div>
  );
}

export function LinkButton({ href, children, variant = "secondary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" | "ink" }) {
  return (
    <a href={href} className={`inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-md border px-[22px] text-base font-bold transition-colors motion-reduce:transition-none ${VARIANT[variant]}`}>
      {children}
    </a>
  );
}

// A button that opens a small panel under it. Closes on Escape, on a click outside and when asked.
export function Menu({
  label,
  button,
  children,
  align = "right",
  buttonClass,
}: {
  label: string;
  button: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  buttonClass: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)} className={buttonClass}>
        {button}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className={`absolute top-[calc(100%+10px)] z-40 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-line-strong bg-surface p-4 shadow-[0_24px_60px_rgba(0,0,0,0.55)] ${align === "right" ? "right-0" : "left-0"}`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function Chevron() {
  return (
    <svg viewBox="0 0 12 12" className="size-3 shrink-0" aria-hidden="true">
      <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Arrow() {
  return (
    <svg viewBox="0 0 20 20" className="size-5 shrink-0" aria-hidden="true">
      <path d="M4 10h12M11 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function YouTag() {
  return <span className="rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase leading-none tracking-wider text-accent">You</span>;
}

export const LABEL = "font-mono text-[11px] font-bold uppercase tracking-wider text-muted";
