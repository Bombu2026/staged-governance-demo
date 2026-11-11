"use client";

import { type Dispatch, type ReactNode, useId } from "react";
import { type Tally, castPower, formatPower, formatUsdc, formatUsdcRounded, percentOf, percentText, quorumMet, quorumPower } from "@/lib/pools/math";
import { type Action, type Kind, type State, type Status, KIND_LABEL, STATUS_LABEL, refusal } from "@/lib/pools/sim";
import { type Tone, Badge } from "../ui";

export const STATUS_TONE: Record<Status, Tone> = {
  voting: "warning",
  "not-listed": "danger",
  funding: "accent",
  expired: "danger",
  building: "success",
  paid: "success",
  closed: "danger",
};

export function StatusBadge({ status }: { status: Status }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export function KindTag({ kind }: { kind: Kind }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-canvas px-2.5 py-1 font-mono text-[11px] font-bold uppercase leading-none tracking-wider text-ink">
      <span aria-hidden="true" className={`inline-block size-2 rounded-full ${kind === "request" ? "bg-accent" : "bg-ink"}`} />
      {KIND_LABEL[kind]}
    </span>
  );
}

export const LABEL = "font-mono text-[11px] font-bold uppercase tracking-wider text-muted";

// Binds a simulated action to a button: why it would be refused right now, and the click that tries it anyway.
export function bindPools(state: State, dispatch: Dispatch<Action>) {
  return (action: Action) => ({ why: refusal(state, action)?.text ?? null, onClick: () => dispatch(action) });
}

export type Bound = ReturnType<typeof bindPools>;

// Compact button for table rows. When blocked it still takes the click, which logs the reason.
export function RowButton({
  children,
  why,
  onClick,
  tone = "plain",
  pressed,
  label,
}: {
  children: ReactNode;
  why: string | null;
  onClick: () => void;
  tone?: "plain" | "for" | "against" | "abstain";
  pressed?: boolean;
  label?: string;
}) {
  const blocked = why !== null && !pressed;
  const on = { plain: "bg-ink text-canvas", for: "bg-success text-on-accent", against: "bg-danger text-on-accent", abstain: "bg-muted text-on-accent" }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-disabled={blocked || undefined}
      aria-label={label}
      title={blocked ? why : undefined}
      className={`min-h-11 whitespace-nowrap rounded-md border px-3 text-sm font-bold transition-colors motion-reduce:transition-none ${
        pressed
          ? `border-transparent ${on}`
          : blocked
            ? "cursor-not-allowed border-transparent bg-raised text-muted"
            : "border-line-strong text-ink hover:bg-raised"
      }`}
    >
      {children}
    </button>
  );
}

// Pledged against target. After refunds, the part that went back is hatched.
export function PoolProgress({ pledged, target, refunded = 0n, tone = "accent" }: { pledged: bigint; target: bigint; refunded?: bigint; tone?: Tone }) {
  const held = pledged - refunded;
  const fill = { neutral: "bg-ink", accent: "bg-accent", success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[tone];
  return (
    <div
      role="img"
      aria-label={`${formatUsdc(pledged)} of ${formatUsdc(target)} USDC pledged${refunded > 0n ? `, ${formatUsdc(refunded)} refunded` : ""}`}
      className="flex h-3 overflow-hidden rounded-full bg-raised"
    >
      <span className={`h-full transition-[width] motion-reduce:transition-none ${fill}`} style={{ width: `${percentOf(held, target)}%` }} />
      {refunded > 0n && <span className="hatch h-full text-muted" style={{ width: `${percentOf(refunded, target)}%` }} />}
    </div>
  );
}

const STEPS = ["Proposed", "Listed", "Funded", "Building", "Paid"] as const;

// Where each status sits on the path, and whether it left the path there.
const STEP_OF: Record<Status, { reached: number; failed: boolean }> = {
  voting: { reached: 0, failed: false },
  "not-listed": { reached: 1, failed: true },
  funding: { reached: 1, failed: false },
  expired: { reached: 2, failed: true },
  building: { reached: 3, failed: false },
  paid: { reached: 4, failed: false },
  closed: { reached: 4, failed: true },
};

export function Lifecycle({ status }: { status: Status }) {
  const { reached, failed } = STEP_OF[status];
  return (
    <ol className="grid grid-cols-5 gap-1.5" aria-label={`Lifecycle: ${STATUS_LABEL[status]}`}>
      {STEPS.map((step, i) => {
        const fail = failed && i === reached;
        const done = i <= reached && !fail;
        const label = fail ? (i === 1 ? "Not listed" : i === 2 ? "Missed" : "Closed") : step;
        return (
          <li key={step} className="min-w-0">
            <span aria-hidden="true" className={`block h-[3px] rounded-full ${fail ? "bg-danger" : done ? "bg-accent" : "bg-line-strong"}`} />
            <span
              className={`mt-1.5 block truncate font-mono text-[10px] font-bold uppercase tracking-wider sm:text-[11px] ${
                fail ? "text-danger" : done ? "text-ink" : "text-faint"
              }`}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function TallyBar({ tally }: { tally: Tally }) {
  const share = (n: bigint) => `${percentOf(n, tally.total)}%`;
  const id = useId();
  return (
    <div>
      <div className="relative pt-6">
        <span className={`absolute left-[40%] top-0 -translate-x-1/2 whitespace-nowrap ${LABEL}`}>Quorum 40%</span>
        <div className="flex h-5 overflow-hidden rounded-md bg-raised" role="img" aria-labelledby={id}>
          <div className="bg-success transition-[width] motion-reduce:transition-none" style={{ width: share(tally.for) }} />
          <div className="bg-danger transition-[width] motion-reduce:transition-none" style={{ width: share(tally.against) }} />
          <div className="hatch text-muted transition-[width] motion-reduce:transition-none" style={{ width: share(tally.abstain) }} />
        </div>
        <div className="absolute bottom-[-4px] left-[40%] top-5 w-0.5 bg-ink" aria-hidden="true" />
      </div>
      <p id={id} className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[13px] tabular-nums">
        <span>
          <span className="mr-1.5 inline-block size-2.5 rounded-[2px] bg-success" />
          For {formatPower(tally.for)}
        </span>
        <span>
          <span className="mr-1.5 inline-block size-2.5 rounded-[2px] bg-danger" />
          Against {formatPower(tally.against)}
        </span>
        <span>
          <span className="hatch mr-1.5 inline-block size-2.5 rounded-[2px] text-muted ring-1 ring-inset ring-line-strong" />
          Abstain {formatPower(tally.abstain)}
        </span>
      </p>
      <p className="mt-1.5 text-sm text-muted">
        Cast {formatPower(castPower(tally))} of {formatPower(tally.total)} power ({percentText(castPower(tally), tally.total)}%). Quorum needs{" "}
        {formatPower(quorumPower(tally.total))}: {quorumMet(tally) ? "met" : "not met yet"}.
      </p>
    </div>
  );
}

export function Money({ amount, unit = "USDC" }: { amount: bigint; unit?: string }) {
  return (
    <span className="whitespace-nowrap font-mono tabular-nums" title={`${formatUsdc(amount)} ${unit}`}>
      {formatUsdcRounded(amount)} <span className="text-muted">{unit}</span>
    </span>
  );
}
