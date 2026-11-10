"use client";

import { type KeyboardEvent, useId, useMemo, useState } from "react";
import { neighbours, type VaultIndex } from "@/lib/vault-index";

const MAX_NODES = 24;
const W = 360;
const H = 360;
const CX = W / 2;
const CY = H / 2;
const MARGIN = 4;
const CENTRE_R = 9;
const NODE_R = 6;
const CHAR_W = 5.4;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function relation(out: boolean, inc: boolean): string {
  return out && inc ? "links both ways" : out ? "linked from this note" : "links to this note";
}

export function VaultGraph({ index, current, onOpen }: { index: VaultIndex; current: number; onOpen: (i: number) => void }) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const all = useMemo(() => neighbours(index, current), [index, current]);
  const shown = all.slice(0, MAX_NODES);

  const nodes = shown.map((nb, k) => {
    // One ring; labels run outward along each node's ray, so each label keeps its own angular slot.
    const angle = -Math.PI / 2 + (2 * Math.PI * k) / shown.length;
    const r = shown.length <= 12 ? 92 : 76;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = CX + cos * r;
    const y = CY + sin * r;
    const start = r + NODE_R + 5;
    const toEdge = Math.min((CX - MARGIN) / Math.max(Math.abs(cos), 1e-6), (CY - MARGIN) / Math.max(Math.abs(sin), 1e-6));
    const leftSide = cos < -1e-6;
    const deg = (angle * 180) / Math.PI + (leftSide ? 180 : 0);
    const title = index.notes[nb.i].title;
    const label = truncate(title, Math.max(4, Math.min(24, Math.floor((toEdge - start) / CHAR_W))));
    return { ...nb, x, y, title, label, lx: CX + cos * start, ly: CY + sin * start, deg, anchor: leftSide ? ("end" as const) : ("start" as const) };
  });

  function onKey(e: KeyboardEvent<SVGGElement>, i: number) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(i);
    }
  }

  if (shown.length === 0) {
    return <p className="text-sm leading-snug text-muted">No links in or out of this note.</p>;
  }

  const active = hover === null ? null : nodes.find((n) => n.i === hover) ?? null;
  const centreTitle = index.notes[current].title;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mx-auto block h-auto w-full max-w-[420px]"
        role="group"
        aria-label={`Local graph: ${shown.length} linked notes`}
      >
        <defs>
          <marker id={`${uid}-arrow`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0.5L7.5 4L0 7.5z" fill="var(--muted)" />
          </marker>
        </defs>
        {nodes.map((n) => {
          const dx = n.x - CX;
          const dy = n.y - CY;
          const len = Math.hypot(dx, dy);
          const ux = dx / len;
          const uy = dy / len;
          const x1 = CX + ux * (CENTRE_R + 3);
          const y1 = CY + uy * (CENTRE_R + 3);
          const x2 = n.x - ux * (NODE_R + 3);
          const y2 = n.y - uy * (NODE_R + 3);
          const lit = hover === n.i;
          return (
            <line
              key={`e${n.i}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={lit ? "var(--accent)" : "var(--muted)"}
              strokeOpacity={lit ? 1 : 0.55}
              strokeWidth={1}
              strokeDasharray={n.out ? undefined : "3 3"}
              markerEnd={n.out ? `url(#${uid}-arrow)` : undefined}
              markerStart={n.in ? `url(#${uid}-arrow)` : undefined}
            />
          );
        })}
        {nodes.map((n) => (
          <g
            key={n.i}
            role="button"
            tabIndex={0}
            aria-label={`${n.title}, ${relation(n.out, n.in)}`}
            className="vault-node cursor-pointer outline-none"
            onClick={() => onOpen(n.i)}
            onKeyDown={(e) => onKey(e, n.i)}
            onMouseEnter={() => setHover(n.i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(n.i)}
            onBlur={() => setHover(null)}
          >
            <title>{n.title}</title>
            <circle cx={n.x} cy={n.y} r={14} fill="transparent" />
            <circle className="vault-node-ring" cx={n.x} cy={n.y} r={NODE_R + 4} fill="none" strokeWidth="2" />
            <circle
              cx={n.x}
              cy={n.y}
              r={NODE_R}
              fill={n.out ? "var(--raised)" : "var(--canvas)"}
              stroke={hover === n.i ? "var(--accent)" : "var(--muted)"}
              strokeWidth="1.5"
              strokeDasharray={n.out ? undefined : "2 2"}
            />
            <text
              x={n.lx}
              y={n.ly}
              dy="0.35em"
              transform={`rotate(${n.deg} ${n.lx} ${n.ly})`}
              textAnchor={n.anchor}
              fontSize="10"
              fill={hover === n.i ? "var(--ink)" : "var(--muted)"}
            >
              {n.label}
            </text>
          </g>
        ))}
        <circle cx={CX} cy={CY} r={CENTRE_R} fill="var(--accent)" />
        <text
          x={CX}
          y={CY + CENTRE_R + 15}
          textAnchor="middle"
          fontSize="11"
          fontWeight="700"
          fill="var(--ink)"
          stroke="var(--surface)"
          strokeWidth="4"
          paintOrder="stroke"
          strokeLinejoin="round"
        >
          <title>{centreTitle}</title>
          {truncate(centreTitle, 18)}
        </text>
      </svg>
      <p aria-hidden="true" className="mt-2 min-h-10 text-sm leading-snug text-ink [overflow-wrap:anywhere]">
        {active ? (
          <>
            {active.title} <span className="text-muted">· {relation(active.out, active.in)}</span>
          </>
        ) : (
          <span className="text-muted">Hover or focus a node to read its full title.</span>
        )}
      </p>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[11px] text-muted" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <svg width="26" height="8" aria-hidden="true">
            <line x1="1" y1="4" x2="20" y2="4" stroke="var(--muted)" />
            <path d="M19 1L25 4L19 7z" fill="var(--muted)" />
          </svg>
          solid: this note links to it
        </li>
        <li className="flex items-center gap-1.5">
          <svg width="26" height="8" aria-hidden="true">
            <path d="M7 1L1 4L7 7z" fill="var(--muted)" />
            <line x1="6" y1="4" x2="25" y2="4" stroke="var(--muted)" strokeDasharray="3 3" />
          </svg>
          dashed: it links here
        </li>
      </ul>
    </div>
  );
}
