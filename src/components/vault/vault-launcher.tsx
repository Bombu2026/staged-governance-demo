"use client";

import dynamic from "next/dynamic";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { IconVault } from "./icons";

const VaultWindow = dynamic(() => import("./vault-window").then((m) => m.VaultWindow), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-50 grid place-items-center bg-canvas/85">
      <p role="status" className="font-mono text-xs text-muted">
        Opening the vault…
      </p>
    </div>
  ),
});

const HASH = /^#vault(?:\/([a-z0-9-]+))?$/;

export type VaultControls = {
  open: boolean;
  count: number | null;
  request: { id: string | null; seq: number };
  headerButton: RefObject<HTMLButtonElement | null>;
  show: (trigger: HTMLElement | null) => void;
  close: () => void;
  setCount: (n: number) => void;
  setLastNote: (id: string | null) => void;
};

export function useVault(): VaultControls {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [request, setRequest] = useState<{ id: string | null; seq: number }>({ id: null, seq: 0 });
  const headerButton = useRef<HTMLButtonElement | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const lastNote = useRef<string | null>(null);

  const openOn = useCallback((id: string | null) => {
    setRequest((r) => ({ id, seq: r.seq + 1 }));
    setOpen(true);
  }, []);

  useEffect(() => {
    function fromHash() {
      const m = HASH.exec(window.location.hash);
      if (m) openOn(m[1] ?? null);
      else setOpen(false);
    }
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [openOn]);

  const show = useCallback(
    (el: HTMLElement | null) => {
      trigger.current = el;
      openOn(lastNote.current);
    },
    [openOn],
  );

  const close = useCallback(() => {
    setOpen(false);
    if (window.location.hash.startsWith("#vault")) {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
    const target = trigger.current?.isConnected ? trigger.current : headerButton.current;
    trigger.current = null;
    requestAnimationFrame(() => target?.focus());
  }, []);

  const setLastNote = useCallback((id: string | null) => {
    lastNote.current = id;
  }, []);

  return { open, count, request, headerButton, show, close, setCount, setLastNote };
}

export function VaultHost({ vault }: { vault: VaultControls }) {
  if (!vault.open) return null;
  return (
    <VaultWindow request={vault.request} onClose={vault.close} onCount={vault.setCount} onNavigate={vault.setLastNote} />
  );
}

function Count({ n }: { n: number | null }) {
  if (n === null) return null;
  return (
    <span className="font-mono text-xs font-medium tabular-nums text-muted">
      {n.toLocaleString("en-US")}
      <span className="sr-only"> notes</span>
    </span>
  );
}

export function VaultHeaderButton({ vault }: { vault: VaultControls }) {
  return (
    <button
      ref={vault.headerButton}
      type="button"
      aria-haspopup="dialog"
      onClick={(e) => vault.show(e.currentTarget)}
      className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center gap-2.5 rounded-md border border-line-strong px-2.5 text-sm font-bold text-ink transition-colors hover:bg-raised motion-reduce:transition-none sm:px-4"
    >
      <span className="sm:hidden">
        <IconVault />
      </span>
      <span className="sr-only sm:not-sr-only">Open the knowledge vault</span>
      <span className="hidden sm:inline">
        <Count n={vault.count} />
      </span>
    </button>
  );
}

export function VaultHeroButton({ vault }: { vault: VaultControls }) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={(e) => vault.show(e.currentTarget)}
      className="inline-flex min-h-11 shrink-0 items-center gap-3 rounded-md border border-line-strong px-[22px] py-2 text-base font-bold text-ink transition-colors hover:bg-raised motion-reduce:transition-none"
    >
      <IconVault />
      Open the knowledge vault
      <Count n={vault.count} />
    </button>
  );
}
