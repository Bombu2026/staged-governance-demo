"use client";

import { type Dispatch, type ReactNode, useId } from "react";
import { type Action, type State, refusal } from "@/lib/governance";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

const badgeTone: Record<Tone, string> = {
  neutral: "bg-raised text-ink",
  accent: "bg-accent/12 text-accent",
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  danger: "bg-danger/12 text-danger",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 font-mono text-[11px] font-bold uppercase leading-none tracking-wider ${badgeTone[tone]}`}
    >
      {children}
    </span>
  );
}

export function SampleTag() {
  return (
    <span className="whitespace-nowrap rounded-full border border-dashed border-line-strong px-2.5 py-[3px] font-mono text-[11px] font-medium uppercase leading-none tracking-wider text-muted">
      Sample data
    </span>
  );
}

const calloutTone: Record<Tone, { box: string; title: string }> = {
  neutral: { box: "bg-raised", title: "text-ink" },
  accent: { box: "bg-accent/12", title: "text-accent" },
  success: { box: "bg-success/12", title: "text-success" },
  warning: { box: "bg-warning/12", title: "text-warning" },
  danger: { box: "bg-danger/12", title: "text-danger" },
};

export function Callout({ tone, title, children }: { tone: Tone; title: string; children: ReactNode }) {
  return (
    <div className={`rounded-lg px-4 py-4 text-[15px] leading-relaxed sm:px-5 ${calloutTone[tone].box}`}>
      <p className={`font-bold ${calloutTone[tone].title}`}>{title}</p>
      <div className="mt-1 text-ink">{children}</div>
    </div>
  );
}

type Variant = "primary" | "secondary" | "danger";

const variantClass: Record<Variant, string> = {
  primary: "border-transparent bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-pressed",
  secondary: "border-line-strong text-ink hover:bg-raised",
  danger: "border-danger/50 text-danger hover:bg-danger/12",
};

export function bind(state: State, dispatch: Dispatch<Action>) {
  return (action: Action) => ({ why: refusal(state, action), onClick: () => dispatch(action) });
}

export function ActionButton({
  children,
  why,
  onClick,
  variant = "secondary",
}: {
  children: ReactNode;
  why: string | null;
  onClick: () => void;
  variant?: Variant;
}) {
  const id = useId();
  const blocked = why !== null;
  return (
    <div className="flex min-w-0 max-w-full flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={onClick}
        aria-disabled={blocked || undefined}
        aria-describedby={blocked ? id : undefined}
        className={`inline-flex min-h-11 items-center justify-center rounded-md border px-[22px] py-2 text-left text-base font-bold leading-tight transition-colors motion-reduce:transition-none ${
          blocked ? "cursor-not-allowed border-transparent bg-raised text-muted" : variantClass[variant]
        }`}
      >
        {children}
      </button>
      {blocked && (
        <p id={id} className="max-w-64 text-[13px] leading-snug text-muted">
          {why}
        </p>
      )}
    </div>
  );
}

export function Panel({
  title,
  meta,
  children,
  className = "",
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-xl bg-surface p-5 sm:p-8 ${className}`}>
      <header className="mb-5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 className="text-[15px] font-bold text-muted">{title}</h3>
        {meta && <div className="flex flex-wrap items-start gap-2">{meta}</div>}
      </header>
      <div className="@container space-y-5">{children}</div>
    </section>
  );
}
