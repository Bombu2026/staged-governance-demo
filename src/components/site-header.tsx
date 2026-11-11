import Link from "next/link";
import type { ReactNode } from "react";

export const SHELL = "mx-auto w-full max-w-[1440px] px-4 sm:px-8 lg:px-12 xl:px-16";

const PAGES = [
  { id: "pools", href: "/", label: "Pooled funding" },
  { id: "governance", href: "/governance", label: "Governance" },
] as const;

export type PageId = (typeof PAGES)[number]["id"];

// Sticky notice and header shared by both pages: what this is, where you are, and the vault button.
export function SiteHeader({ current, notice, children }: { current: PageId; notice: string; children?: ReactNode }) {
  return (
    <div className="sticky top-0 z-30">
      <div className="bg-raised text-ink">
        <p role="note" className={`${SHELL} py-2 text-xs leading-snug sm:text-[13px]`}>
          <span className="mr-2 inline-block rounded-full bg-accent px-2 py-[3px] align-[1px] font-mono text-[10px] font-bold uppercase leading-none tracking-wider text-on-accent">
            Simulation
          </span>
          {notice}
        </p>
      </div>
      <header className="border-b border-line bg-[rgba(15,14,12,0.88)] backdrop-blur-md">
        <div className={`${SHELL} flex h-14 items-center justify-between gap-3 sm:h-[88px] sm:gap-6`}>
          <div className="flex min-w-0 items-center gap-3 sm:gap-8">
            <p className="hidden whitespace-nowrap text-lg font-extrabold leading-none tracking-[-0.03em] md:block md:text-[22px]">
              Slop concepts
            </p>
            <nav aria-label="Pages" className="flex items-center gap-1 rounded-full bg-surface p-1">
              {PAGES.map((page) => {
                const active = page.id === current;
                return (
                  <Link
                    key={page.id}
                    href={page.href}
                    aria-current={active ? "page" : undefined}
                    className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-bold leading-none transition-colors motion-reduce:transition-none sm:px-4 sm:py-2 sm:text-[15px] ${
                      active ? "bg-ink text-canvas" : "text-muted hover:text-ink"
                    }`}
                  >
                    {page.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex min-w-0 items-center gap-3 sm:gap-6">
            <p className="hidden min-w-0 text-right text-xs leading-tight text-muted lg:block lg:whitespace-nowrap lg:text-[13px]">
              by Bombu2026 · unofficial
            </p>
            {children}
          </div>
        </div>
      </header>
    </div>
  );
}
