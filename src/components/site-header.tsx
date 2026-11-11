import Link from "next/link";
import type { ReactNode } from "react";

export const SHELL = "mx-auto w-full max-w-[1276px] px-4 sm:px-8 lg:px-12";

const PAGES = [
  { id: "pools", href: "/", label: "Pools" },
  { id: "how", href: "/how-it-works", label: "How it works" },
  { id: "governance", href: "/governance", label: "Governance" },
] as const;

export type PageId = (typeof PAGES)[number]["id"];

export const NOTICE = "Unofficial concept demo made for the Slop team. Sample data, or the Base Sepolia testnet with a wallet. No real money. Not affiliated with or endorsed by slop.cash.";

function Mark() {
  return (
    <svg viewBox="0 0 36 36" className="size-9 shrink-0" aria-hidden="true">
      <rect width="36" height="36" rx="7" fill="var(--accent)" />
      <path d="M9 24.5h18" stroke="var(--on-accent)" strokeWidth="3" strokeLinecap="round" opacity="0.35" />
      <path d="M9 24.5h11" stroke="var(--on-accent)" strokeWidth="3" strokeLinecap="round" />
      <path d="M12 11v9M18 11v9M24 11v9" stroke="var(--on-accent)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// Notice, brand, page links and, on the right, whatever the page puts there: the wallet on the pools
// page, the vault button elsewhere.
export function SiteHeader({ current, children }: { current: PageId; children?: ReactNode }) {
  const links = PAGES.filter((page) => page.id !== "pools");
  return (
    <div className="sticky top-0 z-30">
      <p role="note" className="bg-raised px-4 py-1.5 text-center text-[11px] leading-snug text-muted sm:text-xs">
        {NOTICE}
      </p>
      <header className="border-b border-line bg-[rgba(15,14,12,0.9)] backdrop-blur-md">
        <div className={`${SHELL} flex h-16 items-center justify-between gap-3 sm:h-[88px]`}>
          <Link href="/" aria-label="Slop pools, unofficial concept: all pools" aria-current={current === "pools" ? "page" : undefined} className="flex min-w-0 shrink-0 items-center gap-3">
            <Mark />
            <span className="hidden truncate text-[22px] font-extrabold leading-none tracking-[-0.03em] min-[480px]:inline">Slop pools</span>
            <span className="hidden rounded-full border border-dashed border-line-strong px-2 py-[3px] font-mono text-[10px] font-bold uppercase leading-none tracking-wider text-muted lg:inline">
              Unofficial concept
            </span>
          </Link>
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <nav aria-label="Pages" className="hidden items-center gap-2 md:flex">
              {links.map((page) => (
                <Link
                  key={page.id}
                  href={page.href}
                  aria-current={page.id === current ? "page" : undefined}
                  className={`inline-flex h-10 items-center whitespace-nowrap rounded-md border px-4 text-[15px] font-bold transition-colors motion-reduce:transition-none ${
                    page.id === current ? "border-ink text-ink" : "border-line-strong text-ink hover:bg-raised"
                  }`}
                >
                  {page.label}
                </Link>
              ))}
            </nav>
            {children}
          </div>
        </div>
        <nav aria-label="Pages" className={`${SHELL} flex gap-4 overflow-x-auto pb-2.5 text-[13px] font-bold md:hidden`}>
          {PAGES.map((page) => (
            <Link key={page.id} href={page.href} aria-current={page.id === current ? "page" : undefined} className={`whitespace-nowrap ${page.id === current ? "text-ink" : "text-muted"}`}>
              {page.label}
            </Link>
          ))}
        </nav>
      </header>
    </div>
  );
}

export function SiteFooter({ children }: { children?: ReactNode }) {
  return (
    <footer className="mt-10 border-t border-line">
      <div className={`${SHELL} py-10 text-sm leading-relaxed text-muted sm:py-14`}>
        <p>{NOTICE}</p>
        {children}
      </div>
    </footer>
  );
}
